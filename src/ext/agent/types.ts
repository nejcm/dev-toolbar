/**
 * The pure half of `/ext/agent`: what the bridge publishes and what a caller
 * gets back. [dev-toolbar/ext/agent]
 *
 * Nothing here touches `window` — the whole module is evaluated on a server
 * during SSR, and the global is only ever installed from `start(api)`
 * (`plans/agent-readable-toolbar.md` § Phase 0, decision 5).
 *
 * Everything is plain JSON-serialisable data, because the reader on the other
 * side is usually `page.evaluate`, which structured-clones what it returns: a
 * function, a `Map` or a class instance would arrive as `undefined` or throw.
 */
import type { CommandInputSchema, ExtensionDiagnostics } from "../../core/contract";

/**
 * One aggregated command, flattened to data. `run` is deliberately not here —
 * a handle hands back descriptions, and `runCommand(id)` is the only way to
 * invoke one (and only when `allowRun` is on).
 */
export interface AgentCommandView {
  id: string;
  label: string;
  /**
   * Prose for a reader deciding whether to call this (contract v2). Absent
   * when the command declares none — `label` is then all there is.
   */
  description?: string;
  group?: string;
  keywords?: readonly string[];
  /** Display-only hint, e.g. `"Mod+Shift+F"`. Core does not bind it. */
  shortcut?: string;
  /**
   * What to pass as `runCommand`'s second argument. Absent means the command
   * takes nothing. These are exactly the commands `/ext/command-menu` skips,
   * so the bridge is the only way to reach them.
   */
  input?: CommandInputSchema;
}

/** One item currently rendered in the bar's regions. */
export interface AgentBarItemView {
  /** `data-dtb-ext-id`. */
  id: string;
  /** `"start"` or `"end"`. */
  align: string | null;
  /** True when this extension's panel is the open one. */
  panelOpen: boolean;
}

/**
 * Shell-level facts: what the *chrome* is doing, as opposed to what an
 * extension is doing.
 *
 * Nothing publishes these through `diagnostics()`, because the shell is core
 * and core has no extension to speak for it. So the bridge reads them off the
 * root node — the one DOM read in the whole design
 * (`plans/agent-readable-toolbar.md` § Phase 1, open question 3: core owning
 * this instead would be a core change and a `CONTRACT_VERSION` conversation).
 */
export interface AgentShellView {
  /**
   * False when no root carrying this `instanceId` is in the document — which
   * is also what a *hidden* bar looks like, because core removes it rather
   * than hiding it visually. `AgentSnapshot.visible` tells the two apart.
   */
  mounted: boolean;
  position: string | null;
  density: string | null;
  colorScheme: string | null;
  /**
   * The per-instance CSS custom property core publishes on
   * `document.documentElement`, and its current value. The **unsuffixed**
   * `--dev-toolbar-height` belongs to `instanceId: "default"` only, so it is
   * deliberately not reported here for any other instance.
   */
  heightVariable: { name: string; value: string | null };
  /**
   * Only what is still *in* the bar. A collapsed extension is removed from
   * its region and re-rendered inside the `···` menu, so an id missing from
   * here is either collapsed or has no bar item at all.
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
  /**
   * The collapsed extensions — **only while the menu is open**. Core renders
   * the menu's contents on open, so a closed menu is an empty list here, not
   * a claim that nothing collapsed. `present` is the fact to read when it is
   * closed.
   */
  items: readonly string[];
}

/** What `read()` returns: the whole agent-visible state of one mounted toolbar. */
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
   * out (decision 3). `status: "absent"` distinguishes "had nothing to say"
   * from "blew up", which is the difference between an agent reporting a clean
   * run and reporting a clean run because it read half the roster.
   */
  diagnostics: readonly ExtensionDiagnostics[];
}

/**
 * Errors are values. A rejection crossing `page.evaluate` arrives as a string
 * with no shape to branch on, so `runCommand` resolves one of these instead of
 * rejecting — including when the command itself throws.
 */
export type AgentRunResult =
  /**
   * `result` is whatever `run()` returned, redacted on the way out like every
   * other read (decision 3), and `undefined` for the many commands that return
   * nothing. It is `structuredClone`-able or it does not survive
   * `page.evaluate`, which is the contract's requirement on `Out` too.
   */
  | { ok: true; result?: unknown }
  | { ok: false; reason: "unknown-command" }
  /** The toolbar this handle belonged to has unmounted; nothing was run. */
  | { ok: false; reason: "torn-down" }
  | { ok: false; reason: "threw"; error: string; errorName?: string };

/**
 * One mounted toolbar, as an agent sees it.
 *
 * `runCommand` is **absent**, not merely refusing, when `allowRun` is off:
 * the whole point of the default is that there is no way to run anything at
 * all, and a method that always answers "no" is a bigger surface than no
 * method.
 *
 * A handle someone captured before its toolbar unmounted refuses everything
 * afterwards (decision 4): `read()` and `listCommands()` **throw**, and
 * `runCommand()` resolves `{ ok: false, reason: "torn-down" }`. Reads throw
 * rather than answering because the only value-shaped answer available — an
 * empty snapshot — is indistinguishable from a live toolbar with nothing in
 * it, which is precisely the wrong answer to give an agent.
 */
export interface AgentHandle {
  readonly instanceId: string;
  readonly contractVersion: number;
  readonly allowRun: boolean;
  listCommands(): readonly AgentCommandView[];
  read(): AgentSnapshot;
  /**
   * Present only when `allowRun` is `true`.
   *
   * `input` is handed to the command's `run()` unchanged; read the schema from
   * `listCommands()[n].input` to know what it wants. A command that refuses
   * its input throws, which arrives here as
   * `{ ok: false, reason: "threw", error }` rather than a rejection.
   */
  runCommand?(id: string, input?: unknown): Promise<AgentRunResult>;
}

/**
 * The object installed at `globalName`. Keyed by `instanceId` rather than
 * being a singleton (decision 1): core supports several mounted roots, and a
 * singleton would let the last mount silently win.
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
