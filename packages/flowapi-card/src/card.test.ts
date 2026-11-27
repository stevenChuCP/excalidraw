import { exportScene } from "@excalidraw/excalidraw/scene/export";

import { createApiCardElement } from "./create";
import { isPinnedElement } from "./pinned";
import {
  apiCardHeight,
  getApiCardData,
  isApiCardElement,
  layoutApiCard,
  API_CARD_DEFAULT_SIZE,
} from "./render";

import type { ApiCardData } from "./types";

const DATA: Omit<ApiCardData, "kind"> = {
  specId: "s-kx-sign",
  key: "A1",
  method: "POST",
  path: "/v1/sign-requests",
  operationId: "createSignRequest",
  summary: "Create a sign request for a document",
};

describe("API card", () => {
  it("is a rectangle that carries its data in customData", () => {
    const card = createApiCardElement(DATA, { x: 10, y: 20 });
    expect(card.type).toBe("rectangle");
    expect(card.x).toBe(10);
    expect(card.width).toBe(API_CARD_DEFAULT_SIZE.width);
    expect(isApiCardElement(card)).toBe(true);
    expect(getApiCardData(card)).toEqual({ ...DATA, kind: "apiCard" });
  });

  it("does not treat plain elements as cards", () => {
    expect(isApiCardElement(null)).toBe(false);
    expect(
      isApiCardElement({
        width: 1,
        height: 1,
        opacity: 100,
        customData: { flowapi: { kind: "other" } },
      }),
    ).toBe(false);
  });

  it("lays out key, method, operationId, path and summary", () => {
    const card = createApiCardElement(DATA, { x: 0, y: 0 });
    const texts = layoutApiCard(card, getApiCardData(card)!)
      .filter((p) => p.type === "text")
      .map((p) => (p.type === "text" ? p.text : ""));
    expect(texts).toEqual([
      "A1",
      "POST",
      "createSignRequest",
      "/v1/sign-requests",
      "Create a sign request for a document",
    ]);
  });

  it("shows the gap badge and shortens long text", () => {
    const card = createApiCardElement(
      { ...DATA, gap: true, summary: "x".repeat(1000) },
      { x: 0, y: 0 },
    );
    const texts = layoutApiCard(card, getApiCardData(card)!)
      .filter((p) => p.type === "text")
      .map((p) => (p.type === "text" ? p.text : ""));
    expect(texts).toContain("not defined yet");
    const summary = texts[texts.length - 1];
    expect(summary.endsWith("…")).toBe(true);
    expect(summary.length).toBeLessThan(1000);
  });

  it("exports its content to SVG", async () => {
    const card = createApiCardElement(DATA, { x: 0, y: 0 });
    const svg = await exportScene({
      type: "svg",
      data: {
        elements: [card],
        appState: { viewBackgroundColor: "#ffffff" },
        files: {},
      },
      config: { canvasBackgroundColor: false },
    });
    const group = svg.querySelector("g.flowapi-api-card");
    expect(group).not.toBeNull();
    expect(group!.getAttribute("data-key")).toBe("A1");
    const texts = [...group!.querySelectorAll("text")].map(
      (t) => t.textContent,
    );
    expect(texts).toContain("createSignRequest");
    expect(texts).toContain("/v1/sign-requests");
  });

  it("M6: an expanded card is taller and lists its details", () => {
    const data: ApiCardData = {
      kind: "apiCard",
      specId: "s",
      key: "A2",
      method: "POST",
      path: "/x",
      expanded: true,
      details: {
        params: [],
        body: { type: "object", fields: [{ name: "id", type: "string" }] },
        responses: [{ code: "200", description: "OK", fields: [] }],
      },
    };
    const h = apiCardHeight(data);
    expect(h).toBeGreaterThan(API_CARD_DEFAULT_SIZE.height);
    expect(apiCardHeight({ ...data, expanded: false })).toBe(
      API_CARD_DEFAULT_SIZE.height,
    );
    const el = {
      width: 300,
      height: h,
      opacity: 100,
      customData: { flowapi: data },
    };
    const texts = layoutApiCard(el, data).flatMap((p) =>
      p.type === "text" ? [p.text] : [],
    );
    expect(texts).toEqual(expect.arrayContaining(["id", "200", "OK"]));
  });

  it("M6: cards and flow parts are pinned, frames and sketches are not", () => {
    const card = createApiCardElement(
      { specId: "s", key: "A1", method: "GET", path: "/" },
      { x: 0, y: 0 },
    );
    expect(isPinnedElement(card)).toBe(true);
    expect(isPinnedElement({ type: "rectangle" })).toBe(false);
    expect(
      isPinnedElement({
        type: "frame",
        customData: { flowapi: { kind: "x" } },
      }),
    ).toBe(false);
  });
});
