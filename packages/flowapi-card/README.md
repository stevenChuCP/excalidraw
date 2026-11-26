# @flowapi/card

The API card that FlowAPI puts on the Excalidraw canvas.

An API card is an ordinary Excalidraw `rectangle` whose `customData.flowapi` holds an `ApiCardData` object (`kind: "apiCard"`). Excalidraw handles selecting, moving, resizing, saving and hit testing like any rectangle. This package draws the card's content on top of it:

- `drawApiCardOnCanvas` is called from `packages/element/src/renderElement.ts` (canvas and PNG export).
- `appendApiCardToSvg` is called from `packages/excalidraw/renderer/staticSvgScene.ts` (SVG export).

Both call sites are marked `// flowapi:`. `createApiCardElement` (in `create.ts`) builds a new card element.

M0 spike: one detail level ("standard"). Compact and expanded levels come in M2.
