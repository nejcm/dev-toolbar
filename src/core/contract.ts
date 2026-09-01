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

/** Handed to `start(api)` once per mount. */
export interface ExtensionRuntimeApi {
  /** Aborted when the extension is unregistered or the toolbar unmounts. */
  signal: AbortSignal;
  /** Core reports visibility; it never pauses an extension on its behalf. */
  isVisible(): boolean;
  subscribeVisibility(cb: (visible: boolean) => void): () => void;
  /** Storage namespaced to this extension id. No-op when persistence is disabled. */
  storage: ToolbarStorage;
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
  commands?: ToolbarCommand[];
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
  panel?: string;
  panelResizer?: string;
  errorChip?: string;
}
