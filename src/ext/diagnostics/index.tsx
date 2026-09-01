/**
 * `@nejcm/dev-toolbar/ext/diagnostics`
 *
 * §3J's diagnostic snapshot — "capture a diagnostic snapshot for a bug report" —
 * with §3E's long-task and responsiveness data as one of its inputs. Written
 * strictly as a consumer of the public extension contract: nothing here imports
 * a *value* from `src/core/*`, only types, which erase at build time.
 *
 * ```tsx
 * import { diagnostics } from "@nejcm/dev-toolbar/ext/diagnostics";
 *
 * // Build it ONCE, outside render.
 * const extensions = [
 *   metrics(),
 *   flags({ ... }),
 *   diagnostics({
 *     app: () => ({ release: __RELEASE__, userId: session.userId }),
 *   }),
 * ];
 * ```
 *
 * ## It aggregates; it does not re-collect
 *
 * §3J's shape lists flags, metrics and session context. Every one of those is
 * already owned by an extension that knows more about it than this one could,
 * and re-deriving them here would produce a second, subtly different answer for
 * every field — the worst possible property in a bug report. So the snapshot
 * *asks*: core aggregates `DevToolbarExtension.diagnostics()` the way it
 * aggregates `commands`, and this extension reads the roster through
 * `api.getDiagnostics()`. What it collects for itself is only what no other
 * extension owns: the page's own facts, and §3E's `PerformanceObserver` data.
 *
 * ## What it promises
 *
 * - **Nothing leaves the machine on its own.** The panel shows the exact text
 *   the copy and download buttons produce, before either is pressed. Reviewing
 *   before sending is the feature.
 * - **Redaction happens on the way in**, once, and the panel, the clipboard,
 *   the download and every command read the same redacted object. §11.3's
 *   order-of-operations trap — serialise before redacting and every nested key
 *   becomes invisible to the key matcher — is what the builder is arranged
 *   around.
 * - **Omissions are visible.** A contributing extension that throws, returns
 *   nothing, or returns something that will not serialise gets a status, a line
 *   in a top-level `omissions` list, a banner in the panel and a heading in the
 *   Markdown. A snapshot that quietly drops the failing extension is worse than
 *   one that says it could not be read: the person holding the ticket cannot
 *   tell the difference between "nothing to report" and "the report is missing".
 * - **It never claims to know what it does not.** §3E's entry types vary by
 *   engine — `longtask` and `layout-shift` are Chromium-only today — so every
 *   count is `null` rather than `0` when it could not be observed, and each
 *   carries a note saying which of the two it is.
 *
 * ## What it is not
 *
 * It is not a security boundary. `redact()` is key- and value-shape matching
 * (see its own documentation), so a credential stored under an innocent key
 * with an innocent shape survives. That is exactly why the panel shows you the
 * text: **you** are the last check before it reaches a ticket.
 */
import { createDiagnosticsRuntime } from "./runtime";
import { DiagnosticsChip, DiagnosticsPanel } from "./ui";
import type { DiagnosticsRuntimeOptions } from "./runtime";
import type { DevToolbarExtension, ExtensionRuntimeApi, ToolbarAlign } from "../../core/contract";

export interface DiagnosticsOptions extends Omit<DiagnosticsRuntimeOptions, "id"> {
  /** Extension id. Default `"diagnostics"`. */
  id?: string;
  /** Bar label, used by the error chip and the panel's accessible name. Default `"Diagnostics"`. */
  label?: string;
  align?: ToolbarAlign;
  order?: number;
  /**
   * Overflow collapse order. Default `10` — low. A snapshot is something you go
   * looking for once, when something is already wrong, and it stays reachable
   * from the `···` menu and from the command palette when the chip collapses.
   */
  priority?: number;
  hidden?: boolean;
  /**
   * Keep the panel mounted after it closes. Default `false`: the captured
   * snapshot lives in the runtime's store, not in the panel, so closing and
   * reopening shows the same snapshot without re-capturing either way.
   */
  keepMounted?: boolean;
  /**
   * Inject this extension's stylesheet. Default `true`. Core's own
   * `injectStyles` prop is not visible to extensions, so if you turned that off
   * turn this off too and ship `DIAGNOSTICS_CSS` yourself.
   */
  injectStyles?: boolean;
}

/**
 * Builds the extension. Call it once — the returned object owns the store and,
 * once started, the `PerformanceObserver`s.
 */
export function diagnostics(options: DiagnosticsOptions = {}): DevToolbarExtension {
  const {
    id = "diagnostics",
    label = "Diagnostics",
    align = "end",
    order = 10,
    priority = 10,
    hidden,
    keepMounted = false,
    injectStyles = true,
    ...runtimeOptions
  } = options;

  // Built here, not in start(api): slot functions run during the toolbar's
  // first render, which is before any effect fires — and a persisted open panel
  // renders on that very first pass.
  const runtime = createDiagnosticsRuntime({ ...runtimeOptions, id });

  return {
    id,
    label,
    contractVersion: 1,
    align,
    order,
    priority,
    keepMounted,
    ...(hidden === undefined ? {} : { hidden }),

    start(api: ExtensionRuntimeApi) {
      return runtime.start(api);
    },

    compact: ({ isOverflowed, isPanelOpen, togglePanel }) => (
      <DiagnosticsChip
        runtime={runtime}
        label={label}
        isOverflowed={isOverflowed}
        isPanelOpen={isPanelOpen}
        injectStyles={injectStyles}
        onToggle={togglePanel}
      />
    ),

    panel: () => <DiagnosticsPanel runtime={runtime} label={label} injectStyles={injectStyles} />,

    /**
     * This extension declares **no** `diagnostics()`, deliberately.
     *
     * It is the reader of the aggregation, not a contributor to it. Declaring
     * one would make the snapshot contain itself — core's `getDiagnostics()`
     * enumerates every present extension, this one included — and the
     * reentrancy guard would then be load-bearing rather than a safety net. The
     * gather step skips its own id for the same reason.
     */

    /**
     * Four commands, and the distinction between the first and the next three
     * is worth stating because an earlier version of these comments got it
     * wrong in both directions.
     *
     * **Reviewing is about the panel's shape, not about forbidding a blind
     * copy.** §3J asks for a one-click *Copy debug report*, and that is
     * defensible here for the reason the whole builder is arranged around:
     * redaction happens on the way in, so `runtime.copy()` can only ever reach
     * the same masked object the panel renders. There is no unredacted path for
     * a command to take.
     *
     * What the panel guarantees is something else — that when you *do* look,
     * you are looking at the exact string that was or will be sent. That
     * survives a blind copy, because every command captures into the same
     * store: the chip updates, and opening the panel afterwards shows precisely
     * what went to the clipboard. A copy you did not read is still a copy you
     * can go and read.
     *
     * `capture` exists separately because the useful moment and the convenient
     * moment differ: freeze the state *now*, mid-repro, and read it when your
     * hands are free. It does not copy because a snapshot taken to be examined
     * is not a snapshot taken to be pasted.
     *
     * (A command cannot open its own panel — `ExtensionRuntimeApi` exposes no
     * panel control, deliberately, since core owns single-active-panel state.
     * Adding one for this would be a contract change for a convenience.)
     */
    commands: [
      {
        id: `${id}.capture`,
        label: "Capture a diagnostic snapshot",
        group: "Diagnostics",
        keywords: ["debug", "report", "bug", "snapshot", "longtask"],
        // Freeze it now; read it in the panel when you are ready.
        run: () => {
          runtime.capture();
        },
      },
      {
        id: `${id}.copy`,
        label: "Copy diagnostic snapshot (Markdown)",
        group: "Diagnostics",
        keywords: ["debug", "report", "bug", "clipboard", "markdown"],
        // Captures fresh rather than copying whatever was last taken: a bug
        // report about *now* is the whole point, and a stale paste is worse
        // than no paste. The capture stays in the store, so the panel can show
        // afterwards exactly what this put on the clipboard.
        run: async () => {
          runtime.capture();
          await runtime.copyOrThrow("markdown");
        },
      },
      {
        id: `${id}.copyJson`,
        label: "Copy diagnostic snapshot (JSON)",
        group: "Diagnostics",
        keywords: ["debug", "report", "bug", "clipboard", "json"],
        run: async () => {
          runtime.capture();
          await runtime.copyOrThrow("json");
        },
      },
      {
        id: `${id}.download`,
        label: "Download diagnostic snapshot (JSON)",
        group: "Diagnostics",
        keywords: ["debug", "report", "bug", "file", "save", "json"],
        // Same signal as the copy commands: a palette entry that reported
        // nothing when the download never started would be a command that
        // silently did nothing, which is what §13.4 exists to prevent.
        run: () => {
          runtime.capture();
          if (!runtime.download("json")) {
            throw new Error(
              "Downloads are unavailable here. Copy the snapshot from the panel instead.",
            );
          }
        },
      },
    ],
  };
}

export {
  FORMAT_KEY,
  TARGET_CONTRACT_VERSION,
  countMasked,
  countOccurrences,
  createDiagnosticsRuntime,
  renderJson,
  renderMarkdown,
  startDownload,
} from "./runtime";
export type {
  AppContextInput,
  DiagnosticsRuntime,
  DiagnosticsRuntimeOptions,
  Revoker,
} from "./runtime";
export { DIAGNOSTICS_CSS, ensureDiagnosticsStyles } from "./css";
export { LONG_TASK_THRESHOLD_MS, createResponsivenessMonitor } from "./responsiveness";
export type { ResponsivenessMonitor, ResponsivenessOptions } from "./responsiveness";
export { NO_SNAPSHOT, SNAPSHOT_FORMATS, describeSupport } from "./types";
export type {
  ContributionStatus,
  DiagnosticContribution,
  DiagnosticOmission,
  DiagnosticSnapshot,
  DiagnosticSource,
  DiagnosticsSnapshotState,
  InteractionReport,
  LayoutShiftReport,
  LongTaskReport,
  LongTaskSample,
  NavigationReport,
  PageReport,
  ResponsivenessReport,
  SnapshotFormat,
  SupportState,
} from "./types";
