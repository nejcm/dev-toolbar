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
import { resolvePresentation, resolveStyleNonce } from "@nejcm/dev-toolbar/kit";
import type { CompactPresentationInput } from "@nejcm/dev-toolbar/kit";
import type { EnvironmentContextInput, EnvironmentRuntimeOptions } from "./runtime";
import type { EnvironmentSnapshot } from "./types";
import type { DevToolbarExtension, ExtensionRuntimeApi, ToolbarAlign } from "../../core/contract";

export interface EnvironmentOptions extends Pick<
  EnvironmentRuntimeOptions,
  "pollMs" | "fields" | "detect" | "maskPii" | "redactOptions"
> {
  /** Extension id. Default `"environment"`. */
  id?: string;
  /** Bar label, used by the chip and its accessible name. Default `"Environment"`. */
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
   * Inject this extension's stylesheets. Default `true`. Not tied to core's own
   * `injectStyles` prop — turn both off and ship the self-contained
   * `ENVIRONMENT_CSS` yourself.
   */
  injectStyles?: boolean;
  /**
   * CSP nonce for this extension's stylesheet. Wins over the `styleNonce`
   * slot prop core forwards from `<DevToolbar>`.
   */
  styleNonce?: string;
  /**
   * How the bar control presents itself: a preset, your own icon, a render
   * callback and an accessible-name override. Bare-preset shorthand:
   * `presentation: "icon-value"`. Callbacks see the redacted
   * `EnvironmentSnapshot`. Presets operate on the short bar word (`"env"`);
   * `label` stays the accessible-name identity. Use the exported
   * `kindLabel(snapshot)` to paint the same value word a preset would.
   *
   * This extension renders two button wrappers — the bar trigger and the `⋮`
   * row (no `aria-expanded`) — both driven by this option identically; the
   * fork is about the element, not the presentation.
   *
   * `render` supplies only the chip's children; state attributes, `title` and
   * the `impersonating` marker stay the extension's. `name` overrides the
   * `aria-label` on both wrappers; a whitespace-only return is ignored.
   *
   * Icon and callbacks are held in this closure and passed as props — a
   * `ReactNode` cannot be signed into a store snapshot.
   *
   * `docs/adr/ADR-004-per-extension-bar-presentation.md`.
   */
  presentation?: CompactPresentationInput<EnvironmentSnapshot>;
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
    presentation: presentationOption,
  } = options;

  // Resolved once, in the closure the icon and callbacks live in.
  const presentation = resolvePresentation(presentationOption);

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
        presentation={presentation}
        isOverflowed={isOverflowed}
        isPanelOpen={isPanelOpen}
        injectStyles={injectStyles}
        styleNonce={resolveStyleNonce(optionNonce, styleNonce)}
        onToggle={togglePanel}
      />
    ),

    /** The redacted snapshot, for `/ext/diagnostics`. Same builder as `environment.copyJson`. */
    diagnostics: () => runtime.diagnostics(),

    panel: ({ styleNonce }) => (
      <EnvironmentPanel
        runtime={runtime}
        injectStyles={injectStyles}
        styleNonce={resolveStyleNonce(optionNonce, styleNonce)}
      />
    ),

    commands: [
      {
        id: `${id}.copy`,
        label: "Copy environment summary",
        group: "Environment",
        keywords: ["release", "commit", "clipboard", "context"],
        // Same redacted snapshot the panel renders, so this command can't bypass masking.
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
export { FIELD_SPECS, GROUP_LABELS, kindLabel, severityForKind } from "./types";
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
