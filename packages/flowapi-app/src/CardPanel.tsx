import { brSplit } from "@flowapi/core";

import { S } from "./strings";

import type { ProjectModel } from "@flowapi/core";

/**
 * Shown while one API card is selected: expand or collapse it, and the arrows
 * that use it (clicking one selects that arrow on the board).
 */
export const CardPanel = ({
  model,
  specId,
  opKey,
  expanded,
  onToggle,
  onArrow,
}: {
  model: ProjectModel;
  specId: string;
  opKey: string;
  expanded: boolean;
  onToggle: () => void;
  onArrow: (flowId: string, line: number) => void;
}) => {
  const uses = model.flows.flatMap((flow) =>
    Object.values(model.links[flow.id] || {})
      .filter((l) => l.specId === specId && l.key === opKey)
      .map((l) => ({
        flow,
        line: l.line,
        msg: flow.messages.find((m) => m.line === l.line),
      })),
  );
  return (
    <div className="flowapi-link-panel" data-testid="flowapi-card-panel">
      <div className="flowapi-link-panel__row">
        <span className="flowapi-key">{opKey}</span>
        <span className="flowapi-muted flowapi-ellipsis">
          {S.cardUsedBy(uses.length)}
        </span>
        <button
          type="button"
          className="flowapi-btn flowapi-btn--small flowapi-btn--primary"
          onClick={onToggle}
          data-testid="flowapi-card-toggle"
        >
          {expanded ? S.cardCollapse : S.cardExpand}
        </button>
      </div>
      {uses.length > 0 && (
        <div className="flowapi-card-uses">
          {uses.map(({ flow, line, msg }) => (
            <button
              key={`${flow.id}:${line}`}
              type="button"
              className="flowapi-picker__item"
              onClick={() => onArrow(flow.id, line)}
              data-testid="flowapi-card-use"
            >
              <span className="flowapi-muted">{flow.name}</span>
              <span className="flowapi-ellipsis">
                {msg ? brSplit(msg.label).join(" ") : S.lineN(line)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
