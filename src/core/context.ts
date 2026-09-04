import { createContext, useContext } from "react";
import type {
  AnyToolbarCommand,
  CommandInvocation,
  DevToolbarClassNames,
  DevToolbarExtension,
  ExtensionErrorInfo,
  ToolbarDensity,
  ToolbarPosition,
  ToolbarStorage,
} from "./contract";
import type { ToolbarStore } from "./store";

export interface DevToolbarContextValue {
  instanceId: string;
  enabled: boolean;
  /**
   * False on the server and on the first client render, true afterwards.
   * Anything derived from persisted state must be gated on this to stay
   * hydration-safe.
   */
  mounted: boolean;
  store: ToolbarStore;
  /** Props + dynamically registered, de-duplicated by id. Includes hidden ones. */
  extensions: readonly DevToolbarExtension[];
  /**
   * The aggregation as of the last extension-list change; stable in between, so
   * it's usable in a dependency array. With the function form of
   * `DevToolbarExtension.commands`, an extension can start contributing without
   * the list changing — anything that must be current calls `getCommands()`.
   */
  commands: readonly AnyToolbarCommand[];
  /** Re-enumerates every extension's commands now. */
  getCommands(): readonly AnyToolbarCommand[];
  /** `input` is handed to the command's `run()` unchanged (contract v2). */
  runCommand(id: string, input?: unknown): Promise<boolean>;
  /** `runCommand` that resolves what the command returned. See `CommandInvocation`. */
  invokeCommand<Out = unknown>(id: string, input?: unknown): Promise<CommandInvocation<Out>>;
  density: ToolbarDensity;
  classNames: DevToolbarClassNames;
  onExtensionError?: (error: Error, info: ExtensionErrorInfo) => void;
  storage: ToolbarStorage;
  visible: boolean;
  position: ToolbarPosition;
  activePanelId: string | null;
  panelHeight: number;
  setVisible(visible: boolean): void;
  toggleVisible(): void;
  setPosition(position: ToolbarPosition): void;
  openPanel(id: string): void;
  closePanel(id?: string): void;
  togglePanel(id: string): void;
  setPanelHeight(height: number): void;
  /** Dynamic registration. Returns an unregister function. */
  register(extension: DevToolbarExtension): () => void;
}

export const DevToolbarContext = createContext<DevToolbarContextValue | null>(null);

/** Internal: does not throw, for parts that must degrade outside a provider. */
export function useOptionalDevToolbar(): DevToolbarContextValue | null {
  return useContext(DevToolbarContext);
}

/** Access the surrounding toolbar instance. */
export function useDevToolbar(): DevToolbarContextValue {
  const value = useContext(DevToolbarContext);
  if (!value) {
    throw new Error("[dev-toolbar] useDevToolbar() must be called inside <DevToolbar>.");
  }
  return value;
}

/**
 * Commands aggregated from every extension. Core ships no palette UI.
 *
 * This is the declarative view: recomputed on extension-list change, stable in
 * between. A palette should re-enumerate with `useDevToolbar().getCommands()`
 * when it opens, since the function form of `commands` can start contributing
 * without the list changing.
 */
export function useToolbarCommands(): readonly AnyToolbarCommand[] {
  return useDevToolbar().commands;
}

export function cx(...values: (string | false | null | undefined)[]): string | undefined {
  const joined = values.filter(Boolean).join(" ");
  return joined === "" ? undefined : joined;
}
