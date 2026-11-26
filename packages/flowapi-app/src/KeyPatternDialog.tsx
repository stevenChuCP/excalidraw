import { useState } from "react";

import {
  describeOp,
  isValidKeyPrefix,
  planKeys,
  suggestKeyPattern,
} from "@flowapi/core";

import { S } from "./strings";

import type { KeyPattern, SpecModel } from "@flowapi/core";

/** asks for a naming pattern, then the caller writes the keys into the spec */
export const KeyPatternDialog = ({
  spec,
  onWrite,
  onClose,
}: {
  spec: SpecModel;
  onWrite: (pattern: KeyPattern) => void;
  onClose: () => void;
}) => {
  const [pattern, setPattern] = useState(() =>
    suggestKeyPattern(spec.ops, spec.title),
  );
  const keyless = spec.ops.filter((op) => !op.key);
  const valid =
    isValidKeyPrefix(pattern.prefix) &&
    Number.isInteger(pattern.start) &&
    pattern.start >= 0;
  const preview = valid ? planKeys(spec.ops, pattern) : [];

  return (
    <div className="flowapi-modal" role="dialog" aria-modal="true">
      <div className="flowapi-modal__box" data-testid="flowapi-key-dialog">
        <h3>{S.keyDialogTitle(spec.name)}</h3>
        <p>{S.keyDialogBody(keyless.length)}</p>
        <div className="flowapi-form">
          <label>
            {S.keyPrefix}
            <input
              value={pattern.prefix}
              onChange={(e) =>
                setPattern((p) => ({ ...p, prefix: e.target.value.trim() }))
              }
              data-testid="flowapi-key-prefix"
            />
          </label>
          <label>
            {S.keyStart}
            <input
              type="number"
              min={0}
              value={pattern.start}
              onChange={(e) =>
                setPattern((p) => ({ ...p, start: Number(e.target.value) }))
              }
              data-testid="flowapi-key-start"
            />
          </label>
        </div>
        {!isValidKeyPrefix(pattern.prefix) && (
          <div className="flowapi-error">{S.keyBadPrefix}</div>
        )}
        <div className="flowapi-muted">{S.keyPreview}</div>
        <ul className="flowapi-preview">
          {preview.slice(0, 6).map(({ op, key }) => (
            <li key={key}>
              <b>{key}</b> {describeOp(op)}
            </li>
          ))}
          {preview.length > 6 && <li>…</li>}
        </ul>
        <div className="flowapi-modal__actions">
          <button type="button" className="flowapi-btn" onClick={onClose}>
            {S.later}
          </button>
          <button
            type="button"
            className="flowapi-btn flowapi-btn--primary"
            disabled={!valid || !preview.length}
            onClick={() => onWrite(pattern)}
            data-testid="flowapi-write-keys"
          >
            {S.writeKeys}
          </button>
        </div>
      </div>
    </div>
  );
};
