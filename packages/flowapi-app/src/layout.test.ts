import fs from "fs";
import path from "path";

import { convertToExcalidrawElements } from "@excalidraw/element";
import { buildProjectModel } from "@flowapi/core";

import { cardId, flowFrameId, layoutFlow } from "./layout";

const FX = path.resolve(__dirname, "../../flowapi-core/fixtures");
const file = (name: string, id: string) => ({
  id,
  name,
  text: fs.readFileSync(path.join(FX, name), "utf8"),
});

describe("layoutFlow", () => {
  it("M1-02: one frame, 5 participants, every @api arrow linked to its card", () => {
    const model = buildProjectModel({
      flows: [file("kx-sign-flow.v2.mmd", "f-v2")],
      specs: [file("kx-sign-openapi.yaml", "s-kx")],
    });
    const flow = model.flows[0];
    const elements = convertToExcalidrawElements(
      layoutFlow(model, flow, {
        x: 100,
        y: 100,
        linkTo: (id) => `https://app/?element=${id}`,
      }),
      { regenerateIds: false },
    );
    const frame = elements.find((e) => e.type === "frame");
    expect(frame?.id).toBe(flowFrameId("f-v2"));
    // everything else sits in the frame
    expect(
      elements.filter((e) => e.type !== "frame" && e.frameId !== frame?.id),
    ).toEqual([]);
    expect(
      elements.filter((e) => e.type === "rectangle" && /:p:/.test(e.id)).length,
    ).toBe(5);
    const apiMessages = flow.messages.filter((m) => m.ref);
    expect(apiMessages.length).toBe(11);
    for (const m of apiMessages) {
      const arrow = elements.find(
        (e) => e.type === "arrow" && e.customData?.flowapi?.line === m.line,
      );
      expect(arrow?.type).toBe("arrow");
      expect(arrow?.link).toBe(
        `https://app/?element=${cardId("s-kx", m.ref!.key)}`,
      );
    }
  });
});
