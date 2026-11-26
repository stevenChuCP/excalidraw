import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

import type { Project, SourceFile } from "@flowapi/core";

// The .flowapi project file: plain JSON holding every flow and spec (texts
// verbatim) and the whiteboard they sit on, so it opens the same anywhere.

export const FLOWAPI_EXTENSION = "flowapi";
export const FLOWAPI_FORMAT_VERSION = 1;
export const FLOWAPI_APP_VERSION = "0.2.0";

export type ProjectFileCanvas = {
  elements: ExcalidrawElement[];
  appState: {
    zoom: number;
    scrollX: number;
    scrollY: number;
    viewBackgroundColor?: string;
  };
  files: BinaryFiles;
};

export type ProjectFile = {
  type: "flowapi";
  flows: SourceFile[];
  specs: SourceFile[];
  retiredKeys?: Record<string, string[]>;
  canvas: ProjectFileCanvas;
  meta: {
    name: string;
    formatVersion: number;
    appVersion: string;
    updated: string;
  };
};

export const serializeProject = (
  name: string,
  project: Project,
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles,
): string => {
  const live = elements.filter((e) => !e.isDeleted);
  const used = new Set(
    live.map((e) => (e as any).fileId).filter(Boolean) as string[],
  );
  const file: ProjectFile = {
    type: "flowapi",
    flows: project.flows,
    specs: project.specs,
    ...(project.retiredKeys && Object.keys(project.retiredKeys).length
      ? { retiredKeys: project.retiredKeys }
      : {}),
    canvas: {
      elements: live,
      appState: {
        zoom: appState.zoom.value,
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
        viewBackgroundColor: appState.viewBackgroundColor,
      },
      files: Object.fromEntries(
        Object.entries(files).filter(([id]) => used.has(id)),
      ),
    },
    meta: {
      name,
      formatVersion: FLOWAPI_FORMAT_VERSION,
      appVersion: FLOWAPI_APP_VERSION,
      updated: new Date().toISOString(),
    },
  };
  return `${JSON.stringify(file, null, 2)}\n`;
};

const isSource = (f: any): f is SourceFile =>
  f &&
  typeof f.id === "string" &&
  typeof f.name === "string" &&
  typeof f.text === "string";

/** reads a .flowapi file; throws with a readable message when it isn't one */
export const parseProjectFile = (text: string): ProjectFile => {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("not a FlowAPI project (the file is not JSON)");
  }
  if (data?.type !== "flowapi") {
    throw new Error("not a FlowAPI project");
  }
  if ((data.meta?.formatVersion ?? 1) > FLOWAPI_FORMAT_VERSION) {
    throw new Error("made by a newer version of the app");
  }
  const flows = Array.isArray(data.flows) ? data.flows.filter(isSource) : [];
  const specs = Array.isArray(data.specs) ? data.specs.filter(isSource) : [];
  const canvas = data.canvas || {};
  return {
    type: "flowapi",
    flows,
    specs,
    retiredKeys: data.retiredKeys || undefined,
    canvas: {
      elements: Array.isArray(canvas.elements) ? canvas.elements : [],
      appState: {
        zoom: Number(canvas.appState?.zoom) || 1,
        scrollX: Number(canvas.appState?.scrollX) || 0,
        scrollY: Number(canvas.appState?.scrollY) || 0,
        viewBackgroundColor: canvas.appState?.viewBackgroundColor,
      },
      files: canvas.files || {},
    },
    meta: {
      name: String(data.meta?.name || "project"),
      formatVersion: Number(data.meta?.formatVersion) || 1,
      appVersion: String(data.meta?.appVersion || ""),
      updated: String(data.meta?.updated || ""),
    },
  };
};

export const projectFromFile = (file: ProjectFile): Project => ({
  flows: file.flows,
  specs: file.specs,
  ...(file.retiredKeys ? { retiredKeys: file.retiredKeys } : {}),
});
