import { API_CARD_KIND } from "./types";

type ElementLike = {
  type: string;
  frameId?: string | null;
  customData?: Record<string, any>;
};

/**
 * Elements the app draws from a flow's text or a spec (flow shapes, arrows,
 * labels, API cards). The canvas can select them but not move, resize or
 * retype them: the text is the source. Frames stay movable and carry their
 * contents along.
 */
export const isPinnedElement = (element: ElementLike | null | undefined) =>
  !!element?.customData?.flowapi &&
  element.type !== "frame" &&
  element.type !== "magicframe";

/** pinned elements that Delete may remove (a card is hidden, not the spec) */
export const isDeletablePinned = (element: ElementLike | null | undefined) =>
  element?.customData?.flowapi?.kind === API_CARD_KIND;

/** a pinned element moves only when its frame moves */
export const keepMovable = <T extends ElementLike>(
  elements: readonly T[],
  movingFrameIds: ReadonlySet<string>,
) =>
  elements.filter(
    (el) =>
      !isPinnedElement(el) || (!!el.frameId && movingFrameIds.has(el.frameId)),
  );

/** a frame the app made for a flow or a spec */
export const isFlowapiFrame = (element: ElementLike | null | undefined) =>
  !!element?.customData?.flowapi &&
  (element.type === "frame" || element.type === "magicframe");

type FullElementLike = ElementLike & {
  id: string;
  containerId?: string | null;
  isDeleted?: boolean;
};

/** pinned elements, the app's frames, and the labels inside pinned shapes */
export const isProtectedElement = (
  element: FullElementLike | null | undefined,
  getElement: (id: string) => FullElementLike | null | undefined,
) =>
  !!element &&
  (isPinnedElement(element) ||
    isFlowapiFrame(element) ||
    (element.type === "text" &&
      !!element.containerId &&
      isPinnedElement(getElement(element.containerId))));

/** the parts of an element a canvas action must not change on protected ones */
const GUARDED_KEYS = [
  "x",
  "y",
  "width",
  "height",
  "angle",
  "points",
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "roughness",
  "roundness",
  "opacity",
  "fontSize",
  "fontFamily",
  "text",
  "originalText",
  "textAlign",
  "verticalAlign",
  "containerId",
  "frameId",
  "groupIds",
  "link",
  "locked",
  "isDeleted",
  "customData",
  "startArrowhead",
  "endArrowhead",
  "name",
] as const;

const sameGuarded = (a: any, b: any) =>
  GUARDED_KEYS.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));

/**
 * Filters what a canvas action (flip, font size, paste styles, duplicate,
 * group, wrap in frame, add link...) does to the scene: protected elements
 * keep their previous state, copies of them are dropped. Hiding a card
 * (deleting it) stays allowed.
 */
export const guardActionElements = <T extends FullElementLike>(
  next: readonly T[],
  prev: ReadonlyMap<string, T>,
): T[] => {
  const nextById = new Map(next.map((e) => [e.id, e]));
  const lookup = (id: string) => nextById.get(id) ?? prev.get(id);
  const out: T[] = [];
  for (const el of next) {
    const was = prev.get(el.id);
    if (was) {
      if (
        el !== was &&
        isProtectedElement(was, lookup) &&
        !sameGuarded(el, was) &&
        !(isDeletablePinned(was) && el.isDeleted)
      ) {
        out.push(was);
        continue;
      }
      out.push(el);
    } else if (
      el.customData?.flowapi ||
      (el.type === "text" &&
        el.containerId &&
        isProtectedElement(lookup(el.containerId), lookup))
    ) {
      // a copy of a protected element: dropped
      continue;
    } else {
      out.push(el);
    }
  }
  // protected elements an action left out come back
  for (const was of prev.values()) {
    if (
      !nextById.has(was.id) &&
      !was.isDeleted &&
      isProtectedElement(was, lookup)
    ) {
      out.push(was);
    }
  }
  return out;
};
