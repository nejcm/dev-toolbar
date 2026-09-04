/**
 * `@nejcm/dev-toolbar/ext/environment`
 *
 * Environment, build and authenticated-actor context, per `plans/dev-bar.md`
 * §3B. Consumes only the public extension contract — no value import from
 * `src/core/*`, types only, which erase at build time.
 *
 * Everything shown is **supplied by you**: no `process.env`, no globals — the
 * only self-detected facts are route/viewport/connection, labelled `detected`
 * so they're never mistaken for deployment-asserted values. Supply nothing and
 * it says `unknown`.
 *
 * ```tsx
 * import { environment } from "@nejcm/dev-toolbar/ext/environment";
 *
 * // Build it ONCE, outside render.
 * const extensions = [
 *   environment({
 *     context: {
 *       environment: "staging",
 *       release: __RELEASE__,
 *       commit: __COMMIT__,
 *       userId: user.id,
 *       impersonating: session.impersonating,
 *     },
 *   }),
 * ];
 * ```
 *
 * Per §6, so a leak is never the default:
 * - every value goes through `redact()` from `/runtime` on the way in, plus
 *   email masking; the panel and clipboard read the same redacted snapshot;
 * - masking is **visible** — a masked row is tagged `masked` and counted next
 *   to the copy buttons — since unseen redaction looks identical to "never supplied".
 *
 * For a restricted view, pass `fields` (an allowlist — everything else is
 * dropped, not hidden, `extra:<key>` entries included), or compute `hidden`
 * yourself and leave the extension out of the array entirely.
 */
import { writeClipboardTextOrThrow } from "../../runtime";
import { createEnvironmentRuntime } from "./runtime";
import { EnvironmentChip, EnvironmentPanel } from "./ui";
import type { EnvironmentContextInput, EnvironmentRuntimeOptions } from "./runtime";
import type { DevToolbarExtension, ExtensionRuntimeApi, ToolbarAlign } from "../../core/contract";

export interface EnvironmentOptions extends Pick<
  EnvironmentRuntimeOptions,
  "pollMs" | "fields" | "detect" | "maskPii" | "redactOptions"
> {
  /** Extension id. Default `"environment"`. */
  id?: string;
  /** Bar label, used by the chip. Default `"Environment"`. */
  label?: string;
  align?: ToolbarAlign;
  order?: number;
  priority?: number;
  hidden?: boolean;
  /**
   * What you know. An object, or a function re-read every `pollMs` for values
   * that change (a sync status, a switched workspace).
   */
  context?: EnvironmentContextInput;
  /**
   * Inject this extension's stylesheet. Default `true`. Not tied to core's own
   * `injectStyles` prop — turn both off and ship `ENVIRONMENT_CSS` yourself.
   */
  injectStyles?: boolean;
  /**
   * CSP nonce for this extension's stylesheet. Wins over the `styleNonce`
   * slot prop core forwards from `<DevToolbar>`.
   */
  styleNonce?: string;
}

/**
 * Builds the extension. Call it once — the returned object owns the store and,
 * once started, the listeners.
 */
export function environment(options: EnvironmentOptions = {}): DevToolbarExtension {
  const {
    id = "environment",
    label = "Environment",
    align = "start",
    order = 0,
    priority = 0,
    hidden,
    injectStyles = true,
    styleNonce: optionNonce,
    context,
    pollMs,
    fields,
    detect,
    maskPii,
    redactOptions,
  } = options;

  // Built here, not in start(api): slot functions run before any effect fires.
  const runtime = createEnvironmentRuntime({
    context,
    pollMs,
    fields,
    detect,
    maskPii,
    redactOptions,
  });

  return {
    id,
    label,
    contractVersion: 2,
    align,
    order,
    priority,
    ...(hidden === undefined ? {} : { hidden }),

    start(api: ExtensionRuntimeApi) {
      return runtime.start(api);
    },

    compact: ({ isOverflowed, isPanelOpen, togglePanel, styleNonce }) => (
      <EnvironmentChip
        runtime={runtime}
        label={label}
        isOverflowed={isOverflowed}
        isPanelOpen={isPanelOpen}
        injectStyles={injectStyles}
        styleNonce={optionNonce || styleNonce}
        onToggle={togglePanel}
      />
    ),

    /**
     * The redacted snapshot, for `/ext/diagnostics` — **P3**. Same builder as
     * `environment.copyJson`, so a bug-report aggregator can't fetch what the
     * panel wouldn't show.
     */
    diagnostics: () => runtime.diagnostics(),

    panel: ({ styleNonce }) => (
      <EnvironmentPanel
        runtime={runtime}
        injectStyles={injectStyles}
        styleNonce={optionNonce || styleNonce}
      />
    ),

    commands: [
      {
        id: `${id}.copy`,
        label: "Copy environment summary",
        group: "Environment",
        keywords: ["release", "commit", "clipboard", "context"],
        // Same redacted snapshot the panel renders, so `runCommand("environment.copy")`
        // can't bypass the UI's masking. `/runtime`'s writer throws on failed writes,
        // which the palette reports (§13.4).
        run: async () => {
          await writeClipboardTextOrThrow(runtime.snapshotText());
        },
      },
      {
        id: `${id}.copyJson`,
        label: "Copy environment context as JSON",
        group: "Environment",
        keywords: ["diagnostics", "json", "context"],
        run: async () => {
          await writeClipboardTextOrThrow(JSON.stringify(runtime.diagnostics(), null, 2));
        },
      },
      {
        id: `${id}.refresh`,
        label: "Re-read environment context",
        group: "Environment",
        keywords: ["reload", "refresh"],
        run: () => runtime.refresh(),
      },
    ],
  };
}

export { ENVIRONMENT_CSS, ensureEnvironmentStyles } from "./css";
export { createEnvironmentRuntime, maskEmails } from "./runtime";
export type {
  EnvironmentContextInput,
  EnvironmentRuntime,
  EnvironmentRuntimeOptions,
} from "./runtime";
export { FIELD_SPECS, GROUP_LABELS, severityForKind } from "./types";
export type {
  EnvironmentContext,
  EnvironmentFieldId,
  EnvironmentFieldView,
  EnvironmentGroup,
  EnvironmentKind,
  EnvironmentSeverity,
  EnvironmentSnapshot,
  ImpersonationContext,
} from "./types";
