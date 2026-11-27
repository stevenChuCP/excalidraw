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
  /** shows parameters, request body and responses */
  expanded?: boolean;
  details?: ApiCardDetails;
};

export type ApiCardField = { name: string; type: string; required?: boolean };

/** what an expanded card lists, read from the spec */
export type ApiCardDetails = {
  params: (ApiCardField & { in: string })[];
  body: { type: string; fields: ApiCardField[] } | null;
  responses: { code: string; description: string; fields: ApiCardField[] }[];
};

/** The parts of an Excalidraw element the card code reads. */
export type ApiCardLikeElement = {
  width: number;
  height: number;
  opacity: number;
  customData?: Record<string, any>;
};
