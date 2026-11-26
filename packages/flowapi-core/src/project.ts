import { parseFlow } from "./flow";
import { describeOp, parseSpec } from "./spec";

import type {
  FlowModel,
  Issue,
  MessageLink,
  Operation,
  Project,
  ProjectModel,
  SpecModel,
} from "./types";

export const baseName = (file: string) =>
  String(file).split(/[?#]/)[0].split(/[\\/]/).pop() || "";

const sameFile = (a: string, b: string) =>
  baseName(a).toLowerCase() === baseName(b).toLowerCase();

const normTpl = (p: string) =>
  p.replace(/\{[^}]+\}/g, "{}").replace(/\/+$/, "");
const pathRegex = (p: string) =>
  new RegExp(
    `^${p
      .replace(/[.*+?^$()|[\]\\]/g, "\\$&")
      .replace(/\\?\{[^}]+\\?\}/g, "[^/]+")}$`,
  );

/** finds the operation a "POST /v1/x" label names (also "…/reject") */
const matchPath = (ops: Operation[], method: string, raw: string) => {
  const txt = raw.replace(/[),.;，。]+$/, "");
  const tm = txt.match(/^(?:…|\.\.\.)(\/.*)$/);
  const tail = tm ? normTpl(tm[1]) : null;
  const hits = ops.filter((o) => {
    if (o.webhook || o.method !== method) {
      return false;
    }
    const sp = normTpl(o.path);
    if (tail) {
      return sp.slice(-tail.length) === tail;
    }
    return normTpl(txt) === sp || pathRegex(o.path).test(txt.split("?")[0]);
  });
  return hits[0] || null;
};

const findByKey = (spec: SpecModel, key: string) => {
  const k = key.toLowerCase();
  const byKey = spec.ops.filter((o) => o.key.toLowerCase() === k);
  if (byKey.length) {
    return byKey;
  }
  return spec.ops.filter((o) => o.operationId?.toLowerCase() === k);
};

export const buildProjectModel = (project: Project): ProjectModel => {
  const specs = project.specs.map((s) => parseSpec(s.id, s.name, s.text).model);
  const flows = project.flows.map((f) => parseFlow(f.id, f.name, f.text));
  const links: ProjectModel["links"] = {};
  const missingSpecs: ProjectModel["missingSpecs"] = [];
  const issues: Issue[] = [];
  const used = new Set<string>(); // "specId|key"

  for (const flow of flows) {
    issues.push(...flow.issues);
    const flowLinks: Record<number, MessageLink> = {};
    links[flow.id] = flowLinks;
    if (!flow.ok) {
      continue;
    }

    // resolve the flow's specs
    const docSpec = new Map<string | null, SpecModel | null>();
    flow.oaiDocs.forEach((doc, i) => {
      const spec = specs.find((s) => sameFile(s.name, doc.file)) || null;
      if (!spec) {
        missingSpecs.push({ flowId: flow.id, file: baseName(doc.file) });
        issues.push({
          level: "warning",
          fileId: flow.id,
          line: doc.line,
          message: `${flow.name} uses ${baseName(
            doc.file,
          )}, which is not in the project yet. Add that file.`,
        });
      }
      if (i === 0) {
        docSpec.set(null, spec);
      }
      if (doc.alias) {
        docSpec.set(doc.alias.toLowerCase(), spec);
      }
    });
    if (!flow.oaiDocs.length && specs.length === 1) {
      docSpec.set(null, specs[0]);
    }
    const flowSpecs = [...new Set([...docSpec.values()])].filter(
      (s): s is SpecModel => !!s,
    );
    const defaultSpec = docSpec.get(null) || null;

    const link = (
      line: number,
      op: Operation,
      how: MessageLink["how"],
    ): MessageLink => {
      const l = { flowId: flow.id, line, specId: op.specId, key: op.key, how };
      flowLinks[line] = l;
      used.add(`${op.specId}|${op.key}`);
      return l;
    };
    const lineIssue = (level: Issue["level"], line: number, message: string) =>
      issues.push({
        level,
        fileId: flow.id,
        line,
        message: `${flow.name}, line ${line}: ${message}`,
      });

    const legacyLines: number[] = [];
    for (const msg of flow.messages) {
      if (msg.ref) {
        const { alias, key, line } = msg.ref;
        const refText = `${alias ? `${alias}:` : ""}${key}`;
        if (alias && !docSpec.has(alias.toLowerCase())) {
          lineIssue(
            "error",
            line,
            `@api ${refText} uses alias ${alias}, which no @oai-doc line names`,
          );
          continue;
        }
        const spec = docSpec.get(alias ? alias.toLowerCase() : null);
        if (!spec) {
          continue; // the missing spec is reported once above
        }
        const hits = findByKey(spec, key);
        if (hits.length > 1) {
          lineIssue(
            "error",
            line,
            `@api ${refText} is ambiguous: key ${key} is on ${hits.length} operations in ${spec.name}`,
          );
        } else if (hits.length === 1) {
          if (!hits[0].key) {
            lineIssue(
              "warning",
              line,
              `@api ${refText} names an operationId, and that operation has no key yet`,
            );
          } else {
            link(msg.line, hits[0], "tag");
          }
        } else {
          lineIssue(
            "warning",
            line,
            `@api ${refText} matches no key or operationId in ${spec.name}`,
          );
        }
        continue;
      }
      if (msg.legacyKey) {
        const spec = defaultSpec;
        const hits = spec ? findByKey(spec, msg.legacyKey) : [];
        if (hits.length === 1 && hits[0].key) {
          link(msg.line, hits[0], "legacy");
          legacyLines.push(msg.line);
        } else if (spec) {
          lineIssue(
            "warning",
            msg.line,
            `tag [${msg.legacyKey}] matches no operation in ${spec.name}`,
          );
        }
        continue;
      }
      // guess by "METHOD /path" in the label
      const pm = msg.label
        .replace(/<br\s*\/?>/gi, " ")
        .match(
          /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+((?:…|\.\.\.)?\/[^\s<]*)/,
        );
      if (pm && flowSpecs.length) {
        let hit: Operation | null = null;
        for (const spec of flowSpecs) {
          hit = hit || matchPath(spec.ops, pm[1], pm[2]);
        }
        if (hit && hit.key) {
          link(msg.line, hit, "path");
          lineIssue(
            "guess",
            msg.line,
            `linked to ${hit.key} (${
              hit.operationId || hit.path
            }) by matching "${pm[1]} ${pm[2]}"`,
          );
        } else if (!hit) {
          lineIssue(
            "warning",
            msg.line,
            `"${pm[1]} ${pm[2]}" matches no path in ${flowSpecs
              .map((s) => s.name)
              .join(" or ")}`,
          );
        }
      }
    }
    if (legacyLines.length) {
      issues.push({
        level: "info",
        fileId: flow.id,
        line: legacyLines[0],
        message: `${flow.name}: ${
          legacyLines.length
        } arrows use the old inline [key] tag (lines ${legacyLines.join(
          ", ",
        )}). Move each to a '%% @api <key>' line above the arrow, so labels stay clean in other Mermaid viewers.`,
      });
    }
    // replies: an unlinked dashed message that answers the linked call before it
    flow.messages.forEach((msg, i) => {
      if (flowLinks[msg.line] || msg.ref || !msg.dashed || i === 0) {
        return;
      }
      const prev = flow.messages[i - 1];
      const pl = flowLinks[prev.line];
      if (pl && !prev.dashed && prev.from === msg.to && prev.to === msg.from) {
        flowLinks[msg.line] = { ...pl, line: msg.line, how: "reply" };
        lineIssue(
          "guess",
          msg.line,
          `reply linked to ${pl.key} because it answers the call on line ${prev.line}`,
        );
      }
    });
  }

  for (const spec of specs) {
    issues.push(...spec.issues);
  }
  for (const spec of specs) {
    for (const op of spec.ops) {
      if (op.key && !used.has(`${spec.id}|${op.key}`) && flows.length) {
        issues.push({
          level: "unused",
          fileId: spec.id,
          line: op.line,
          message: `${describeOp(op)} in ${spec.name} is not in any flow`,
        });
      }
    }
  }

  return { project, specs, flows, links, missingSpecs, issues };
};

/** the operations a flow links to, in order of first use */
export const flowOperations = (model: ProjectModel, flow: FlowModel) => {
  const out: Operation[] = [];
  const seen = new Set<string>();
  for (const msg of flow.messages) {
    const l = model.links[flow.id]?.[msg.line];
    if (l && !seen.has(`${l.specId}|${l.key}`)) {
      seen.add(`${l.specId}|${l.key}`);
      const op = model.specs
        .find((s) => s.id === l.specId)
        ?.ops.find((o) => o.key === l.key);
      if (op) {
        out.push(op);
      }
    }
  }
  return out;
};

export const isOperationUsed = (model: ProjectModel, op: Operation) =>
  Object.values(model.links).some((fl) =>
    Object.values(fl).some((l) => l.specId === op.specId && l.key === op.key),
  );
