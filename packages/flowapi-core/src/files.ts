import { baseName } from "./project";

import type { Project, SourceFile } from "./types";

export type FileKind = "flow" | "spec";

/** decides whether a dropped text is a Mermaid flow or an OpenAPI spec */
export const classifyFile = (name: string, text: string): FileKind | null => {
  if (/\.(mmd|mermaid)$/i.test(name)) {
    return "flow";
  }
  if (/^\s*["']?(openapi|swagger)["']?\s*:/m.test(text)) {
    return "spec";
  }
  if (/\.(ya?ml|json)$/i.test(name)) {
    return /"(openapi|swagger)"\s*:/.test(text) || /\.ya?ml$/i.test(name)
      ? "spec"
      : null;
  }
  if (/^\s*(%%[^\n]*\n\s*)*sequenceDiagram/m.test(text)) {
    return "flow";
  }
  return null;
};

/**
 * Decided: a dropped file whose name is already in the project is added as a
 * copy with a number ("kx-sign-openapi-2.yaml"), never replacing the other.
 */
export const uniqueFileName = (taken: string[], name: string) => {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  if (!lower.has(name.toLowerCase())) {
    return name;
  }
  const m = name.match(/^(.*?)(\.[^.]+)?$/)!;
  const stem = m[1];
  const ext = m[2] || "";
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!lower.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
};

const slug = (s: string) =>
  s
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "file";

export const uniqueId = (taken: string[], prefix: "s" | "f", name: string) => {
  const base = `${prefix}-${slug(name)}`;
  const set = new Set(taken);
  if (!set.has(base)) {
    return base;
  }
  for (let n = 2; ; n++) {
    if (!set.has(`${base}-${n}`)) {
      return `${base}-${n}`;
    }
  }
};

export type ImportResult = {
  project: Project;
  added: (SourceFile & { kind: FileKind; renamedFrom?: string })[];
  rejected: { name: string; reason: string }[];
};

/** adds files to the sidebar (decided: import never puts anything on the canvas) */
export const importFiles = (
  project: Project,
  files: { name: string; text: string }[],
): ImportResult => {
  const next: Project = {
    ...project,
    flows: [...project.flows],
    specs: [...project.specs],
  };
  const added: ImportResult["added"] = [];
  const rejected: ImportResult["rejected"] = [];
  for (const f of files) {
    const name = baseName(f.name) || "untitled";
    const kind = classifyFile(name, f.text);
    if (!kind) {
      rejected.push({
        name,
        reason: "not a Mermaid sequence diagram or an OpenAPI spec",
      });
      continue;
    }
    const all = [...next.flows, ...next.specs];
    const finalName = uniqueFileName(
      all.map((x) => x.name),
      name,
    );
    const id = uniqueId(
      all.map((x) => x.id),
      kind === "flow" ? "f" : "s",
      finalName,
    );
    const file: SourceFile = { id, name: finalName, text: f.text };
    (kind === "flow" ? next.flows : next.specs).push(file);
    added.push({
      ...file,
      kind,
      ...(finalName !== name ? { renamedFrom: name } : {}),
    });
  }
  return { project: next, added, rejected };
};
