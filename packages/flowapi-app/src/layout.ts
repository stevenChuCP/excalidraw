import { FONT_FAMILY, ROUNDNESS } from "@excalidraw/common";
import { methodPalette } from "@flowapi/card";
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
export const FLOW_SHAPE_KIND = "flowShape";

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
/** an @api line that points at no operation */
export const BROKEN = "#e03131";

const HEADS: Record<FlowMessage["head"], "triangle" | "arrow" | "bar" | null> =
  {
    fill: "triangle",
    open: "arrow",
    cross: "bar",
    none: null,
  };

export const FLOW_CHIP_KIND = "flowChip";
const CHIP_H = 20;
const CHIP_FONT = 12;
const BROKEN_CHIP = { bg: "#fbebeb", fg: "#c92a2a" };

export type FlowLinkInfo = {
  /** the key chip's text at the start of the arrow label, e.g. "A1" or "ca:E1" */
  tag: string | null;
  /** method of the linked operation, for the chip color */
  method: string | null;
  /** an @api line whose key matches no operation */
  broken: boolean;
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
  const op = link
    ? model.specs
        .find((s) => s.id === link.specId)
        ?.ops.find((o) => o.key === link.key)
    : undefined;
  return {
    tag,
    method: op?.method ?? null,
    broken: !!msg.ref && !link,
    specId: link?.specId ?? null,
    key: link?.key ?? null,
  };
};

const messageText = (msg: FlowMessage) =>
  brSplit(msg.label || msg.text || "").join("\n");

/** short, stable hash of a text, for ids */
export const hash = (text: string) => {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
};

const widest = (text: string) =>
  Math.max(0, ...text.split("\n").map((l) => l.length)) * CHAR_W;

/** changes whenever what the flow draws changes (its text or its links) */
export const flowRenderKey = (model: ProjectModel, flow: FlowModel) =>
  hash(
    `${
      model.project.flows.find((f) => f.id === flow.id)?.text
    }\u0000${JSON.stringify(
      flow.messages.map((m) => messageLinkInfo(model, flow, m)),
    )}`,
  );

export type FlowLayoutOptions = {
  /** top-left of the frame in scene coordinates */
  x: number;
  y: number;
  /** element link to a card id, e.g. "https://host/?element=op:s:A1" */
  linkTo?: (elementId: string) => string;
};

export const layoutFlow = (
  model: ProjectModel,
  flow: FlowModel,
  opts: FlowLayoutOptions,
): ExcalidrawElementSkeleton[] => {
  const pre = flowElementPrefix(flow.id);
  const out: ExcalidrawElementSkeleton[] = [];
  // stable ids (sids): built from what an element is, not where it is in the
  // text, so editing the text elsewhere keeps the ids and with them the layout
  const seen = new Map<string, number>();
  const sid = (base: string) => {
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return `${pre}${base}:${n}`;
  };
  const partId = (i: number) => flow.parts[i]?.id ?? String(i);
  const children: string[] = [];
  const add = (el: ExcalidrawElementSkeleton & { id: string }) => {
    out.push(el);
    children.push(el.id);
  };

  // column spacing wide enough for the longest label between two columns
  let colW = 240;
  for (const m of flow.messages) {
    const span = Math.abs(m.to - m.from);
    const tag = messageLinkInfo(model, flow, m).tag;
    const w =
      widest(messageText(m)) + 60 + (tag ? (tag.length * 8 + 28) * 2 : 0);
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
      id: `${pre}p:${p.id}`,
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
        const text = messageText(item);
        const nLines = text.split("\n").length;
        const self = item.from === item.to;
        const rowH = nLines * LINE_H + (self ? 46 : 26);
        const ay = y + rowH / 2;
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
        const arrowId = sid(
          `m:${partId(item.from)}>${partId(item.to)}:${
            info.tag || hash(item.label)
          }`,
        );
        add({
          type: "arrow",
          id: arrowId,
          x: fx,
          y: self ? y + 8 : ay,
          points: points as any,
          width: self ? 60 : Math.abs(points[1][0]),
          height: self ? 26 : 0,
          strokeColor: info.broken ? BROKEN : STROKE,
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
              from: partId(item.from),
              to: partId(item.to),
              broken: info.broken,
            },
          },
        });
        if (info.tag) {
          // the key chip: left of the label, on the arrow line
          const palette = info.broken
            ? BROKEN_CHIP
            : info.specId
            ? methodPalette(info.method)
            : methodPalette(null);
          const chipW = info.tag.length * 8 + 16;
          // at the arrow's source end, clear of the centered label
          const chipX = self
            ? fx + 8
            : points[1][0] >= 0
            ? fx + 12
            : fx - 12 - chipW;
          add({
            type: "rectangle",
            id: `${arrowId}:chip`,
            x: chipX,
            y: (self ? y + 8 : ay) - CHIP_H / 2,
            width: chipW,
            height: CHIP_H,
            strokeColor: "transparent",
            backgroundColor: palette.bg,
            fillStyle: "solid",
            strokeWidth: 1,
            roughness: 0,
            roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: CHIP_H / 2 },
            label: {
              text: info.tag,
              fontSize: CHIP_FONT,
              fontFamily: FONT_FAMILY.Cascadia,
              strokeColor: palette.fg,
            },
            customData: {
              flowapi: {
                kind: FLOW_CHIP_KIND,
                flowId: flow.id,
                line: item.line,
                specId: info.specId,
                key: info.key,
                broken: info.broken,
              },
            },
          });
        }
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
          id: sid(`n:${hash(item.text)}`),
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
        const blockId = sid(`b:${item.type}:${hash(item.label)}`);
        // Mermaid `rect <color>` is a shaded band, the rest are labelled frames
        const shaded = item.type === "rect";
        const at = out.length;
        y += shaded ? 10 : 30;
        place(item.children, bx0, bx1, depth + 1);
        y += 8;
        const box: ExcalidrawElementSkeleton & { id: string } = {
          type: "rectangle",
          id: blockId,
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
                id: `${blockId}:label`,
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
        const dividerId = sid(`d:${hash(item.label)}`);
        add({
          type: "line",
          id: dividerId,
          x: x0 + depth * 10,
          y: y + 4,
          width: x1 - x0 - depth * 20,
          height: 0,
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
            id: `${dividerId}:label`,
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
      id: `${pre}life:${flow.parts[i].id}`,
      x: cx(i),
      y: top + PART_H,
      width: 0,
      height: bottom - top - PART_H,
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
  const lifelines = out.filter((e) => (e as any).id?.startsWith(`${pre}life:`));
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
    customData: {
      flowapi: {
        kind: FLOW_FRAME_KIND,
        flowId: flow.id,
        renderKey: flowRenderKey(model, flow),
      },
    },
  };
  // remember where the layout put each element (relative to the layout
  // origin), so a redraw can tell elements moved by hand from untouched ones
  for (const el of out as any[]) {
    el.customData = {
      ...el.customData,
      flowapi: {
        kind: FLOW_SHAPE_KIND,
        flowId: flow.id,
        ...el.customData?.flowapi,
        auto: [Math.round(el.x - opts.x), Math.round(el.y - opts.y)],
      },
    };
  }
  return [...lifelines, ...rest, frame];
};
