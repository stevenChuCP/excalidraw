import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import {
  convertToExcalidrawElements,
  defaultGetElementLinkFromSelection,
  newElementWith,
} from "@excalidraw/element";
import { API_CARD_KIND, getApiCardData } from "@flowapi/card";
import { createApiCardElement } from "@flowapi/card/create";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  FLOW_ARROW_KIND,
  cardId,
  flowFrameId,
  isFlowElementId,
  layoutFlow,
  messageLinkInfo,
} from "./layout";

import type { FlowModel, Operation, ProjectModel } from "@flowapi/core";

// Puts sidebar items on the canvas and keeps what is there in step with the
// project model (card text and gap badge, arrow links).

export const linkToElement = (id: string) =>
  defaultGetElementLinkFromSelection(id, "element");

const cardDataOf = (op: Operation) => ({
  specId: op.specId,
  key: op.key,
  method: op.method as any,
  path: op.path,
  operationId: op.operationId,
  summary: op.summary,
  gap: op.gaps.length > 0,
});

const focus = (api: ExcalidrawImperativeAPI, id: string) => {
  const el = api.getSceneElements().find((e) => e.id === id);
  if (!el) {
    return;
  }
  api.updateScene({
    appState: { selectedElementIds: { [id]: true } },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  api.setViewport({ target: id, fit: "scale-down", animation: true });
};

/** ids of API cards on the board, as `op:<specId>:<key>` */
export const cardsOnBoard = (elements: readonly ExcalidrawElement[]) => {
  const ids = new Set<string>();
  for (const el of elements) {
    const data = !el.isDeleted && getApiCardData(el);
    if (data) {
      ids.add(cardId(data.specId, data.key));
    }
  }
  return ids;
};

export const flowsOnBoard = (elements: readonly ExcalidrawElement[]) => {
  const ids = new Set<string>();
  for (const el of elements) {
    if (!el.isDeleted && el.type === "frame" && el.id.startsWith("flow:")) {
      ids.add(el.id.slice(5));
    }
  }
  return ids;
};

/** drops an operation's card at `pos` (its top-left), or shows the one already there */
export const placeOperation = (
  api: ExcalidrawImperativeAPI,
  op: Operation,
  pos: { x: number; y: number },
) => {
  if (!op.key) {
    return;
  }
  const id = cardId(op.specId, op.key);
  const all = api.getSceneElementsIncludingDeleted();
  const existing = all.find((e) => e.id === id);
  if (existing && !existing.isDeleted) {
    focus(api, id);
    return;
  }
  const fresh = createApiCardElement(cardDataOf(op), pos);
  const card = existing
    ? newElementWith(existing, {
        isDeleted: false,
        x: pos.x,
        y: pos.y,
        customData: fresh.customData,
      })
    : ({ ...fresh, id } as typeof fresh);
  api.updateScene({
    elements: [...all.filter((e) => e.id !== id), card],
    appState: { selectedElementIds: { [id]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};

/** lays a flow out in a frame at `pos` (its top-left), or shows the one already there */
export const placeFlow = (
  api: ExcalidrawImperativeAPI,
  model: ProjectModel,
  flow: FlowModel,
  pos: { x: number; y: number },
) => {
  const frameId = flowFrameId(flow.id);
  const all = api.getSceneElementsIncludingDeleted();
  if (all.some((e) => e.id === frameId && !e.isDeleted)) {
    focus(api, frameId);
    return;
  }
  const created = convertToExcalidrawElements(
    layoutFlow(model, flow, { ...pos, linkTo: linkToElement }),
    { regenerateIds: false },
  );
  // a flow deleted from the board earlier comes back fresh
  const createdIds = new Set(created.map((e) => e.id));
  const containerIds = new Set(
    all.filter((e) => isFlowElementId(flow.id, e.id)).map((e) => e.id),
  );
  const kept = all.filter(
    (e) =>
      !createdIds.has(e.id) &&
      !containerIds.has(e.id) &&
      !(e.type === "text" && e.containerId && containerIds.has(e.containerId)),
  );
  api.updateScene({
    elements: [...kept, ...created],
    appState: { selectedElementIds: { [frameId]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};

/**
 * Brings cards and arrows on the board in line with the model: card text and
 * gap badge from the spec, arrow links from the flow's @api lines. Returns
 * true when something changed.
 */
export const syncBoard = (
  api: ExcalidrawImperativeAPI,
  model: ProjectModel,
) => {
  const ops = new Map<string, Operation>();
  for (const s of model.specs) {
    for (const op of s.ops) {
      if (op.key) {
        ops.set(cardId(s.id, op.key), op);
      }
    }
  }
  const flows = new Map(model.flows.map((f) => [f.id, f]));
  let changed = false;
  const next = api.getSceneElementsIncludingDeleted().map((el) => {
    if (el.isDeleted) {
      return el;
    }
    const card = getApiCardData(el);
    if (card) {
      const op = ops.get(cardId(card.specId, card.key));
      if (!op) {
        return el;
      }
      const data = { ...cardDataOf(op), kind: API_CARD_KIND };
      if (JSON.stringify(data) === JSON.stringify({ ...card })) {
        return el;
      }
      changed = true;
      return newElementWith(el, {
        customData: { ...el.customData, flowapi: data },
      });
    }
    const arrow = el.customData?.flowapi;
    if (el.type === "arrow" && arrow?.kind === FLOW_ARROW_KIND) {
      const flow = flows.get(arrow.flowId);
      const msg = flow?.messages.find((m) => m.line === arrow.line);
      if (!flow || !msg) {
        return el;
      }
      const info = messageLinkInfo(model, flow, msg);
      const link =
        info.specId && info.key
          ? linkToElement(cardId(info.specId, info.key))
          : null;
      if (
        arrow.specId === info.specId &&
        arrow.key === info.key &&
        sameTarget(el.link, link)
      ) {
        return el;
      }
      changed = true;
      return newElementWith(el, {
        link,
        customData: {
          ...el.customData,
          flowapi: { ...arrow, specId: info.specId, key: info.key },
        },
      });
    }
    return el;
  });
  if (changed) {
    api.updateScene({
      elements: next,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }
  return changed;
};

/** compares element links by target id only (the page URL may differ) */
const sameTarget = (a: string | null, b: string | null) => {
  const id = (l: string | null) => {
    if (!l) {
      return null;
    }
    try {
      return new URL(l, "http://x").searchParams.get("element");
    } catch {
      return l;
    }
  };
  return id(a) === id(b);
};
