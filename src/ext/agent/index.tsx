/**
 * `@nejcm/dev-toolbar/ext/agent` exposes core's command and diagnostics
 * aggregations to an in-page agent (`plans/agent-readable-toolbar.md` § Phase 0).
 * It uses a registry because core supports multiple mounted roots; `default`
 * throws unless there is exactly one rather than guessing.
 *
 * The chip deliberately diverges from the plan's "no `compact`, no `panel`":
 * that shape paints a chip anyway, since `Bar.tsx` falls back to a `trigger`
 * span for any extension with neither. A null compact slot still creates the
 * item and its `:not(:first-child)::before` divider (`styles.css`), and
 * `hidden` stops `start()` entirely (`DevToolbar.tsx`), taking the global with
 * it. `priority: -1` makes the chip collapse first instead.
 *
 * `allowRun` defaults off because the global is reachable by any page script.
 * Teardown removes stale handles and the global. Nothing touches a global at
 * module evaluation, so SSR remains safe. Core's import boundary also matters:
 * this extension imports only core types and uses `/runtime` for redaction;
 * core may not import `/runtime`.
 *
 * `read().shell` is the one DOM read. The shell belongs to core, which has no
 * extension to publish these facts through `diagnostics()`; changing that
 * would be a core contract change (`plans/agent-readable-toolbar.md` § Phase 1).
 */
import { installAgentBridge } from "./runtime";
import type { AgentReportOptions } from "./report";
import { DEFAULT_GLOBAL_NAME } from "./types";
import type { DevToolbarExtension, ExtensionRuntimeApi, ToolbarAlign } from "../../core/contract";

export interface AgentBridgeOptions {
  /**
   * Global name. Default `"__DEV_TOOLBAR__"`. Set it to opt into a different
   * one, not to hide the surface — obscurity is not a control.
   */
  globalName?: string;
  /**
   * Default `false` — reads only. Running a command is arbitrary effect; the
   * consumer opts in. When off, the published handle has no `runCommand`.
   */
  allowRun?: boolean;
  /** Extra `redact()` keys for consumer-supplied diagnostics. */
  extraKeys?: readonly string[];
  /**
   * Off-page transport (`plans/agent-readable-toolbar.md` § Phase 3). Absent —
   * the default — means the bridge opens no connection to anything: the global
   * is the whole surface, and only a script already in the page can reach it.
   *
   * Present means the page POSTs its (coalesced, already-redacted) snapshot to
   * `report.url` and picks up commands the receiver has queued, which is what
   * lets an agent that never loads the app `curl` the state. Point it at a
   * **dev-server route on the same origin**; see the Vite recipe in the README.
   *
   * `allowRun` still gates running: with it off the handle has no
   * `runCommand`, so a queued command comes back refused rather than run.
   */
  report?: AgentReportOptions;
  /**
   * The `instanceId` you pass to `<DevToolbar>`, and the key this bridge's
   * handle is published under. Default `"default"`, matching core's own
   * default. The contract hands `start(api)` no instance identity, so — as in
   * `/ext/flags` and `/ext/theme-editor` — you repeat it here.
   */
  instanceId?: string;
  /** Extension id. Default `"agent"`. */
  id?: string;
  /** Bar label, used by the error chip and the label chip. Default `"Agent"`. */
  label?: string;
  align?: ToolbarAlign;
  order?: number;
  /**
   * Overflow collapse order — **lowest collapses first**. Default `-1`, below
   * core's default of `0`, so this chip yields the bar before any ordinary
   * extension does. Nothing is lost when it does: the bridge is not its chip.
   */
  priority?: number;
  hidden?: boolean;
}

/**
 * Builds the extension. Call it once, outside render.
 *
 * **For development builds.** The handle is reachable by any script on the
 * page; ship it where you would ship a devtool, not to production.
 */
export function agentBridge(options: AgentBridgeOptions = {}): DevToolbarExtension {
  const {
    globalName = DEFAULT_GLOBAL_NAME,
    allowRun = false,
    extraKeys,
    report,
    instanceId = "default",
    id = "agent",
    label = "Agent",
    align = "end",
    order = 90,
    priority = -1,
    hidden,
  } = options;

  return {
    id,
    label,
    contractVersion: 2,
    align,
    order,
    priority,
    ...(hidden === undefined ? {} : { hidden }),

    compact: () => (
      <span
        data-dtb-part="trigger"
        data-dtb-agent-mode={allowRun ? "run-enabled" : "read-only"}
        title={
          `Agent bridge on ${globalName}.instances[${JSON.stringify(instanceId)}] — ` +
          (allowRun
            ? "reads state and can run commands (allowRun)"
            : "reads state only (allowRun is off)")
        }
      >
        {label}
      </span>
    ),

    start(api: ExtensionRuntimeApi) {
      return installAgentBridge(api, {
        instanceId,
        globalName,
        allowRun,
        contractVersion: 2,
        ...(extraKeys === undefined ? {} : { extraKeys }),
        ...(report === undefined ? {} : { report }),
      });
    },
  };
}

export { createAgentReporter, startAgentReporter } from "./report";
export type {
  AgentCommandResult,
  AgentPendingCommand,
  AgentReportBody,
  AgentReportOptions,
  AgentReportResponse,
  AgentReportRunOutcome,
  AgentReporter,
} from "./report";
export {
  createAgentHandle,
  createAgentRegistry,
  installAgentBridge,
  readShell,
  toCommandView,
} from "./runtime";
export type { AgentRuntimeOptions } from "./runtime";
export { AGENT_MARKER, AGENT_PROTOCOL_VERSION, DEFAULT_GLOBAL_NAME } from "./types";
export type {
  AgentBarItemView,
  AgentCommandView,
  AgentHandle,
  AgentOverflowView,
  AgentRegistry,
  AgentRunResult,
  AgentShellView,
  AgentSnapshot,
} from "./types";
