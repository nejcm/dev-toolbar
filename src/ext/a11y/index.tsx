/**
 * `@nejcm/dev-toolbar/ext/a11y`
 *
 * axe-core on the bar: a scan you ask for, violations grouped by impact, and
 * click-to-highlight over the page. Consumes only the public extension
 * contract — no `src/core/*` value imports, types only.
 *
 * ```tsx
 * import { a11y } from "@nejcm/dev-toolbar/ext/a11y";
 *
 * // Build it ONCE, outside render.
 * const extensions = [a11y({ rules: { "color-contrast": { enabled: false } } })];
 * ```
 *
 * **axe-core is an optional peer, not a dependency.** It is loaded with
 * `import("axe-core")` when the extension starts — or, with `loadOn: "scan"`,
 * not until the first scan; a consumer who has not installed it gets the
 * `"unsupported"` state — the same word `/ext/metrics` uses for a missing
 * platform API — and nothing throws. Installing it is not free: axe-core is
 * roughly 550 KB and a supply-chain surface of its own, so this is the one
 * place in the package where "zero runtime dependencies" is true of the
 * package and still costs the consumer something.
 *
 * **Nothing runs on a timer.** A full-document axe pass is expensive, so it
 * happens on a click, a command, or an agent call — never on an interval, and
 * not at mount unless `scanOnStart` says so.
 *
 * The toolbar's own DOM is excluded from the default context: the bar is not
 * the app under test.
 */
import { writeClipboardTextOrThrow } from "@nejcm/dev-toolbar/runtime";
import { resolvePresentation, resolveStyleNonce } from "@nejcm/dev-toolbar/kit";
import { DEFAULT_LOAD_ON, createA11yRuntime } from "./runtime";
import { A11yChip, A11yPanel, A11ySurface } from "./ui";
import type { CompactPresentationInput } from "@nejcm/dev-toolbar/kit";
import type { A11yRuntimeOptions } from "./runtime";
import type { A11yReport } from "./types";
import type {
  AnyToolbarCommand,
  DevToolbarExtension,
  ExtensionRuntimeApi,
  ToolbarAlign,
  ToolbarCommand,
} from "../../core/contract";

export interface A11yOptions extends A11yRuntimeOptions {
  /** Extension id. Default `"a11y"`. */
  id?: string;
  /** Bar label, used by the error chip and the panel's accessible name. Default `"Accessibility"`. */
  label?: string;
  align?: ToolbarAlign;
  order?: number;
  /**
   * Overflow collapse order. Default `15` — low: a scan is something you go
   * looking for, and it stays reachable from `⋮` and the command palette.
   */
  priority?: number;
  hidden?: boolean;
  /**
   * Keep the panel mounted after it closes. Default `true`, as in `/ext/flags`
   * and `/ext/theme-editor`. The report lives in the runtime, not the panel, so
   * this preserves the groups list's scroll position rather than the scan.
   */
  keepMounted?: boolean;
  /**
   * Inject this extension's stylesheet. Default `true`. If core's
   * `injectStyles` is off, turn this off too and ship `A11Y_CSS` yourself.
   */
  injectStyles?: boolean;
  /**
   * CSP nonce for this extension's stylesheet. Wins over the `styleNonce` slot
   * prop core forwards from `<DevToolbar>`.
   */
  styleNonce?: string;
  /**
   * How the bar control presents itself: a preset, your own icon, a render
   * callback, and an accessible-name override. A bare preset is shorthand —
   * `presentation: "icon-value"`.
   *
   * Each knob is invoked once per render, in the bar and the `⋮` menu alike,
   * with the same `A11yReport` the panel and `diagnostics()` read. Presets
   * operate on the short bar word (`"a11y"`): `label` stays the overflow and
   * accessible-name identity, so `"icon-label"` paints `"a11y"` in the bar and
   * `"Accessibility"` in the menu.
   *
   * `render` supplies the chip's children; the state attributes,
   * `aria-expanded` and `title` stay the extension's. Returning `undefined`
   * falls through to the preset. `name` overrides `aria-label` (a
   * whitespace-only return is ignored) — prefer a name that doesn't change
   * with the report's `total`, or a screen reader re-announces it every scan.
   *
   * The report is serialised for "copy" and for `diagnostics()`, so the icon and
   * callbacks live in this closure and travel as props, never into the snapshot.
   *
   * `docs/adr/ADR-004-per-extension-bar-presentation.md`.
   */
  presentation?: CompactPresentationInput<A11yReport>;
}

/** Builds the extension. Call it once — the returned object owns the store and the scan state. */
export function a11y(options: A11yOptions = {}): DevToolbarExtension {
  const {
    id = "a11y",
    label = "Accessibility",
    align = "end",
    order = 15,
    priority = 15,
    hidden,
    keepMounted = true,
    injectStyles = true,
    styleNonce: optionNonce,
    // Pulled out so it isn't spread into `createA11yRuntime` below with the
    // rest of `options`.
    presentation: presentationOption,
    ...runtimeOptions
  } = options;

  // Resolved once here — the closure the icon and callbacks live in, like
  // `label` and `injectStyles`.
  const presentation = resolvePresentation(presentationOption);

  const runtime = createA11yRuntime(runtimeOptions);
  const loadOn = runtimeOptions.loadOn ?? DEFAULT_LOAD_ON;

  const scanCommand: ToolbarCommand<void, A11yReport> = {
    id: `${id}.scan`,
    label: "Scan this page for accessibility violations",
    description:
      "Runs axe-core once, now, over the app (the toolbar's own DOM is excluded). " +
      "Resolves with the same report the panel renders and `diagnostics()` returns: " +
      "violations grouped by impact, already masked. Expensive — tens of milliseconds " +
      "on a small page, seconds on a large one — and never run on a timer. Reports " +
      '`status: "unsupported"` when the optional `axe-core` peer is not installed.',
    group: "Accessibility",
    keywords: ["a11y", "axe", "accessibility", "scan", "audit"],
    run: () => runtime.scan(),
  };

  const exportCommand: ToolbarCommand<{ copy?: boolean } | void, A11yReport> = {
    id: `${id}.export`,
    label: "Export the last accessibility scan",
    description:
      "Returns the last report without scanning — the object the panel is rendering. " +
      "`copy: true` also writes it to the clipboard as JSON. Read `status` first: " +
      "`pending` means nothing has been scanned yet.",
    group: "Accessibility",
    keywords: ["a11y", "axe", "export", "json", "report", "clipboard"],
    input: {
      fields: {
        copy: {
          type: "boolean",
          default: false,
          description:
            "Also write the JSON to the clipboard. The report is the return value either way.",
        },
      },
    },
    run: async (input) => {
      const copy = input?.copy;
      if (copy !== undefined && typeof copy !== "boolean") {
        throw new Error("`copy` must be a boolean.");
      }
      const report = runtime.report();
      if (copy === true) {
        await writeClipboardTextOrThrow(
          JSON.stringify(report, null, 2),
          "The report is this command's return value; copy it from there.",
        );
      }
      return report;
    },
  };

  const highlightCommand: ToolbarCommand<{ rule?: string; node?: number } | void, A11yReport> = {
    id: `${id}.highlight`,
    label: "Highlight a flagged element",
    description:
      "Draws a box over one element from the last scan, below the bar and taking no " +
      "pointer events. `rule` is a violated rule id and `node` its zero-based index " +
      "within that rule's *listed* elements — at most `nodeLimit` of them, default " +
      "`5`, however large `nodeCount` is. Omit `rule` to clear the highlight; a rule " +
      "or an index the last report does not list clears it too. An element inside " +
      "an open shadow root can be highlighted; one axe reached through an iframe " +
      "cannot.",
    group: "Accessibility",
    keywords: ["a11y", "axe", "highlight", "inspect", "element"],
    input: {
      fields: {
        rule: {
          type: "string",
          description: "Violated rule id, e.g. `color-contrast`. Omit to clear the highlight.",
        },
        node: {
          type: "number",
          default: 0,
          description:
            "Zero-based index into that rule's listed elements. An index the report " +
            "does not list clears the highlight instead.",
        },
      },
    },
    run: (input) => {
      const rule = input?.rule;
      const node = input?.node ?? 0;
      if (rule !== undefined && typeof rule !== "string") {
        throw new Error("`rule` must be a string, or omitted to clear the highlight.");
      }
      if (!Number.isInteger(node) || node < 0) {
        throw new Error("`node` must be a non-negative integer.");
      }
      return runtime.select(rule === undefined ? null : `${rule}#${node}`);
    },
  };

  const clearCommand: ToolbarCommand<void, A11yReport> = {
    id: `${id}.clear`,
    label: "Clear the accessibility scan",
    description:
      "Drops the last report and the highlight, returning the extension to `pending`. " +
      "Nothing is re-scanned; the scan count survives so a reader can tell " +
      '"never scanned" from "cleared". A scan already in flight is disowned — it ' +
      "runs to completion and its result is thrown away.",
    group: "Accessibility",
    keywords: ["a11y", "axe", "clear", "reset"],
    run: () => runtime.clear(),
  };

  const commands: AnyToolbarCommand[] = [
    scanCommand,
    exportCommand,
    highlightCommand,
    clearCommand,
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

    /** The report — the same object the panel renders. */
    diagnostics: () => runtime.diagnostics(),

    compact: ({ isOverflowed, isPanelOpen, togglePanel, styleNonce }) => (
      <A11yChip
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
      <A11yPanel
        runtime={runtime}
        label={label}
        loadOn={loadOn}
        injectStyles={injectStyles}
        styleNonce={resolveStyleNonce(optionNonce, styleNonce)}
      />
    ),

    overlay: ({ styleNonce }) => (
      <A11ySurface
        runtime={runtime}
        injectStyles={injectStyles}
        styleNonce={resolveStyleNonce(optionNonce, styleNonce)}
      />
    ),

    commands,
  };
}

export { A11Y_CSS, ensureA11yStyles } from "./css";
export { DEFAULT_NODE_LIMIT, TOOLBAR_EXCLUDE, createA11yRuntime } from "./runtime";
export type { A11yRuntime, A11yRuntimeOptions } from "./runtime";
export {
  A11Y_MARKER,
  IMPACTS,
  IMPACT_SEVERITY,
  NO_COUNTS,
  emptyReport,
  isImpact,
  selectionKey,
  worstImpact,
} from "./types";
export type {
  A11yGroupView,
  A11yHighlightView,
  A11yNodeView,
  A11yReport,
  A11ySnapshot,
  A11yViolationView,
  AxeLike,
  Impact,
  RectLike,
  ScanStatus,
} from "./types";
