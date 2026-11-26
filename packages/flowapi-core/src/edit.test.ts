import fs from "fs";
import path from "path";

import { buildProjectModel } from "./project";
import {
  addOperation,
  arrowsLinkedTo,
  deleteOperationFromProject,
  fixDuplicateKey,
  keyProblem,
  linkArrow,
  nextKey,
  renameKey,
  stubFromLabel,
} from "./edit";

import type { Project } from "./types";

const FX = path.resolve(__dirname, "../fixtures");
const read = (n: string) => fs.readFileSync(path.join(FX, n), "utf8");
const kx = (): Project => ({
  flows: [
    {
      id: "f-v2",
      name: "kx-sign-flow.v2.mmd",
      text: read("kx-sign-flow.v2.mmd"),
    },
  ],
  specs: [
    {
      id: "s-kx",
      name: "kx-sign-openapi.yaml",
      text: read("kx-sign-openapi.yaml"),
    },
  ],
});

/** lines of b that are not in a, and of a not in b (a crude line diff) */
const changedLines = (a: string, b: string) => {
  const al = a.split("\n");
  const bl = b.split("\n");
  let i = 0;
  while (i < al.length && al[i] === bl[i]) {
    i++;
  }
  let j = 0;
  while (j < al.length - i && al[al.length - 1 - j] === bl[bl.length - 1 - j]) {
    j++;
  }
  return {
    removed: al.slice(i, al.length - j),
    added: bl.slice(i, bl.length - j),
  };
};

describe("renameKey (M2-03)", () => {
  it("rewrites the spec tag and every @api line, nothing else", () => {
    const model = buildProjectModel(kx());
    const op = model.specs[0].ops.find((o) => o.key === "A2")!;
    const next = renameKey(model, "s-kx", op, "A20");
    const spec = changedLines(kx().specs[0].text, next.specs[0].text);
    expect(spec.removed).toEqual(["      x-diagram-tag: A2"]);
    expect(spec.added).toEqual(["      x-diagram-tag: A20"]);
    const flow = next.flows[0].text;
    expect(flow.match(/@api A20$/gm)?.length).toBe(2);
    expect(flow).not.toMatch(/@api A2$/m);
    const after = buildProjectModel(next);
    expect(arrowsLinkedTo(after, "s-kx", "A20").length).toBe(2);
  });

  it("refuses a key that is taken", () => {
    const model = buildProjectModel(kx());
    expect(keyProblem(model, "s-kx", "A1")).toMatch(/already used/);
    expect(keyProblem(model, "s-kx", "A9")).toBeNull();
    expect(keyProblem(model, "s-kx", "9x")).toMatch(/letter/);
  });
});

describe("create, link and delete (M4)", () => {
  it("M4-01: a stub for the cancel arrow gets A8 and only adds lines", () => {
    const base = kx();
    base.flows[0].text = base.flows[0].text.replace(
      "    TB->>S: GET /v1/sign-requests/{id}\n",
      "    TB->>S: GET /v1/sign-requests/{id}\n    TB->>S: POST /v1/sign-requests/{id}/cancel\n",
    );
    let model = buildProjectModel(base);
    const msg = model.flows[0].messages.find((m) => /cancel/.test(m.label))!;
    expect(model.links["f-v2"][msg.line]).toBeUndefined();
    const key = nextKey(model, "s-kx");
    expect(key).toBe("A8");
    const stub = stubFromLabel(msg.label, key);
    expect(stub).toMatchObject({
      method: "POST",
      path: "/v1/sign-requests/{id}/cancel",
      operationId: "cancelSignRequest",
    });
    const specText = addOperation(base.specs[0].text, stub);
    const d = changedLines(base.specs[0].text, specText);
    expect(d.removed).toEqual([]);
    expect(d.added.join("\n")).toMatch(
      /\/v1\/sign-requests\/\{id\}\/cancel:\n\s+post:\n[\s\S]*x-diagram-tag: A8/,
    );
    model = buildProjectModel({
      ...base,
      specs: [{ ...base.specs[0], text: specText }],
    });
    const linked = linkArrow(model, "f-v2", msg.line, "s-kx", "A8");
    expect(linked.flows[0].text).toMatch(
      /%% @api A8\n\s+TB->>S: POST \/v1\/sign-requests\/\{id\}\/cancel/,
    );
    const after = buildProjectModel(linked);
    const m2 = after.flows[0].messages.find((m) => /cancel/.test(m.label))!;
    expect(after.links["f-v2"][m2.line]).toMatchObject({
      key: "A8",
      how: "tag",
    });
  });

  it("M4-04: deleting A4 retires the key and breaks its arrow", () => {
    const model = buildProjectModel(kx());
    const op = model.specs[0].ops.find((o) => o.key === "A4")!;
    expect(arrowsLinkedTo(model, "s-kx", "A4").length).toBe(1);
    const next = deleteOperationFromProject(model, op);
    expect(next.specs[0].text).not.toMatch(/\/reject:/);
    expect(next.retiredKeys).toEqual({ "s-kx": ["A4"] });
    const after = buildProjectModel(next);
    expect(after.specs[0].ops.length).toBe(6);
    expect(arrowsLinkedTo(after, "s-kx", "A4")).toEqual([]);
    expect(keyProblem(after, "s-kx", "A4")).toMatch(/not reused/);
    expect(nextKey(after, "s-kx")).toBe("A8");
    // the other operations' text is untouched
    const d = changedLines(kx().specs[0].text, next.specs[0].text);
    expect(d.added).toEqual([]);
    expect(d.removed[0]).toMatch(
      /\/v1\/mobile\/sign-requests\/\{id\}\/reject:/,
    );
  });

  it("M4-03: the duplicate key fix renames one of the two", () => {
    const project: Project = {
      flows: [],
      specs: [
        {
          id: "s-dup",
          name: "duplicate-keys-openapi.yaml",
          text: read("duplicate-keys-openapi.yaml"),
        },
      ],
    };
    const model = buildProjectModel(project);
    expect(model.issues.some((i) => /B1 is on 2/.test(i.message))).toBe(true);
    const next = fixDuplicateKey(model, "s-dup", "B1");
    const after = buildProjectModel(next);
    expect(after.specs[0].ops.map((o) => o.key)).toEqual(["B1", "B2"]);
    expect(after.issues.some((i) => /is on 2/.test(i.message))).toBe(false);
  });
});
