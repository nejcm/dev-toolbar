import type { ReactNode } from "react";

/** Contract version implemented by this core. Core warns (once per extension id) if an extension's `contractVersion` differs. */
export const CONTRACT_VERSION = 1;

export type ToolbarAlign = "start" | "end";
export type ToolbarPosition = "bottom" | "top";
export type ToolbarDensity = "compact" | "comfortable";
export type ToolbarColorScheme = "light" | "dark" | "system";

/** Minimal synchronous key/value store; `localStorage` satisfies this shape and is the default. */
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
 * What `DevToolbarExtension.commands` may be. A static array is the simple case;
 * the function form lets a command list derived from later-arriving state (e.g.
 * one toggle per flag) stay current without a reload.
 *
 * Core calls the function on each aggregation pass, so it must be pure and cheap
 * (no fetch/subscribe/mutate), identify entries by `id` (not object identity),
 * and return a stable order for a given state. A throw is contained: core logs
 * once per extension and treats it as contributing nothing, as if `hidden`.
 */
export type ToolbarCommandsInput = readonly ToolbarCommand[] | (() => readonly ToolbarCommand[]);

/**
 * What one extension contributed to a diagnostic snapshot. Core emits one of these
 * per present, non-hidden extension whether or not it declares `diagnostics`, so a
 * bug-report snapshot can distinguish "had nothing to say" from "failed".
 */
export type DiagnosticStatus =
  /** `diagnostics()` ran and returned a value. */
  | "ok"
  /** No `diagnostics()` declared. */
  | "absent"
  /** `diagnostics()` threw; `error` says what. */
  | "failed";

export interface ExtensionDiagnostics {
  id: string;
  label: string;
  status: DiagnosticStatus;
  /** Only present when `status` is `"ok"`. Not redacted — core has no `redact()`. */
  data?: unknown;
  /**
   * The thrown error's message alone, unjoined and unredacted, when `status` is
   * `"failed"`. Kept separate (not prefixed as `"TypeError: ..."`) so the `/runtime`
   * redactors — which match value shapes anchored to the whole string — can still
   * mask a credential-carrying URL message. Core cannot redact it itself (may not
   * import `/runtime`).
   */
  error?: string;
  /**
   * The thrown error's `name`, e.g. `"TypeError"`. Absent for a non-`Error` throw.
   * Unverified — `name` is a writable own property, not a guaranteed class
   * identifier — so a reader must redact it before joining it to anything.
   */
  errorName?: string;
}

export interface CompactSlotProps {
  /** True when this item is rendered inside the overflow menu rather than the bar. */
  isOverflowed: boolean;
  isPanelOpen: boolean;
  density: ToolbarDensity;
  openPanel(): void;
  closePanel(): void;
  /** Open this extension's panel when closed, close it when open. */
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
 * Handed to the `overlay` slot. Unlike `compact`, the overlay is never subject to
 * overflow collapse — it stays in the DOM even when the bar narrows, which is why
 * modal surfaces (a command palette, a picker) belong here rather than in `compact`.
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
  /**
   * Also released automatically when `signal` aborts. The returned unsubscribe
   * function is for releasing it earlier; calling it more than once, or after
   * `signal` has aborted, is a no-op.
   */
  subscribeVisibility(cb: (visible: boolean) => void): () => void;
  /** Storage namespaced to this extension id. No-op when persistence is disabled. */
  storage: ToolbarStorage;
  /**
   * Every command aggregated from every extension, re-enumerated on each call.
   * Lets extensions on their own subpath (e.g. `/ext/command-menu`) read the
   * aggregation without importing a value from core.
   */
  getCommands(): readonly ToolbarCommand[];
  /**
   * Runs an aggregated command by id. Resolves `true` once `run()` completes,
   * `false` if no command declares that id. If `run()` throws or rejects,
   * `runCommand()` rejects with the same error — callers must catch it.
   */
  runCommand(id: string): Promise<boolean>;
  /**
   * Diagnostics counterpart of `getCommands()`, one entry per present, non-hidden
   * extension (`status: "absent"` for those with no `diagnostics()`), so a reader
   * needing full-roster completeness (a bug-report snapshot) gets it.
   */
  getDiagnostics(): readonly ExtensionDiagnostics[];
}

export interface DevToolbarExtension {
  /**
   * Identity, and the namespace for this extension's persisted storage
   * (`dtb:v1:<instanceId>:ext:<id>:*`, `docs/architecture.md` §3). `:` is
   * unescaped, so an id containing `:` can alias another scope — safest as
   * `[A-Za-z0-9_-]`.
   */
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
   * Consumer-computed; means this extension does not exist for this actor, not
   * merely "unpainted" — core treats it as absent everywhere: never `start()`ed,
   * torn down if it becomes hidden while running, panel unmounted/closed, no
   * commands contributed. Use `priority` instead if you only want to collapse it
   * out of sight.
   */
  hidden?: boolean;
  /** Keep the panel mounted after it closes. */
  keepMounted?: boolean;
  compact?: (props: CompactSlotProps) => ReactNode;
  panel?: (props: PanelSlotProps) => ReactNode;
  /**
   * Always rendered while this extension is present, not hidden and the bar is
   * visible — never collapsed into the `⋮` menu. For modal surfaces. See
   * `OverlaySlotProps`.
   */
  overlay?: (props: OverlaySlotProps) => ReactNode;
  /** A static array, or a function core calls on each pass. See `ToolbarCommandsInput`. */
  commands?: ToolbarCommandsInput;
  /**
   * What this extension knows that belongs in a bug report. Aggregated like
   * `commands`; core renders none of it, `/ext/diagnostics` reads it. Must be
   * pure and cheap (called from a click handler, not a timer), return
   * JSON-serialisable data, and return data already safe to leave the machine —
   * the reader redacts again as defence in depth, not a substitute for redacting
   * at the source. A throw is contained: core reports `status: "failed"` for
   * this extension and builds the rest of the snapshot normally.
   */
  diagnostics?: () => unknown;
  start?(api: ExtensionRuntimeApi): void | (() => void);
}

/** Narrow class-name map. `--dtb-*` tokens are the primary styling surface; every part also carries a stable `data-dtb-part` attribute. */
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
