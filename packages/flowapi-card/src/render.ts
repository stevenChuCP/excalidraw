import {
  API_CARD_KIND,
  type ApiCardData,
  type ApiCardDetails,
  type ApiCardField,
  type ApiCardLikeElement,
} from "./types";

export const getApiCardData = (
  element: ApiCardLikeElement | null | undefined,
): ApiCardData | null => {
  const data = element?.customData?.flowapi;
  return data && data.kind === API_CARD_KIND ? (data as ApiCardData) : null;
};

export const isApiCardElement = (
  element: ApiCardLikeElement | null | undefined,
): boolean => getApiCardData(element) !== null;

// layout (element-local px, standard level)
export const API_CARD_DEFAULT_SIZE = { width: 300, height: 104 };
const PAD = 12;
const ROW1_Y = 12; // top of the header row
const PILL_H = 20;
const ROW2_Y = 52; // path baseline
const ROW3_Y = 78; // summary baseline

const UI_FONT = "Assistant, system-ui, sans-serif";
const MONO_FONT = "Cascadia, ui-monospace, monospace";

const FONTS = {
  key: `700 13px ${UI_FONT}`,
  method: `600 11px ${MONO_FONT}`,
  operationId: `600 13px ${MONO_FONT}`,
  path: `400 12px ${MONO_FONT}`,
  summary: `400 13px ${UI_FONT}`,
  badge: `600 11px ${UI_FONT}`,
  section: `700 11px ${UI_FONT}`,
  field: `400 12px ${MONO_FONT}`,
  fieldType: `400 11px ${MONO_FONT}`,
  code: `600 12px ${MONO_FONT}`,
  note: `400 12px ${UI_FONT}`,
};

type Palette = { bg: string; fg: string };

const METHOD_COLORS: Record<string, Palette> = {
  GET: { bg: "#D6E6FB", fg: "#0F3A75" },
  POST: { bg: "#CDEBCD", fg: "#163A1A" },
  PUT: { bg: "#FCE7C2", fg: "#6B3E00" },
  PATCH: { bg: "#FCE7C2", fg: "#6B3E00" },
  DELETE: { bg: "#F8D4D0", fg: "#7A1A12" },
};
const DEFAULT_METHOD_COLOR: Palette = { bg: "#E2E4E9", fg: "#1B1D21" };

/** pill colors for an HTTP method (shared with the key chips on arrows) */
export const methodPalette = (method: string | null | undefined): Palette =>
  METHOD_COLORS[(method || "").toUpperCase()] ?? DEFAULT_METHOD_COLOR;

const TEXT = { main: "#1B1D21", muted: "#5E6470" };
const GAP_BADGE: Palette = { bg: "#FDF0C4", fg: "#6B4E00" };
const GAP_LABEL = "not defined yet";
const SECTION_LABELS = {
  params: "Parameters",
  body: "Request body",
  responses: "Responses",
  none: "none",
};
const DIVIDER = "#E6E8EC";
const REQUIRED_MARK = "*";

// expanded part
const ROW_H = 18;
const SECTION_GAP = 10;
const TOGGLE = 20; // the expand arrow's square, top right

export type ApiCardRenderOptions = {
  /** swaps colors for dark mode (the caller's color filter) */
  mapColor?: (color: string) => string;
};

// -----------------------------------------------------------------------------
// text measuring (shared by canvas and SVG, so both truncate the same way)
// -----------------------------------------------------------------------------

let measureContext: CanvasRenderingContext2D | null | undefined;

const measureText = (text: string, font: string): number => {
  if (measureContext === undefined) {
    try {
      measureContext =
        typeof document !== "undefined"
          ? document.createElement("canvas").getContext("2d")
          : null;
    } catch {
      measureContext = null;
    }
  }
  if (measureContext) {
    measureContext.font = font;
    const width = measureContext.measureText(text).width;
    if (width > 0 || !text) {
      return width;
    }
  }
  // no canvas (e.g. tests): rough estimate from the font size
  const size = parseFloat(font.split(" ")[1]) || 12;
  return text.length * size * 0.6;
};

const fitText = (text: string, font: string, maxWidth: number): string => {
  if (maxWidth <= 0) {
    return "";
  }
  if (measureText(text, font) <= maxWidth) {
    return text;
  }
  const ellipsis = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureText(text.slice(0, mid) + ellipsis, font) <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo > 0 ? text.slice(0, lo) + ellipsis : "";
};

// -----------------------------------------------------------------------------
// layout: one list of primitives, drawn by canvas or written as SVG
// -----------------------------------------------------------------------------

type Primitive =
  | {
      type: "path";
      d: string;
      stroke: string;
      width: number;
    }
  | {
      type: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      radius: number;
      fill: string;
    }
  | {
      type: "text";
      x: number;
      y: number;
      text: string;
      font: string;
      fill: string;
    };

export const layoutApiCard = (
  element: ApiCardLikeElement,
  data: ApiCardData,
  opts: ApiCardRenderOptions = {},
): Primitive[] => {
  const color = opts.mapColor ?? ((c: string) => c);
  const out: Primitive[] = [];
  const right = element.width - PAD;
  let x = PAD;
  const textY = ROW1_Y + PILL_H / 2 + 4.5; // header text baseline

  // key, e.g. "A1"
  if (data.key) {
    out.push({
      type: "text",
      x,
      y: textY,
      text: data.key,
      font: FONTS.key,
      fill: color(TEXT.main),
    });
    x += measureText(data.key, FONTS.key) + 8;
  }

  // method pill
  const method = (data.method || "").toUpperCase();
  const palette = METHOD_COLORS[method] ?? DEFAULT_METHOD_COLOR;
  const pillW = measureText(method, FONTS.method) + 14;
  out.push({
    type: "rect",
    x,
    y: ROW1_Y,
    width: pillW,
    height: PILL_H,
    radius: PILL_H / 2,
    fill: color(palette.bg),
  });
  out.push({
    type: "text",
    x: x + 7,
    y: textY - 0.5,
    text: method,
    font: FONTS.method,
    fill: color(palette.fg),
  });
  x += pillW + 8;

  // expand arrow in the top right corner
  const tx = right - TOGGLE + 6;
  const ty = ROW1_Y + PILL_H / 2;
  out.push({
    type: "path",
    d: data.expanded
      ? `M${tx} ${ty + 3}L${tx + 4} ${ty - 2}L${tx + 8} ${ty + 3}`
      : `M${tx} ${ty - 2}L${tx + 4} ${ty + 3}L${tx + 8} ${ty - 2}`,
    stroke: color(TEXT.muted),
    width: 1.6,
  });

  // gap badge sits at the right end of the header row
  let headerRight = right - TOGGLE - 4;
  if (data.gap) {
    const badgeW = measureText(GAP_LABEL, FONTS.badge) + 14;
    const badgeX = headerRight - badgeW;
    out.push({
      type: "rect",
      x: badgeX,
      y: ROW1_Y,
      width: badgeW,
      height: PILL_H,
      radius: 4,
      fill: color(GAP_BADGE.bg),
    });
    out.push({
      type: "text",
      x: badgeX + 7,
      y: textY - 0.5,
      text: GAP_LABEL,
      font: FONTS.badge,
      fill: color(GAP_BADGE.fg),
    });
    headerRight = badgeX - 8;
  }

  // operationId
  if (data.operationId) {
    out.push({
      type: "text",
      x,
      y: textY,
      text: fitText(data.operationId, FONTS.operationId, headerRight - x),
      font: FONTS.operationId,
      fill: color(TEXT.main),
    });
  }

  // path
  if (data.path && element.height >= ROW2_Y + 6) {
    out.push({
      type: "text",
      x: PAD,
      y: ROW2_Y,
      text: fitText(data.path, FONTS.path, right - PAD),
      font: FONTS.path,
      fill: color(TEXT.muted),
    });
  }

  // summary
  if (data.summary && element.height >= ROW3_Y + 6) {
    out.push({
      type: "text",
      x: PAD,
      y: ROW3_Y,
      text: fitText(data.summary, FONTS.summary, right - PAD),
      font: FONTS.summary,
      fill: color(TEXT.main),
    });
  }

  if (data.expanded) {
    layoutDetails(out, data, element.width, color);
  }

  return out.filter((p) => p.type !== "text" || p.text);
};

/** the rows of the expanded part, as [kind, ...cells] */
type DetailRow =
  | { kind: "section"; text: string }
  | { kind: "field"; name: string; type: string; indent: number }
  | { kind: "code"; code: string; text: string }
  | { kind: "note"; text: string };

const detailRows = (details: ApiCardDetails | undefined): DetailRow[] => {
  const rows: DetailRow[] = [];
  const d = details || { params: [], body: null, responses: [] };
  const field = (f: ApiCardField, indent = 0, prefix = ""): DetailRow => ({
    kind: "field",
    name: `${prefix}${f.name}${f.required ? REQUIRED_MARK : ""}`,
    type: f.type,
    indent,
  });
  rows.push({ kind: "section", text: SECTION_LABELS.params });
  if (!d.params.length) {
    rows.push({ kind: "note", text: SECTION_LABELS.none });
  }
  d.params.forEach((p) =>
    rows.push({
      ...(field(p) as Extract<DetailRow, { kind: "field" }>),
      type: `${p.in} · ${p.type}`,
    }),
  );
  rows.push({
    kind: "section",
    text: d.body?.type
      ? `${SECTION_LABELS.body} · ${d.body.type}`
      : SECTION_LABELS.body,
  });
  if (!d.body || !d.body.fields.length) {
    rows.push({ kind: "note", text: SECTION_LABELS.none });
  }
  d.body?.fields.forEach((f) => rows.push(field(f)));
  rows.push({ kind: "section", text: SECTION_LABELS.responses });
  if (!d.responses.length) {
    rows.push({ kind: "note", text: SECTION_LABELS.none });
  }
  d.responses.forEach((r) => {
    rows.push({ kind: "code", code: r.code, text: r.description });
    r.fields.forEach((f) => rows.push(field(f, 1)));
  });
  return rows;
};

/** height of a card with this data */
export const apiCardHeight = (data: ApiCardData | null | undefined) => {
  if (!data?.expanded) {
    return API_CARD_DEFAULT_SIZE.height;
  }
  const rows = detailRows(data.details);
  const sections = rows.filter((r) => r.kind === "section").length;
  return (
    API_CARD_DEFAULT_SIZE.height + rows.length * ROW_H + sections * SECTION_GAP
  );
};

/** true when a point (card-local px) is on the expand arrow */
export const isOnApiCardToggle = (
  element: { width: number },
  x: number,
  y: number,
) =>
  x >= element.width - PAD - TOGGLE - 6 &&
  x <= element.width &&
  y >= 0 &&
  y <= ROW1_Y + PILL_H + 8;

const layoutDetails = (
  out: Primitive[],
  data: ApiCardData,
  width: number,
  color: (c: string) => string,
) => {
  const right = width - PAD;
  let y = API_CARD_DEFAULT_SIZE.height - 8;
  out.push({
    type: "rect",
    x: PAD,
    y,
    width: width - PAD * 2,
    height: 1,
    radius: 0,
    fill: color(DIVIDER),
  });
  for (const row of detailRows(data.details)) {
    if (row.kind === "section") {
      y += SECTION_GAP;
    }
    y += ROW_H;
    const base = y - 5;
    if (row.kind === "section") {
      out.push({
        type: "text",
        x: PAD,
        y: base,
        text: fitText(row.text, FONTS.section, right - PAD),
        font: FONTS.section,
        fill: color(TEXT.muted),
      });
    } else if (row.kind === "note") {
      out.push({
        type: "text",
        x: PAD + 8,
        y: base,
        text: row.text,
        font: FONTS.note,
        fill: color(TEXT.muted),
      });
    } else if (row.kind === "code") {
      const palette = /^2/.test(row.code)
        ? METHOD_COLORS.POST
        : /^[45]/.test(row.code)
        ? METHOD_COLORS.DELETE
        : DEFAULT_METHOD_COLOR;
      const w = measureText(row.code, FONTS.code) + 10;
      out.push({
        type: "rect",
        x: PAD + 8,
        y: base - 12,
        width: w,
        height: 16,
        radius: 4,
        fill: color(palette.bg),
      });
      out.push({
        type: "text",
        x: PAD + 13,
        y: base,
        text: row.code,
        font: FONTS.code,
        fill: color(palette.fg),
      });
      out.push({
        type: "text",
        x: PAD + 16 + w,
        y: base,
        text: fitText(row.text, FONTS.note, right - (PAD + 16 + w)),
        font: FONTS.note,
        fill: color(TEXT.main),
      });
    } else {
      const x0 = PAD + 8 + row.indent * 16;
      const typeW = Math.min(
        measureText(row.type, FONTS.fieldType),
        (right - x0) / 2,
      );
      out.push({
        type: "text",
        x: x0,
        y: base,
        text: fitText(row.name, FONTS.field, right - x0 - typeW - 10),
        font: FONTS.field,
        fill: color(TEXT.main),
      });
      out.push({
        type: "text",
        x: right - typeW,
        y: base,
        text: fitText(row.type, FONTS.fieldType, typeW + 1),
        font: FONTS.fieldType,
        fill: color(TEXT.muted),
      });
    }
  }
};

// -----------------------------------------------------------------------------
// canvas (editor and PNG export)
// -----------------------------------------------------------------------------

/**
 * Draws the card content. The context's origin must be the element's
 * top-left corner, as in `drawElementOnCanvas`.
 */
export const drawApiCardOnCanvas = (
  context: CanvasRenderingContext2D,
  element: ApiCardLikeElement,
  opts: ApiCardRenderOptions = {},
) => {
  const data = getApiCardData(element);
  if (!data) {
    return;
  }
  context.save();
  try {
    context.beginPath();
    context.rect(0, 0, element.width, element.height);
    context.clip();
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    for (const p of layoutApiCard(element, data, opts)) {
      if (p.type === "path") {
        context.strokeStyle = p.stroke;
        context.lineWidth = p.width;
        context.lineCap = "round";
        context.lineJoin = "round";
        if (typeof Path2D !== "undefined") {
          context.stroke(new Path2D(p.d));
        }
        continue;
      }
      context.fillStyle = p.fill;
      if (p.type === "rect") {
        context.beginPath();
        if (context.roundRect) {
          context.roundRect(p.x, p.y, p.width, p.height, p.radius);
        } else {
          context.rect(p.x, p.y, p.width, p.height);
        }
        context.fill();
      } else {
        context.font = p.font;
        context.fillText(p.text, p.x, p.y);
      }
    }
  } finally {
    context.restore();
  }
};

// -----------------------------------------------------------------------------
// SVG export
// -----------------------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";

const num = (n: number) => `${Math.round(n * 100) / 100}`;

const parseFont = (font: string) => {
  // "<weight> <size>px <family...>"
  const [weight, size, ...family] = font.split(" ");
  return { weight, size, family: family.join(" ") };
};

/**
 * Appends the card content to `parent`, whose coordinate system must have
 * the element's top-left corner at its origin (the transformed group of the
 * card's rectangle).
 */
export const appendApiCardToSvg = (
  parent: SVGElement,
  element: ApiCardLikeElement,
  opts: ApiCardRenderOptions = {},
) => {
  const data = getApiCardData(element);
  if (!data) {
    return;
  }
  const doc = parent.ownerDocument;
  const g = doc.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "flowapi-api-card");
  g.setAttribute("data-key", data.key);
  if (element.opacity !== 100) {
    g.setAttribute("opacity", `${element.opacity / 100}`);
  }
  for (const p of layoutApiCard(element, data, opts)) {
    if (p.type === "path") {
      const path = doc.createElementNS(SVG_NS, "path");
      path.setAttribute("d", p.d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", p.stroke);
      path.setAttribute("stroke-width", num(p.width));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      g.appendChild(path);
    } else if (p.type === "rect") {
      const rect = doc.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", num(p.x));
      rect.setAttribute("y", num(p.y));
      rect.setAttribute("width", num(p.width));
      rect.setAttribute("height", num(p.height));
      rect.setAttribute("rx", num(p.radius));
      rect.setAttribute("fill", p.fill);
      g.appendChild(rect);
    } else {
      const { weight, size, family } = parseFont(p.font);
      const text = doc.createElementNS(SVG_NS, "text");
      text.setAttribute("x", num(p.x));
      text.setAttribute("y", num(p.y));
      text.setAttribute("font-family", family);
      text.setAttribute("font-size", size);
      text.setAttribute("font-weight", weight);
      text.setAttribute("fill", p.fill);
      text.textContent = p.text;
      g.appendChild(text);
    }
  }
  parent.appendChild(g);
};
