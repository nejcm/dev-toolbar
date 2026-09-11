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
 * `hidden` stops `start()` entirely (`useExtensionLifecycle.ts`), taking the global with
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
import { useEffect } from "react";
import {
  ensureKitStyles,
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
 * Every other extension passes its store's snapshot; this one has no store —
 * the bridge publishes to a global, not to a React surface — so there is no
 * snapshot to pass and nothing about the chip changes after the factory runs.
 * Rather than hand a callback `void` or `undefined`, it gets the four facts the
 * chip *is*: the configured `label`, whether running is allowed, and which
 * global and instance this bridge is keyed under. `allowRun` is the one worth
 * branching on — `icon: (view) => (view.allowRun ? <Armed /> : <ReadOnly />)`
 * paints the distinction the `data-dtb-agent-mode` attribute already carries.
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
 * The agent chip's presentation: an icon, and an accessible name to go with it.
 *
 * **Two knobs, not four.** The other seven extensions take the whole
 * `CompactPresentation` — `preset`, `icon`, `render` and `name` — because they
 * have a value, a short bar word and a full label for a preset to select
 * between. This chip has one text and no value, so every preset member but
 * `"default"` would be a no-op or a lie, and a `render` callback over a view
 * that never changes is a `ReactNode` with extra steps. Publishing them anyway
 * would be publishing knobs that silently do nothing, so the type is
 * `Pick`ed down to the two that act (`plans/bar-presentation-icons-v1.md`,
 * group C; `docs/adr/ADR-004-per-extension-bar-presentation.md`).
 *
 * It stays a `Pick` of the shared interface rather than a lookalike of its own,
 * so `icon` and `name` mean here exactly what they mean on the other eight and
 * a widening later is additive.
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
  /**
   * Your own icon for the bar chip, and the accessible name that goes with it.
   * Two knobs rather than the four the value-bearing extensions take; see
   * {@link AgentPresentation} for why.
   *
   * Supplying an icon **replaces the label** in the bar: this chip is a
   * readout, so an icon and a word side by side say the same thing twice in the
   * width the bar is short of. The `⋮` menu keeps the word and puts the icon
   * before it, which is the same "the menu is never wordless" rule `/kit`
   * enforces for every preset.
   *
   * With an icon the chip becomes `role="img"` with an `aria-label`, because a
   * bare `<span aria-label>` is **not** a named node — the attribute would be
   * ignored and the chip would be announced by its `title`, or by nothing.
   * Without one it stays the role-less span it has always been, named by its
   * own text: adding a role there would change what every screen reader already
   * reads out.
   *
   * Nothing here reaches the bridge. The icon lives in this factory's closure,
   * exactly as `label` does, so no `ReactNode` can reach `read()` or the
   * `report` transport — both of which must stay JSON.
   */
  presentation?: AgentPresentation;
  /**
   * Inject `KIT_CSS` while an icon is on the bar. Default `true`.
   *
   * This extension has no stylesheet of its own and still does not — the chip
   * is a plain trigger, and the surface it exists for is a global. An icon is
   * the one thing it paints that needs a rule: `/kit`'s glyph clamp, which is
   * what stops a 24px `<svg>` setting the bar's height. Every other extension
   * carries `KIT_CSS` on the front of its own sheet; with none to carry it,
   * this ensures kit's directly, and only when there is an icon to clamp.
   *
   * Turn it off if you turned off core's `injectStyles` and ship the toolbar's
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
  /**
   * Overflow collapse order — **lowest collapses first**. Default `-1`, below
   * core's default of `0`, so this chip yields the bar before any ordinary
   * extension does. Nothing is lost when it does: the bridge is not its chip.
   */
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
 * A component rather than more JSX in the slot, for one reason: the glyph clamp
 * lives in `KIT_CSS`, injection is an effect everywhere in this codebase, and a
 * slot function has nowhere to put one. Declared at module scope, never inside
 * the slot — `react/no-unstable-nested-components` is an error here, and a
 * component redeclared per render would remount the icon on every tick.
 *
 * It is deliberately not the no-icon path as well: that chip must stay the
 * exact span it has always been, and it needs no stylesheet to be it.
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
      // `role="img"` is what makes the `aria-label` count: an attribute on a
      // role-less span names nothing, which is exactly how this chip came to be
      // exempt from the "named by an attribute" rule in
      // `src/ext/__tests__/presentation.test.tsx` while it had no icon. The
      // role also hides the `⋮` row's duplicate word from the announcement.
      role="img"
      aria-label={resolveAccessibleName(presentation.name, view, view.label)}
      title={title}
    >
      {/* `parts.icon` is true under a branch that has already proved the icon
          paintable, which is `renderCompactParts`' precondition met by
          construction rather than through a parts table this chip has no preset
          to fill. The `⋮` row keeps the word and puts the icon before it. */}
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

  // Resolved once, here, rather than per render: this closure is where an icon
  // and a name callback live, exactly as `label` and `allowRun` do.
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
      // The same `undefined | null` guard the kit `Chip` applies to its slots,
      // and the reason this is a branch rather than a parts table: with no icon
      // the chip is the span it has always been, down to the byte — no role, no
      // `aria-label`, and the label as a bare text child rather than wrapped.
      if (icon === undefined || icon === null) {
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
