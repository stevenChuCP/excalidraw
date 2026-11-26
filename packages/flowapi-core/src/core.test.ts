import fs from "fs";
import path from "path";

import { parse as parseYaml } from "yaml";

import {
  buildProjectModel,
  importFiles,
  parseFlow,
  parseSpec,
  planKeys,
  suggestKeyPattern,
  uniqueFileName,
  writeKeys,
} from "./index";

import type { Issue, Project } from "./types";

const FIX = path.resolve(__dirname, "../fixtures");
const read = (name: string) => fs.readFileSync(path.join(FIX, name), "utf8");

const projectOf = (...names: string[]): Project =>
  importFiles(
    { flows: [], specs: [] },
    names.map((name) => ({ name, text: read(name) })),
  ).project;

describe("spec parsing", () => {
  it("reads the 7 operations of the KX spec with their keys", () => {
    const { model } = parseSpec(
      "s-kx",
      "kx-sign-openapi.yaml",
      read("kx-sign-openapi.yaml"),
    );
    expect(model.title).toBe("KX Sign SaaS API");
    expect(model.ops.map((o) => o.key).sort()).toEqual([
      "A1",
      "A2",
      "A3",
      "A4",
      "A5",
      "A6",
      "A7",
    ]);
    const a6 = model.ops.find((o) => o.key === "A6")!;
    expect(a6.webhook).toBe(true);
    const a1 = model.ops.find((o) => o.key === "A1")!;
    expect(a1).toMatchObject({
      method: "POST",
      path: "/v1/sign-requests",
      operationId: "createSignRequest",
      line: 31,
    });
  });

  it("finds gaps automatically and flags the stale marker", () => {
    const { model } = parseSpec(
      "s-kx",
      "kx-sign-openapi.yaml",
      read("kx-sign-openapi.yaml"),
    );
    const gapKeys = model.ops.filter((o) => o.gaps.length).map((o) => o.key);
    expect(gapKeys.sort()).toEqual(["A2", "A3", "A4", "A5", "A6"]);
    expect(model.ops.find((o) => o.key === "A1")!.gaps).toEqual([]);
    expect(model.ops.find((o) => o.key === "A4")!.gaps).toEqual([
      "request has no fields",
      "200 response has no fields",
    ]);
    const stale = model.issues.filter((i) => /stale marker/.test(i.message));
    expect(stale.some((i) => /A2 .*request body/.test(i.message))).toBe(true);
  });

  it("reports duplicate keys", () => {
    const { model } = parseSpec(
      "s-dup",
      "duplicate-keys-openapi.yaml",
      read("duplicate-keys-openapi.yaml"),
    );
    expect(
      model.issues.some(
        (i) =>
          i.level === "error" && /Key B1 is on 2 operations/.test(i.message),
      ),
    ).toBe(true);
  });
});

describe("flow parsing", () => {
  it("reads participants, @oai-doc and @api lines", () => {
    const flow = parseFlow(
      "f",
      "kx-sign-flow.v2.mmd",
      read("kx-sign-flow.v2.mmd"),
    );
    expect(flow.parts).toHaveLength(5);
    expect(flow.oaiDocs).toEqual([
      { alias: null, file: "kx-sign-openapi.yaml", line: 1 },
    ]);
    const refs = flow.messages.filter((m) => m.ref).map((m) => m.ref!.key);
    expect(refs).toEqual([
      "A1",
      "A1",
      "A2",
      "A2",
      "A3",
      "A3",
      "A4",
      "A5",
      "A6",
      "A7",
      "A7",
    ]);
    expect(flow.issues).toEqual([]);
  });

  it("reads aliases for several specs", () => {
    const flow = parseFlow(
      "f",
      "two-specs-flow.mmd",
      read("two-specs-flow.mmd"),
    );
    expect(flow.oaiDocs.map((d) => [d.alias, d.file])).toEqual([
      ["kx", "kx-sign-openapi.yaml"],
      ["ca", "ca-openapi.yaml"],
    ]);
    expect(flow.messages[0].ref).toMatchObject({ alias: "ca", key: "E1" });
    expect(flow.messages[2].ref).toMatchObject({ alias: null, key: "A1" });
  });
});

describe("project", () => {
  it("M1-01: imports a flow and a spec into the sidebar model", () => {
    const project = projectOf("kx-sign-flow.v2.mmd", "kx-sign-openapi.yaml");
    expect(project.flows.map((f) => f.name)).toEqual(["kx-sign-flow.v2.mmd"]);
    expect(project.specs.map((s) => s.name)).toEqual(["kx-sign-openapi.yaml"]);
    const model = buildProjectModel(project);
    expect(model.specs[0].ops).toHaveLength(7);
  });

  it("M1-02: links every @api arrow", () => {
    const model = buildProjectModel(
      projectOf("kx-sign-flow.v2.mmd", "kx-sign-openapi.yaml"),
    );
    const flow = model.flows[0];
    const linked = flow.messages.filter((m) => model.links[flow.id][m.line]);
    expect(linked.map((m) => model.links[flow.id][m.line].key)).toEqual([
      "A1",
      "A1",
      "A2",
      "A2",
      "A3",
      "A3",
      "A4",
      "A5",
      "A6",
      "A7",
      "A7",
    ]);
    expect(model.missingSpecs).toEqual([]);
  });

  it("M1-03: names a spec the flow needs but the project lacks", () => {
    const model = buildProjectModel(projectOf("kx-sign-flow.v2.mmd"));
    expect(model.missingSpecs).toEqual([
      { flowId: "f-kx-sign-flow-v2", file: "kx-sign-openapi.yaml" },
    ]);
  });

  it("M1-05: a dropped file with a taken name gets a number", () => {
    const first = projectOf("kx-sign-openapi.yaml");
    const { project, added } = importFiles(first, [
      { name: "kx-sign-openapi.yaml", text: read("kx-sign-openapi.yaml") },
    ]);
    expect(project.specs.map((s) => s.name)).toEqual([
      "kx-sign-openapi.yaml",
      "kx-sign-openapi-2.yaml",
    ]);
    expect(added[0].renamedFrom).toBe("kx-sign-openapi.yaml");
    expect(project.specs[0].text).toBe(read("kx-sign-openapi.yaml"));
    expect(uniqueFileName(["a.yaml", "a-2.yaml"], "a.yaml")).toBe("a-3.yaml");
  });

  it("M1-06: writes a key on every operation of a keyless spec", () => {
    const text = read("no-keys-openapi.yaml");
    const { model } = parseSpec("s", "no-keys-openapi.yaml", text);
    expect(model.ops.every((o) => !o.key)).toBe(true);
    const pattern = suggestKeyPattern(model.ops, model.title);
    expect(pattern).toEqual({ prefix: "N", start: 1 });
    const out = writeKeys(text, planKeys(model.ops, pattern));
    const after = parseSpec("s", "no-keys-openapi.yaml", out).model;
    expect(after.ops.map((o) => o.key)).toEqual(
      model.ops.map((_, i) => `N${i + 1}`),
    );
    // only new lines were added; every original line is still there in order
    const isNew = (l: string) => /^\s*x-diagram-tag: N\d+$/.test(l);
    expect(out.split("\n").filter(isNew)).toHaveLength(model.ops.length);
    expect(out.split("\n").filter((l) => !isNew(l))).toEqual(text.split("\n"));
  });

  it("M1-07: @api ca:E1 links to the CA spec", () => {
    const model = buildProjectModel(
      projectOf(
        "two-specs-flow.mmd",
        "kx-sign-openapi.yaml",
        "ca-openapi.yaml",
      ),
    );
    const flow = model.flows[0];
    const l = model.links[flow.id][flow.messages[0].line];
    expect(l).toMatchObject({ specId: "s-ca-openapi", key: "E1", how: "tag" });
    expect(model.links[flow.id][flow.messages[2].line]).toMatchObject({
      specId: "s-kx-sign-openapi",
      key: "A1",
    });
    expect(model.issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("M1-09: old [A1] tags still link, with a suggestion", () => {
    const model = buildProjectModel(
      projectOf("kx-sign-flow.mmd", "kx-sign-openapi.yaml"),
    );
    const flow = model.flows[0];
    expect(Object.keys(model.links[flow.id]).length).toBeGreaterThanOrEqual(11);
    expect(
      model.issues.some(
        (i) => i.level === "info" && /old inline \[key\] tag/.test(i.message),
      ),
    ).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// M1-04: same findings as today's flow-api-viewer.html
// -----------------------------------------------------------------------------

// today's viewer reads YAML with js-yaml; `yaml` stands in for it here
const jsyaml = { load: (text: string) => parseYaml(text) };

const runViewer = (flowText: string, specText: string) => {
  const html = read("flow-api-viewer.html");
  const code = html.slice(
    html.indexOf("var ARROWS="),
    html.indexOf("/* ================= text measuring"),
  );
  // eslint-disable-next-line no-new-func
  const { parseSeq, buildModel, linkMessages } = new Function(
    "jsyaml",
    `${code}; return { parseSeq, buildModel, linkMessages };`,
  )(jsyaml);
  const seq = parseSeq(flowText);
  const model = buildModel(jsyaml.load(specText));
  const issues: { lvl: string; t: string }[] = [
    ...seq.issues,
    ...model.issues,
    ...linkMessages(seq, model),
  ];
  if (!seq.oaiDoc) {
    issues.push({ lvl: "info2", t: "no @oai-doc" });
  }
  return issues;
};

const LEVEL: Record<string, Issue["level"]> = {
  err: "error",
  warn: "warning",
  guess: "guess",
  info: "unused",
  info2: "info",
};

/** level plus the line number or key a finding is about */
const fingerprint = (level: string, text: string) => {
  const line = text.match(/[Ll]ine (\d+)/);
  const key = text.match(/^([A-Z]+\d+) /);
  return `${level}:${line ? `L${line[1]}` : key ? key[1] : "-"}`;
};

describe("M1-04: Checks match today's viewer", () => {
  for (const flowName of [
    "kx-sign-flow.v2.mmd",
    "kx-sign-flow.mmd",
    "webhook-retry.mmd",
  ]) {
    it(`${flowName} + kx-sign-openapi.yaml`, () => {
      const viewer = runViewer(read(flowName), read("kx-sign-openapi.yaml"))
        .map((i) => fingerprint(LEVEL[i.lvl], i.t))
        .sort();
      const model = buildProjectModel(
        projectOf(flowName, "kx-sign-openapi.yaml"),
      );
      const ours = model.issues
        // checks decided after the viewer: gaps and stale x-undefined markers
        .filter((i) => i.level !== "gap" && !/stale marker/.test(i.message))
        .map((i) => fingerprint(i.level, i.message))
        .sort();
      expect(ours).toEqual(viewer);
    });
  }
});
