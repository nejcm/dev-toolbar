/**
 * `@nejcm/dev-toolbar/ext/environment`
 *
 * Environment, build and authenticated-actor context, per `plans/dev-bar.md`
 * §3B. Written strictly as a consumer of the public extension contract: nothing
 * here imports a *value* from `src/core/*`, only types, which erase at build
 * time.
 *
 * Everything it displays is **supplied by you**. Core has no `ctx`, this
 * extension does not invent one, it reads no `process.env` and looks for no
 * global — the only things it works out for itself are facts about this browser
 * tab (route, viewport, connection), and those are labelled `detected` so they
 * are never mistaken for something the deployment asserted. Supply nothing and
 * it says `unknown`, which is the honest answer to "which environment am I
 * actually in".
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
 * §6 is guidance, not something core implements, and this extension takes two
 * of its rules seriously so that a leak is never the default:
 *
 * - every consumer-supplied value goes through `redact()` from `/runtime` on
 *   the way in, and email addresses are masked on top of that. The panel and
 *   the clipboard read the same redacted snapshot; there is no unredacted path;
 * - masking is **visible** — a masked row is tagged `masked` in the panel and
 *   counted next to the copy buttons — because a redaction nobody can see is
 *   indistinguishable from a value that was never supplied.
 *
 * For a restricted view, pass `fields` (an allowlist — everything else is
 * dropped, not hidden, `extra:<key>` entries included), or compute `hidden`
 * yourself and leave the extension out of the array entirely.
 */
import { writeClipboardTextOrThrow } from "../../runtime";
import { createEnvironmentRuntime } from "./runtime";
import { EnvironmentChip, EnvironmentPanel } from "./ui";
import type { EnvironmentContextInput, EnvironmentRuntimeOptions } from "./runtime";
import type {
  DevToolbarExtension,
  ExtensionRuntimeApi,
  ToolbarAlign,
} from "../../core/contract";

export interface EnvironmentOptions
  extends Pick<
    EnvironmentRuntimeOptions,
    "pollMs" | "fields" | "detect" | "maskPii" | "redactOptions"
  > {
  /** Extension id. Default `"environment"`. */
  id?: string;
  /** Bar label, used by the error chip and the panel's accessible name. Default `"Environment"`. */
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
   * Inject this extension's stylesheet. Default `true`. Core's own
   * `injectStyles` prop is not visible to extensions, so if you turned that off
   * turn this off too and ship `ENVIRONMENT_CSS` yourself.
   */
  injectStyles?: boolean;
}

/**
 * Builds the extension. Call it once — the returned object owns the store and,
 * once started, the listeners.
 */
export function environment(
  options: EnvironmentOptions = {},
): DevToolbarExtension {
  const {
    id = "environment",
    label = "Environment",
    align = "start",
    order = 0,
    priority = 0,
    hidden,
    injectStyles = true,
    context,
    pollMs,
    fields,
    detect,
    maskPii,
    redactOptions,
  } = options;

  // Built here, not in start(api): slot functions run during the toolbar's
  // first render, which is before any effect fires.
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
    contractVersion: 1,
    align,
    order,
    priority,
    ...(hidden === undefined ? {} : { hidden }),

    start(api: ExtensionRuntimeApi) {
      return runtime.start(api);
    },

    compact: ({ isOverflowed, isPanelOpen, togglePanel }) => (
      <EnvironmentChip
        runtime={runtime}
        label={label}
        isOverflowed={isOverflowed}
        isPanelOpen={isPanelOpen}
        injectStyles={injectStyles}
        onToggle={togglePanel}
      />
    ),

    /**
     * The redacted snapshot, for `/ext/diagnostics` — **P3**. Exactly what the
     * `environment.copyJson` command copies, from exactly the same builder: a
     * bug-report aggregator is a third front door onto this data, and it must
     * not be able to fetch what the panel would not show.
     */
    diagnostics: () => runtime.diagnostics(),

    panel: () => (
      <EnvironmentPanel
        runtime={runtime}
        label={label}
        injectStyles={injectStyles}
      />
    ),

    commands: [
      {
        id: `${id}.copy`,
        label: "Copy environment summary",
        group: "Environment",
        keywords: ["release", "commit", "clipboard", "context"],
        // Same redacted snapshot the panel renders. A command is a front door:
        // if this read the raw context, `runCommand("environment.copy")` would
        // be a way around every mask in the UI.
        // `/runtime`'s writer, which throws when the write did not happen:
        // the palette reports a throw and closes over a resolve (§13.4).
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
          await writeClipboardTextOrThrow(
            JSON.stringify(runtime.diagnostics(), null, 2),
          );
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
