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
};
