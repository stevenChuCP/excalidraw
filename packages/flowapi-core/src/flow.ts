import type {
  FlowBlock,
  FlowItem,
  FlowMessage,
  FlowModel,
  FlowParticipant,
  Issue,
  OaiDoc,
} from "./types";

const ARROWS = ["-->>", "->>", "-->", "->", "--x", "-x", "--)", "-)"];
const RE_MSG = new RegExp(
  `^(.+?)\\s*(${ARROWS.map((a) => a.replace(/[()]/g, "\\$&")).join(
    "|",
  )})\\s*([+-]?)\\s*([^:]+?)\\s*:\\s*(.*)$`,
);
const RE_ALIAS = /^[A-Za-z][\w-]*$/;

/**
 * Parses a Mermaid sequence diagram with FlowAPI directives:
 *
 * - `%% @oai-doc <file>` or `%% @oai-doc <alias> <file>`, one per spec; the
 *   first one is the default spec.
 * - `%% @api <key>` or `%% @api <alias>:<key>` on the line before an arrow.
 * - the old inline `[A1]` tag at the start of a message label.
 */
export const parseFlow = (id: string, name: string, src: string): FlowModel => {
  const parts: FlowParticipant[] = [];
  const pIdx = new Map<string, number>();
  const issues: Issue[] = [];
  const root: FlowBlock = {
    kind: "block",
    line: 0,
    type: "root",
    label: "",
    children: [],
  };
  const stack: FlowBlock[] = [];
  let cur = root;
  let seen = false;
  let title: string | null = null;
  let stmts = 0;
  let pending: { alias: string | null; key: string; line: number } | null =
    null;
  const oaiDocs: OaiDoc[] = [];

  const issue = (level: Issue["level"], line: number, message: string) =>
    issues.push({
      level,
      fileId: id,
      line,
      message: `Line ${line}: ${message}`,
    });

  const part = (rawId: string, label?: string, actor = false) => {
    const pid = rawId.trim();
    if (!pIdx.has(pid)) {
      pIdx.set(pid, parts.length);
      parts.push({ id: pid, label: label?.trim() || pid, actor });
    } else if (label) {
      parts[pIdx.get(pid)!].label = label.trim();
    }
    return pIdx.get(pid)!;
  };

  src.split(/\r?\n/).forEach((raw, i) => {
    const ln = i + 1;
    const s = raw.trim();
    let m: RegExpMatchArray | null;
    if (!s) {
      return;
    }
    if (s.startsWith("%%")) {
      const dv = s.match(/^%%\s*@([\w-]+)\s*(.*)$/);
      if (!dv) {
        return;
      }
      const arg = dv[2].trim();
      if (dv[1] === "oai-doc") {
        const words = arg.split(/\s+/).filter(Boolean);
        if (!words.length) {
          issue("error", ln, "@oai-doc needs a spec file name");
          return;
        }
        const doc: OaiDoc =
          words.length >= 2 && RE_ALIAS.test(words[0])
            ? { alias: words[0], file: words.slice(1).join(" "), line: ln }
            : { alias: null, file: arg, line: ln };
        if (stmts) {
          issue("warning", ln, "@oai-doc should come before the diagram");
        }
        if (
          doc.alias &&
          oaiDocs.some(
            (d) => d.alias?.toLowerCase() === doc.alias!.toLowerCase(),
          )
        ) {
          issue("error", ln, `alias ${doc.alias} is used twice`);
          return;
        }
        if (!doc.alias && oaiDocs.length) {
          issue(
            "warning",
            ln,
            "a second @oai-doc needs an alias, e.g. %% @oai-doc ca ca-openapi.yaml; ignored",
          );
          return;
        }
        oaiDocs.push(doc);
      } else if (dv[1] === "api") {
        const ref = arg.split(/\s+/)[0];
        if (!ref) {
          issue("warning", ln, "@api needs a key, e.g. %% @api A1");
          return;
        }
        if (pending) {
          issue(
            "warning",
            pending.line,
            `@api ${pending.alias ? `${pending.alias}:` : ""}${
              pending.key
            } has no arrow before the next @api; ignored`,
          );
        }
        const am = ref.match(/^([A-Za-z][\w-]*):(.+)$/);
        pending = am
          ? { alias: am[1], key: am[2], line: ln }
          : { alias: null, key: ref, line: ln };
      } else {
        issue("warning", ln, `unknown directive @${dv[1]}`);
      }
      return;
    }
    stmts++;
    if (/^sequenceDiagram\b/.test(s)) {
      seen = true;
      return;
    }
    if (/^(title|accTitle|accDescr)\b/.test(s)) {
      if (/^title/.test(s)) {
        title = s.replace(/^title\s*:?\s*/, "");
      }
      return;
    }
    if ((m = s.match(/^(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/))) {
      part(m[2], m[3], m[1] === "actor");
      return;
    }
    if (/^(autonumber|activate|deactivate|destroy|create|links?)\b/.test(s)) {
      return;
    }
    if (
      (m = s.match(/^(rect|opt|alt|loop|par|critical|break|box)\b\s*(.*)$/))
    ) {
      const b: FlowBlock = {
        kind: "block",
        type: m[1],
        label: m[2].trim(),
        children: [],
        line: ln,
      };
      cur.children.push(b);
      stack.push(cur);
      cur = b;
      return;
    }
    if ((m = s.match(/^(else|and|option)\b\s*(.*)$/))) {
      if (cur !== root) {
        cur.children.push({ kind: "divider", label: m[2].trim(), line: ln });
      } else {
        issue("warning", ln, `'${m[1]}' outside a block`);
      }
      return;
    }
    if (s === "end") {
      if (stack.length) {
        cur = stack.pop()!;
      } else {
        issue("warning", ln, "extra 'end'");
      }
      return;
    }
    if ((m = s.match(/^note\s+(over|left of|right of)\s+([^:]+):\s*(.*)$/i))) {
      cur.children.push({
        kind: "note",
        pos: m[1].toLowerCase() as "over",
        parts: m[2].split(",").map((x) => part(x)),
        text: m[3],
        line: ln,
      });
      return;
    }
    if ((m = s.match(RE_MSG))) {
      const a = m[2];
      const text = m[5];
      const lm = text.match(/^\s*\[([^\]]+)\]\s*/);
      const msg: FlowMessage = {
        kind: "msg",
        line: ln,
        n: 0,
        from: part(m[1]),
        to: part(m[4]),
        arrow: a,
        dashed: a.startsWith("--"),
        head: />>$/.test(a)
          ? "fill"
          : /x$/.test(a)
          ? "cross"
          : /\)$/.test(a)
          ? "open"
          : "none",
        text,
        label: lm ? text.slice(lm[0].length) : text,
        ref: pending,
        legacyKey: lm ? lm[1].trim() : null,
      };
      cur.children.push(msg);
      pending = null;
      return;
    }
    issue("warning", ln, `not understood, skipped: ${s.slice(0, 80)}`);
  });

  if (pending) {
    const p = pending as { key: string; line: number };
    issue("warning", p.line, `@api ${p.key} is not followed by an arrow`);
  }
  if (stack.length) {
    issue("warning", cur.line, "this block is missing its 'end'");
  }
  if (!seen) {
    issues.push({
      level: "error",
      fileId: id,
      message: `${name}: no 'sequenceDiagram' line. Only Mermaid sequence diagrams are supported.`,
    });
  }
  if (!oaiDocs.length && seen) {
    issues.push({
      level: "info",
      fileId: id,
      line: 1,
      message: `${name} has no '%% @oai-doc <file>' line, so it can't say which spec it uses`,
    });
  }

  const messages: FlowMessage[] = [];
  const walk = (items: FlowItem[]) => {
    for (const it of items) {
      if (it.kind === "msg") {
        it.n = messages.length + 1;
        messages.push(it);
      } else if (it.kind === "block") {
        walk(it.children);
      }
    }
  };
  walk(root.children);

  return {
    id,
    name,
    title,
    parts,
    items: root.children,
    messages,
    oaiDocs,
    issues,
    ok: seen,
  };
};

/** "a<br/>b" → ["a", "b"] */
export const brSplit = (t: string) =>
  String(t)
    .split(/<br\s*\/?>/i)
    .map((x) => x.trim());
