import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { SourceFile } from "@flowapi/core";

const LINE_HEIGHT = 18;
const APPLY_DELAY = 300;

/**
 * A plain text editor for a flow or spec: line numbers, edits applied to the
 * project after a short pause, and jumps to a line from Checks.
 */
export const TextEditor = ({
  file,
  onChange,
  jump,
}: {
  file: SourceFile;
  onChange: (text: string) => void;
  /** a line to select; `n` changes on every jump, even to the same line */
  jump?: { line: number; n: number } | null;
}) => {
  const [draft, setDraft] = useState(file.text);
  const sent = useRef(file.text);
  const timer = useRef<number | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);

  // text changed elsewhere (a write-back, another tab): show it
  useEffect(() => {
    if (file.text !== sent.current) {
      sent.current = file.text;
      setDraft(file.text);
    }
  }, [file.text]);

  // a pending edit still goes in when the editor closes or switches file
  useEffect(
    () => () => {
      if (timer.current) {
        window.clearTimeout(timer.current);
      }
    },
    [],
  );

  const flush = (text: string) => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (text !== sent.current) {
      sent.current = text;
      onChange(text);
    }
  };

  useLayoutEffect(() => {
    const el = area.current;
    if (!jump || !el) {
      return;
    }
    const lines = el.value.split("\n");
    const i = Math.max(0, Math.min(lines.length - 1, jump.line - 1));
    const start = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0);
    el.focus();
    el.setSelectionRange(start, start + lines[i].length);
    el.scrollTop = Math.max(0, i * LINE_HEIGHT - el.clientHeight / 3);
    if (gutter.current) {
      gutter.current.scrollTop = el.scrollTop;
    }
  }, [jump]);

  const count = draft.split("\n").length;

  return (
    <div className="flowapi-editor" data-testid="flowapi-editor">
      <div className="flowapi-editor__gutter" ref={gutter} aria-hidden>
        {Array.from({ length: count }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <textarea
        ref={area}
        className="flowapi-editor__text"
        value={draft}
        spellCheck={false}
        wrap="off"
        data-testid="flowapi-editor-text"
        data-file-id={file.id}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          if (timer.current) {
            window.clearTimeout(timer.current);
          }
          timer.current = window.setTimeout(() => flush(text), APPLY_DELAY);
        }}
        onBlur={(e) => flush(e.target.value)}
        onKeyDown={(e) => {
          // keep the editor's keys away from the canvas shortcuts
          e.stopPropagation();
          if (e.key === "Tab") {
            e.preventDefault();
            const el = e.currentTarget;
            const { selectionStart: a, selectionEnd: b } = el;
            const text = `${el.value.slice(0, a)}  ${el.value.slice(b)}`;
            setDraft(text);
            requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
            timer.current = window.setTimeout(() => flush(text), APPLY_DELAY);
          }
        }}
        onScroll={(e) => {
          if (gutter.current) {
            gutter.current.scrollTop = e.currentTarget.scrollTop;
          }
        }}
      />
    </div>
  );
};
