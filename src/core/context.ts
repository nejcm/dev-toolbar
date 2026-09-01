import { createContext, useContext } from "react";
import type {
  DevToolbarClassNames,
  DevToolbarExtension,
  ToolbarCommand,
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
   * The aggregation as of the last time the extension list changed. Stable
   * between those changes, which is what makes it usable in a dependency array.
   *
   * With the function form of `DevToolbarExtension.commands` an extension can
   * start contributing a command without the list changing, and core has no way
   * to know — so anything that must be current calls `getCommands()`.
   */
  commands: readonly ToolbarCommand[];
  /** Re-enumerates every extension's commands now. */
  getCommands(): readonly ToolbarCommand[];
  runCommand(id: string): Promise<boolean>;
  density: ToolbarDensity;
  classNames: DevToolbarClassNames;
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

export const DevToolbarContext = createContext<DevToolbarContextValue | null>(
  null,
);

/** Internal: does not throw, for parts that must degrade outside a provider. */
export function useOptionalDevToolbar(): DevToolbarContextValue | null {
  return useContext(DevToolbarContext);
}

/** Access the surrounding toolbar instance. */
export function useDevToolbar(): DevToolbarContextValue {
  const value = useContext(DevToolbarContext);
  if (!value) {
    throw new Error(
      "[dev-toolbar] useDevToolbar() must be called inside <DevToolbar>.",
    );
  }
  return value;
}

/**
 * Commands aggregated from every extension. Core ships no palette UI.
 *
 * This is the *declarative* view: it is recomputed when the extension list
 * changes and is referentially stable in between. An extension using the
 * function form of `commands` can begin contributing one without that list
 * changing — a feature flag that appeared after mount, say — so a palette
 * should re-enumerate with `useDevToolbar().getCommands()` at the moment it
 * opens rather than render this.
 */
export function useToolbarCommands(): readonly ToolbarCommand[] {
  return useDevToolbar().commands;
}

export function cx(
  ...values: (string | false | null | undefined)[]
): string | undefined {
  const joined = values.filter(Boolean).join(" ");
  return joined === "" ? undefined : joined;
}
