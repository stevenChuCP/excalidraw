import { S } from "./strings";

import type { Issue, IssueLevel, ProjectModel } from "@flowapi/core";

const ORDER: IssueLevel[] = [
  "error",
  "warning",
  "gap",
  "guess",
  "unused",
  "info",
];

export const linkCount = (model: ProjectModel) =>
  Object.values(model.links).reduce((n, l) => n + Object.keys(l).length, 0);

/** the Checks tab: findings grouped like today's viewer; click one to open its line */
export const ChecksPanel = ({
  model,
  onIssueClick,
  renderFix,
}: {
  model: ProjectModel;
  onIssueClick?: (issue: Issue) => void;
  /** a one-click fix button for an issue, when there is one */
  renderFix?: (issue: Issue) => React.ReactNode;
}) => {
  const files = new Map(
    [...model.project.flows, ...model.project.specs].map((f) => [f.id, f.name]),
  );
  const where = (i: Issue) => {
    const name = i.fileId ? files.get(i.fileId) : null;
    if (!name) {
      return null;
    }
    return i.line ? `${name}:${i.line}` : name;
  };
  const groups = ORDER.map((level) => ({
    level,
    issues: model.issues.filter((i) => i.level === level),
  })).filter((g) => g.issues.length);

  return (
    <div className="flowapi-checks" data-testid="flowapi-checks">
      <div className="flowapi-muted" data-testid="flowapi-checks-summary">
        {S.summary(model.flows.length, model.specs.length, linkCount(model))}
      </div>
      {!groups.length && <p>{S.noIssues}</p>}
      {groups.map((g) => (
        <section
          key={g.level}
          className={`flowapi-checks__group flowapi-checks__group--${g.level}`}
          data-testid={`flowapi-checks-${g.level}`}
        >
          <h4>
            {S.groups[g.level]}{" "}
            <span className="flowapi-muted">{g.issues.length}</span>
          </h4>
          <ul>
            {g.issues.map((i, n) => {
              const clickable = !!(
                onIssueClick &&
                i.fileId &&
                files.has(i.fileId)
              );
              return (
                <li
                  key={n}
                  data-testid="flowapi-issue"
                  className={clickable ? "flowapi-issue--link" : undefined}
                  onClick={clickable ? () => onIssueClick!(i) : undefined}
                  title={clickable ? S.openAtLine : undefined}
                >
                  <span>{i.message}</span>
                  {where(i) && (
                    <span className="flowapi-where">{where(i)}</span>
                  )}
                  {renderFix?.(i)}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
};
