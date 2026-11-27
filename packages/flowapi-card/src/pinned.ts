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
