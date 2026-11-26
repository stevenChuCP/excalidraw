import { buildProjectModel } from "@flowapi/core";

import type { Project, ProjectModel } from "@flowapi/core";

const STORAGE_KEY = "flowapi-project";

const EMPTY: Project = { flows: [], specs: [] };

const load = (): Project => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (Array.isArray(p?.flows) && Array.isArray(p?.specs)) {
        return { flows: p.flows, specs: p.specs };
      }
    }
  } catch {
    // unreadable storage: start empty
  }
  return EMPTY;
};

type State = { project: Project; model: ProjectModel };

/** The project (flows and specs in the sidebar), kept in localStorage. */
export class ProjectStore {
  private state: State;
  private listeners = new Set<() => void>();

  constructor(project: Project = load()) {
    this.state = { project, model: buildProjectModel(project) };
  }

  getState = () => this.state;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  setProject = (project: Project) => {
    this.state = { project, model: buildProjectModel(project) };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    } catch {
      // storage full or blocked: the project stays in memory
    }
    this.listeners.forEach((fn) => fn());
  };

  /** replaces one file's text (e.g. after writing keys) */
  setFileText = (fileId: string, text: string) => {
    const { project } = this.state;
    const upd = (f: Project["flows"][number]) =>
      f.id === fileId ? { ...f, text } : f;
    this.setProject({
      flows: project.flows.map(upd),
      specs: project.specs.map(upd),
    });
  };

  removeFile = (fileId: string) => {
    const { project } = this.state;
    this.setProject({
      flows: project.flows.filter((f) => f.id !== fileId),
      specs: project.specs.filter((f) => f.id !== fileId),
    });
  };
}
