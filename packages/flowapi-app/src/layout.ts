import { FONT_FAMILY } from "@excalidraw/common";
import { brSplit } from "@flowapi/core";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";

import type {
  FlowItem,
  FlowMessage,
  FlowModel,
  ProjectModel,
} from "@flowapi/core";

// Lays a parsed Mermaid sequence flow out as Excalidraw element skeletons:
// a frame holding participant boxes, dashed lifelines, message arrows (linked
// to their API cards), notes and alt/loop/opt blocks.

export const FLOW_ARROW_KIND = "flowArrow";
export const FLOW_FRAME_KIND = "flowFrame";

export const flowFrameId = (flowId: string) => `flow:${flowId}`;
export const flowElementPrefix = (flowId: string) => `flow:${flowId}:`;
export const isFlowElementId = (flowId: string, id: string) =>
  id === flowFrameId(flowId) || id.startsWith(flowElementPrefix(flowId));

/** the card element id for an operation; the key is its stable id */
export const cardId = (specId: string, key: string) => `op:${specId}:${key}`;

const PART_W = 170;
const PART_H = 56;
const LINE_H = 19;
const CHAR_W = 7.6;
const PAD = 40;
const FONT = 16;
const LABEL_FONT = 14;

const STROKE = "#1e1e1e";
const MUTED = "#868e96";

const HEADS: Record<FlowMessage["head"], "triangle" | "arrow" | "bar" | null> =
  {
    fill: "triangle",
    open: "arrow",
    cross: "bar",
    none: null,
  };

export type FlowLinkInfo = {
  /** text shown before the arrow label, e.g. "A1" or "ca:E1" */
  tag: string | null;
  specId: string | null;
  key: string | null;
};

export const messageLinkInfo = (
  model: ProjectModel,
  flow: FlowModel,
  msg: FlowMessage,
): FlowLinkInfo => {
  const link = model.links[flow.id]?.[msg.line];
  const tag = msg.ref
    ? msg.ref.alias
      ? `${msg.ref.alias}:${msg.ref.key}`
      : msg.ref.key
    : link?.key || msg.legacyKey || null;
  return {
    tag,
    specId: link?.specId ?? null,
    key: link?.key ?? null,
  };
};

const messageText = (msg: FlowMessage, info: FlowLinkInfo) => {
  const lines = brSplit(msg.label || msg.text || "");
  if (info.tag) {
    lines[0] = `${info.tag} · ${lines[0] || ""}`.trim();
  }
  return lines.join("\n");
};

const widest = (text: string) =>
  Math.max(0, ...text.split("\n").map((l) => l.length)) * CHAR_W;

export type FlowLayoutOptions = {
  /** top-left of the frame in scene coordinates */
  x: number;
  y: number;
  /** element link to a card id, e.g. "https://host/?element=op:s:A1" */
  linkTo: (elementId: string) => string;
};

export const layoutFlow = (
  model: ProjectModel,
  flow: FlowModel,
  opts: FlowLayoutOptions,
): ExcalidrawElementSkeleton[] => {
  const pre = flowElementPrefix(flow.id);
  const out: ExcalidrawElementSkeleton[] = [];
  const children: string[] = [];
  const add = (el: ExcalidrawElementSkeleton & { id: string }) => {
    out.push(el);
    children.push(el.id);
  };

  // column spacing wide enough for the longest label between two columns
  let colW = 240;
  for (const m of flow.messages) {
    const span = Math.abs(m.to - m.from);
    const w = widest(messageText(m, messageLinkInfo(model, flow, m))) + 60;
    colW = Math.max(colW, span ? w / span : 0);
  }
  colW = Math.min(colW, 520);

  const left = opts.x + PAD;
  const top = opts.y + PAD;
  const cx = (i: number) => left + PART_W / 2 + i * colW;
  const nParts = Math.max(1, flow.parts.length);
  const spanLeft = left - 20;
  const spanRight = cx(nParts - 1) + PART_W / 2 + 20;

  flow.parts.forEach((p, i) => {
    add({
      type: "rectangle",
      id: `${pre}p${i}`,
      x: cx(i) - PART_W / 2,
      y: top,
      width: PART_W,
      height: PART_H,
      strokeColor: STROKE,
      backgroundColor: p.actor ? "#e7f5ff" : "#f8f9fa",
      fillStyle: "solid",
      roughness: 0,
      strokeWidth: 1,
      roundness: { type: 3 },
      label: {
        text: brSplit(p.label).join("\n"),
        fontSize: FONT,
        fontFamily: FONT_FAMILY.Nunito,
      },
    });
  });

  let y = top + PART_H + 30;

  const place = (items: FlowItem[], x0: number, x1: number, depth: number) => {
    for (const item of items) {
      if (item.kind === "msg") {
        const info = messageLinkInfo(model, flow, item);
        const text = messageText(item, info);
        const nLines = text.split("\n").length;
        const self = item.from === item.to;
        const rowH = nLines * LINE_H + (self ? 46 : 26);
        const ay = y + rowH / 2;
        const linkData =
          info.specId && info.key
            ? {
                link: opts.linkTo(cardId(info.specId, info.key)),
              }
            : {};
        const fx = cx(item.from);
        const points: [number, number][] = self
          ? [
              [0, 0],
              [60, 0],
              [60, 26],
              [0, 26],
            ]
          : [
              [0, 0],
              [cx(item.to) - fx, 0],
            ];
        add({
          type: "arrow",
          id: `${pre}m${item.line}`,
          x: fx,
          y: self ? y + 8 : ay,
          points: points as any,
          strokeColor: STROKE,
          strokeStyle: item.dashed ? "dashed" : "solid",
          strokeWidth: 1,
          roughness: 0,
          roundness: null,
          startArrowhead: null,
          endArrowhead: HEADS[item.head],
          label: { text, fontSize: LABEL_FONT, fontFamily: FONT_FAMILY.Nunito },
          customData: {
            flowapi: {
              kind: FLOW_ARROW_KIND,
              flowId: flow.id,
              line: item.line,
              specId: info.specId,
              key: info.key,
            },
          },
          ...linkData,
        });
        y += rowH;
      } else if (item.kind === "note") {
        const text = brSplit(item.text).join("\n");
        const nLines = text.split("\n").length;
        const parts = item.parts.length ? item.parts : [0];
        const a = Math.min(...parts);
        const b = Math.max(...parts);
        const w = Math.max(160, widest(text) + 30);
        let nx: number;
        let nw: number;
        if (item.pos === "left of") {
          nw = w;
          nx = cx(a) - 14 - nw;
        } else if (item.pos === "right of") {
          nw = w;
          nx = cx(b) + 14;
        } else {
          nx = Math.min(cx(a) - 50, (cx(a) + cx(b)) / 2 - w / 2);
          nw = Math.max(cx(b) + 50 - nx, w);
        }
        const nh = nLines * LINE_H + 18;
        add({
          type: "rectangle",
          id: `${pre}n${item.line}`,
          x: nx,
          y: y + 6,
          width: nw,
          height: nh,
          strokeColor: "#e8c547",
          backgroundColor: "#fff9db",
          fillStyle: "solid",
          roughness: 0,
          strokeWidth: 1,
          label: { text, fontSize: LABEL_FONT, fontFamily: FONT_FAMILY.Nunito },
        });
        y += nh + 14;
      } else if (item.kind === "block") {
        const inset = depth * 10;
        const bx0 = x0 + inset;
        const bx1 = x1 - inset;
        const startY = y;
        // Mermaid `rect <color>` is a shaded band, the rest are labelled frames
        const shaded = item.type === "rect";
        const at = out.length;
        y += shaded ? 10 : 30;
        place(item.children, bx0, bx1, depth + 1);
        y += 8;
        const box: ExcalidrawElementSkeleton & { id: string } = {
          type: "rectangle",
          id: `${pre}b${item.line}`,
          x: bx0,
          y: startY + 4,
          width: bx1 - bx0,
          height: y - startY - 4,
          strokeColor: shaded ? "transparent" : MUTED,
          backgroundColor: shaded ? item.label || "#f1f3f5" : "transparent",
          fillStyle: "solid",
          strokeStyle: "dashed",
          roughness: 0,
          strokeWidth: 1,
          opacity: shaded ? 60 : 100,
        };
        const title: (ExcalidrawElementSkeleton & { id: string })[] = shaded
          ? []
          : [
              {
                type: "text",
                id: `${pre}bl${item.line}`,
                x: bx0 + 8,
                y: startY + 9,
                text: `${item.type}${item.label ? `  [${item.label}]` : ""}`,
                fontSize: LABEL_FONT,
                fontFamily: FONT_FAMILY.Nunito,
                strokeColor: MUTED,
              },
            ];
        // the block goes under what it holds
        out.splice(at, 0, box, ...title);
        children.push(box.id, ...title.map((t) => t.id));
        y += 10;
      } else if (item.kind === "divider") {
        add({
          type: "line",
          id: `${pre}d${item.line}`,
          x: x0 + depth * 10,
          y: y + 4,
          points: [
            [0, 0],
            [x1 - x0 - depth * 20, 0],
          ] as any,
          strokeColor: MUTED,
          strokeStyle: "dashed",
          roughness: 0,
          strokeWidth: 1,
        });
        if (item.label) {
          add({
            type: "text",
            id: `${pre}dl${item.line}`,
            x: x0 + depth * 10 + 8,
            y: y + 8,
            text: `[${item.label}]`,
            fontSize: LABEL_FONT,
            fontFamily: FONT_FAMILY.Nunito,
            strokeColor: MUTED,
          });
        }
        y += 30;
      }
    }
  };

  place(flow.items, spanLeft, spanRight, 0);

  const bottom = y + 20;
  flow.parts.forEach((_, i) => {
    add({
      type: "line",
      id: `${pre}life${i}`,
      x: cx(i),
      y: top + PART_H,
      points: [
        [0, 0],
        [0, bottom - top - PART_H],
      ] as any,
      strokeColor: MUTED,
      strokeStyle: "dashed",
      roughness: 0,
      strokeWidth: 1,
    });
  });
  // lifelines go under the arrows
  const lifelines = out.filter((e) => (e as any).id?.startsWith(`${pre}life`));
  const rest = out.filter((e) => !lifelines.includes(e));

  const frame: ExcalidrawElementSkeleton = {
    type: "frame",
    id: flowFrameId(flow.id),
    name: flow.title || flow.name,
    children,
    x: opts.x,
    y: opts.y,
    width:
      Math.max(spanRight + PAD, cx(nParts - 1) + PART_W / 2 + PAD) - opts.x,
    height: bottom + PAD - opts.y,
    customData: { flowapi: { kind: FLOW_FRAME_KIND, flowId: flow.id } },
  };
  return [...lifelines, ...rest, frame];
};
