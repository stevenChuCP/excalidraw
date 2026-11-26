import { useState } from "react";

import { describeOp, isOperationUsed } from "@flowapi/core";

import { cardId } from "./layout";
import { S } from "./strings";

import type { ProjectModel, SpecModel } from "@flowapi/core";

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

export const ProjectPanel = ({
  model,
  cardsOnBoard,
  flowsOnBoard,
  onAddFiles,
  onRemove,
  onOpenChecks,
  onNameKeys,
  checksOpen,
}: {
  model: ProjectModel;
  cardsOnBoard: Set<string>;
  flowsOnBoard: Set<string>;
  onAddFiles: () => void;
  onRemove: (fileId: string) => void;
  onOpenChecks: () => void;
  onNameKeys: (specId: string) => void;
  checksOpen: boolean;
}) => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const nIssues = issueCount(model);
  const empty = !model.flows.length && !model.specs.length;

  return (
    <aside className="flowapi-panel" data-testid="flowapi-panel">
      <div className="flowapi-panel__head">
        <span className="flowapi-panel__title">{S.panelTitle}</span>
        <button
          type="button"
          className={`flowapi-btn${checksOpen ? " flowapi-btn--on" : ""}`}
          onClick={onOpenChecks}
          data-testid="flowapi-checks-button"
        >
          {S.checks}
          {nIssues > 0 && <span className="flowapi-count">{nIssues}</span>}
        </button>
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
                className="flowapi-row flowapi-row--flow"
                draggable
                onDragStart={(e) =>
                  setDrag(e, { type: "flow", flowId: flow.id })
                }
                title={`${on ? S.onBoard : S.notOnBoard} · ${S.dragHint}`}
                data-testid="flowapi-flow-row"
                data-flow-id={flow.id}
              >
                <span
                  className={`flowapi-dot${on ? " flowapi-dot--on" : ""}`}
                />
                <span className="flowapi-name">{flow.name}</span>
                <span className="flowapi-muted">
                  {flow.parts.length}·{flow.messages.length}
                </span>
                <button
                  type="button"
                  className="flowapi-x"
                  title={S.remove}
                  onClick={() => onRemove(flow.id)}
                >
                  ×
                </button>
              </div>
              {missing.map((m) => (
                <div
                  key={m.file}
                  className="flowapi-needs"
                  data-testid="flowapi-needs"
                >
                  {S.needs(m.file)} ·{" "}
                  <button
                    type="button"
                    className="flowapi-link"
                    onClick={onAddFiles}
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
            onToggle={() =>
              setCollapsed((c) => ({ ...c, [spec.id]: !c[spec.id] }))
            }
            onRemove={() => onRemove(spec.id)}
            onNameKeys={() => onNameKeys(spec.id)}
          />
        ))}
      </section>

      <div className="flowapi-panel__foot">
        <button
          type="button"
          className="flowapi-btn flowapi-btn--wide"
          onClick={onAddFiles}
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
  onToggle,
  onRemove,
  onNameKeys,
}: {
  spec: SpecModel;
  model: ProjectModel;
  cardsOnBoard: Set<string>;
  collapsed: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onNameKeys: () => void;
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
      <div className="flowapi-row flowapi-row--spec" onClick={onToggle}>
        <span className="flowapi-caret">{collapsed ? "▸" : "▾"}</span>
        <span className="flowapi-name">{spec.name}</span>
        <button
          type="button"
          className="flowapi-x"
          title={S.remove}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      </div>
      <div className="flowapi-sub">
        <span data-testid="flowapi-op-count">{S.ops(spec.ops.length)}</span>
        {unused > 0 && <span> · {S.unused(unused)}</span>}
        {keyless > 0 && (
          <>
            {" · "}
            <button
              type="button"
              className="flowapi-link"
              onClick={onNameKeys}
              data-testid="flowapi-name-keys"
            >
              {S.nameKeys}
            </button>
          </>
        )}
      </div>
      {!collapsed &&
        spec.ops.map((op) => {
          const on = !!op.key && cardsOnBoard.has(cardId(spec.id, op.key));
          return (
            <div
              key={`${op.method} ${op.path}`}
              className={`flowapi-row flowapi-row--op${
                op.key ? "" : " flowapi-row--disabled"
              }`}
              draggable={!!op.key}
              onDragStart={(e) =>
                setDrag(e, { type: "op", specId: spec.id, key: op.key })
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
              <span className="flowapi-key">{op.key || S.noKey}</span>
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
            </div>
          );
        })}
    </div>
  );
};
