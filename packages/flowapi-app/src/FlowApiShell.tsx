import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { viewportCoordsToSceneCoords } from "@excalidraw/common";
import { importFiles, planKeys, writeKeys } from "@flowapi/core";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  cardsOnBoard as getCardsOnBoard,
  flowsOnBoard as getFlowsOnBoard,
  placeFlow,
  placeOperation,
  syncBoard,
} from "./board";
import { ChecksPanel } from "./ChecksPanel";
import { KeyPatternDialog } from "./KeyPatternDialog";
import { FLOWAPI_DRAG_MIME, ProjectPanel } from "./ProjectPanel";
import { ProjectStore } from "./store";
import { S } from "./strings";

import "./flowapi.scss";

import type { KeyPattern } from "@flowapi/core";

import type { DragPayload } from "./ProjectPanel";

/** files the project takes; anything else dropped goes to Excalidraw */
const IMPORT_RE = /\.(mmd|mermaid|ya?ml|json)$/i;

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
  const { project, model } = useSyncExternalStore(
    store.subscribe,
    store.getState,
  );
  const [checksOpen, setChecksOpen] = useState(false);
  const [keySpecId, setKeySpecId] = useState<string | null>(null);
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

  const addFiles = useCallback(
    async (files: File[]) => {
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
    [store, toast],
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
          cardsOnBoard={board.cards}
          flowsOnBoard={board.flows}
          onAddFiles={() => fileInput.current?.click()}
          onRemove={(id) => store.removeFile(id)}
          onOpenChecks={() => setChecksOpen((o) => !o)}
          onNameKeys={(id) => setKeySpecId(id)}
          checksOpen={checksOpen}
        />
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".mmd,.mermaid,.yaml,.yml,.json"
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
        {checksOpen && (
          <ChecksPanel model={model} onClose={() => setChecksOpen(false)} />
        )}
      </div>
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
