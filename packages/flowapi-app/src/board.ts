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
  FLOW_FRAME_KIND,
  cardId,
  flowElementPrefix,
  flowFrameId,
  flowRenderKey,
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

/** generated elements of a flow on the board, with their bound labels */
const flowElementsOf = (all: readonly ExcalidrawElement[], flowId: string) => {
  const ids = new Set(
    all
      .filter((e) => !e.isDeleted && isFlowElementId(flowId, e.id))
      .map((e) => e.id),
  );
  for (const e of all) {
    if (
      !e.isDeleted &&
      e.type === "text" &&
      e.containerId &&
      ids.has(e.containerId)
    ) {
      ids.add(e.id);
    }
  }
  return ids;
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
  const old = new Set(
    all.filter((e) => isFlowElementId(flow.id, e.id)).map((e) => e.id),
  );
  const kept = all.filter(
    (e) =>
      !createdIds.has(e.id) &&
      !old.has(e.id) &&
      !(e.type === "text" && e.containerId && old.has(e.containerId)),
  );
  api.updateScene({
    elements: [...kept, ...created],
    appState: { selectedElementIds: { [frameId]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};

type Delta = { dx: number; dy: number };

/**
 * Redraws a flow on the board after its text or links changed. Elements that
 * were there before (same stable id) keep their position; new ones go where
 * the layout puts them, shifted like the message before them. The frame keeps
 * its place and grows when the flow does; sketches in it stay.
 */
export const refreshFlow = (
  api: ExcalidrawImperativeAPI,
  model: ProjectModel,
  flow: FlowModel,
) => {
  const frameId = flowFrameId(flow.id);
  const all = api.getSceneElementsIncludingDeleted();
  const frame = all.find((e) => e.id === frameId && !e.isDeleted);
  if (!frame) {
    return false;
  }
  const oldIds = flowElementsOf(all, flow.id);
  oldIds.delete(frameId);
  const old = new Map(
    all.filter((e) => oldIds.has(e.id)).map((e) => [e.id, e] as const),
  );
  const fresh = convertToExcalidrawElements(
    layoutFlow(model, flow, {
      x: frame.x,
      y: frame.y,
      linkTo: linkToElement,
    }),
    { regenerateIds: false },
  );
  const freshFrame = fresh.find((e) => e.id === frameId)!;
  const prefix = flowElementPrefix(flow.id);

  // how far the user moved each participant
  const partDx = new Map<string, number>();
  for (const el of fresh) {
    if (el.id.startsWith(`${prefix}p:`)) {
      const was = old.get(el.id);
      partDx.set(el.id.slice(`${prefix}p:`.length), was ? was.x - el.x : 0);
    }
  }

  const deltas = new Map<string, Delta>();
  let lastDy = 0;
  const moved: ExcalidrawElement[] = [];
  for (const el of fresh) {
    if (el.id === frameId || (el.type === "text" && el.containerId)) {
      continue;
    }
    const was = old.get(el.id);
    let next: ExcalidrawElement = el;
    if (
      el.type === "arrow" &&
      el.customData?.flowapi?.kind === FLOW_ARROW_KIND
    ) {
      const { from, to } = el.customData.flowapi;
      const fdx = partDx.get(from) || 0;
      const tdx = partDx.get(to) || 0;
      const dy = was ? was.y - el.y : lastDy;
      lastDy = dy;
      const points = el.points.map((p, i) =>
        i === el.points.length - 1 && from !== to
          ? ([p[0] + tdx - fdx, p[1]] as const)
          : p,
      );
      next = {
        ...el,
        x: el.x + fdx,
        y: el.y + dy,
        points: points as any,
        width: Math.abs(points[points.length - 1][0]) || el.width,
      };
      deltas.set(el.id, { dx: (fdx + tdx) / 2, dy });
    } else if (el.id.startsWith(`${prefix}life:`)) {
      // lifelines are sized after everything else is placed
      continue;
    } else {
      const d = was
        ? { dx: was.x - el.x, dy: was.y - el.y }
        : { dx: 0, dy: el.id.startsWith(`${prefix}p:`) ? 0 : lastDy };
      if (was && !el.id.startsWith(`${prefix}p:`)) {
        lastDy = d.dy;
      }
      next = { ...el, x: el.x + d.dx, y: el.y + d.dy };
      deltas.set(el.id, d);
    }
    moved.push(next);
  }
  const labels = fresh
    .filter((e) => e.type === "text" && e.containerId)
    .map((t) => {
      const d = deltas.get((t as any).containerId) || { dx: 0, dy: 0 };
      return { ...t, x: t.x + d.dx, y: t.y + d.dy } as ExcalidrawElement;
    });

  let bottom = -Infinity;
  for (const el of moved) {
    bottom = Math.max(bottom, el.y + el.height);
  }
  const lifelines = fresh
    .filter((e) => e.id.startsWith(`${prefix}life:`))
    .map((el) => {
      const pid = el.id.slice(`${prefix}life:`.length);
      const box = moved.find((m) => m.id === `${prefix}p:${pid}`);
      const top = box ? box.y + box.height : el.y;
      const x = box ? box.x + box.width / 2 : el.x;
      const len = Math.max(40, bottom + 20 - top);
      return {
        ...el,
        x,
        y: top,
        width: 0,
        height: len,
        points: [
          [0, 0],
          [0, len],
        ] as any,
      } as ExcalidrawElement;
    });

  const children = [...lifelines, ...moved, ...labels];
  let [minX, minY, maxX, maxY] = [
    frame.x,
    frame.y,
    frame.x + frame.width,
    frame.y + frame.height,
  ];
  for (const el of children) {
    minX = Math.min(minX, el.x - 20);
    minY = Math.min(minY, el.y - 20);
    maxX = Math.max(maxX, el.x + el.width + 20);
    maxY = Math.max(maxY, el.y + el.height + 20);
  }
  const nextFrame = newElementWith(frame, {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    customData: freshFrame.customData,
  });
  const others = all.filter((e) => !oldIds.has(e.id) && e.id !== frameId);
  api.updateScene({
    elements: [...others, ...children, nextFrame],
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  return true;
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
  for (const el of api.getSceneElements()) {
    const data = el.customData?.flowapi;
    if (el.type === "frame" && data?.kind === FLOW_FRAME_KIND) {
      const flow = flows.get(data.flowId);
      if (flow?.ok && data.renderKey !== flowRenderKey(model, flow)) {
        changed = refreshFlow(api, model, flow) || changed;
      }
    }
  }
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

/** a card keeps its place when its operation's key changes */
export const rekeyCard = (
  api: ExcalidrawImperativeAPI,
  specId: string,
  oldKey: string,
  newKey: string,
) => {
  const oldId = cardId(specId, oldKey);
  const newId = cardId(specId, newKey);
  const all = api.getSceneElementsIncludingDeleted();
  const card = all.find((e) => e.id === oldId && !e.isDeleted);
  if (!card) {
    return;
  }
  const data = getApiCardData(card)!;
  const moved = {
    ...newElementWith(card, {
      customData: { ...card.customData, flowapi: { ...data, key: newKey } },
    }),
    id: newId,
  } as ExcalidrawElement;
  const selected = api.getAppState().selectedElementIds[oldId];
  api.updateScene({
    elements: all
      .filter((e) => e.id !== newId)
      .map((e) => (e.id === oldId ? moved : e)),
    ...(selected
      ? { appState: { selectedElementIds: { [newId]: true } } }
      : {}),
    captureUpdate: CaptureUpdateAction.NEVER,
  });
};

/** takes a card off the board (the spec is not touched) */
export const removeCard = (
  api: ExcalidrawImperativeAPI,
  specId: string,
  key: string,
) => {
  const id = cardId(specId, key);
  const all = api.getSceneElementsIncludingDeleted();
  if (!all.some((e) => e.id === id && !e.isDeleted)) {
    return;
  }
  api.updateScene({
    elements: all.map((e) =>
      e.id === id ? newElementWith(e, { isDeleted: true }) : e,
    ),
    captureUpdate: CaptureUpdateAction.NEVER,
  });
};
