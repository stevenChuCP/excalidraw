import { useEffect, useRef, useState } from "react";

import { describeOp, isOperationUsed } from "@flowapi/core";

import { cardId } from "./layout";
import { S } from "./strings";

import type { Operation, ProjectModel, SpecModel } from "@flowapi/core";

export const FLOWAPI_DRAG_MIME = "application/x-flowapi";

export type DragPayload =
  | { type: "op"; specId: string; key: string }
  | { type: "flow"; flowId: string };

const setDrag = (e: React.DragEvent, payload: DragPayload) => {
  e.dataTransfer.setData(FLOWAPI_DRAG_MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = "copy";
};

const issueCount = (model: ProjectModel) =>
  model.issues.filter(
    (i) => i.level === "error" || i.level === "warning" || i.level === "gap",
  ).length;

export type PanelActions = {
  addFiles: () => void;
  removeFile: (fileId: string) => void;
  toggleChecks: () => void;
  nameKeys: (specId: string) => void;
  openProject?: () => void;
  saveProject?: () => void;
  exportHtml?: () => void;
  /** returns an error to show, or null when the key was renamed */
  renameKey?: (op: Operation, newKey: string) => string | null;
  openFile?: (fileId: string) => void;
  exportFile?: (fileId: string) => void;
  deleteOperation?: (op: Operation) => void;
};

type MenuItem = { label: string; onSelect: () => void; testId: string };

/** a ⋯ button with a small menu */
const RowMenu = ({ items }: { items: MenuItem[] }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [open]);
  if (!items.length) {
    return null;
  }
  return (
    <span className="flowapi-menu" ref={ref}>
      <button
        type="button"
        className={`flowapi-x${open ? " flowapi-x--on" : ""}`}
        title={S.more}
        data-testid="flowapi-row-menu"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {S.moreIcon}
      </button>
      {open && (
        <span className="flowapi-menu__list" role="menu">
          {items.map((item) => (
            <button
              key={item.testId}
              type="button"
              role="menuitem"
              data-testid={item.testId}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
};

export const ProjectPanel = ({
  model,
  name,
  cardsOnBoard,
  flowsOnBoard,
  checksOpen,
  activeFileId,
  actions,
}: {
  model: ProjectModel;
  name: string;
  cardsOnBoard: Set<string>;
  flowsOnBoard: Set<string>;
  checksOpen: boolean;
  activeFileId?: string | null;
  actions: PanelActions;
}) => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const nIssues = issueCount(model);
  const empty = !model.flows.length && !model.specs.length;

  const fileItems = (fileId: string, kind: "flow" | "spec"): MenuItem[] => [
    ...(actions.openFile
      ? [
          {
            label: kind === "flow" ? S.editFlowText : S.editSpecText,
            onSelect: () => actions.openFile!(fileId),
            testId: "flowapi-menu-edit",
          },
        ]
      : []),
    ...(actions.exportFile
      ? [
          {
            label: kind === "flow" ? S.exportFlow : S.exportSpec,
            onSelect: () => actions.exportFile!(fileId),
            testId: "flowapi-menu-export",
          },
        ]
      : []),
    {
      label: S.remove,
      onSelect: () => actions.removeFile(fileId),
      testId: "flowapi-menu-remove",
    },
  ];

  return (
    <aside className="flowapi-panel" data-testid="flowapi-panel">
      <div className="flowapi-panel__head">
        <span className="flowapi-panel__title" title={name || S.panelTitle}>
          {name || S.panelTitle}
        </span>
        <span className="flowapi-panel__tools">
          {actions.openProject && (
            <button
              type="button"
              className="flowapi-btn flowapi-btn--small"
              onClick={actions.openProject}
              data-testid="flowapi-open-project"
              title={S.openProjectHint}
            >
              {S.openProject}
            </button>
          )}
          {actions.saveProject && (
            <button
              type="button"
              className="flowapi-btn flowapi-btn--small"
              onClick={actions.saveProject}
              data-testid="flowapi-save-project"
              title={S.saveProjectHint}
            >
              {S.saveProject}
            </button>
          )}
          {actions.exportHtml && (
            <button
              type="button"
              className="flowapi-btn flowapi-btn--small"
              onClick={actions.exportHtml}
              data-testid="flowapi-export-html"
              title={S.exportHtmlHint}
            >
              {S.exportHtmlButton}
            </button>
          )}
          <button
            type="button"
            className={`flowapi-btn flowapi-btn--small${
              checksOpen ? " flowapi-btn--on" : ""
            }`}
            onClick={actions.toggleChecks}
            data-testid="flowapi-checks-button"
          >
            {S.checks}
            {nIssues > 0 && <span className="flowapi-count">{nIssues}</span>}
          </button>
        </span>
      </div>

      {empty && <p className="flowapi-panel__empty">{S.emptyProject}</p>}

      <section className="flowapi-section" data-testid="flowapi-flows">
        <h3>{S.flows}</h3>
        {!model.flows.length && (
          <div className="flowapi-muted">{S.emptyFlows}</div>
        )}
        {model.flows.map((flow) => {
          const missing = model.missingSpecs.filter(
            (m) => m.flowId === flow.id,
          );
          const on = flowsOnBoard.has(flow.id);
          return (
            <div key={flow.id} className="flowapi-item">
              <div
                className={`flowapi-row flowapi-row--flow${
                  activeFileId === flow.id ? " flowapi-row--active" : ""
                }`}
                draggable
                onDragStart={(e) =>
                  setDrag(e, { type: "flow", flowId: flow.id })
                }
                onDoubleClick={() => actions.openFile?.(flow.id)}
                title={`${on ? S.onBoard : S.notOnBoard} · ${S.dragHint}${
                  actions.openFile ? `\n${S.doubleClickToEdit}` : ""
                }`}
                data-testid="flowapi-flow-row"
                data-flow-id={flow.id}
              >
                <span
                  className={`flowapi-dot${on ? " flowapi-dot--on" : ""}`}
                />
                <span className="flowapi-name">{flow.name}</span>
                <span className="flowapi-muted">
                  {S.flowSize(flow.parts.length, flow.messages.length)}
                </span>
                <RowMenu items={fileItems(flow.id, "flow")} />
              </div>
              {missing.map((m) => (
                <div
                  key={m.file}
                  className="flowapi-needs"
                  data-testid="flowapi-needs"
                >
                  {S.needs(m.file)}
                  {S.sep}
                  <button
                    type="button"
                    className="flowapi-link"
                    onClick={actions.addFiles}
                  >
                    {S.addFile}
                  </button>
                </div>
              ))}
            </div>
          );
        })}
      </section>

      <section className="flowapi-section" data-testid="flowapi-specs">
        <h3>{S.specs}</h3>
        {!model.specs.length && (
          <div className="flowapi-muted">{S.emptySpecs}</div>
        )}
        {model.specs.map((spec) => (
          <SpecItem
            key={spec.id}
            spec={spec}
            model={model}
            cardsOnBoard={cardsOnBoard}
            collapsed={!!collapsed[spec.id]}
            active={activeFileId === spec.id}
            onToggle={() =>
              setCollapsed((c) => ({ ...c, [spec.id]: !c[spec.id] }))
            }
            menu={fileItems(spec.id, "spec")}
            actions={actions}
          />
        ))}
      </section>

      <div className="flowapi-panel__foot">
        <button
          type="button"
          className="flowapi-btn flowapi-btn--wide"
          onClick={actions.addFiles}
          data-testid="flowapi-add-files"
        >
          {S.addFiles}
        </button>
      </div>
    </aside>
  );
};

const SpecItem = ({
  spec,
  model,
  cardsOnBoard,
  collapsed,
  active,
  onToggle,
  menu,
  actions,
}: {
  spec: SpecModel;
  model: ProjectModel;
  cardsOnBoard: Set<string>;
  collapsed: boolean;
  active: boolean;
  onToggle: () => void;
  menu: MenuItem[];
  actions: PanelActions;
}) => {
  const unused = spec.ops.filter(
    (op) => op.key && !isOperationUsed(model, op),
  ).length;
  const keyless = spec.ops.filter((op) => !op.key).length;
  return (
    <div
      className="flowapi-item"
      data-testid="flowapi-spec"
      data-spec-id={spec.id}
    >
      <div
        className={`flowapi-row flowapi-row--spec${
          active ? " flowapi-row--active" : ""
        }`}
        onClick={onToggle}
        onDoubleClick={() => actions.openFile?.(spec.id)}
      >
        <span className="flowapi-caret">
          {collapsed ? S.caretClosed : S.caretOpen}
        </span>
        <span className="flowapi-name">{spec.name}</span>
        <RowMenu items={menu} />
      </div>
      <div className="flowapi-sub">
        <span data-testid="flowapi-op-count">{S.ops(spec.ops.length)}</span>
        {unused > 0 && (
          <span>
            {S.sep}
            {S.unused(unused)}
          </span>
        )}
        {keyless > 0 && (
          <>
            {S.sep}
            <button
              type="button"
              className="flowapi-link"
              onClick={() => actions.nameKeys(spec.id)}
              data-testid="flowapi-name-keys"
            >
              {S.nameKeys}
            </button>
          </>
        )}
      </div>
      {!collapsed &&
        spec.ops.map((op) => (
          <OperationRow
            key={`${op.webhook} ${op.method} ${op.path}`}
            op={op}
            on={!!op.key && cardsOnBoard.has(cardId(spec.id, op.key))}
            actions={actions}
          />
        ))}
    </div>
  );
};

const OperationRow = ({
  op,
  on,
  actions,
}: {
  op: Operation;
  on: boolean;
  actions: PanelActions;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(op.key);
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    const next = draft.trim();
    if (!next || next === op.key) {
      setEditing(false);
      setError(null);
      return;
    }
    const problem = actions.renameKey?.(op, next) ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    setEditing(false);
    setError(null);
  };

  const items: MenuItem[] = [
    ...(actions.renameKey && op.key
      ? [
          {
            label: S.renameKey,
            onSelect: () => {
              setDraft(op.key);
              setEditing(true);
            },
            testId: "flowapi-menu-rename-key",
          },
        ]
      : []),
    ...(actions.deleteOperation
      ? [
          {
            label: S.deleteOperation,
            onSelect: () => actions.deleteOperation!(op),
            testId: "flowapi-menu-delete-op",
          },
        ]
      : []),
  ];

  return (
    <>
      <div
        className={`flowapi-row flowapi-row--op${
          op.key ? "" : " flowapi-row--disabled"
        }`}
        draggable={!!op.key && !editing}
        onDragStart={(e) =>
          setDrag(e, { type: "op", specId: op.specId, key: op.key })
        }
        title={`${describeOp(op)}\n${
          op.key
            ? `${on ? S.onBoard : S.notOnBoard} · ${S.dragHint}`
            : S.keyFirst
        }${op.gaps.length ? `\n\n${op.gaps.join("\n")}` : ""}`}
        data-testid="flowapi-op-row"
        data-key={op.key}
      >
        <span className={`flowapi-dot${on ? " flowapi-dot--on" : ""}`} />
        {editing ? (
          <input
            className="flowapi-key-input"
            value={draft}
            autoFocus
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                commit();
              } else if (e.key === "Escape") {
                setEditing(false);
                setError(null);
              }
            }}
            onBlur={commit}
            data-testid="flowapi-key-input"
          />
        ) : (
          <span
            className="flowapi-key"
            onDoubleClick={(e) => {
              if (actions.renameKey && op.key) {
                e.stopPropagation();
                setDraft(op.key);
                setEditing(true);
              }
            }}
          >
            {op.key || S.noKey}
          </span>
        )}
        <span
          className={`flowapi-method flowapi-method--${op.method.toLowerCase()}`}
        >
          {op.method}
        </span>
        <span className="flowapi-name">{op.operationId || op.path}</span>
        {op.gaps.length > 0 && (
          <span
            className="flowapi-gap"
            data-testid="flowapi-gap"
            title={op.gaps.join("\n")}
          />
        )}
        <RowMenu items={items} />
      </div>
      {error && (
        <div className="flowapi-row-error" data-testid="flowapi-key-error">
          {error}
        </div>
      )}
    </>
  );
};
