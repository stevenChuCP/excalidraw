import { S } from "./strings";

/** a small confirm, used before steps that change or replace things */
export const ConfirmDialog = ({
  title,
  children,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
  testId,
}: {
  title: string;
  children?: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}) => (
  <div
    className="flowapi-modal"
    role="dialog"
    aria-modal="true"
    onKeyDown={(e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        onCancel();
      }
    }}
  >
    <div className="flowapi-modal__box" data-testid={testId}>
      <h3>{title}</h3>
      {children}
      <div className="flowapi-modal__actions">
        <button type="button" className="flowapi-btn" onClick={onCancel}>
          {S.cancel}
        </button>
        <button
          type="button"
          className={`flowapi-btn ${
            danger ? "flowapi-btn--danger" : "flowapi-btn--primary"
          }`}
          onClick={onConfirm}
          autoFocus
          data-testid="flowapi-confirm"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
);
