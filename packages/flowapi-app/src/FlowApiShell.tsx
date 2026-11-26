import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { viewportCoordsToSceneCoords } from "@excalidraw/common";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";
import {
  arrowsLinkedTo,
  importFiles,
  keyProblem,
  planKeys,
  renameKey,
  writeKeys,
} from "@flowapi/core";
import { fileOpen } from "browser-fs-access";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { BinaryFileData } from "@excalidraw/excalidraw/types";

import {
  cardsOnBoard as getCardsOnBoard,
  flowsOnBoard as getFlowsOnBoard,
  placeFlow,
  placeOperation,
  rekeyCard,
  syncBoard,
} from "./board";
import { ConfirmDialog } from "./ConfirmDialog";
import { saveTextFile, savesAsDownload } from "./files";
import {
  FLOWAPI_EXTENSION,
  parseProjectFile,
  projectFromFile,
  serializeProject,
} from "./projectFile";
import { ChecksPanel } from "./ChecksPanel";
import { SidePanel } from "./SidePanel";
import { TextEditor } from "./TextEditor";
import { KeyPatternDialog } from "./KeyPatternDialog";
import { FLOWAPI_DRAG_MIME, ProjectPanel } from "./ProjectPanel";
import { ProjectStore } from "./store";
import { S } from "./strings";

import "./flowapi.scss";

import type { Issue, KeyPattern, Operation } from "@flowapi/core";

import type { ProjectFile } from "./projectFile";

import type { DragPayload } from "./ProjectPanel";

/** files the project takes; anything else dropped goes to Excalidraw */
const IMPORT_RE = /\.(mmd|mermaid|ya?ml|json|flowapi)$/i;
const PROJECT_RE = /\.flowapi$/i;

const isAbort = (e: unknown) => (e as Error)?.name === "AbortError";

const hasOurMime = (e: React.DragEvent) =>
  Array.from(e.dataTransfer.types || []).includes(FLOWAPI_DRAG_MIME);

export const FlowApiShell = ({
  excalidrawAPI,
  theme,
  children,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  theme: "light" | "dark";
  children: React.ReactNode;
}) => {
  const store = useMemo(() => new ProjectStore(), []);
  const { project, model, name } = useSyncExternalStore(
    store.subscribe,
    store.getState,
  );
  const [sideOpen, setSideOpen] = useState(false);
  const [tabs, setTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string>("checks");
  const [jump, setJump] = useState<{
    fileId: string;
    line: number;
    n: number;
  } | null>(null);
  const checksOpen = sideOpen && activeTab === "checks";

  const toggleChecks = () => {
    if (checksOpen) {
      setSideOpen(false);
    } else {
      setActiveTab("checks");
      setSideOpen(true);
    }
  };
  const openFile = (fileId: string, line?: number) => {
    setTabs((t) => (t.includes(fileId) ? t : [...t, fileId]));
    setActiveTab(fileId);
    setSideOpen(true);
    if (line) {
      setJump((j) => ({ fileId, line, n: (j?.n || 0) + 1 }));
    }
  };
  const closeTab = (fileId: string) => {
    setTabs((t) => t.filter((x) => x !== fileId));
    if (activeTab === fileId) {
      setActiveTab("checks");
    }
  };
  const onIssueClick = (issue: Issue) => {
    if (issue.fileId) {
      openFile(issue.fileId, issue.line || 1);
    }
  };
  const [keySpecId, setKeySpecId] = useState<string | null>(null);
  const [pendingOpen, setPendingOpen] = useState<ProjectFile | null>(null);
  const [board, setBoard] = useState({
    cards: new Set<string>(),
    flows: new Set<string>(),
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const modelRef = useRef(model);
  modelRef.current = model;

  if (import.meta.env.DEV) {
    (window as any).flowapi = { store };
  }

  const toast = useCallback(
    (message: string) => excalidrawAPI?.setToast({ message, duration: 4000 }),
    [excalidrawAPI],
  );

  // which cards and flows are on the board, for the sidebar dots; and keep
  // cards and arrows in step with the model
  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }
    let sig = "";
    const update = (elements: readonly any[]) => {
      const cards = getCardsOnBoard(elements);
      const flows = getFlowsOnBoard(elements);
      const next = `${[...cards].sort().join()}|${[...flows].sort().join()}`;
      if (next !== sig) {
        sig = next;
        setBoard({ cards, flows });
        syncBoard(excalidrawAPI, modelRef.current);
      }
    };
    update(excalidrawAPI.getSceneElements());
    return excalidrawAPI.onChange((elements) => update(elements));
  }, [excalidrawAPI]);

  useEffect(() => {
    if (excalidrawAPI) {
      syncBoard(excalidrawAPI, model);
    }
  }, [excalidrawAPI, model]);

  const applyProjectFile = useCallback(
    (file: ProjectFile) => {
      store.fileHandle = null;
      store.setProject(projectFromFile(file), file.meta.name);
      if (excalidrawAPI) {
        const { zoom, scrollX, scrollY, viewBackgroundColor } =
          file.canvas.appState;
        excalidrawAPI.addFiles(
          Object.values(file.canvas.files) as BinaryFileData[],
        );
        excalidrawAPI.updateScene({
          elements: restoreElements(file.canvas.elements, null, {
            repairBindings: true,
          }),
          appState: {
            zoom: { value: zoom as any },
            scrollX,
            scrollY,
            viewBackgroundColor:
              viewBackgroundColor ||
              excalidrawAPI.getAppState().viewBackgroundColor,
            selectedElementIds: {},
          },
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        excalidrawAPI.history.clear();
      }
      toast(S.projectOpened(file.meta.name));
    },
    [excalidrawAPI, store, toast],
  );

  const openProjectFile = useCallback(
    async (file: File) => {
      let parsed: ProjectFile;
      try {
        parsed = parseProjectFile(await file.text());
      } catch (e) {
        toast(S.projectBadFile(file.name, (e as Error).message));
        return;
      }
      if (!parsed.meta.name || parsed.meta.name === "project") {
        parsed.meta.name = file.name.replace(PROJECT_RE, "");
      }
      const { project: cur } = store.getState();
      const boardEmpty = !excalidrawAPI?.getSceneElements().length;
      if (!cur.flows.length && !cur.specs.length && boardEmpty) {
        applyProjectFile(parsed);
      } else {
        setPendingOpen(parsed);
      }
    },
    [applyProjectFile, excalidrawAPI, store, toast],
  );

  const saveProject = useCallback(async () => {
    if (!excalidrawAPI) {
      return;
    }
    const base = store.fileBaseName();
    const text = serializeProject(
      base,
      store.getState().project,
      excalidrawAPI.getSceneElementsIncludingDeleted(),
      excalidrawAPI.getAppState(),
      excalidrawAPI.getFiles(),
    );
    const download = savesAsDownload();
    try {
      const handle = await saveTextFile(
        text,
        `${base}.${FLOWAPI_EXTENSION}`,
        "application/json",
        "FlowAPI project",
        store.fileHandle,
      );
      store.fileHandle = handle || null;
      const savedName = handle?.name?.replace(PROJECT_RE, "") || base;
      if (savedName !== store.getState().name) {
        store.setName(savedName);
      }
      toast(
        `${S.projectSaved(`${savedName}.${FLOWAPI_EXTENSION}`)}${
          download ? `\n${S.downloadNote}` : ""
        }`,
      );
    } catch (e) {
      if (!isAbort(e)) {
        toast((e as Error).message);
      }
    }
  }, [excalidrawAPI, store, toast]);

  const openProject = useCallback(async () => {
    try {
      const file = await fileOpen({
        extensions: [`.${FLOWAPI_EXTENSION}`],
        description: "FlowAPI project",
      });
      await openProjectFile(file);
    } catch (e) {
      if (!isAbort(e)) {
        toast((e as Error).message);
      }
    }
  }, [openProjectFile, toast]);

  const onRenameKey = (op: Operation, newKey: string): string | null => {
    const m = store.getState().model;
    const problem = keyProblem(m, op.specId, newKey, op);
    if (problem) {
      return problem;
    }
    const arrows = arrowsLinkedTo(m, op.specId, op.key).length;
    if (excalidrawAPI) {
      rekeyCard(excalidrawAPI, op.specId, op.key, newKey);
    }
    store.setProject(renameKey(m, op.specId, op, newKey));
    toast(S.keyRenamed(op.key, newKey, arrows));
    return null;
  };

  const addFiles = useCallback(
    async (all: File[]) => {
      const projectFiles = all.filter((f) => PROJECT_RE.test(f.name));
      if (projectFiles.length) {
        await openProjectFile(projectFiles[0]);
      }
      const files = all.filter((f) => !PROJECT_RE.test(f.name));
      if (!files.length) {
        return;
      }
      const read = await Promise.all(
        files.map(async (f) => ({ name: f.name, text: await f.text() })),
      );
      const result = importFiles(store.getState().project, read);
      store.setProject(result.project);
      const msgs: string[] = [];
      if (result.added.length) {
        msgs.push(S.imported(result.added.length));
      }
      for (const a of result.added) {
        if (a.renamedFrom) {
          msgs.push(S.renamed(a.renamedFrom, a.name));
        }
      }
      for (const r of result.rejected) {
        msgs.push(S.rejected(r.name, r.reason));
      }
      const m = store.getState().model;
      for (const missing of m.missingSpecs) {
        if (result.added.some((a) => a.id === missing.flowId)) {
          const flow = m.flows.find((f) => f.id === missing.flowId);
          msgs.push(`${flow?.name} ${S.needs(missing.file)}`);
        }
      }
      if (msgs.length) {
        toast(msgs.join("\n"));
      }
      // a spec with operations that have no key: ask for a naming pattern
      const keyless = result.added.find(
        (a) =>
          a.kind === "spec" &&
          m.specs.find((s) => s.id === a.id)?.ops.some((op) => !op.key),
      );
      if (keyless) {
        setKeySpecId(keyless.id);
      }
    },
    [openProjectFile, store, toast],
  );

  const onWriteKeys = (specId: string, pattern: KeyPattern) => {
    const spec = model.specs.find((s) => s.id === specId);
    const file = project.specs.find((s) => s.id === specId);
    if (!spec || !file) {
      return;
    }
    const plan = planKeys(spec.ops, pattern);
    store.setFileText(specId, writeKeys(file.text, plan));
    setKeySpecId(null);
    toast(S.keysWritten(plan.length, spec.name));
  };

  const onDragOver = (e: React.DragEvent) => {
    if (hasOurMime(e)) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
    } else if (Array.from(e.dataTransfer.types || []).includes("Files")) {
      // file names show only on drop; Excalidraw keeps its own dragover
      e.preventDefault();
    }
  };

  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(FLOWAPI_DRAG_MIME);
    if (raw) {
      e.preventDefault();
      e.stopPropagation();
      if (!excalidrawAPI) {
        return;
      }
      const payload = JSON.parse(raw) as DragPayload;
      const p = viewportCoordsToSceneCoords(
        { clientX: e.clientX, clientY: e.clientY },
        excalidrawAPI.getAppState(),
      );
      const m = store.getState().model;
      if (payload.type === "op") {
        const op = m.specs
          .find((s) => s.id === payload.specId)
          ?.ops.find((o) => o.key === payload.key);
        if (op) {
          placeOperation(excalidrawAPI, op, { x: p.x - 150, y: p.y - 52 });
        }
      } else {
        const flow = m.flows.find((f) => f.id === payload.flowId);
        if (flow) {
          placeFlow(excalidrawAPI, m, flow, p);
        }
      }
      return;
    }
    const files = Array.from(e.dataTransfer.files || []);
    const ours = files.filter((f) => IMPORT_RE.test(f.name));
    if (ours.length && ours.length === files.length) {
      e.preventDefault();
      e.stopPropagation();
      addFiles(ours);
    }
  };

  const keySpec = keySpecId
    ? model.specs.find((s) => s.id === keySpecId)
    : null;

  return (
    <div
      className={`flowapi-shell${
        theme === "dark" ? " flowapi-shell--dark" : ""
      }`}
    >
      <div
        className="flowapi-shell__side"
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <ProjectPanel
          model={model}
          name={name}
          cardsOnBoard={board.cards}
          flowsOnBoard={board.flows}
          checksOpen={checksOpen}
          activeFileId={sideOpen && activeTab !== "checks" ? activeTab : null}
          actions={{
            addFiles: () => fileInput.current?.click(),
            removeFile: (id) => {
              closeTab(id);
              store.removeFile(id);
            },
            toggleChecks,
            openFile: (id) => openFile(id),
            nameKeys: (id) => setKeySpecId(id),
            openProject,
            saveProject,
            renameKey: onRenameKey,
          }}
        />
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".mmd,.mermaid,.yaml,.yml,.json,.flowapi"
          style={{ display: "none" }}
          data-testid="flowapi-file-input"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            if (files.length) {
              addFiles(files);
            }
          }}
        />
      </div>
      <div
        className="flowapi-shell__canvas"
        onDragOverCapture={onDragOver}
        onDropCapture={onDrop}
      >
        {children}
        {sideOpen && (
          <SidePanel
            tabs={[
              { id: "checks", label: S.checks, testId: "flowapi-tab-checks" },
              ...tabs
                .map((id) =>
                  [...project.flows, ...project.specs].find((f) => f.id === id),
                )
                .filter((f): f is NonNullable<typeof f> => !!f)
                .map((f) => ({
                  id: f.id,
                  label: f.name,
                  testId: "flowapi-tab-file",
                })),
            ]}
            active={activeTab}
            onSelect={setActiveTab}
            onCloseTab={closeTab}
            onClose={() => setSideOpen(false)}
          >
            {activeTab === "checks" ? (
              <ChecksPanel model={model} onIssueClick={onIssueClick} />
            ) : (
              (() => {
                const file = [...project.flows, ...project.specs].find(
                  (f) => f.id === activeTab,
                );
                return file ? (
                  <TextEditor
                    key={file.id}
                    file={file}
                    onChange={(text) => store.setFileText(file.id, text)}
                    jump={jump?.fileId === file.id ? jump : null}
                  />
                ) : null;
              })()
            )}
          </SidePanel>
        )}
      </div>
      {pendingOpen && (
        <ConfirmDialog
          title={S.replaceTitle}
          confirmLabel={S.replaceConfirm}
          onConfirm={() => {
            const file = pendingOpen;
            setPendingOpen(null);
            applyProjectFile(file);
          }}
          onCancel={() => setPendingOpen(null)}
          testId="flowapi-replace-dialog"
        >
          <p>{S.replaceBody}</p>
        </ConfirmDialog>
      )}
      {keySpec && (
        <KeyPatternDialog
          spec={keySpec}
          onWrite={(pattern) => onWriteKeys(keySpec.id, pattern)}
          onClose={() => setKeySpecId(null)}
        />
      )}
    </div>
  );
};
