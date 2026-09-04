import type { ReactNode } from "react";

/**
 * Contract version implemented by core. Core warns once per extension id when
 * `contractVersion` differs. Version 2 adds command descriptions, input schemas
 * and returned values (`plans/agent-readable-toolbar.md` § Phase 2); it is
 * source-compatible with v1. See [ADR-003](../../docs/adr/ADR-003-contract-version-policy.md).
 */
export const CONTRACT_VERSION = 2;

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

/**
 * A value a command input field may hold. Primitives only — a command input is
 * a form, and a form has no nesting.
 */
export type CommandInputValue = boolean | string | number | null;

/** Primitive field kinds; `"enum"` is separate because it carries `values`. */
export type CommandInputType = "boolean" | "string" | "number";

interface CommandInputFieldBase {
  /** Prose for whoever is choosing what to pass. One line. */
  description?: string;
  /** Default `false`. An omitted optional field means "unset", never a coerced zero value. */
  required?: boolean;
  /** What a form should prefill, and what a reader should assume an omitted field means. */
  default?: CommandInputValue;
  /*
   * There is deliberately no `nullable` here. It was drafted, and its only use
   * — `flags.set`'s `value` — turned out to be false: a `null` override is
   * refused for every non-variant flag, because it would not survive
   * `vetOverrides` on the next reload. Rather than ship a field whose sole
   * caller lied, it was removed until a command genuinely needs it. `null` is
   * still a `CommandInputValue`, so an `enum` whose `values` include it says
   * so exactly, which is the only case that has come up.
   */
}

export interface CommandInputPrimitiveField extends CommandInputFieldBase {
  /**
   * One primitive, or the set of primitives this field accepts. The array form
   * exists because genuinely polymorphic values exist — `flags.set`'s `value`
   * is whatever type the named flag has — and a schema that cannot say so
   * would be a lie the first time it is used.
   */
  type: CommandInputType | readonly CommandInputType[];
}

export interface CommandInputEnumField extends CommandInputFieldBase {
  type: "enum";
  /** The complete set of accepted values. */
  values: readonly CommandInputValue[];
}

export type CommandInputField = CommandInputPrimitiveField | CommandInputEnumField;

/**
 * What one command accepts, described narrowly on purpose.
 *
 * **Not JSON Schema and not Zod.** Zero runtime dependencies is a rule, and
 * command inputs are flat bags of `boolean | string | number | enum`. There is
 * no nesting, composition or validator: `run()` knows what its input means and
 * refuses bad input by throwing.
 *
 * The schema describes input for a palette or agent; it is not a validation gate.
 */
export interface CommandInputSchema {
  /** Named fields. Flat: a value here is a primitive or an enum, never another object. */
  fields: Readonly<Record<string, CommandInputField>>;
}

/**
 * A command an extension contributes. Core aggregates commands but renders no palette.
 *
 * `In` and `Out` both default to `void`, which is what makes every v1 command a
 * valid v2 command: a zero-argument `run(): void | Promise<void>` satisfies
 * `run(input: void): void | Promise<void>` unchanged, and a `ToolbarCommand`
 * written against v1 needs no edit.
 *
 * A roster uses `AnyToolbarCommand`, not `ToolbarCommand`; declare a generic
 * explicitly in array literals when the command has an input type.
 */
export interface ToolbarCommand<In = void, Out = void> {
  id: string;
  label: string;
  /**
   * Prose for a reader deciding whether to call this — an agent, or a tool
   * listing. `label` is for a palette row and stays short.
   */
  description?: string;
  group?: string;
  keywords?: string[];
  /** Display-only hint, e.g. "Mod+Shift+F". Core does not bind it. */
  shortcut?: string;
  /**
   * Absent means "takes no input", and a palette can run it from a keypress.
   * Present means a palette needs a form for it, or must skip it —
   * `/ext/command-menu` skips, and leaves these to `/ext/agent`.
   */
  input?: CommandInputSchema;
  run(input: In): Out | Promise<Out>;
}

/**
 * The element type of every command **aggregation** — `getCommands()`,
 * `useToolbarCommands()`, `commands`. A roster holds commands with different
 * `In`/`Out`, so it needs one element type that all of them satisfy.
 *
 * `any` is load-bearing here and is the only one in the package. A
 * heterogeneous list cannot be typed `ToolbarCommand<void, void>` (nothing is
 * assignable to a `void` parameter) and typing it `ToolbarCommand<never, unknown>`
 * would make `readonly ToolbarCommand[]` — what every v1 consumer writes —
 * stop being assignable from it. `ToolbarCommand<any, any>` is mutually
 * assignable with both, which is exactly the compatibility this needs.
 * `invokeCommand` casts once before calling the selected command.
 */
/* oxlint-disable typescript/no-explicit-any -- see above; the alternatives break v1 source compatibility. */
export interface AnyToolbarCommand extends Omit<ToolbarCommand<any, any>, "run"> {
  /** Optional for v1 compatibility, so aggregated `command.run()` calls still compile. */
  run(input?: any): any;
}
/* oxlint-enable typescript/no-explicit-any */

/**
 * What `invokeCommand` resolves. `ok: false` is only ever "no command declares
 * that id" — a command that *ran* and threw rejects, exactly as `runCommand`
 * has always done, so core keeps one error convention and `/ext/agent` turns
 * the rejection into a value at the boundary an agent actually reads.
 */
export type CommandInvocation<Out = unknown> =
  | { ok: true; result: Out }
  | { ok: false; reason: "unknown-command" };

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
export type ToolbarCommandsInput =
  | readonly AnyToolbarCommand[]
  | (() => readonly AnyToolbarCommand[]);

/**
 * One extension's diagnostic contribution. Core emits one per present,
 * non-hidden extension so a snapshot can distinguish "absent" from "failed".
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

/** Metadata handed to `onExtensionError` after an extension slot fails. */
export interface ExtensionErrorInfo {
  extensionId: string;
  label: string;
  slot: "compact" | "panel" | "overlay";
  /** React's component stack, or `null` when React supplies none. */
  componentStack: string | null;
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
  getCommands(): readonly AnyToolbarCommand[];
  /**
   * Runs an aggregated command by id. Resolves `true` once `run()` completes,
   * `false` if no command declares that id. If `run()` throws or rejects,
   * `runCommand()` rejects with the same error — callers must catch it.
   *
   * `input` is handed to `run()` unchanged; a command with no `input` schema
   * ignores it. Use `invokeCommand` when you need what `run()` returned.
   */
  runCommand(id: string, input?: unknown): Promise<boolean>;
  /**
   * `runCommand` that resolves what `run()` returned rather than only whether
   * it was found. Contract v2: a command that produces something (a captured
   * snapshot, a computed value) is otherwise a dead end for a caller that is
   * not looking at the screen.
   *
   * Rejects with whatever `run()` threw, like `runCommand`.
   */
  invokeCommand<Out = unknown>(id: string, input?: unknown): Promise<CommandInvocation<Out>>;
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
