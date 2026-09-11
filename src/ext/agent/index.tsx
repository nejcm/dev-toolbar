/**
 * `@nejcm/dev-toolbar/ext/agent` exposes core's command and diagnostics
 * aggregations to an in-page agent. Uses a registry, not a singleton, because
 * core supports multiple mounted roots; `default` throws unless there is
 * exactly one rather than guessing.
 *
 * The chip renders `compact` (rather than omitting it) so `Bar.tsx` doesn't
 * fall back to a generic `trigger` span; `priority: -1` makes it collapse
 * before an ordinary extension. `allowRun` defaults off since the published
 * global is reachable by any page script. This extension imports only core
 * types and uses `/runtime` for redaction — core may not import `/runtime`.
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
   * Off-page transport. Absent (default) means the bridge opens no
   * connection — the global is the whole surface. Present means the page
   * POSTs its coalesced, redacted snapshot to `report.url` and picks up
   * queued commands, letting an agent that never loads the app `curl` the
   * state. Point it at a **dev-server route on the same origin** (see the
   * Vite recipe in the README); `allowRun` still gates running.
   */
  report?: AgentReportOptions;
  /**
   * The `instanceId` you pass to `<DevToolbar>`. Default `"default"`. The
   * contract hands `start(api)` no instance identity, so you repeat it here.
   */
  instanceId?: string;
  /** Extension id. Default `"agent"`. */
  id?: string;
  /** Bar label, used by the error chip and the label chip. Default `"Agent"`. */
  label?: string;
  align?: ToolbarAlign;
  order?: number;
  /** Overflow collapse order, lowest first. Default `-1`, below core's `0`, so this chip yields the bar before an ordinary extension. */
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
