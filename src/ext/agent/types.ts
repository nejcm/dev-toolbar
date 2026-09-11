/**
 * The JSON-serialisable data published by `/ext/agent`. It touches no globals,
 * so the module remains safe to evaluate during SSR.
 */
import type { CommandInputSchema, ExtensionDiagnostics } from "../../core/contract";

/** One aggregated command, flattened to data. Invocation is only through `runCommand`. */
export interface AgentCommandView {
  id: string;
  label: string;
  /** Prose for a reader deciding whether to call this (contract v2). Absent when the command declares none. */
  description?: string;
  group?: string;
  keywords?: readonly string[];
  /** Display-only hint, e.g. `"Mod+Shift+F"`. Core does not bind it. */
  shortcut?: string;
  /** What to pass as `runCommand`'s second argument. `/ext/command-menu` skips these commands. */
  input?: CommandInputSchema;
}

/** One item currently rendered in a bar region. */
export interface AgentBarItemView {
  /** `data-dtb-ext-id`. */
  id: string;
  /** `"start"` or `"end"`. */
  align: string | null;
  /** True when this extension's panel is the open one. */
  panelOpen: boolean;
}

/**
 * Shell-level facts (the chrome, not an extension). Nothing publishes these
 * through `diagnostics()` since the shell is core and has no extension to
 * speak for it, so the bridge reads them off the root node — the one DOM
 * read in the whole design.
 */
export interface AgentShellView {
  /**
   * False when no root carrying this `instanceId` is in the document — also
   * what a *hidden* bar looks like, since core removes rather than hides it.
   * `AgentSnapshot.visible` tells the two apart.
   */
  mounted: boolean;
  position: string | null;
  density: string | null;
  colorScheme: string | null;
  /**
   * The per-instance CSS custom property core publishes on
   * `document.documentElement`. The unsuffixed `--dev-toolbar-height` is
   * published only while this is the sole mounted instance, so it is
   * deliberately not reported here.
   */
  heightVariable: { name: string; value: string | null };
  /**
   * Only what is still *in* the bar. A collapsed extension moves into the
   * `···` menu, so an id missing here is either collapsed or has no bar item.
   */
  bar: readonly AgentBarItemView[];
  overflow: AgentOverflowView;
  /** `data-dtb-ext-id` of the open panel, or `null`. */
  activePanel: string | null;
}

export interface AgentOverflowView {
  /** True when the `···` button is rendered, i.e. at least one item collapsed. */
  present: boolean;
  /** True while the `···` menu is open. */
  open: boolean;
  /** Collapsed extensions, **only while the menu is open** — closed is `[]`, not "nothing collapsed"; read `present` for that. */
  items: readonly string[];
}

/** The whole agent-visible state of one mounted toolbar. */
export interface AgentSnapshot {
  /** The `instanceId` of the `<DevToolbar>` this handle belongs to. */
  instanceId: string;
  /** The extension contract this bridge was built against. */
  contractVersion: number;
  /** `api.isVisible()` — whether the bar is currently shown. */
  visible: boolean;
  /** Mirrors `AgentBridgeOptions.allowRun`, so a caller can tell why `runCommand` is missing. */
  allowRun: boolean;
  commands: readonly AgentCommandView[];
  /** Position, density, colour scheme, the height variable, and bar membership. */
  shell: AgentShellView;
  /**
   * One entry per present, non-hidden extension, redacted again on the way
   * out. `status: "absent"` distinguishes "had nothing to say" from "blew
   * up" — the difference between a clean run and a clean run that only read
   * half the roster.
   */
  diagnostics: readonly ExtensionDiagnostics[];
}

/** Result of `runCommand`; command failures are values so an agent can branch on them. */
export type AgentRunResult =
  /** Whatever `run()` returned, redacted like every other read; `undefined` for commands that return nothing. Must be `structuredClone`-able to survive `page.evaluate`. */
  | { ok: true; result?: unknown }
  | { ok: false; reason: "unknown-command" }
  /** The toolbar this handle belonged to has unmounted; nothing was run. */
  | { ok: false; reason: "torn-down" }
  | { ok: false; reason: "threw"; error: string; errorName?: string };

/**
 * One mounted toolbar, as an agent sees it.
 *
 * `runCommand` is **absent**, not merely refusing, when `allowRun` is off.
 * A handle captured before its toolbar unmounted refuses everything after:
 * `read()` and `listCommands()` **throw** (an empty snapshot would be
 * indistinguishable from a live, empty toolbar), and `runCommand()` resolves
 * `{ ok: false, reason: "torn-down" }`.
 */
export interface AgentHandle {
  readonly instanceId: string;
  readonly contractVersion: number;
  readonly allowRun: boolean;
  listCommands(): readonly AgentCommandView[];
  read(): AgentSnapshot;
  /**
   * Present only when `allowRun` is `true`. `input` is handed to the
   * command's `run()` unchanged; a refusal arrives as
   * `{ ok: false, reason: "threw", error }` rather than a rejection.
   */
  runCommand?(id: string, input?: unknown): Promise<AgentRunResult>;
}

/**
 * The object installed at `globalName`. Keyed by `instanceId` rather than
 * being a singleton: core supports several mounted roots, and a singleton
 * would let the last mount silently win.
 */
export interface AgentRegistry {
  /** Shape version of this object, independent of `CONTRACT_VERSION`. */
  readonly protocolVersion: number;
  /** Live map; a handle is deleted from it when its toolbar unmounts. */
  readonly instances: Record<string, AgentHandle>;
  /**
   * The only mounted instance. Throws — with the ids to pick from — when there
   * is not exactly one, rather than guessing which toolbar was meant.
   */
  readonly default: AgentHandle;
}

/**
 * Bumped when the shape of `AgentRegistry` or `AgentHandle` changes.
 *
 * **2**: `runCommand` takes an `input` argument and resolves `result`, and
 * `AgentCommandView` carries `description` and `input` (contract v2). Both
 * additions; a reader written against 1 keeps working.
 */
export const AGENT_PROTOCOL_VERSION = 2;

/** Default global name. Discoverable on purpose — obscurity is not a control. */
export const DEFAULT_GLOBAL_NAME = "__DEV_TOOLBAR__";

/** Prefix for everything this extension logs. Also the bundle's marker. */
export const AGENT_MARKER = "[dev-toolbar/ext/agent]";
