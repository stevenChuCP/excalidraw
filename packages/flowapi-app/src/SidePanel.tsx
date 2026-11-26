import { S } from "./strings";

export type SideTab = { id: string; label: string; testId: string };

/** the right-hand panel: Checks and one tab per open flow or spec text */
export const SidePanel = ({
  tabs,
  active,
  onSelect,
  onCloseTab,
  onClose,
  children,
}: {
  tabs: SideTab[];
  active: string;
  onSelect: (id: string) => void;
  onCloseTab: (id: string) => void;
  onClose: () => void;
  children: React.ReactNode;
}) => (
  <div className="flowapi-side" data-testid="flowapi-side">
    <div className="flowapi-side__tabs" role="tablist">
      {tabs.map((t) => (
        <span
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          className={`flowapi-tab${t.id === active ? " flowapi-tab--on" : ""}`}
          onClick={() => onSelect(t.id)}
          data-testid={t.testId}
          title={t.label}
        >
          <span className="flowapi-tab__label">{t.label}</span>
          {t.id !== "checks" && (
            <button
              type="button"
              className="flowapi-tab__x"
              title={S.closeTab}
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(t.id);
              }}
            >
              {S.closeIcon}
            </button>
          )}
        </span>
      ))}
      <button
        type="button"
        className="flowapi-x flowapi-x--on flowapi-side__close"
        title={S.close}
        onClick={onClose}
        data-testid="flowapi-side-close"
      >
        {S.closeIcon}
      </button>
    </div>
    <div className="flowapi-side__body">{children}</div>
  </div>
);
