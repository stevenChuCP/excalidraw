/** A source text kept in the project: a Mermaid flow or an OpenAPI spec. */
export type SourceFile = {
  /** stable id inside the project, e.g. "s-kx-sign-openapi" or "f-kx-sign-flow" */
  id: string;
  /** file name as imported, e.g. "kx-sign-openapi.yaml" */
  name: string;
  text: string;
};

export type Project = {
  flows: SourceFile[];
  specs: SourceFile[];
  /** keys of deleted operations, per spec id; never handed out again */
  retiredKeys?: Record<string, string[]>;
};

export type IssueLevel =
  /** blocks a link or makes a file unusable */
  | "error"
  /** something to look at */
  | "warning"
  /** an arrow linked by guessing (path or reply match) */
  | "guess"
  /** an operation that no flow uses */
  | "unused"
  /** an operation the gap checks found incomplete */
  | "gap"
  /** a suggestion */
  | "info";

export type Issue = {
  level: IssueLevel;
  message: string;
  /** where it is: which file and line */
  fileId?: string;
  line?: number;
  /** a one-click fix the app can apply */
  fix?: { kind: "duplicateKey"; specId: string; key: string };
};

export type HttpMethod =
  | "GET"
  | "PUT"
  | "POST"
  | "DELETE"
  | "OPTIONS"
  | "HEAD"
  | "PATCH"
  | "TRACE";

export type Operation = {
  specId: string;
  /** x-diagram-tag; "" when the spec has none for this operation */
  key: string;
  method: HttpMethod;
  /** path, or the webhook name for webhooks */
  path: string;
  operationId?: string;
  summary?: string;
  webhook: boolean;
  /** 1-based line of the operation in the spec text */
  line: number;
  /** what the gap checks found, empty when the operation is complete */
  gaps: string[];
};

export type SpecModel = {
  id: string;
  name: string;
  title: string;
  ops: Operation[];
  issues: Issue[];
  /** false when the text is not a readable spec */
  ok: boolean;
};

export type FlowParticipant = { id: string; label: string; actor: boolean };

export type ApiRef = {
  /** alias from `%% @api ca:E1`, or null for the flow's default spec */
  alias: string | null;
  key: string;
  /** line of the `%% @api` directive */
  line: number;
};

export type FlowMessage = {
  kind: "msg";
  /** 1-based source line */
  line: number;
  /** order among messages, from 1 */
  n: number;
  from: number;
  to: number;
  arrow: string;
  dashed: boolean;
  head: "fill" | "cross" | "open" | "none";
  text: string;
  /** text shown on the arrow (old inline `[A1]` tag removed) */
  label: string;
  ref: ApiRef | null;
  /** old inline `[A1]` tag, if any */
  legacyKey: string | null;
};

export type FlowNote = {
  kind: "note";
  line: number;
  pos: "over" | "left of" | "right of";
  parts: number[];
  text: string;
};

export type FlowBlock = {
  kind: "block";
  line: number;
  type: string;
  label: string;
  children: FlowItem[];
};

export type FlowDivider = { kind: "divider"; line: number; label: string };

export type FlowItem = FlowMessage | FlowNote | FlowBlock | FlowDivider;

export type OaiDoc = { alias: string | null; file: string; line: number };

export type FlowModel = {
  id: string;
  name: string;
  title: string | null;
  parts: FlowParticipant[];
  items: FlowItem[];
  messages: FlowMessage[];
  oaiDocs: OaiDoc[];
  issues: Issue[];
  ok: boolean;
};

export type LinkHow = "tag" | "legacy" | "path" | "reply";

export type MessageLink = {
  flowId: string;
  line: number;
  specId: string;
  key: string;
  how: LinkHow;
};

export type ProjectModel = {
  project: Project;
  specs: SpecModel[];
  flows: FlowModel[];
  /** message links per flow id, by message line */
  links: Record<string, Record<number, MessageLink>>;
  /** spec files that flows point to but the project lacks */
  missingSpecs: { flowId: string; file: string }[];
  issues: Issue[];
};
