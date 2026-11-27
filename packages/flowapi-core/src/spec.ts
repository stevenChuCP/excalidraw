import { LineCounter, parseDocument, isNode } from "yaml";

import type {
  DetailField,
  HttpMethod,
  Issue,
  Operation,
  OperationDetails,
  SpecModel,
} from "./types";

const METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;

type Json = any;

export type ParsedSpec = {
  model: SpecModel;
  /** the spec as plain data, or null when it did not parse */
  data: Json | null;
};

const makeDeref = (spec: Json) => {
  const resolve = (ref: string): Json | undefined => {
    if (!ref.startsWith("#/")) {
      return undefined;
    }
    let cur: Json = spec;
    for (const raw of ref.slice(2).split("/")) {
      const k = decodeURIComponent(raw.replace(/~1/g, "/").replace(/~0/g, "~"));
      cur = cur == null ? undefined : cur[k];
    }
    return cur;
  };
  /** follows $ref chains; returns `{ "x-unresolved": ref }` when one dangles */
  return (obj: Json): Json => {
    let o = obj;
    let depth = 0;
    while (o && typeof o === "object" && typeof o.$ref === "string") {
      if (depth++ > 30) {
        return o;
      }
      const target = resolve(o.$ref);
      if (target === undefined) {
        return { "x-unresolved": o.$ref };
      }
      const { $ref, ...siblings } = o;
      o = Object.keys(siblings).length ? { ...target, ...siblings } : target;
    }
    return o;
  };
};

/** every $ref inside `obj` that points nowhere */
const danglingRefs = (
  obj: Json,
  deref: (o: Json) => Json,
  seen = new Set<Json>(),
): string[] => {
  if (!obj || typeof obj !== "object" || seen.has(obj)) {
    return [];
  }
  seen.add(obj);
  const out: string[] = [];
  if (typeof obj.$ref === "string") {
    const d = deref(obj);
    if (d && d["x-unresolved"]) {
      out.push(obj.$ref);
      return out;
    }
    out.push(...danglingRefs(d, deref, seen));
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k !== "$ref") {
      out.push(...danglingRefs(v, deref, seen));
    }
  }
  return out;
};

const pickJsonContent = (content: Json): Json | undefined => {
  if (!content || typeof content !== "object") {
    return undefined;
  }
  const keys = Object.keys(content);
  const k =
    keys.find((x) => /json/i.test(x)) ?? keys.find((x) => x !== "") ?? keys[0];
  return k ? content[k] : undefined;
};

/** a schema with no fields: missing, `{}`, or an object without properties */
const isEmptySchema = (schema: Json, deref: (o: Json) => Json): boolean => {
  const s = deref(schema);
  if (!s || typeof s !== "object") {
    return true;
  }
  if (s["x-unresolved"]) {
    return false; // reported as a dangling $ref instead
  }
  for (const k of ["allOf", "oneOf", "anyOf"]) {
    if (Array.isArray(s[k]) && s[k].length) {
      return s[k].every((x: Json) => isEmptySchema(x, deref));
    }
  }
  if (s.type === "array") {
    return s.items ? isEmptySchema(s.items, deref) : true;
  }
  if (s.type && s.type !== "object") {
    return false; // a string, number... body is defined
  }
  const props = s.properties && Object.keys(s.properties).length;
  return !props;
};

const hasProperties = (schema: Json, deref: (o: Json) => Json) => {
  const s = deref(schema);
  return !!(s && s.properties && Object.keys(s.properties).length);
};

/** gap checks for one operation (decided: automatic, not hand-set markers) */
const findGaps = (
  op: Json,
  path: string,
  params: Json[],
  webhook: boolean,
  deref: (o: Json) => Json,
): { gaps: string[]; staleMarkers: string[] } => {
  const gaps: string[] = [];
  const staleMarkers: string[] = [];

  const checkMarker = (schema: Json, where: string) => {
    const s = deref(schema);
    if (s && s["x-undefined"] && hasProperties(s, deref)) {
      staleMarkers.push(where);
    }
  };

  if (!op.summary) {
    gaps.push("no summary");
  }

  // request body
  const body = op.requestBody ? deref(op.requestBody) : null;
  if (body) {
    const media = pickJsonContent(body.content);
    if (media) {
      if (isEmptySchema(media.schema, deref)) {
        gaps.push("request has no fields");
      } else if (deref(media.schema)?.["x-undefined"]) {
        checkMarker(media.schema, "request body");
      }
    }
  }

  // responses
  const responses = op.responses ? deref(op.responses) : null;
  const codes = responses ? Object.keys(responses) : [];
  const success = codes.filter((c) => /^2(\d\d|XX)$/i.test(c));
  if (!success.length) {
    gaps.push("no success response");
  }
  for (const code of success) {
    const res = deref(responses[code]);
    const media = pickJsonContent(res?.content);
    if (media) {
      if (isEmptySchema(media.schema, deref)) {
        gaps.push(`${code} response has no fields`);
      } else if (deref(media.schema)?.["x-undefined"]) {
        checkMarker(media.schema, `${code} response`);
      }
    }
  }

  // path parameters
  if (!webhook) {
    const declared = new Set(
      params.filter((p) => p && p.in === "path").map((p) => p.name),
    );
    for (const m of path.matchAll(/\{([^}]+)\}/g)) {
      if (!declared.has(m[1])) {
        gaps.push(`path parameter {${m[1]}} is not declared`);
      }
    }
  }

  // dangling $refs
  for (const ref of new Set(danglingRefs(op, deref))) {
    gaps.push(`$ref ${ref} points nowhere`);
  }

  return { gaps, staleMarkers };
};

const MAX_FIELDS = 12;

/** a short type name: string, int64, Address, Item[] */
const typeName = (schema: Json, deref: (o: Json) => Json): string => {
  if (!schema || typeof schema !== "object") {
    return "";
  }
  if (typeof schema.$ref === "string") {
    return schema.$ref.split("/").pop() || "";
  }
  const s = deref(schema);
  if (!s || typeof s !== "object") {
    return "";
  }
  if (s.type === "array") {
    return `${typeName(s.items, deref) || "any"}[]`;
  }
  for (const k of ["oneOf", "anyOf"]) {
    if (Array.isArray(s[k]) && s[k].length) {
      return s[k].map((x: Json) => typeName(x, deref)).join(" | ");
    }
  }
  if (s.format && (s.type === "integer" || s.type === "number")) {
    return String(s.format);
  }
  return String(s.type || (s.properties ? "object" : ""));
};

/** the top-level fields of a schema (allOf merged, array items opened) */
const fieldsOf = (schema: Json, deref: (o: Json) => Json): DetailField[] => {
  let s = deref(schema);
  if (s?.type === "array") {
    s = deref(s.items);
  }
  if (!s || typeof s !== "object") {
    return [];
  }
  const props: Record<string, Json> = {};
  const required = new Set<string>();
  const merge = (x: Json) => {
    const d = deref(x);
    if (!d || typeof d !== "object") {
      return;
    }
    (d.allOf || []).forEach(merge);
    Object.assign(props, d.properties || {});
    (Array.isArray(d.required) ? d.required : []).forEach((r: string) =>
      required.add(r),
    );
  };
  merge(s);
  return Object.keys(props)
    .slice(0, MAX_FIELDS)
    .map((name) => ({
      name,
      type: typeName(props[name], deref),
      ...(required.has(name) ? { required: true } : {}),
    }));
};

const opDetails = (
  op: Json,
  params: Json[],
  deref: (o: Json) => Json,
): OperationDetails => {
  const body = op.requestBody ? deref(op.requestBody) : null;
  const bodyMedia = body ? pickJsonContent(body.content) : undefined;
  const responses = op.responses ? deref(op.responses) || {} : {};
  return {
    params: params
      .filter((p) => p && p.name && p.in)
      .map((p) => ({
        name: String(p.name),
        in: String(p.in),
        type: typeName(p.schema, deref),
        ...(p.required ? { required: true } : {}),
      })),
    body: bodyMedia
      ? {
          type: typeName(bodyMedia.schema, deref),
          fields: fieldsOf(bodyMedia.schema, deref),
        }
      : null,
    responses: Object.keys(responses).map((code) => {
      const res = deref(responses[code]) || {};
      const media = pickJsonContent(res.content);
      return {
        code,
        description: res.description ? String(res.description) : "",
        fields: media ? fieldsOf(media.schema, deref) : [],
      };
    }),
  };
};

const titleFromName = (name: string) => name.replace(/\.(ya?ml|json)$/i, "");

export const parseSpec = (
  id: string,
  name: string,
  text: string,
): ParsedSpec => {
  const issues: Issue[] = [];
  const model: SpecModel = {
    id,
    name,
    title: titleFromName(name),
    ops: [],
    issues,
    ok: false,
  };

  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, uniqueKeys: false });
  if (doc.errors.length) {
    const e = doc.errors[0];
    issues.push({
      level: "error",
      fileId: id,
      line: e.linePos?.[0]?.line,
      message: `${name} could not be read: ${e.message.split("\n")[0]}`,
    });
    return { model, data: null };
  }
  const data = doc.toJS({ maxAliasCount: 1000 });
  if (!data || typeof data !== "object") {
    issues.push({
      level: "error",
      fileId: id,
      message: `${name} is not an OpenAPI spec`,
    });
    return { model, data: null };
  }
  if (!data.openapi && !data.swagger) {
    issues.push({
      level: "warning",
      fileId: id,
      line: 1,
      message: `${name} has no 'openapi' version field; read as OpenAPI 3`,
    });
  }
  if (data.info?.title) {
    model.title = String(data.info.title);
  }
  model.ok = true;

  const deref = makeDeref(data);
  const lineOf = (keys: string[]) => {
    const node = doc.getIn(keys, true);
    const offset = isNode(node) && node.range ? node.range[0] : 0;
    return lineCounter.linePos(offset).line;
  };

  const collect = (section: "paths" | "webhooks" | "x-webhooks") => {
    const container = data[section];
    if (!container || typeof container !== "object") {
      return;
    }
    for (const path of Object.keys(container)) {
      const item = deref(container[path]) || {};
      for (const m of METHODS) {
        const op = item[m];
        if (!op || typeof op !== "object") {
          continue;
        }
        const params: Json[] = [
          ...(item.parameters || []),
          ...(op.parameters || []),
        ].map(deref);
        const webhook = section !== "paths";
        const line = lineOf([section, path, m]);
        const { gaps, staleMarkers } = findGaps(
          op,
          path,
          params,
          webhook,
          deref,
        );
        const tag = op["x-diagram-tag"];
        const operation: Operation = {
          specId: id,
          key: tag == null ? "" : String(tag),
          method: m.toUpperCase() as HttpMethod,
          path,
          operationId: op.operationId ? String(op.operationId) : undefined,
          summary: op.summary ? String(op.summary) : undefined,
          webhook,
          line,
          gaps,
          details: opDetails(op, params, deref),
        };
        model.ops.push(operation);
        for (const where of staleMarkers) {
          issues.push({
            level: "warning",
            fileId: id,
            line,
            message: `${describeOp(
              operation,
            )}: the ${where} is marked x-undefined but already has fields. Remove the stale marker.`,
          });
        }
      }
    }
  };
  collect("paths");
  collect("webhooks");
  collect("x-webhooks");

  if (!model.ops.length) {
    issues.push({
      level: "error",
      fileId: id,
      message: `${name} has no operations under paths or webhooks`,
    });
  }

  // keys must be unique within the spec (case-insensitive)
  const byKey = new Map<string, Operation[]>();
  for (const op of model.ops) {
    if (op.key) {
      const k = op.key.toLowerCase();
      byKey.set(k, [...(byKey.get(k) || []), op]);
    }
  }
  for (const ops of byKey.values()) {
    if (ops.length > 1) {
      issues.push({
        level: "error",
        fileId: id,
        line: ops[1].line,
        message: `Key ${ops[0].key} is on ${ops.length} operations (${ops
          .map((o) => o.operationId || `${o.method} ${o.path}`)
          .join(", ")}). Keys must be unique in a spec.`,
        fix: { kind: "duplicateKey", specId: id, key: ops[0].key },
      });
    }
  }
  const byOpId = new Map<string, number>();
  for (const op of model.ops) {
    if (op.operationId) {
      byOpId.set(op.operationId, (byOpId.get(op.operationId) || 0) + 1);
    }
  }
  for (const [opId, n] of byOpId) {
    if (n > 1) {
      issues.push({
        level: "error",
        fileId: id,
        message: `operationId ${opId} is used ${n} times (OpenAPI requires it to be unique)`,
      });
    }
  }
  const keyless = model.ops.filter((o) => !o.key);
  if (keyless.length) {
    issues.push({
      level: "warning",
      fileId: id,
      line: keyless[0].line,
      message: `${keyless.length} operation${
        keyless.length > 1 ? "s have" : " has"
      } no key (x-diagram-tag), so ${
        keyless.length > 1 ? "they" : "it"
      } can't go on the board yet`,
    });
  }
  for (const op of model.ops) {
    if (op.gaps.length) {
      issues.push({
        level: "gap",
        fileId: id,
        line: op.line,
        message: `${describeOp(op)}: ${op.gaps.join("; ")}`,
      });
    }
  }

  return { model, data };
};

export const describeOp = (op: Operation) =>
  `${op.key ? `${op.key} ` : ""}${op.webhook ? "WEBHOOK " : ""}${op.method} ${
    op.path
  }${op.operationId ? ` (${op.operationId})` : ""}`;
