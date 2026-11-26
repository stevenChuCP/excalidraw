export const API_CARD_KIND = "apiCard";

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

/** What an API card shows. Stored in `element.customData.flowapi`. */
export type ApiCardData = {
  kind: typeof API_CARD_KIND;
  /** spec id inside the .flowapi project, e.g. "s-kx-sign" */
  specId: string;
  /** operation key (x-diagram-tag), e.g. "A1" */
  key: string;
  method: HttpMethod;
  path: string;
  operationId?: string;
  summary?: string;
  /** true when the gap checks found the operation incomplete */
  gap?: boolean;
};

/** The parts of an Excalidraw element the card code reads. */
export type ApiCardLikeElement = {
  width: number;
  height: number;
  opacity: number;
  customData?: Record<string, any>;
};
