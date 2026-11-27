import React from "react";

import { isPromiseLike } from "@excalidraw/common";
// flowapi: actions leave protected elements alone
import { guardActionElements, isProtectedElement } from "@flowapi/card";

import type {
  ExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";

import { trackEvent } from "../analytics";

import type { AppClassProperties, AppState } from "../types";
import type {
  Action,
  UpdaterFn,
  ActionName,
  ActionResult,
  PanelComponentProps,
  ActionSource,
} from "./types";

const trackAction = (
  action: Action,
  source: ActionSource,
  appState: Readonly<AppState>,
  elements: readonly ExcalidrawElement[],
  app: AppClassProperties,
  value: any,
) => {
  if (action.trackEvent) {
    try {
      if (typeof action.trackEvent === "object") {
        const shouldTrack = action.trackEvent.predicate
          ? action.trackEvent.predicate(appState, elements, value)
          : true;
        if (shouldTrack) {
          trackEvent(
            action.trackEvent.category,
            action.trackEvent.action || action.name,
            `${source} (${
              app.editorInterface.formFactor === "phone" ? "mobile" : "desktop"
            })`,
          );
        }
      }
    } catch (error) {
      console.error("error while logging action:", error);
    }
  }
};

export class ActionManager {
  actions = {} as Record<ActionName, Action>;

  updater: (actionResult: ActionResult | Promise<ActionResult>) => void;

  getAppState: () => Readonly<AppState>;
  getElementsIncludingDeleted: () => readonly OrderedExcalidrawElement[];
  app: AppClassProperties;

  constructor(
    updater: UpdaterFn,
    getAppState: () => AppState,
    getElementsIncludingDeleted: () => readonly OrderedExcalidrawElement[],
    app: AppClassProperties,
  ) {
    this.updater = (actionResult) => {
      if (isPromiseLike(actionResult)) {
        actionResult.then((actionResult) => {
          return updater(actionResult);
        });
      } else {
        return updater(actionResult);
      }
    };
    this.getAppState = getAppState;
    this.getElementsIncludingDeleted = getElementsIncludingDeleted;
    this.app = app;
  }

  registerAction(action: Action) {
    this.actions[action.name] = action;
  }

  registerAll(actions: readonly Action[]) {
    actions.forEach((action) => this.registerAction(action));
  }

  private isActionBlockedByViewportTransition = (action: Action) =>
    action.navigation === true && this.app.viewport.isLockedTransitionPending;

  handleKeyDown(event: React.KeyboardEvent | KeyboardEvent) {
    if (!this.app.isInteractionEnabled() && !this.app.isNavigationEnabled()) {
      return false;
    }

    const canvasActions = this.app.props.UIOptions.canvasActions;
    const data = Object.values(this.actions)
      .sort((a, b) => (b.keyPriority || 0) - (a.keyPriority || 0))
      .filter(
        (action) =>
          (action.name in canvasActions
            ? canvasActions[action.name as keyof typeof canvasActions]
            : true) &&
          action.keyTest &&
          action.keyTest(
            event,
            this.getAppState(),
            this.getElementsIncludingDeleted(),
            this.app,
          ),
      );

    if (data.length !== 1) {
      if (data.length > 1) {
        console.warn("Canceling as multiple actions match this shortcut", data);
      }
      return false;
    }

    const action = data[0];

    // in the non-interactive editor, only navigation actions are allowed
    // (when navigation itself is)
    if (!this.app.isInteractionEnabled() && action.navigation !== true) {
      return false;
    }

    if (this.getAppState().viewModeEnabled && action.viewMode !== true) {
      return false;
    }

    if (this.isActionBlockedByViewportTransition(action)) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    const elements = this.getElementsIncludingDeleted();
    const appState = this.getAppState();
    const value = null;

    trackAction(action, "keyboard", appState, elements, this.app, null);

    event.preventDefault();
    event.stopPropagation();
    this.updater(
      this.guarded(data[0], () =>
        data[0].perform(elements, appState, value, this.app),
      ),
    );
    return true;
  }

  executeAction<T extends Action>(
    action: T,
    source: ActionSource = "api",
    value: Parameters<T["perform"]>[2] = null,
  ) {
    // the user must not be able to affect a non-interactive editor
    // (programmatic execution by the host remains allowed, as are
    // navigation actions when navigation is)
    if (
      source !== "api" &&
      !this.app.isInteractionEnabled() &&
      !(this.app.isNavigationEnabled() && action.navigation === true)
    ) {
      return;
    }

    if (this.isActionBlockedByViewportTransition(action)) {
      return;
    }

    const elements = this.getElementsIncludingDeleted();
    const appState = this.getAppState();

    trackAction(action, source, appState, elements, this.app, value);

    this.updater(
      this.guarded(action, () =>
        action.perform(elements, appState, value, this.app),
      ),
    );
  }

  /**
   * flowapi: runs an action so that it leaves what the app draws from text
   * (flow shapes, labels, cards, their frames) as it was. Actions may change
   * elements in place, so protected ones are copied first.
   */
  private guarded(
    action: Action,
    perform: () => ActionResult | Promise<ActionResult>,
  ): ActionResult | Promise<ActionResult> {
    if (action.name === "undo" || action.name === "redo") {
      return perform();
    }
    const all = this.getElementsIncludingDeleted();
    const byId = new Map(all.map((e) => [e.id, e]));
    const lookup = (id: string) => byId.get(id);
    const before = new Map(
      all.map((e) => [
        e.id,
        isProtectedElement(e, lookup) ? ({ ...e } as typeof e) : e,
      ]),
    );
    const fix = (result: ActionResult): ActionResult => {
      if (result && result.elements) {
        return {
          ...result,
          elements: guardActionElements(result.elements, before),
        };
      }
      const now = this.getElementsIncludingDeleted();
      const fixed = guardActionElements(now, before);
      if (fixed.some((e, i) => e !== now[i]) || fixed.length !== now.length) {
        this.app.scene.replaceAllElements(fixed);
      }
      return result;
    };
    const result = perform();
    return isPromiseLike(result) ? result.then(fix) : fix(result);
  }

  /**
   * @param data additional data sent to the PanelComponent
   */
  renderAction = (name: ActionName, data?: PanelComponentProps["data"]) => {
    const canvasActions = this.app.props.UIOptions.canvasActions;

    if (
      this.actions[name] &&
      "PanelComponent" in this.actions[name] &&
      (name in canvasActions
        ? canvasActions[name as keyof typeof canvasActions]
        : true)
    ) {
      const action = this.actions[name];
      const PanelComponent = action.PanelComponent!;
      PanelComponent.displayName = "PanelComponent";
      const updateData = (formState?: any) => {
        if (this.isActionBlockedByViewportTransition(action)) {
          return;
        }

        // read fresh state at call time — memoized panel children may invoke
        // an `updateData` closure minted by an earlier render
        trackAction(
          action,
          "ui",
          this.getAppState(),
          this.getElementsIncludingDeleted(),
          this.app,
          formState,
        );

        this.updater(
          this.guarded(action, () =>
            action.perform(
              this.getElementsIncludingDeleted(),
              this.getAppState(),
              formState,
              this.app,
            ),
          ),
        );
      };

      return (
        <PanelComponent
          elements={this.getElementsIncludingDeleted()}
          appState={this.getAppState()}
          updateData={updateData}
          appProps={this.app.props}
          app={this.app}
          data={data}
          renderAction={this.renderAction}
        />
      );
    }

    return null;
  };

  isActionEnabled = (action: Action) => {
    const elements = this.getElementsIncludingDeleted();
    const appState = this.getAppState();

    return (
      !action.predicate ||
      action.predicate(elements, appState, this.app.props, this.app)
    );
  };
}
