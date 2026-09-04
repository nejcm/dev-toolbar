/**
 * `@nejcm/dev-toolbar/ext/diagnostics`
 *
 * §3J's diagnostic snapshot for bug reports, plus §3E's long-task and
 * responsiveness data. Written strictly as a consumer of the public extension
 * contract: nothing here imports a *value* from `src/core/*`, only types.
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
 * Flags, metrics and session context are already owned by extensions that
 * know more about them than this one could, so the snapshot *asks*: core
 * aggregates `DevToolbarExtension.diagnostics()` the way it aggregates
 * `commands`, and this extension reads the roster via `api.getDiagnostics()`.
 * It collects for itself only what no other extension owns — page facts and
 * §3E's `PerformanceObserver` data.
 *
 * ## What it promises
 *
 * - **Nothing leaves the machine on its own.** The panel shows the exact text
 *   the copy/download buttons would produce, before either is pressed.
 * - **Redaction happens on the way in**, once — panel, clipboard, download and
 *   every command read the same already-redacted object (§11.3: serialise
 *   before redacting and nested keys become invisible to the matcher).
 * - **Omissions are visible.** A contributing extension that throws or fails
 *   to serialise gets a status, a line in top-level `omissions`, a panel
 *   banner and a Markdown heading — never a silent drop.
 * - **It never claims to know what it does not.** §3E entry types vary by
 *   engine, so counts are `null` rather than `0` when unobservable, each with
 *   a note explaining why.
 *
 * ## What it is not
 *
 * Not a security boundary — `redact()` is key/value-shape matching, so a
 * credential under an innocent key can survive. The panel shows you the text
 * because **you** are the last check before it reaches a ticket.
 */
import { createDiagnosticsRuntime } from "./runtime";
import { DiagnosticsChip, DiagnosticsPanel } from "./ui";
import { resolveStyleNonce } from "@nejcm/dev-toolbar/kit";
import type { DiagnosticsRuntimeOptions } from "./runtime";
import type {
  DevToolbarExtension,
  ExtensionRuntimeApi,
  ToolbarAlign,
  ToolbarCommand,
} from "../../core/contract";
import type { DiagnosticSnapshot } from "./types";

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
   * from the `⋮` menu and from the command palette when the chip collapses.
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
   * Inject this extension's stylesheets. Default `true`. Core's own
   * `injectStyles` prop is not visible to extensions, so if you turned that off
   * turn this off too and ship the self-contained `DIAGNOSTICS_CSS` yourself.
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
    styleNonce: optionNonce,
    ...runtimeOptions
  } = options;

  // Built here, not in start(api): slot functions run on the toolbar's first
  // render, before any effect fires, and a persisted open panel needs it then.
  const runtime = createDiagnosticsRuntime({ ...runtimeOptions, id });

  return {
    id,
    label,
    contractVersion: 2,
    align,
    order,
    priority,
    keepMounted,
    ...(hidden === undefined ? {} : { hidden }),

    start(api: ExtensionRuntimeApi) {
      return runtime.start(api);
    },

    compact: ({ isOverflowed, isPanelOpen, togglePanel, styleNonce }) => (
      <DiagnosticsChip
        runtime={runtime}
        label={label}
        isOverflowed={isOverflowed}
        isPanelOpen={isPanelOpen}
        injectStyles={injectStyles}
        styleNonce={resolveStyleNonce(optionNonce, styleNonce)}
        onToggle={togglePanel}
      />
    ),

    panel: ({ styleNonce }) => (
      <DiagnosticsPanel
        runtime={runtime}
        label={label}
        injectStyles={injectStyles}
        styleNonce={resolveStyleNonce(optionNonce, styleNonce)}
      />
    ),

    /**
     * A **summary** of the last capture — `capturedAt`, `revision`, how many
     * contributions and how many omissions — never the snapshot itself
     * (`plans/agent-readable-toolbar.md` § Phase 1).
     *
     * The snapshot is built *from* `api.getDiagnostics()`, so returning it
     * here would make every roster read quadratic and embed one snapshot
     * inside the next. The full object stays reachable through the commands
     * below.
     *
     * The gather step skips its own id, so this summary never appears in the
     * bug report; it is published for the readers that enumerate the roster
     * directly — `/ext/agent`, and anything else built on
     * `api.getDiagnostics()`.
     */
    diagnostics: () => runtime.summary(),

    /**
     * Four commands. `capture` freezes state now (mid-repro) for reading
     * later; it does not copy. The copy/download commands re-capture fresh
     * rather than reuse a stale snapshot, and since redaction happens on the
     * way in, `runtime.copy()` can only ever reach the same masked object the
     * panel renders — a blind copy is still one you can go back and read,
     * because every command captures into the same store the panel shows.
     *
     * (A command can't open its own panel — `ExtensionRuntimeApi` exposes no
     * panel control, since core owns single-active-panel state.)
     */
    commands: [
      /**
       * The one command that returns something (contract v2). It writes to
       * this extension's own store, so before v2 a caller who was not looking
       * at the panel had no way to read back what it produced — the plan's
       * "dead end for a tool call". It now resolves the captured snapshot,
       * which is already redacted on the way in, so this is not a second path
       * around the panel's masks.
       */
      {
        id: `${id}.capture`,
        label: "Capture a diagnostic snapshot",
        description:
          "Freezes the current state — page facts, long tasks, and every extension's " +
          "contribution — and resolves the captured snapshot. Already redacted.",
        group: "Diagnostics",
        keywords: ["debug", "report", "bug", "snapshot", "longtask"],
        run: () => runtime.capture(),
      } satisfies ToolbarCommand<void, DiagnosticSnapshot>,
      {
        id: `${id}.copy`,
        label: "Copy diagnostic snapshot (Markdown)",
        group: "Diagnostics",
        keywords: ["debug", "report", "bug", "clipboard", "markdown"],
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
        // Throws rather than failing silently, per §13.4.
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
