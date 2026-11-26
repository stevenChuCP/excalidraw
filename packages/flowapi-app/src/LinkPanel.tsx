import { useMemo, useState } from "react";

import { brSplit, keyProblem, nextKey, stubFromLabel } from "@flowapi/core";

import { S } from "./strings";

import type {
  FlowModel,
  Operation,
  OperationStub,
  ProjectModel,
} from "@flowapi/core";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export type SelectedArrow = { flowId: string; line: number };

/**
 * The "+ link" chip for a selected flow arrow, its operation picker, and the
 * "Create operation" form (decided: creating asks first).
 */
export const LinkPanel = ({
  model,
  arrow,
  onLink,
  onCreate,
  onUnlink,
}: {
  model: ProjectModel;
  arrow: SelectedArrow;
  onLink: (specId: string, key: string) => void;
  onCreate: (specId: string, stub: OperationStub) => void;
  onUnlink: () => void;
}) => {
  const flow = model.flows.find((f) => f.id === arrow.flowId);
  const msg = flow?.messages.find((m) => m.line === arrow.line);
  const link = model.links[arrow.flowId]?.[arrow.line];
  const [mode, setMode] = useState<"chip" | "pick" | "create">("chip");
  const [query, setQuery] = useState("");

  const label = msg ? brSplit(msg.label).join(" ") : "";
  const flowSpecIds = useMemo(() => specsOfFlow(model, flow), [model, flow]);

  if (!flow || !msg) {
    return null;
  }

  const ops = model.specs
    .slice()
    .sort(
      (a, b) =>
        rank(flowSpecIds, a.id) - rank(flowSpecIds, b.id) ||
        a.name.localeCompare(b.name),
    )
    .flatMap((s) =>
      s.ops.filter((o) => o.key).map((o) => ({ spec: s, op: o })),
    );
  const q = query.trim().toLowerCase();
  const shown = ops.filter(
    ({ op }) =>
      !q ||
      `${op.key} ${op.method} ${op.path} ${op.operationId || ""} ${
        op.summary || ""
      }`
        .toLowerCase()
        .includes(q),
  );

  return (
    <div className="flowapi-link-panel" data-testid="flowapi-link-panel">
      {mode === "chip" && (
        <div className="flowapi-link-panel__row">
          {link ? (
            <>
              <span className="flowapi-key">{link.key}</span>
              <span className="flowapi-muted flowapi-ellipsis">{label}</span>
              <button
                type="button"
                className="flowapi-btn flowapi-btn--small"
                onClick={() => setMode("pick")}
                data-testid="flowapi-link-change"
              >
                {S.linkChange}
              </button>
              {msg.ref && (
                <button
                  type="button"
                  className="flowapi-btn flowapi-btn--small"
                  onClick={onUnlink}
                  data-testid="flowapi-unlink"
                >
                  {S.unlink}
                </button>
              )}
            </>
          ) : (
            <>
              <span className="flowapi-muted flowapi-ellipsis">
                {msg.ref ? S.arrowBroken(msg.ref.key) : label}
              </span>
              <button
                type="button"
                className="flowapi-btn flowapi-btn--small flowapi-btn--primary"
                onClick={() => setMode("pick")}
                data-testid="flowapi-link-chip"
              >
                {S.linkChip}
              </button>
            </>
          )}
        </div>
      )}
      {mode === "pick" && (
        <div className="flowapi-picker">
          <div className="flowapi-picker__title">{S.linkTitle(label)}</div>
          <input
            autoFocus
            className="flowapi-input"
            placeholder={S.linkSearch}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                setMode("chip");
              }
            }}
            data-testid="flowapi-link-search"
          />
          <div className="flowapi-picker__list">
            {!shown.length && <div className="flowapi-muted">{S.linkNone}</div>}
            {shown.map(({ spec, op }) => (
              <button
                key={`${spec.id}:${op.key}`}
                type="button"
                className="flowapi-picker__item"
                onClick={() => onLink(spec.id, op.key)}
                data-testid="flowapi-link-option"
                data-key={op.key}
                data-spec-id={spec.id}
              >
                <span className="flowapi-key">{op.key}</span>
                <span
                  className={`flowapi-method flowapi-method--${op.method.toLowerCase()}`}
                >
                  {op.method}
                </span>
                <span className="flowapi-ellipsis">{op.path}</span>
                {model.specs.length > 1 && (
                  <span className="flowapi-muted">{spec.name}</span>
                )}
              </button>
            ))}
          </div>
          <div className="flowapi-picker__foot">
            <button
              type="button"
              className="flowapi-btn flowapi-btn--small"
              onClick={() => setMode("chip")}
            >
              {S.cancel}
            </button>
            <button
              type="button"
              className="flowapi-btn flowapi-btn--small"
              onClick={() => setMode("create")}
              disabled={!model.specs.length}
              data-testid="flowapi-create-operation"
            >
              {S.createOperation}
            </button>
          </div>
        </div>
      )}
      {mode === "create" && (
        <CreateForm
          model={model}
          label={msg.label}
          specIds={flowSpecIds}
          onCancel={() => setMode("pick")}
          onCreate={onCreate}
        />
      )}
    </div>
  );
};

const rank = (ids: string[], id: string) => {
  const i = ids.indexOf(id);
  return i === -1 ? ids.length : i;
};

/** the specs a flow names, default first */
const specsOfFlow = (model: ProjectModel, flow: FlowModel | undefined) => {
  if (!flow) {
    return [];
  }
  const out: string[] = [];
  for (const doc of flow.oaiDocs) {
    const base = doc.file.split(/[\\/]/).pop()!.toLowerCase();
    const spec = model.specs.find((s) => s.name.toLowerCase() === base);
    if (spec && !out.includes(spec.id)) {
      out.push(spec.id);
    }
  }
  for (const l of Object.values(model.links[flow.id] || {})) {
    if (!out.includes(l.specId)) {
      out.push(l.specId);
    }
  }
  return out;
};

const CreateForm = ({
  model,
  label,
  specIds,
  onCancel,
  onCreate,
}: {
  model: ProjectModel;
  label: string;
  specIds: string[];
  onCancel: () => void;
  onCreate: (specId: string, stub: OperationStub) => void;
}) => {
  const [specId, setSpecId] = useState(specIds[0] || model.specs[0]?.id);
  const [stub, setStub] = useState<OperationStub>(() =>
    stubFromLabel(label, nextKey(model, specIds[0] || model.specs[0]?.id)),
  );
  const spec = model.specs.find((s) => s.id === specId);
  const taken = spec?.ops.find(
    (o: Operation) =>
      o.method === stub.method.toUpperCase() && o.path === stub.path,
  );
  const problem =
    keyProblem(model, specId, stub.key) ||
    (!stub.path.startsWith("/") ? S.createBadPath : null) ||
    (taken ? S.createExists(taken.key || taken.path) : null) ||
    (!/^[A-Za-z_][\w]*$/.test(stub.operationId)
      ? S.createBadOperationId
      : null);
  const field = (k: keyof OperationStub, title: string, testId: string) => (
    <label>
      {title}
      <input
        className="flowapi-input"
        value={stub[k]}
        onChange={(e) => setStub((s) => ({ ...s, [k]: e.target.value }))}
        onKeyDown={(e) => e.stopPropagation()}
        data-testid={testId}
      />
    </label>
  );
  return (
    <div className="flowapi-picker" data-testid="flowapi-create-form">
      <div className="flowapi-picker__title">{S.createTitle}</div>
      <p className="flowapi-muted">{S.createBody(spec?.name || "")}</p>
      <div className="flowapi-create">
        {model.specs.length > 1 && (
          <label>
            {S.createSpec}
            <select
              className="flowapi-input"
              value={specId}
              onChange={(e) => {
                setSpecId(e.target.value);
                setStub((s) => ({ ...s, key: nextKey(model, e.target.value) }));
              }}
            >
              {model.specs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {S.createMethod}
          <select
            className="flowapi-input"
            value={stub.method}
            onChange={(e) => setStub((s) => ({ ...s, method: e.target.value }))}
            data-testid="flowapi-create-method"
          >
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        {field("key", S.createKey, "flowapi-create-key")}
        {field("path", S.createPath, "flowapi-create-path")}
        {field("operationId", S.createOperationId, "flowapi-create-opid")}
        {field("summary", S.createSummary, "flowapi-create-summary")}
      </div>
      {problem && <div className="flowapi-error">{problem}</div>}
      <div className="flowapi-picker__foot">
        <button
          type="button"
          className="flowapi-btn flowapi-btn--small"
          onClick={onCancel}
        >
          {S.cancel}
        </button>
        <button
          type="button"
          className="flowapi-btn flowapi-btn--small flowapi-btn--primary"
          disabled={!!problem}
          onClick={() =>
            onCreate(specId, {
              ...stub,
              method: stub.method.toUpperCase(),
              key: stub.key.trim(),
            })
          }
          data-testid="flowapi-create-confirm"
        >
          {S.createConfirm}
        </button>
      </div>
    </div>
  );
};
