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
 * It aggregates rather than re-collecting: flags, metrics and session context
 * are already owned by extensions that know more about them, so the snapshot
 * reads the roster via `api.getDiagnostics()` and collects for itself only
 * what no other extension owns — page facts and §3E's `PerformanceObserver`
 * data.
 *
 * What it promises: nothing leaves the machine until copy/download is
 * pressed, and the panel shows exactly that text beforehand; redaction
 * happens once on the way in, so panel/clipboard/download/commands all read
 * the same already-redacted object; a contributing extension that throws or
 * fails to serialise gets a visible status rather than a silent drop; counts
 * that can't be observed are `null`, never a `0` that reads as "none
 * happened"; and window errors, rejections and patched
 * `console.error`/`console.warn` feed a bounded, grouped tail (see
 * `./console.ts`).
 *
 * Not a security boundary — `redact()` is key/value-shape matching, so a
 * credential under an innocent key can survive. The panel shows you the text
 * because **you** are the last check before it reaches a ticket.
 */
import { createDiagnosticsRuntime } from "./runtime";
import { DiagnosticsChip, DiagnosticsPanel } from "./ui";
import { resolvePresentation, resolveStyleNonce } from "@nejcm/dev-toolbar/kit";
import type { CompactPresentationInput } from "@nejcm/dev-toolbar/kit";
import type { DiagnosticsRuntimeOptions } from "./runtime";
import type {
  AnyToolbarCommand,
  DevToolbarExtension,
  ExtensionRuntimeApi,
  ToolbarAlign,
  ToolbarCommand,
} from "../../core/contract";
import type { ConsoleTailReport, DiagnosticSnapshot, DiagnosticsBarView } from "./types";

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
  /**
   * How the bar control presents itself: a preset, your own icon, a render
   * callback and an accessible-name override. A bare preset is the shorthand —
   * `presentation: "icon-value"`.
   *
   * One control, so each knob is invoked once per render, in the bar and in the
   * `⋮` menu alike, with a narrow {@link DiagnosticsBarView} rather than the
   * store state behind it — four facts the chip paints, kept deliberately
   * minimal because a callback parameter is contravariant and every field here
   * is one that cannot be renamed later. The presets operate on the **short bar
   * word** (`"diagnostics"`): `label` stays the overflow and accessible-name
   * identity, so `"icon-label"` paints `"diagnostics"` in the bar and
   * `"Diagnostics"` in the menu.
   *
   * **The error/warning badge is not yours to restyle.** It sits outside both
   * the preset and `render`, after the contents, under every preset including
   * `"icon"` — it is live state, and the one thing on the chip that says
   * something is wrong. `render` supplies the children of the chip carrying
   * `data-dtb-incomplete` and the dot, so the state attributes,
   * `aria-expanded` and `title` stay the extension's; returning `undefined`
   * falls through to the preset. `name` overrides the `aria-label`, and a
   * whitespace-only return is ignored. Prefer a name that does not change with
   * the *counts* — `(v) => \`Diagnostics ${v.errors}\`` renames the control on
   * every caught error and a screen reader re-announces it.
   *
   * Nothing here reaches the store: the icon and the callbacks are held in this
   * closure and passed as props, because a `ReactNode` cannot be signed.
   *
   * `docs/adr/ADR-004-per-extension-bar-presentation.md`.
   */
  presentation?: CompactPresentationInput<DiagnosticsBarView>;
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
    // Destructured out rather than read off `options`: everything this factory
    // does not name is spread into `createDiagnosticsRuntime` below, and an
    // icon or a callback has no business reaching the runtime.
    presentation: presentationOption,
    ...runtimeOptions
  } = options;

  // Resolved once, here, rather than per render: this is the closure the icon
  // and the callbacks live in, exactly as `label` and `injectStyles` do.
  const presentation = resolvePresentation(presentationOption);

  // Built here, not in start(api): slot functions run on the toolbar's first
  // render, before any effect fires, and a persisted open panel needs it then.
  const runtime = createDiagnosticsRuntime({ ...runtimeOptions, id });

  // Contributed only while the tail is capturing — same rule as /ext/metrics'
  // `network.*` commands: an always-listed command that can only answer
  // "turned off" is worse than an absent one; `diagnostics()` still reports
  // the status either way.
  const consoleCommands: AnyToolbarCommand[] =
    runtime.tail(0).status === "disabled"
      ? []
      : [
          {
            id: `${id}.console.export`,
            label: "Export the console error tail",
            description:
              "Returns what went wrong on the way here: `window` errors, unhandled " +
              "rejections and patched `console.error`/`console.warn`, newest first. " +
              "Repeats of one message share an entry and raise its `count`, so a render " +
              "loop is one row with a number on it. `console.log` is never captured. " +
              "Every message was masked argument by argument as it was captured — object " +
              "arguments walked by `redact()`, strings matched by value shape and every " +
              "URL in them masked — and this is the same report the snapshot carries, not " +
              "a second, rawer copy of it. A stack is included where there was one, " +
              "scanned for known credential shapes before the length cap. Headers " +
              "are included; a Digest match masks the remaining stack. " +
              "`errors`, `warnings` and `dropped` are `null` rather than `0` when nothing " +
              "was being watched. Omit `limit` for every retained entry.",
            group: "Diagnostics",
            keywords: ["console", "errors", "warnings", "tail", "export", "bug", "report"],
            input: {
              fields: {
                limit: {
                  type: "number",
                  description: "Keep only the newest N grouped entries. Omit for all of them.",
                },
              },
            },
            run: (input) => {
              const { limit } = input ?? {};
              if (limit !== undefined && (typeof limit !== "number" || !Number.isFinite(limit))) {
                throw new Error("`limit` must be a finite number.");
              }
              return runtime.tail(limit);
            },
          } satisfies ToolbarCommand<{ limit?: number } | void, ConsoleTailReport>,
          {
            id: `${id}.console.clear`,
            label: "Clear the console error tail",
            description:
              "Drops every captured message and zeroes the counters on the chip. " +
              "Capture continues; the next error starts a fresh tail. Nothing else " +
              "in the snapshot is affected.",
            group: "Diagnostics",
            keywords: ["console", "errors", "clear", "reset", "tail"],
            run: () => runtime.clearTail(),
          } satisfies ToolbarCommand,
        ];

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
        presentation={presentation}
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
     * A **summary** of the last capture — never the snapshot itself
     * (`plans/agent-readable-toolbar.md` § Phase 1): the snapshot is built
     * *from* `api.getDiagnostics()`, so returning it here would make every
     * roster read quadratic. The gather step skips its own id, so this
     * summary never appears in the bug report itself.
     */
    diagnostics: () => runtime.summary(),

    /**
     * `capture` freezes state now for reading later; it does not copy. The
     * copy/download commands re-capture fresh rather than reuse a stale
     * snapshot. A command can't open its own panel — core owns
     * single-active-panel state.
     */
    commands: [
      /**
       * The one command that returns something (contract v2) — it resolves
       * the captured, already-redacted snapshot, so a caller not looking at
       * the panel can still read back what a capture produced.
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
      ...consoleCommands,
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
export { DEFAULT_MESSAGE_CHARS, DEFAULT_STACK_CHARS, DEFAULT_TAIL_SIZE } from "./console";
export type { ConsoleTail, ConsoleTailDeps, ConsoleTailOptions } from "./console";
export { createConsoleTail } from "./console";
export { NO_SNAPSHOT, SNAPSHOT_FORMATS, describeSupport, describeTail } from "./types";
export type {
  ConsoleTailCounts,
  ConsoleTailEntry,
  ConsoleTailLevel,
  ConsoleTailReport,
  ConsoleTailSource,
  ConsoleTailStatus,
  ContributionStatus,
  DiagnosticContribution,
  DiagnosticOmission,
  DiagnosticSnapshot,
  DiagnosticSource,
  DiagnosticsBarView,
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
