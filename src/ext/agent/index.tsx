/**
 * `@nejcm/dev-toolbar/ext/agent`
 *
 * The bridge: the toolbar's own aggregations — commands and diagnostics —
 * reachable from `page.evaluate`, so an in-page agent can read state and (opt
 * in) act, instead of scraping the DOM and clicking pixel coordinates.
 * `plans/agent-readable-toolbar.md` § Phase 0.
 *
 * ```tsx
 * import { agentBridge } from "@nejcm/dev-toolbar/ext/agent";
 *
 * // Build it ONCE, outside render. Development builds only.
 * const extensions = [agentBridge({ instanceId: "playground" })];
 * ```
 *
 * ```js
 * // …then, from Playwright, CDP, or the console:
 * window.__DEV_TOOLBAR__.instances["playground"].read();
 * window.__DEV_TOOLBAR__.default.listCommands();
 * ```
 *
 * It has no `panel` and no stylesheet, and its `compact` slot is one `<span>`:
 * the label, plus a `title` and a `data-dtb-agent-mode` attribute saying
 * whether the mounted global can only be read or can also run commands. In an
 * `allowRun: true` build that chip is the only in-bar signal that a
 * command-running global is on the page, which is worth being legible.
 *
 * `priority` is `-1`, below core's default of `0`, so it is the **first** item
 * to collapse into the `···` menu: nothing is lost when it does — the bridge
 * is not its chip — while a metrics sparkline or an environment badge is.
 *
 * Consumes only the public extension contract — no `src/core/*` value imports,
 * types only (erased at build time) — plus `redact()` from `/runtime`, which
 * is the reason this is an extension and not a core feature: **core may not
 * import `/runtime`**, so a bridge in core would publish unredacted extension
 * output on a global.
 *
 * Four properties are the design, in the order they matter:
 *
 * - **A registry, not a singleton.** Handles are keyed by `instanceId`; core
 *   supports several mounted roots, and a singleton would let the last mount
 *   silently win. `default` throws, naming the ids, when there is not exactly
 *   one.
 * - **`allowRun` defaults off.** A global is reachable by any script on the
 *   page. Reads are already-redacted extension output; `runCommand` is
 *   arbitrary effect chosen by whoever got a script in. With it off the handle
 *   carries no `runCommand` at all — not one that refuses.
 * - **The global goes when the toolbar does.** `api.signal` removes the handle
 *   and, with the last instance, the global itself. A live handle onto a dead
 *   `api` is worse than no handle.
 * - **SSR-safe.** Nothing touches a global at module evaluation, only inside
 *   `start()`.
 *
 * `hidden` is inherited, never reimplemented: everything comes from `api`, so a
 * hidden extension contributes no commands and no diagnostics through the
 * bridge, exactly as in the bar.
 */
import { installAgentBridge } from "./runtime";
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
    contractVersion: 1,
    align,
    order,
    priority,
    ...(hidden === undefined ? {} : { hidden }),

    /**
     * Cheap and pure — it runs on every toolbar render. `isOverflowed` is
     * unused: the chip reads the same in the bar and in the `···` menu.
     */
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
        contractVersion: 1,
        ...(extraKeys === undefined ? {} : { extraKeys }),
      });
    },
  };
}

export {
  createAgentHandle,
  createAgentRegistry,
  installAgentBridge,
  toCommandView,
} from "./runtime";
export type { AgentRuntimeOptions } from "./runtime";
export { AGENT_MARKER, AGENT_PROTOCOL_VERSION, DEFAULT_GLOBAL_NAME } from "./types";
export type {
  AgentCommandView,
  AgentHandle,
  AgentRegistry,
  AgentRunResult,
  AgentSnapshot,
} from "./types";
