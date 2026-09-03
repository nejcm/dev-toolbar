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
import type { ExtensionDiagnostics } from "../../core/contract";

/**
 * One aggregated command, flattened to data. `run` is deliberately not here —
 * a handle hands back descriptions, and `runCommand(id)` is the only way to
 * invoke one (and only when `allowRun` is on).
 */
export interface AgentCommandView {
  id: string;
  label: string;
  group?: string;
  keywords?: readonly string[];
  /** Display-only hint, e.g. `"Mod+Shift+F"`. Core does not bind it. */
  shortcut?: string;
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
  | { ok: true }
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
  /** Present only when `allowRun` is `true`. */
  runCommand?(id: string): Promise<AgentRunResult>;
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

/** Bumped when the shape of `AgentRegistry` or `AgentHandle` changes. */
export const AGENT_PROTOCOL_VERSION = 1;

/** Default global name. Discoverable on purpose — obscurity is not a control. */
export const DEFAULT_GLOBAL_NAME = "__DEV_TOOLBAR__";

/** Prefix for everything this extension logs. Also the bundle's marker. */
export const AGENT_MARKER = "[dev-toolbar/ext/agent]";
