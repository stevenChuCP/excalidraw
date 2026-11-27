import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import {
  convertToExcalidrawElements,
  defaultGetElementLinkFromSelection,
  newElementWith,
  newFrameElement,
} from "@excalidraw/element";
import { API_CARD_KIND, apiCardHeight, getApiCardData } from "@flowapi/card";
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

/** M6: flow parts can't be moved by hand, so a redraw lays out everything */
const PINNED_FLOWS = true;

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
  details: op.details,
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
  specName = op.specId,
) => {
  if (!op.key) {
    return;
  }
  const id = cardId(op.specId, op.key);
  if (api.getSceneElements().some((e) => e.id === id)) {
    focus(api, id);
    return;
  }
  placeCardInSpecFrame(api, op, specName, undefined, pos);
  api.updateScene({
    appState: { selectedElementIds: { [id]: true } },
    captureUpdate: CaptureUpdateAction.NEVER,
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
  // the layout origin moves with the frame when the user drags it
  const [ox, oy] = frame.customData?.flowapi?.originOffset || [0, 0];
  const origin = { x: frame.x + ox, y: frame.y + oy };
  const fresh = convertToExcalidrawElements(
    layoutFlow(model, flow, { ...origin, linkTo: linkToElement }),
    { regenerateIds: false },
  );
  const freshFrame = fresh.find((e) => e.id === frameId)!;
  const prefix = flowElementPrefix(flow.id);

  /** how far the user moved an element away from where the layout put it */
  const userDelta = (was: ExcalidrawElement | undefined): Delta | null => {
    // flow parts are pinned (M6): only boards from before M6 can have parts
    // moved by hand, and those snap back to the layout too
    if (PINNED_FLOWS) {
      return null;
    }
    const auto = was?.customData?.flowapi?.auto;
    if (!was || !Array.isArray(auto)) {
      return null;
    }
    const dx = Math.round(was.x - origin.x) - auto[0];
    const dy = Math.round(was.y - origin.y) - auto[1];
    return Math.abs(dx) > 1 || Math.abs(dy) > 1 ? { dx, dy } : null;
  };

  // participants the user moved sideways take their arrows along
  const partDx = new Map<string, number>();
  for (const el of fresh) {
    if (el.id.startsWith(`${prefix}p:`)) {
      const d = userDelta(old.get(el.id));
      partDx.set(el.id.slice(`${prefix}p:`.length), d ? d.dx : 0);
    }
  }

  // Elements moved by hand keep their place; untouched ones follow the new
  // layout, so a message inserted mid-flow pushes the untouched ones below it
  // down instead of landing on top of them.
  const deltas = new Map<string, Delta>();
  const moved: ExcalidrawElement[] = [];
  for (const el of fresh) {
    if (el.id === frameId || (el.type === "text" && el.containerId)) {
      continue;
    }
    if (el.id.startsWith(`${prefix}life:`)) {
      continue; // sized after everything else is placed
    }
    const was = old.get(el.id);
    const user = userDelta(was);
    let next: ExcalidrawElement = el;
    if (
      el.type === "arrow" &&
      el.customData?.flowapi?.kind === FLOW_ARROW_KIND
    ) {
      const { from, to } = el.customData.flowapi;
      const fdx = partDx.get(from) || 0;
      const tdx = partDx.get(to) || 0;
      // an arrow keeps a height the user gave it; its ends follow participants
      const dy = user ? was!.y - el.y : 0;
      const points = el.points.map((pt, i) =>
        i === el.points.length - 1 && from !== to
          ? ([pt[0] + tdx - fdx, pt[1]] as const)
          : pt,
      );
      next = {
        ...el,
        x: el.x + fdx,
        y: el.y + dy,
        points: points as any,
        width: Math.abs(points[points.length - 1][0]) || el.width,
      };
      deltas.set(el.id, { dx: (fdx + tdx) / 2, dy });
    } else {
      const d = user
        ? { dx: was!.x - el.x, dy: was!.y - el.y }
        : { dx: 0, dy: 0 };
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
    freshFrame.x,
    freshFrame.y,
    freshFrame.x + freshFrame.width,
    freshFrame.y + freshFrame.height,
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
    customData: {
      ...freshFrame.customData,
      flowapi: {
        ...freshFrame.customData?.flowapi,
        originOffset: [origin.x - minX, origin.y - minY],
      },
    },
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
      const data = {
        ...cardDataOf(op),
        kind: API_CARD_KIND as typeof API_CARD_KIND,
        ...(card.expanded ? { expanded: true } : {}),
      };
      const height = apiCardHeight(data);
      if (
        JSON.stringify(data) === JSON.stringify({ ...card }) &&
        el.height === height
      ) {
        return el;
      }
      changed = true;
      return newElementWith(el, {
        height,
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
      // M6: the key chip links the arrow to its card, not an element link
      const link = null;
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
  const arranged = arrangeCards(
    next,
    (id) => specNameOf(model, id),
    rankOf(model),
  );
  if (changed || arranged.changed) {
    api.updateScene({
      elements: arranged.elements,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }
  return changed || arranged.changed;
};

const specNameOf = (model: ProjectModel, specId: string) =>
  model.specs.find((s) => s.id === specId)?.name || specId;

const CARD_PAD = 24;
const CARD_GAP = 20;

/** a card's place in its spec: the order of the spec file, as in the sidebar */
export type CardRank = (specId: string, key: string) => number;

const rankOf = (model: ProjectModel): CardRank => {
  const ranks = new Map<string, number>();
  for (const s of model.specs) {
    s.ops.forEach((o, i) => ranks.set(cardId(s.id, o.key), i));
  }
  return (specId, key) => ranks.get(cardId(specId, key)) ?? Infinity;
};

/**
 * Cards live in their spec's frame (M6): stacked in the spec's order (or
 * their current order when no rank is given), the frame sized to fit. Cards
 * outside a frame (boards from before M6) move into one, made where they are.
 */
export const arrangeCards = (
  all: readonly ExcalidrawElement[],
  specName: (specId: string) => string,
  rank?: CardRank,
) => {
  const live = all.filter((e) => !e.isDeleted);
  const bySpec = new Map<string, ExcalidrawElement[]>();
  for (const el of live) {
    const d = getApiCardData(el);
    if (d) {
      bySpec.set(d.specId, [...(bySpec.get(d.specId) || []), el]);
    }
  }
  const updates = new Map<string, ExcalidrawElement>();
  const added: ExcalidrawElement[] = [];
  for (const [specId, cards] of bySpec) {
    const fid = specFrameId(specId);
    let frame = live.find((e) => e.id === fid);
    const created = !frame;
    if (!frame) {
      frame = {
        ...newFrameElement({
          x: Math.min(...cards.map((c) => c.x)) - CARD_PAD,
          y: Math.min(...cards.map((c) => c.y)) - CARD_PAD,
          width: 100,
          height: 100,
          name: specName(specId),
        }),
        id: fid,
        customData: { flowapi: { kind: SPEC_FRAME_KIND, specId } },
      } as ExcalidrawElement;
    }
    cards.sort((a, b) => {
      const da = getApiCardData(a)!;
      const db = getApiCardData(b)!;
      return (
        (rank ? rank(da.specId, da.key) - rank(db.specId, db.key) : 0) ||
        a.y - b.y
      );
    });
    let y = frame.y + CARD_PAD;
    let w = 0;
    for (const c of cards) {
      const h = apiCardHeight(getApiCardData(c));
      const x = frame.x + CARD_PAD;
      if (c.x !== x || c.y !== y || c.height !== h || c.frameId !== fid) {
        updates.set(c.id, newElementWith(c, { x, y, height: h, frameId: fid }));
      }
      y += h + CARD_GAP;
      w = Math.max(w, c.width);
    }
    const width = w + CARD_PAD * 2;
    const height = y - CARD_GAP + CARD_PAD - frame.y;
    if (created) {
      added.push({ ...frame, width, height } as ExcalidrawElement);
    } else if (frame.width !== width || frame.height !== height) {
      updates.set(fid, newElementWith(frame, { width, height }));
    }
  }
  if (!updates.size && !added.length) {
    return { elements: all, changed: false };
  }
  return {
    elements: [...all.map((e) => updates.get(e.id) || e), ...added],
    changed: true,
  };
};

/** expands or collapses a card; the cards below it move */
export const toggleCard = (
  api: ExcalidrawImperativeAPI,
  id: string,
  model: ProjectModel,
) => {
  const all = api.getSceneElementsIncludingDeleted();
  const card = all.find((e) => e.id === id && !e.isDeleted);
  const data = getApiCardData(card);
  if (!card || !data) {
    return;
  }
  const flowapi = { ...data, expanded: !data.expanded };
  if (!flowapi.expanded) {
    delete (flowapi as { expanded?: boolean }).expanded;
  }
  const next = all.map((e) =>
    e.id === id
      ? newElementWith(e, {
          height: apiCardHeight(flowapi),
          customData: { ...e.customData, flowapi },
        })
      : e,
  );
  api.updateScene({
    elements: arrangeCards(next, (s) => specNameOf(model, s), rankOf(model))
      .elements,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};

/** moves the view to a card and selects it */
export const focusCard = (api: ExcalidrawImperativeAPI, id: string) =>
  focus(api, id);

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
    elements: arrangeCards(
      all
        .filter((e) => e.id !== newId)
        .map((e) => (e.id === oldId ? moved : e)),
      (s) => s,
    ).elements,
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
    elements: arrangeCards(
      all.map((e) =>
        e.id === id ? newElementWith(e, { isDeleted: true }) : e,
      ),
      (s) => s,
    ).elements,
    captureUpdate: CaptureUpdateAction.NEVER,
  });
};

export const specFrameId = (specId: string) => `spec:${specId}`;
export const SPEC_FRAME_KIND = "specFrame";

/**
 * Puts an operation's card on the board by itself (decided: linking an arrow
 * to an operation with no card places it next to its spec's frame). The card
 * goes at the bottom of the spec's frame, which is made beside the flow's
 * frame the first time. Does nothing when the card is already there.
 */
export const placeCardInSpecFrame = (
  api: ExcalidrawImperativeAPI,
  op: Operation,
  specName: string,
  nearFlowId?: string,
  at?: { x: number; y: number },
) => {
  if (!op.key) {
    return;
  }
  const id = cardId(op.specId, op.key);
  const all = api.getSceneElementsIncludingDeleted();
  if (all.some((e) => e.id === id && !e.isDeleted)) {
    return;
  }
  const PAD = 24;
  const GAP = 20;
  const fid = specFrameId(op.specId);
  let frame: ExcalidrawElement | undefined = all.find(
    (e) => e.id === fid && !e.isDeleted,
  );
  const card0 = createApiCardElement(cardDataOf(op), { x: 0, y: 0 });
  let x: number;
  let y: number;
  if (frame) {
    const inFrame = all.filter((e) => !e.isDeleted && e.frameId === fid);
    const bottom = inFrame.length
      ? Math.max(...inFrame.map((e) => e.y + e.height))
      : frame.y + PAD - GAP;
    x = frame.x + PAD;
    y = bottom + GAP;
  } else {
    const near = nearFlowId
      ? all.find((e) => e.id === flowFrameId(nearFlowId) && !e.isDeleted)
      : null;
    const anchor =
      near ||
      all
        .filter((e) => !e.isDeleted)
        .reduce<ExcalidrawElement | null>(
          (r, e) => (!r || e.x + e.width > r.x + r.width ? e : r),
          null,
        );
    const fx = at ? at.x : anchor ? anchor.x + anchor.width + 80 : 0;
    const fy = at ? at.y : anchor ? anchor.y : 0;
    frame = {
      ...newFrameElement({
        x: fx,
        y: fy,
        width: card0.width + PAD * 2,
        height: card0.height + PAD * 2,
        name: specName,
      }),
      id: fid,
      customData: { flowapi: { kind: SPEC_FRAME_KIND, specId: op.specId } },
    } as ExcalidrawElement;
    x = fx + PAD;
    y = fy + PAD;
  }
  const card = {
    ...card0,
    id,
    x,
    y,
    frameId: fid,
  } as ExcalidrawElement;
  const f = frame;
  const nextFrame = newElementWith(f, {
    width: Math.max(f.width, x + card.width + PAD - f.x),
    height: Math.max(f.height, y + card.height + PAD - f.y),
  });
  api.updateScene({
    elements: arrangeCards(
      [...all.filter((e) => e.id !== id && e.id !== fid), card, nextFrame],
      () => specName,
    ).elements,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};
