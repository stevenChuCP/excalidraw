import { LineCounter, isMap, isNode, isScalar, parseDocument } from "yaml";

import type { Operation } from "./types";

const METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
];

export type KeyPattern = { prefix: string; start: number };

/**
 * The pattern to offer for operations without keys: the letter prefix most
 * keys in the spec already use (continuing after the highest number), or the
 * first letter of the spec title for a spec with no keys at all.
 */
export const suggestKeyPattern = (
  ops: Operation[],
  title: string,
): KeyPattern => {
  const counts = new Map<string, number>();
  let max = 0;
  for (const op of ops) {
    const m = op.key.match(/^([A-Za-z]+)(\d+)$/);
    if (m) {
      counts.set(m[1], (counts.get(m[1]) || 0) + 1);
    }
  }
  const prefix =
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    (title.match(/[A-Za-z]/)?.[0] || "K").toUpperCase();
  for (const op of ops) {
    const m = op.key.match(/^([A-Za-z]+)(\d+)$/);
    if (m && m[1] === prefix) {
      max = Math.max(max, Number(m[2]));
    }
  }
  return { prefix, start: max + 1 };
};

export const isValidKeyPrefix = (prefix: string) =>
  /^[A-Za-z][A-Za-z_-]*$/.test(prefix);

/** keys for every operation that has none, in spec order */
export const planKeys = (ops: Operation[], pattern: KeyPattern) => {
  const taken = new Set(ops.map((o) => o.key.toLowerCase()).filter(Boolean));
  const plan: { op: Operation; key: string }[] = [];
  let n = pattern.start;
  for (const op of ops) {
    if (op.key) {
      continue;
    }
    let key = `${pattern.prefix}${n++}`;
    while (taken.has(key.toLowerCase())) {
      key = `${pattern.prefix}${n++}`;
    }
    taken.add(key.toLowerCase());
    plan.push({ op, key });
  }
  return plan;
};

/**
 * Writes `x-diagram-tag: <key>` into the spec text for each planned
 * operation, as a new line under its operationId (or as the operation's first
 * field). Every other byte of the text stays as it was.
 */
export const writeKeys = (
  text: string,
  plan: { op: Operation; key: string }[],
): string => {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, uniqueKeys: false });
  const inserts: { at: number; text: string }[] = [];
  const isJson = /^\s*\{/.test(text);
  if (isJson) {
    // JSON specs: rewrite through the document model (formatting is JSON anyway)
    for (const { op, key } of plan) {
      doc.setIn(
        [sectionOf(op), op.path, op.method.toLowerCase(), "x-diagram-tag"],
        key,
      );
    }
    return `${JSON.stringify(doc.toJS(), null, 2)}\n`;
  }
  for (const { op, key } of plan) {
    const node = doc.getIn(
      [sectionOf(op), op.path, op.method.toLowerCase()],
      true,
    );
    if (!isMap(node) || node.flow || !node.items.length) {
      doc.setIn(
        [sectionOf(op), op.path, op.method.toLowerCase(), "x-diagram-tag"],
        key,
      );
      return doc.toString();
    }
    const first = node.items[0];
    const firstKey = first.key;
    if (!isNode(firstKey) || !firstKey.range) {
      continue;
    }
    const keyStart = firstKey.range[0];
    const lineStart = text.lastIndexOf("\n", keyStart - 1) + 1;
    const indent = text.slice(lineStart, keyStart);
    const opIdPair = node.items.find(
      (p) => isScalar(p.key) && p.key.value === "operationId",
    );
    let at = lineStart;
    if (opIdPair && isNode(opIdPair.value) && opIdPair.value.range) {
      const nl = text.indexOf("\n", opIdPair.value.range[1]);
      at = nl === -1 ? text.length : nl + 1;
    }
    inserts.push({
      at,
      text: `${indent}x-diagram-tag: ${key}\n`,
    });
  }
  let out = text;
  for (const ins of inserts.sort((a, b) => b.at - a.at)) {
    const needsNl = ins.at === out.length && !out.endsWith("\n");
    out =
      out.slice(0, ins.at) +
      (needsNl ? "\n" : "") +
      ins.text +
      out.slice(ins.at);
  }
  return out;
};

const sectionOf = (op: Operation) => (op.webhook ? "webhooks" : "paths");

export { METHODS as OPENAPI_METHODS };
