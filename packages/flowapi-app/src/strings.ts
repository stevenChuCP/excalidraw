// All FlowAPI UI text in one place, so it can move into Excalidraw's i18n
// files later (decided: English only for now, keep i18n possible).

export const S = {
  panelTitle: "Project",
  flows: "Flows",
  specs: "Specs",
  addFiles: "Add files…",
  addFile: "Add file…",
  emptyProject:
    "Drop .mmd flows and OpenAPI specs (.yaml, .yml, .json) here or on the canvas.",
  emptyFlows: "No flows yet",
  emptySpecs: "No specs yet",
  ops: (n: number) => `${n} operation${n === 1 ? "" : "s"}`,
  unused: (n: number) => `${n} unused`,
  needs: (file: string) => `needs ${file}`,
  noKey: "no key",
  onBoard: "On the board",
  notOnBoard: "Not on the board yet",
  dragHint: "Drag onto the canvas",
  keyFirst: "Give this operation a key first",
  remove: "Remove from project",
  checks: "Checks",
  checksTitle: "Checks",
  close: "Close",
  summary: (flows: number, specs: number, links: number) =>
    `${flows} flow${flows === 1 ? "" : "s"} · ${specs} spec${
      specs === 1 ? "" : "s"
    } · ${links} link${links === 1 ? "" : "s"}`,
  noIssues: "No issues found.",
  groups: {
    error: "Errors",
    warning: "Needs a look",
    gap: "Not defined yet",
    guess: "Guessed links",
    unused: "Not in any flow",
    info: "Suggestions",
  } as Record<string, string>,
  imported: (n: number) =>
    `Added ${n} file${n === 1 ? "" : "s"} to the project`,
  renamed: (from: string, to: string) =>
    `${from} is already in the project, added as ${to}`,
  rejected: (name: string, reason: string) => `${name}: ${reason}`,
  keyDialogTitle: (spec: string) => `Name the operations in ${spec}`,
  keyDialogBody: (n: number) =>
    `${n} operation${
      n === 1 ? " has" : "s have"
    } no key (x-diagram-tag). Flows link to operations by key, so the app writes one into the spec. Pick a naming pattern:`,
  keyPrefix: "Prefix",
  keyStart: "Start at",
  keyPreview: "Preview",
  keyBadPrefix: "Use letters only, starting with a letter",
  writeKeys: "Write keys",
  later: "Later",
  keysWritten: (n: number, spec: string) =>
    `Wrote ${n} key${n === 1 ? "" : "s"} into ${spec}`,
  nameKeys: "Name operations…",
  more: "More",
  moreIcon: "⋯",
  sep: " · ",
  caretOpen: "▾",
  caretClosed: "▸",
  flowSize: (parts: number, msgs: number) => `${parts}·${msgs}`,
  doubleClickToEdit: "Double-click to edit its text",
  editFlowText: "Edit flow text",
  editSpecText: "Edit spec text",
  exportFlow: "Export flow (.mmd)…",
  exportSpec: "Export spec…",
  openProject: "Open…",
  openProjectHint: "Open a .flowapi project",
  saveProject: "Save",
  saveProjectHint: "Save the project as a .flowapi file",
  projectSaved: (name: string) => `Saved ${name}`,
  projectOpened: (name: string) => `Opened ${name}`,
  projectBadFile: (name: string, why: string) => `${name}: ${why}`,
  replaceTitle: "Open another project?",
  replaceBody:
    "Opening a project replaces the flows, specs and board you have now. Save first if you want to keep them.",
  replaceConfirm: "Open project",
  cancel: "Cancel",
  renameKey: "Rename key…",
  keyRenamed: (from: string, to: string, arrows: number) =>
    `Renamed ${from} to ${to}${
      arrows ? ` and updated ${arrows} arrow${arrows === 1 ? "" : "s"}` : ""
    }`,
  deleteOperation: "Delete operation…",
  deleteTitle: (op: string) => `Delete ${op}?`,
  deleteBody:
    "This removes the operation from the spec in this project. Its key is never handed out again in this spec.",
  deleteArrows: (n: number) =>
    n
      ? `${n} arrow${n === 1 ? "" : "s"} will lose ${
          n === 1 ? "its" : "their"
        } link:`
      : "No arrow links to it.",
  deleteConfirm: "Delete operation",
  deleted: (op: string) => `Deleted ${op}`,
  exported: (name: string) => `Exported ${name}`,
  fix: "Fix",
  removeMarker: "Remove marker",
  editorEmpty: "Double-click a flow or spec in the sidebar to edit its text.",
  editorApplied: "Canvas updated",
  closeTab: "Close",
  linkChip: "+ link",
  linkTitle: (label: string) => `Link “${label}” to an operation`,
  linkSearch: "Search operations",
  linkNone: "No operation matches.",
  createOperation: "Create operation…",
  createTitle: "Create operation",
  createBody: (spec: string) =>
    `Adds this stub to ${spec} in the project. Its request and response stay empty and show up as gaps until you fill them in.`,
  createMethod: "Method",
  createPath: "Path",
  createOperationId: "operationId",
  createSummary: "Summary",
  createKey: "Key",
  createSpec: "Spec",
  createConfirm: "Create and link",
  linked: (key: string) => `Linked to ${key}`,
  unlink: "Unlink",
  arrowBroken: (key: string) => `@api ${key} matches no operation`,
  exportHtml: "Export standalone HTML…",
  exportMenu: "Export",
  htmlTitle: (name: string) => `${name} · FlowAPI`,
  htmlExported: (name: string) => `Exported ${name}`,
  downloadNote:
    "This browser can't save to a folder, so the file was downloaded.",
};
