import { isMap, isNode, isScalar, parseDocument } from "yaml";

import { baseName } from "./project";
import { suggestKeyPattern, writeKeys } from "./keys";

import type { Document, YAMLMap } from "yaml";
import type {
  FlowModel,
  Operation,
  Project,
  ProjectModel,
  SourceFile,
} from "./types";

// Text edits the app makes to the flows and specs in a project (the "Spec
// write-back" table in the design plan). Every edit changes only the lines it
// has to; comments, key order and indentation stay as they were.

type OpAddress = Pick<Operation, "webhook" | "path" | "method">;

const sectionOf = (op: OpAddress) => (op.webhook ? "webhooks" : "paths");
const isJsonText = (text: string) => /^\s*\{/.test(text);

const parse = (text: string) => parseDocument(text, { uniqueKeys: false });

const opMap = (doc: Document, op: OpAddress) => {
  const node = doc.getIn(
    [sectionOf(op), op.path, op.method.toLowerCase()],
    true,
  );
  return isMap(node) ? (node as YAMLMap) : null;
};

const lineStart = (text: string, at: number) =>
  text.lastIndexOf("\n", at - 1) + 1;
const lineEnd = (text: string, at: number) => {
  const nl = text.indexOf("\n", at);
  return nl === -1 ? text.length : nl + 1;
};

const replaceProjectFile = (
  project: Project,
  fileId: string,
  text: string,
): Project => {
  const upd = (f: SourceFile) => (f.id === fileId ? { ...f, text } : f);
  return {
    ...project,
    flows: project.flows.map(upd),
    specs: project.specs.map(upd),
  };
};

// -----------------------------------------------------------------------------
// keys
// -----------------------------------------------------------------------------

export const KEY_RE = /^[A-Za-z][\w-]*$/;

/** why `key` can't be used in this spec, or null when it can */
export const keyProblem = (
  model: ProjectModel,
  specId: string,
  key: string,
  except?: OpAddress,
): string | null => {
  if (!KEY_RE.test(key)) {
    return "Use letters, digits, - or _, starting with a letter";
  }
  const spec = model.specs.find((s) => s.id === specId);
  const lower = key.toLowerCase();
  const taken = spec?.ops.some(
    (o) =>
      o.key.toLowerCase() === lower &&
      !(
        except &&
        o.method === except.method &&
        o.path === except.path &&
        o.webhook === except.webhook
      ),
  );
  if (taken) {
    return `${key} is already used in ${spec?.name}`;
  }
  const retired = model.project.retiredKeys?.[specId] || [];
  if (retired.some((k) => k.toLowerCase() === lower)) {
    return `${key} belonged to a deleted operation and is not reused`;
  }
  return null;
};

/** the next free key in the spec's pattern, skipping retired keys */
export const nextKey = (model: ProjectModel, specId: string) => {
  const spec = model.specs.find((s) => s.id === specId);
  if (!spec) {
    return "K1";
  }
  const retired = model.project.retiredKeys?.[specId] || [];
  const all = [
    ...spec.ops,
    ...retired.map((key) => ({ key } as Operation)),
  ] as Operation[];
  const { prefix, start } = suggestKeyPattern(all, spec.title);
  for (let n = start; ; n++) {
    const key = `${prefix}${n}`;
    if (!keyProblem(model, specId, key)) {
      return key;
    }
  }
};

/** sets one operation's x-diagram-tag in the spec text */
export const setOperationKey = (
  text: string,
  op: OpAddress,
  key: string,
): string => {
  const doc = parse(text);
  if (isJsonText(text)) {
    doc.setIn(
      [sectionOf(op), op.path, op.method.toLowerCase(), "x-diagram-tag"],
      key,
    );
    return `${JSON.stringify(doc.toJS(), null, 2)}\n`;
  }
  const map = opMap(doc, op);
  const pair = map?.items.find(
    (p) => isScalar(p.key) && p.key.value === "x-diagram-tag",
  );
  if (pair && isScalar(pair.value) && pair.value.range) {
    const [from, to] = pair.value.range;
    const q = text[from];
    const quoted = q === '"' || q === "'";
    return (
      text.slice(0, from) + (quoted ? `${q}${key}${q}` : key) + text.slice(to)
    );
  }
  return writeKeys(text, [{ op: { ...op, key: "" } as Operation, key }]);
};

/**
 * Renames an operation's key: the spec's x-diagram-tag and every arrow that
 * links to it (`%% @api` lines and old inline `[A1]` tags) in every flow.
 */
export const renameKey = (
  model: ProjectModel,
  specId: string,
  op: Operation,
  newKey: string,
): Project => {
  const specFile = model.project.specs.find((s) => s.id === specId);
  if (!specFile) {
    return model.project;
  }
  let project = replaceProjectFile(
    model.project,
    specId,
    setOperationKey(specFile.text, op, newKey),
  );
  for (const flow of model.flows) {
    const file = project.flows.find((f) => f.id === flow.id);
    if (!file) {
      continue;
    }
    const lines = file.text.split("\n");
    let changed = false;
    for (const msg of flow.messages) {
      const link = model.links[flow.id]?.[msg.line];
      if (!link || link.specId !== specId || link.key !== op.key) {
        continue;
      }
      if (link.how === "tag" && msg.ref) {
        const i = msg.ref.line - 1;
        const next = lines[i].replace(
          /(@api\s+(?:[\w-]+:)?)([^\s]+)/,
          (_, head) => `${head}${newKey}`,
        );
        changed ||= next !== lines[i];
        lines[i] = next;
      } else if (link.how === "legacy" && msg.legacyKey) {
        const i = msg.line - 1;
        const next = lines[i].replace(`[${msg.legacyKey}]`, `[${newKey}]`);
        changed ||= next !== lines[i];
        lines[i] = next;
      }
    }
    if (changed) {
      project = replaceProjectFile(project, flow.id, lines.join("\n"));
    }
  }
  return project;
};

// -----------------------------------------------------------------------------
// linking arrows
// -----------------------------------------------------------------------------

const aliasFor = (file: string, taken: Set<string>) => {
  const base =
    baseName(file)
      .replace(/\.(ya?ml|json)$/i, "")
      .replace(/[-_.]?openapi$/i, "")
      .match(/[A-Za-z][\w]*/)?.[0]
      .toLowerCase() || "spec";
  let alias = base.slice(0, 12);
  for (let n = 2; taken.has(alias); n++) {
    alias = `${base.slice(0, 10)}${n}`;
  }
  return alias;
};

/** how a flow refers to a spec in `%% @api`: "" for its default spec */
const specPrefix = (
  model: ProjectModel,
  flow: FlowModel,
  specId: string,
): { prefix: string; docLine: string | null } => {
  const spec = model.specs.find((s) => s.id === specId)!;
  const same = (file: string) =>
    baseName(file).toLowerCase() === spec.name.toLowerCase();
  const docs = flow.oaiDocs;
  if (!docs.length) {
    // no @oai-doc yet: this spec becomes the default
    const others = model.specs.length > 1;
    return {
      prefix: "",
      docLine: others ? `%% @oai-doc ${spec.name}` : null,
    };
  }
  if (same(docs[0].file)) {
    return { prefix: "", docLine: null };
  }
  const named = docs.find((d) => d.alias && same(d.file));
  if (named) {
    return { prefix: `${named.alias}:`, docLine: null };
  }
  const taken = new Set(
    docs.map((d) => (d.alias || "").toLowerCase()).filter(Boolean),
  );
  const alias = aliasFor(spec.name, taken);
  return { prefix: `${alias}:`, docLine: `%% @oai-doc ${alias} ${spec.name}` };
};

/**
 * Links a flow arrow to an operation: writes (or rewrites) the `%% @api` line
 * above it, and adds an `@oai-doc` line when the flow doesn't name that spec
 * yet. Never changes the spec.
 */
export const linkArrow = (
  model: ProjectModel,
  flowId: string,
  msgLine: number,
  specId: string,
  key: string,
): Project => {
  const flow = model.flows.find((f) => f.id === flowId);
  const file = model.project.flows.find((f) => f.id === flowId);
  const msg = flow?.messages.find((m) => m.line === msgLine);
  if (!flow || !file || !msg) {
    return model.project;
  }
  const { prefix, docLine } = specPrefix(model, flow, specId);
  const lines = file.text.split("\n");
  const indent = lines[msgLine - 1].match(/^\s*/)![0];
  const apiLine = `${indent}%% @api ${prefix}${key}`;
  if (msg.ref) {
    lines[msg.ref.line - 1] = apiLine;
  } else {
    lines.splice(msgLine - 1, 0, apiLine);
  }
  if (msg.legacyKey) {
    // the @api line takes over from the old inline tag
    const i = lines.findIndex(
      (l, n) => n >= msgLine - 1 && l.includes(`[${msg.legacyKey}]`),
    );
    if (i !== -1) {
      lines[i] = lines[i].replace(new RegExp(`\\[${msg.legacyKey}\\]\\s*`), "");
    }
  }
  if (docLine) {
    const lastDoc = flow.oaiDocs.length
      ? flow.oaiDocs[flow.oaiDocs.length - 1].line
      : lines.findIndex((l) => /^\s*sequenceDiagram\b/.test(l)) + 1;
    lines.splice(lastDoc, 0, docLine);
  }
  return replaceProjectFile(model.project, flowId, lines.join("\n"));
};

/** removes the `%% @api` line above an arrow; the spec keeps its key */
export const unlinkArrow = (
  model: ProjectModel,
  flowId: string,
  msgLine: number,
): Project => {
  const flow = model.flows.find((f) => f.id === flowId);
  const file = model.project.flows.find((f) => f.id === flowId);
  const msg = flow?.messages.find((m) => m.line === msgLine);
  if (!file || !msg?.ref) {
    return model.project;
  }
  const lines = file.text.split("\n");
  lines.splice(msg.ref.line - 1, 1);
  return replaceProjectFile(model.project, flowId, lines.join("\n"));
};

// -----------------------------------------------------------------------------
// creating and deleting operations
// -----------------------------------------------------------------------------

export type OperationStub = {
  method: string;
  path: string;
  operationId: string;
  summary: string;
  key: string;
};

const METHOD_RE = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/i;

const pascal = (w: string) =>
  w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
const singular = (w: string) => w.replace(/ies$/, "y").replace(/s$/, "");

/** method, path and names guessed from an arrow label */
export const stubFromLabel = (label: string, key: string): OperationStub => {
  const plain = label
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const method = (plain.match(METHOD_RE)?.[1] || "POST").toUpperCase();
  const rawPath = plain.match(/(\/[^\s()（）、,，]+)/)?.[1] || "/new-operation";
  const path = rawPath.replace(/…|\.\.\./g, "");
  const segs = path.split("/").filter((w) => w && !/^v\d+$/.test(w));
  const plainSegs = segs.filter((w) => !w.startsWith("{"));
  const words = (w: string) => w.split(/[-_]/).filter(Boolean);
  const last = segs[segs.length - 1] || "operation";
  const prev = segs[segs.length - 2] || "";
  let parts: string[];
  if (method === "POST" && prev.startsWith("{") && !last.startsWith("{")) {
    // POST /things/{id}/cancel -> cancelThing
    parts = [...words(last), ...words(singular(segs[segs.length - 3] || ""))];
  } else {
    const verb =
      (
        {
          GET: "get",
          POST: "create",
          PUT: "replace",
          PATCH: "update",
          DELETE: "delete",
        } as Record<string, string>
      )[method] || method.toLowerCase();
    const noun = plainSegs[plainSegs.length - 1] || "operation";
    const one =
      last.startsWith("{") || method !== "GET" ? singular(noun) : noun;
    parts = [verb, ...words(one)];
  }
  const operationId = parts
    .filter(Boolean)
    .map((w, i) => (i === 0 ? w.toLowerCase() : pascal(w)))
    .join("")
    .replace(/[^\w]/g, "");
  const summary = plain
    .replace(METHOD_RE, "")
    .replace(rawPath, "")
    .replace(/^[\s①-⑳:：·-]+|[\s()（）]+$/g, "")
    .trim();
  return {
    method,
    path,
    operationId,
    summary: summary || `${method} ${path}`,
    key,
  };
};

const yamlScalar = (s: string) =>
  /^[\w./{}-]+$/.test(s) && !/^(true|false|null|yes|no|on|off|~)$/i.test(s)
    ? s
    : JSON.stringify(s);

/**
 * Adds a stub operation to the spec text: operationId, summary, key and a
 * bare 200 response (its empty request and response show up as gaps).
 */
export const addOperation = (text: string, stub: OperationStub): string => {
  const doc = parse(text);
  const method = stub.method.toLowerCase();
  if (isJsonText(text)) {
    doc.setIn(["paths", stub.path, method], {
      operationId: stub.operationId,
      summary: stub.summary,
      "x-diagram-tag": stub.key,
      responses: { "200": { description: "OK" } },
    });
    return `${JSON.stringify(doc.toJS(), null, 2)}\n`;
  }
  const paths = doc.get("paths", true);
  const body = (ind: string, step: string) =>
    [
      `${ind}${method}:`,
      `${ind}${step}operationId: ${yamlScalar(stub.operationId)}`,
      `${ind}${step}summary: ${yamlScalar(stub.summary)}`,
      `${ind}${step}x-diagram-tag: ${yamlScalar(stub.key)}`,
      `${ind}${step}responses:`,
      `${ind}${step}${step}"200":`,
      `${ind}${step}${step}${step}description: OK`,
    ].join("\n");
  if (!isMap(paths) || paths.flow || !paths.items.length) {
    const sep = text.endsWith("\n") ? "" : "\n";
    return `${text}${sep}paths:\n  ${yamlScalar(stub.path)}:\n${body(
      "    ",
      "  ",
    )}\n`;
  }
  // indentation as the spec already uses it
  const firstKey = paths.items[0].key;
  const pathIndent =
    isNode(firstKey) && firstKey.range
      ? text.slice(lineStart(text, firstKey.range[0]), firstKey.range[0])
      : "  ";
  let step = "  ";
  const firstVal = paths.items[0].value;
  if (
    isMap(firstVal) &&
    firstVal.items.length &&
    isNode(firstVal.items[0].key)
  ) {
    const k = firstVal.items[0].key as any;
    if (k.range) {
      const ind = text.slice(lineStart(text, k.range[0]), k.range[0]);
      step = ind.slice(pathIndent.length) || "  ";
    }
  }
  const afterContent = (end: number) => {
    let e = end;
    while (e > 0 && /\s/.test(text[e - 1])) {
      e--;
    }
    return lineEnd(text, Math.max(0, e - 1));
  };
  const insertAt = (at: number, insert: string) =>
    text.slice(0, at) +
    (at === 0 || text[at - 1] === "\n" ? "" : "\n") +
    insert +
    text.slice(at);
  const existing = paths.items.find(
    (p) => isScalar(p.key) && p.key.value === stub.path,
  );
  if (existing && isMap(existing.value) && !existing.value.flow) {
    return insertAt(
      afterContent((existing.value as any).range[1]),
      `${body(pathIndent + step, step)}\n`,
    );
  }
  return insertAt(
    afterContent((paths as any).range[1]),
    `${pathIndent}${yamlScalar(stub.path)}:\n${body(
      pathIndent + step,
      step,
    )}\n`,
  );
};

/** removes an operation (and its path when nothing else is left under it) */
export const deleteOperation = (text: string, op: OpAddress): string => {
  const doc = parse(text);
  if (isJsonText(text)) {
    doc.deleteIn([sectionOf(op), op.path, op.method.toLowerCase()]);
    const item = doc.getIn([sectionOf(op), op.path]);
    if (isMap(item) && !item.items.length) {
      doc.deleteIn([sectionOf(op), op.path]);
    }
    return `${JSON.stringify(doc.toJS(), null, 2)}\n`;
  }
  const section = doc.get(sectionOf(op), true);
  if (!isMap(section)) {
    return text;
  }
  const pathPair = section.items.find(
    (p) => isScalar(p.key) && p.key.value === op.path,
  );
  if (!pathPair || !isMap(pathPair.value)) {
    return text;
  }
  const pathMap = pathPair.value;
  const methodPairs = pathMap.items.filter(
    (p) =>
      isScalar(p.key) &&
      /^(get|put|post|delete|options|head|patch|trace)$/.test(
        String(p.key.value),
      ),
  );
  const target = pathMap.items.find(
    (p) => isScalar(p.key) && p.key.value === op.method.toLowerCase(),
  );
  if (!target || !isNode(target.key) || !target.key.range) {
    return text;
  }
  const removeRange = (fromNode: any, toNode: any) => {
    const from = lineStart(text, fromNode.range[0]);
    const endOffset = toNode?.range ? toNode.range[1] : fromNode.range[1];
    const to = lineEnd(text, Math.max(fromNode.range[0], endOffset - 1));
    return text.slice(0, from) + text.slice(to);
  };
  const onlyMethod =
    methodPairs.length === 1 && pathMap.items.length === 1 && !pathMap.flow;
  if (onlyMethod && isNode(pathPair.key)) {
    return removeRange(pathPair.key, pathPair.value);
  }
  return removeRange(target.key, target.value);
};

/** the arrows that link to an operation, for confirm dialogs */
export const arrowsLinkedTo = (
  model: ProjectModel,
  specId: string,
  key: string,
) => {
  const out: {
    flowId: string;
    flowName: string;
    line: number;
    label: string;
  }[] = [];
  for (const flow of model.flows) {
    for (const msg of flow.messages) {
      const l = model.links[flow.id]?.[msg.line];
      if (l && l.specId === specId && l.key === key) {
        out.push({
          flowId: flow.id,
          flowName: flow.name,
          line: msg.line,
          label: msg.label.replace(/<br\s*\/?>/gi, " "),
        });
      }
    }
  }
  return out;
};

/** deletes an operation from its spec and retires its key for good */
export const deleteOperationFromProject = (
  model: ProjectModel,
  op: Operation,
): Project => {
  const file = model.project.specs.find((s) => s.id === op.specId);
  if (!file) {
    return model.project;
  }
  const project = replaceProjectFile(
    model.project,
    op.specId,
    deleteOperation(file.text, op),
  );
  if (!op.key) {
    return project;
  }
  const retired = project.retiredKeys?.[op.specId] || [];
  return {
    ...project,
    retiredKeys: {
      ...project.retiredKeys,
      [op.specId]: retired.includes(op.key) ? retired : [...retired, op.key],
    },
  };
};

/** gives the second of two operations sharing a key a new one */
export const fixDuplicateKey = (
  model: ProjectModel,
  specId: string,
  key: string,
): Project => {
  const spec = model.specs.find((s) => s.id === specId);
  const dups = spec?.ops.filter((o) => o.key === key) || [];
  if (dups.length < 2) {
    return model.project;
  }
  let project = model.project;
  for (const op of dups.slice(1)) {
    const m: ProjectModel = { ...model, project };
    const k = nextKey(m, specId);
    const file = project.specs.find((s) => s.id === specId)!;
    project = replaceProjectFile(
      project,
      specId,
      setOperationKey(file.text, op, k),
    );
    // arrows whose label names this operation's path follow it
    for (const flow of model.flows) {
      const lines = project.flows
        .find((f) => f.id === flow.id)!
        .text.split("\n");
      let changed = false;
      for (const msg of flow.messages) {
        const l = model.links[flow.id]?.[msg.line];
        if (
          l?.specId === specId &&
          l.key === key &&
          msg.ref &&
          labelNames(msg.label, op)
        ) {
          lines[msg.ref.line - 1] = lines[msg.ref.line - 1].replace(
            /(@api\s+(?:[\w-]+:)?)([^\s]+)/,
            (_, head) => `${head}${k}`,
          );
          changed = true;
        }
      }
      if (changed) {
        project = replaceProjectFile(project, flow.id, lines.join("\n"));
      }
    }
  }
  return project;
};

const labelNames = (label: string, op: OpAddress) => {
  const re = new RegExp(
    `\\b${op.method}\\b[^/]*${op.path
      .replace(/[.*+?^$()|[\]\\]/g, "\\$&")
      .replace(/\\?\{[^}]+\\?\}/g, "[^/\\s]+")}(?![\\w/])`,
    "i",
  );
  return re.test(label);
};
