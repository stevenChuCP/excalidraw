import { buildProjectModel } from "@flowapi/core";

import type { Project, ProjectModel } from "@flowapi/core";

const STORAGE_KEY = "flowapi-project";

const EMPTY: Project = { flows: [], specs: [] };

type Saved = { project: Project; name: string };

const load = (): Saved => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (Array.isArray(p?.flows) && Array.isArray(p?.specs)) {
        return {
          project: {
            flows: p.flows,
            specs: p.specs,
            ...(p.retiredKeys ? { retiredKeys: p.retiredKeys } : {}),
          },
          name: typeof p.name === "string" ? p.name : "",
        };
      }
    }
  } catch {
    // unreadable storage: start empty
  }
  return { project: EMPTY, name: "" };
};

type State = {
  project: Project;
  model: ProjectModel;
  /** project name, used as the .flowapi file name */
  name: string;
};

/**
 * The project (flows and specs in the sidebar), kept in localStorage. All
 * saving and loading goes through here, so a server can take over later.
 */
export class ProjectStore {
  private state: State;
  private listeners = new Set<() => void>();
  /** where the project was last saved (Chrome and Edge save in place) */
  fileHandle: FileSystemFileHandle | null = null;

  constructor(saved: Saved = load()) {
    this.state = {
      project: saved.project,
      model: buildProjectModel(saved.project),
      name: saved.name,
    };
  }

  getState = () => this.state;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private persist() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...this.state.project, name: this.state.name }),
      );
    } catch {
      // storage full or blocked: the project stays in memory
    }
  }

  setProject = (project: Project, name = this.state.name) => {
    this.state = { project, model: buildProjectModel(project), name };
    this.persist();
    this.listeners.forEach((fn) => fn());
  };

  setName = (name: string) => this.setProject(this.state.project, name);

  /** replaces one file's text (e.g. after writing keys) */
  setFileText = (fileId: string, text: string) => {
    const { project } = this.state;
    const upd = (f: Project["flows"][number]) =>
      f.id === fileId ? { ...f, text } : f;
    this.setProject({
      ...project,
      flows: project.flows.map(upd),
      specs: project.specs.map(upd),
    });
  };

  removeFile = (fileId: string) => {
    const { project } = this.state;
    this.setProject({
      ...project,
      flows: project.flows.filter((f) => f.id !== fileId),
      specs: project.specs.filter((f) => f.id !== fileId),
    });
  };

  /** the name to save under: the project name, or the first file's */
  fileBaseName = () => {
    const { name, project } = this.state;
    const first = project.flows[0]?.name || project.specs[0]?.name || "project";
    return (name || first.replace(/\.[^.]+$/, "")).replace(
      /[\\/:*?"<>|]/g,
      "-",
    );
  };
}
