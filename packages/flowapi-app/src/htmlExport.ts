import { exportScene } from "@excalidraw/excalidraw";
import { getCommonBounds } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

import { FLOW_CHIP_KIND, cardId } from "./layout";
import { S } from "./strings";

import type { Project } from "@flowapi/core";

/** room above the content for frame names, which sit outside frame bounds */
const LABEL_ROOM = 40;
const PADDING = 24;

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ]!),
  );

/** the element id a canvas link points to, or null for an outside link */
const linkTarget = (href: string) => {
  try {
    return new URL(href, "http://x/").searchParams.get("element");
  } catch {
    return null;
  }
};

/**
 * A single HTML file of the board: the drawing as inline SVG (fonts inlined),
 * links between elements turned into in-page jumps, and the source files. It
 * needs no network and no app.
 */
export const buildStandaloneHtml = async ({
  name,
  project,
  elements,
  appState,
  files,
}: {
  name: string;
  project: Project;
  elements: readonly ExcalidrawElement[];
  appState: AppState;
  files: BinaryFiles;
}) => {
  // key chips link to their cards in the page
  const live = elements
    .filter((e) => !e.isDeleted)
    .map((e) => {
      const d = e.customData?.flowapi;
      return d?.kind === FLOW_CHIP_KIND && d.specId && d.key
        ? {
            ...e,
            link: `http://x/?element=${encodeURIComponent(
              cardId(d.specId, d.key),
            )}`,
          }
        : e;
    });
  if (!live.length) {
    throw new Error(S.htmlEmpty);
  }
  const [minX, minY, maxX, maxY] = getCommonBounds(live);
  const x = minX;
  const y = minY - LABEL_ROOM;
  const svg = await exportScene({
    type: "svg",
    data: {
      elements: live as any,
      appState: { viewBackgroundColor: appState.viewBackgroundColor } as any,
      files,
    },
    config: {
      x,
      y,
      width: maxX - minX,
      height: maxY - minY + LABEL_ROOM,
      padding: PADDING,
      canvasBackgroundColor: appState.viewBackgroundColor || "#ffffff",
    },
  });

  // where each link target sits in SVG coordinates
  const byId = new Map(live.map((e) => [e.id, e]));
  const targets: Record<string, [number, number, number, number]> = {};
  svg.querySelectorAll("a").forEach((a) => {
    const href = a.getAttribute("href") || "";
    const id = linkTarget(href);
    const el = id ? byId.get(id) : undefined;
    if (id && !el) {
      // points at an operation that has no card on the board
      a.removeAttribute("href");
      return;
    }
    if (!id || !el) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
      return;
    }
    const [x1, y1, x2, y2] = getCommonBounds([el]);
    targets[id] = [x1 - x + PADDING, y1 - y + PADDING, x2 - x1, y2 - y1];
    a.setAttribute("href", `#${encodeURIComponent(id)}`);
    a.setAttribute("data-target", id);
  });
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("id", "board");

  const sources = [...project.flows, ...project.specs]
    .map(
      (f) =>
        `<details><summary>${escapeHtml(f.name)}</summary><pre>${escapeHtml(
          f.text,
        )}</pre></details>`,
    )
    .join("\n");

  const title = escapeHtml(S.htmlTitle(name));
  const bg = appState.viewBackgroundColor || "#ffffff";
  // a page script: pan and zoom by viewBox, jump to a link's target
  const script = `
(function(){
var svg=document.getElementById("board");
var T=${JSON.stringify(targets).replace(/</g, "\\u003c")};
var full=svg.getAttribute("viewBox").split(" ").map(Number);
var vb=full.slice();
function set(v){vb=v;svg.setAttribute("viewBox",v.join(" "));}
function fit(r){var w=Math.max(r[2]*3,900),h=Math.max(r[3]*3,600),el=svg.getBoundingClientRect();var a=el.width/el.height;if(w/h<a){w=h*a}else{h=w/a}set([r[0]+r[2]/2-w/2,r[1]+r[3]/2-h/2,w,h]);}
var hl=document.createElementNS("http://www.w3.org/2000/svg","rect");
hl.setAttribute("class","flowapi-hl");
function go(id){var r=T[id];if(!r)return;fit(r);hl.setAttribute("x",r[0]-8);hl.setAttribute("y",r[1]-8);hl.setAttribute("width",r[2]+16);hl.setAttribute("height",r[3]+16);svg.appendChild(hl);hl.classList.remove("on");void hl.getBBox();hl.classList.add("on");}
svg.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a[data-target]");if(!a)return;e.preventDefault();var id=a.getAttribute("data-target");history.replaceState(null,"","#"+encodeURIComponent(id));go(id);});
document.getElementById("all").addEventListener("click",function(){set(full.slice());history.replaceState(null,"",location.pathname);});
svg.addEventListener("wheel",function(e){e.preventDefault();var el=svg.getBoundingClientRect();var px=(e.clientX-el.left)/el.width,py=(e.clientY-el.top)/el.height;var k=Math.exp(e.deltaY*0.0015);var w=vb[2]*k,h=vb[3]*k;set([vb[0]+(vb[2]-w)*px,vb[1]+(vb[3]-h)*py,w,h]);},{passive:false});
var drag=null;
svg.addEventListener("pointerdown",function(e){if(e.target.closest&&e.target.closest("a"))return;drag={x:e.clientX,y:e.clientY,vb:vb.slice()};svg.setPointerCapture(e.pointerId);});
svg.addEventListener("pointermove",function(e){if(!drag)return;var el=svg.getBoundingClientRect();var s=vb[2]/el.width;set([drag.vb[0]-(e.clientX-drag.x)*s,drag.vb[1]-(e.clientY-drag.y)*s,vb[2],vb[3]]);});
svg.addEventListener("pointerup",function(){drag=null;});
if(location.hash){go(decodeURIComponent(location.hash.slice(1)));}
})();`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="FlowAPI">
<title>${title}</title>
<style>
html,body{margin:0;height:100%;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:${escapeHtml(
    bg,
  )};color:#1e1e1e}
header{display:flex;gap:12px;align-items:center;padding:8px 16px;border-bottom:1px solid #ddd;background:#fff}
header h1{font-size:16px;margin:0}
header p{margin:0;color:#666;font-size:13px;flex:1}
header button{font:inherit;font-size:13px;padding:4px 10px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer}
main{height:calc(100% - 45px);display:flex;flex-direction:column}
#board{flex:1;width:100%;min-height:0;touch-action:none;cursor:grab}
#board a{cursor:pointer}
.flowapi-hl{fill:none;stroke:#1971c2;stroke-width:4;rx:10;opacity:0}
.flowapi-hl.on{animation:hl 1.6s ease-out}
@keyframes hl{0%,60%{opacity:1}100%{opacity:0}}
section{max-height:35%;overflow:auto;border-top:1px solid #ddd;background:#fff;padding:4px 16px}
section h2{font-size:13px;margin:6px 0}
details summary{cursor:pointer;font-size:13px;padding:2px 0}
pre{font-size:12px;background:#f6f6f6;padding:8px;overflow:auto}
</style>
</head>
<body>
<header><h1>${title}</h1><p>${escapeHtml(
    S.htmlHint,
  )}</p><button type="button" id="all">${escapeHtml(
    S.htmlShowAll,
  )}</button></header>
<main>
${svg.outerHTML}
<section><h2>${escapeHtml(S.htmlSources)}</h2>
${sources}
</section>
</main>
<script>${script}</script>
</body>
</html>
`;
};
