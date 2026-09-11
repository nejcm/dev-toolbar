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
import { useEffect } from "react";
import {
  ensureKitStyles,
  hasPaintableIcon,
  renderCompactParts,
  resolveAccessibleName,
  resolveIcon,
  resolvePresentation,
  resolveStyleNonce,
} from "@nejcm/dev-toolbar/kit";
import { installAgentBridge } from "./runtime";
import type { ReactNode } from "react";
import type { CompactPresentation, ResolvedCompactPresentation } from "@nejcm/dev-toolbar/kit";
import type { AgentReportOptions } from "./report";
import { DEFAULT_GLOBAL_NAME } from "./types";
import type { DevToolbarExtension, ExtensionRuntimeApi, ToolbarAlign } from "../../core/contract";

/**
 * What this chip is built from, and all a presentation knob is handed.
 *
 * Every other extension passes its store's snapshot; this one has none — the
 * bridge publishes to a global, not a React surface — so it gets the four
 * facts the chip *is* instead: `label`, `allowRun`, and the global/instance
 * key. `allowRun` is the one worth branching on —
 * `icon: (view) => (view.allowRun ? <Armed /> : <ReadOnly />)` paints the
 * distinction `data-dtb-agent-mode` already carries.
 */
export interface AgentChipView {
  /** The configured `label`. Default `"Agent"`. */
  label: string;
  /** Mirrors `AgentBridgeOptions.allowRun`, as the published snapshot does. */
  allowRun: boolean;
  /** The global the bridge publishes on. */
  globalName: string;
  /** The `instanceId` this bridge's handle is keyed under. */
  instanceId: string;
}

/**
 * The agent chip's presentation: an icon, and an accessible name to go with
 * it. Two knobs, not four — this chip has one text and no value, so `preset`
 * and `render` would be a no-op or a lie here, unlike the other seven
 * extensions' `CompactPresentation` (`plans/bar-presentation-icons-v1.md`,
 * group C; `docs/adr/ADR-004-per-extension-bar-presentation.md`).
 *
 * A `Pick` of the shared interface, not a lookalike, so `icon` and `name`
 * mean exactly what they mean on the other eight and widening later is
 * additive.
 */
export type AgentPresentation = Pick<CompactPresentation<AgentChipView>, "icon" | "name">;

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
  /**
   * Your own icon for the bar chip, and the accessible name to go with it.
   * Two knobs, not the four value-bearing extensions take; see
   * {@link AgentPresentation}.
   *
   * Supplying an icon **replaces the label** in the bar — an icon and a word
   * side by side would say the same thing twice in the space the bar is
   * short of. The `⋮` menu keeps the word and puts the icon before it.
   *
   * With an icon the chip becomes `role="img"` with an `aria-label`, since a
   * bare `<span aria-label>` names nothing — the chip would fall back to its
   * `title`, or to nothing. Without one it stays the role-less span it has
   * always been, named by its own text.
   *
   * The icon lives in this factory's closure, like `label`, so no `ReactNode`
   * reaches `read()` or the `report` transport — both of which must stay
   * JSON.
   */
  presentation?: AgentPresentation;
  /**
   * Inject `KIT_CSS` while an icon is on the bar. Default `true`.
   *
   * This extension has no stylesheet of its own — an icon is the only thing
   * it paints that needs one: `/kit`'s glyph clamp, which stops a 24px
   * `<svg>` from setting the bar's height. Other extensions carry `KIT_CSS`
   * on their own sheet; this injects it directly, only when there's an icon
   * to clamp.
   *
   * Turn it off if you disabled core's `injectStyles` and ship the toolbar's
   * CSS yourself — `KIT_CSS` is exported from `@nejcm/dev-toolbar/kit`.
   */
  injectStyles?: boolean;
  /**
   * CSP nonce for that stylesheet. Wins over the `styleNonce` slot prop core
   * forwards from `<DevToolbar>`.
   */
  styleNonce?: string;
  align?: ToolbarAlign;
  order?: number;
  /** Overflow collapse order, lowest first. Default `-1`, below core's `0`, so this chip yields the bar before an ordinary extension. */
  priority?: number;
  hidden?: boolean;
}

interface AgentIconChipProps {
  view: AgentChipView;
  presentation: ResolvedCompactPresentation<AgentChipView>;
  /** Already resolved, and already proved paintable by the caller's guard. */
  icon: ReactNode;
  agentMode: string;
  title: string;
  isOverflowed: boolean;
  injectStyles: boolean;
  styleNonce?: string;
}

/**
 * The chip once a consumer has supplied an icon.
 *
 * A component, not more JSX in the slot, because injecting `KIT_CSS` needs an
 * effect and a slot function has nowhere to put one. Declared at module
 * scope — `react/no-unstable-nested-components` is an error here, and a
 * per-render component would remount the icon every tick.
 *
 * Deliberately not shared with the no-icon path: that chip must stay the
 * exact span it has always been, and needs no stylesheet.
 */
function AgentIconChip({
  view,
  presentation,
  icon,
  agentMode,
  title,
  isOverflowed,
  injectStyles,
  styleNonce,
}: AgentIconChipProps): ReactNode {
  useEffect(() => {
    if (injectStyles) ensureKitStyles(undefined, styleNonce);
    // Injectors deduplicate in the document, so re-running on a new nonce is harmless.
  }, [injectStyles, styleNonce]);

  return (
    <span
      data-dtb-part="trigger"
      data-dtb-agent-mode={agentMode}
      // `role="img"` is what makes `aria-label` count — a role-less span
      // names nothing, which is why this chip was exempt from the "named by
      // an attribute" rule in `src/ext/__tests__/presentation.test.tsx`
      // before it had an icon. The role also hides the `⋮` row's duplicate
      // word from the announcement.
      role="img"
      aria-label={resolveAccessibleName(presentation.name, view, view.label)}
      title={title}
    >
      {/* `parts.icon: true` is safe here — this branch already proved the icon
          paintable, satisfying `renderCompactParts`' precondition by
          construction rather than a parts table (no preset to fill it). The
          `⋮` row keeps the word and puts the icon before it. */}
      {renderCompactParts({
        parts: { icon: true, text: isOverflowed ? "full" : "none", value: false },
        icon,
        iconProps: { "data-dtb-part": "agent-icon" },
        short: view.label,
        full: view.label,
        textProps: { "data-dtb-part": "agent-label" },
      })}
    </span>
  );
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
    presentation: presentationOption,
    injectStyles = true,
    styleNonce: optionNonce,
    align = "end",
    order = 90,
    priority = -1,
    hidden,
  } = options;

  // Resolved once here — the closure where an icon and a name callback live,
  // like `label` and `allowRun`.
  const presentation = resolvePresentation<AgentChipView>(presentationOption);
  const view: AgentChipView = { label, allowRun, globalName, instanceId };
  const agentMode = allowRun ? "run-enabled" : "read-only";
  const title =
    `Agent bridge on ${globalName}.instances[${JSON.stringify(instanceId)}] — ` +
    (allowRun
      ? "reads state and can run commands (allowRun)"
      : "reads state only (allowRun is off)");

  return {
    id,
    label,
    contractVersion: 2,
    align,
    order,
    priority,
    ...(hidden === undefined ? {} : { hidden }),

    compact: ({ isOverflowed, styleNonce }) => {
      const icon = resolveIcon(presentation.icon, view);
      // Kit's emptiness rule: `false`, `true`, `null`, `undefined`, `""` are
      // all "no icon" (React paints nothing for any of them). This is a
      // branch, not a parts table, because with no icon the chip must stay
      // the exact span it always was — no role, no `aria-label`, label as a
      // bare text child. So `icon: (view) => view.busy && <Spinner />` falls
      // back to that span when it declines.
      if (!hasPaintableIcon(icon)) {
        return (
          <span data-dtb-part="trigger" data-dtb-agent-mode={agentMode} title={title}>
            {label}
          </span>
        );
      }
      return (
        <AgentIconChip
          view={view}
          presentation={presentation}
          icon={icon}
          agentMode={agentMode}
          title={title}
          isOverflowed={isOverflowed}
          injectStyles={injectStyles}
          styleNonce={resolveStyleNonce(optionNonce, styleNonce)}
        />
      );
    },

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
