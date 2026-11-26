import { newElement } from "@excalidraw/element";
import { ROUNDNESS } from "@excalidraw/common";

import { API_CARD_DEFAULT_SIZE } from "./render";
import { API_CARD_KIND } from "./types";

import type { ApiCardData } from "./types";

/** A new API card: a rectangle carrying `customData.flowapi`. */
export const createApiCardElement = (
  data: Omit<ApiCardData, "kind">,
  position: { x: number; y: number },
) => {
  return newElement({
    type: "rectangle",
    x: position.x,
    y: position.y,
    width: API_CARD_DEFAULT_SIZE.width,
    height: API_CARD_DEFAULT_SIZE.height,
    strokeColor: "#D5D8DE",
    backgroundColor: "#FFFFFF",
    fillStyle: "solid",
    strokeWidth: 1,
    roughness: 0,
    roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 10 },
    customData: { flowapi: { ...data, kind: API_CARD_KIND } },
  });
};
