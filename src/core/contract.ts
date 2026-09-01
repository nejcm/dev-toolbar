import type { ReactNode } from "react";

/**
 * Version of the extension contract implemented by this core.
 *
 * Extensions may declare `contractVersion`; the core warns (once per extension
 * id) when it does not match.
 */
export const CONTRACT_VERSION = 1;

export type ToolbarAlign = "start" | "end";
export type ToolbarPosition = "bottom" | "top";
export type ToolbarDensity = "compact" | "comfortable";
export type ToolbarColorScheme = "light" | "dark" | "system";

/**
 * Minimal synchronous key/value store. `localStorage` satisfies this shape,
 * which is why it is the default.
 */
export interface ToolbarStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A command an extension contributes. Core aggregates them; it renders no palette. */
export interface ToolbarCommand {
  id: string;
  label: string;
  group?: string;
  keywords?: string[];
  /** Display-only hint, e.g. "Mod+Shift+F". Core does not bind it. */
  shortcut?: string;
  run(): void | Promise<void>;
}

/**
 * What `DevToolbarExtension.commands` may be — **P2**.
 *
 * A static array is the simple case and stays valid. The function form exists
 * because an extension's command list is often derived from state that arrives
 * after the factory ran: `/ext/flags` contributes one toggle per boolean flag,
 * and with a static array a flag that appeared later got a panel row and no
 * command until the page reloaded.
 *
 * Core calls the function on each aggregation pass — when the extension list
 * changes, and on every `getCommands()` / `runCommand()`. Three rules follow:
 *
 * - **It must be pure and cheap.** It runs during render, and twice per render
 *   under StrictMode. Enumerate; do not fetch, subscribe or mutate.
 * - **Identity is the `id`, not the object.** Core and every palette key and
 *   diff by `id`, so returning freshly built objects each call is fine and is
 *   the expected shape.
 * - **Order must be stable** for a given state, or a palette's list will
 *   reshuffle under the cursor between passes.
 *
 * A throw is contained: core logs once per extension and treats that extension
 * as contributing nothing, exactly as if it were `hidden`.
 */
export type ToolbarCommandsInput =
  | readonly ToolbarCommand[]
  | (() => readonly ToolbarCommand[]);

export interface CompactSlotProps {
  /** True when this item is rendered inside the overflow menu rather than the bar. */
  isOverflowed: boolean;
  isPanelOpen: boolean;
  density: ToolbarDensity;
  openPanel(): void;
  closePanel(): void;
  /**
   * Open this extension's panel when it is closed, close it when it is open.
   *
   * Added in P1: every extension that renders a trigger was writing
   * `isPanelOpen ? closePanel() : openPanel()` by hand, which is core's own
   * invariant leaking into extension code.
   */
  togglePanel(): void;
}

export interface PanelSlotProps {
  /** False only for `keepMounted` panels that are mounted but not the active one. */
  isActive: boolean;
  density: ToolbarDensity;
  /** Current panel height in pixels. */
  height: number;
  close(): void;
}

/**
 * Handed to the `overlay` slot — **P2**.
 *
 * The overlay renders inside the toolbar root, once, for as long as the
 * extension is present, not hidden and the bar is visible. It is *not* subject
 * to overflow collapse, which is the whole reason it exists: a compact item
 * that has collapsed into the `···` menu is not in the DOM at all, so an
 * extension whose surface is a modal — a command palette, a picker — would lose
 * it exactly when the window got narrow.
 */
export interface OverlaySlotProps {
  density: ToolbarDensity;
  position: ToolbarPosition;
}

/** Handed to `start(api)` once per mount. */
export interface ExtensionRuntimeApi {
  /** Aborted when the extension is unregistered or the toolbar unmounts. */
  signal: AbortSignal;
  /** Core reports visibility; it never pauses an extension on its behalf. */
  isVisible(): boolean;
  subscribeVisibility(cb: (visible: boolean) => void): () => void;
  /** Storage namespaced to this extension id. No-op when persistence is disabled. */
  storage: ToolbarStorage;
  /**
   * Every command aggregated from every extension, right now — **P2**.
   *
   * Re-enumerated on each call, so a command an extension started contributing
   * after mount is here. This is how `/ext/command-menu` reads the aggregation
   * without importing a *value* from core (`useToolbarCommands()` is for the
   * host application, whose copy of core is the same module instance; an
   * extension on its own subpath has no such guarantee).
   */
  getCommands(): readonly ToolbarCommand[];
  /**
   * Runs an aggregated command by id. Resolves `false` when nothing declares
   * it — including a command that existed when it was listed and does not any
   * more, which a palette has to be able to tell its user.
   */
  runCommand(id: string): Promise<boolean>;
}

export interface DevToolbarExtension {
  id: string;
  label: string;
  /** Core warns when this does not equal `CONTRACT_VERSION`. */
  contractVersion?: number;
  /** Bar region. Default `"start"`. */
  align?: ToolbarAlign;
  /** Ascending sort within a region. Default `0`. */
  order?: number;
  /** Overflow collapse order — lowest collapses first. Default `0`. */
  priority?: number;
  /**
   * Consumer-computed. Replaces the dropped `availability(ctx)`.
   *
   * This is not "temporarily unpainted" — it means *this extension does not
   * exist for this actor*, so core treats it as absent everywhere, not just in
   * the bar. A hidden extension is never `start()`ed, is torn down (signal
   * aborted, cleanup run) if it becomes hidden while running, has its panel
   * unmounted and closed, and contributes no commands to `useToolbarCommands()`
   * or `runCommand()`.
   *
   * If you only want to collapse an item out of sight, use `priority`.
   */
  hidden?: boolean;
  /** Keep the panel mounted after it closes. */
  keepMounted?: boolean;
  compact?: (props: CompactSlotProps) => ReactNode;
  panel?: (props: PanelSlotProps) => ReactNode;
  /**
   * Always rendered while this extension is present, not hidden and the bar is
   * visible — never collapsed into the `···` menu. For modal surfaces. See
   * `OverlaySlotProps`.
   */
  overlay?: (props: OverlaySlotProps) => ReactNode;
  /** A static array, or a function core calls on each pass. See `ToolbarCommandsInput`. */
  commands?: ToolbarCommandsInput;
  start?(api: ExtensionRuntimeApi): void | (() => void);
}

/**
 * Narrow class-name map. `--dtb-*` tokens are the primary styling surface and
 * every part also carries a stable `data-dtb-part` attribute.
 */
export interface DevToolbarClassNames {
  root?: string;
  bar?: string;
  region?: string;
  item?: string;
  overflowButton?: string;
  overflowMenu?: string;
  overflowMenuItem?: string;
  overlay?: string;
  panel?: string;
  panelResizer?: string;
  errorChip?: string;
}
