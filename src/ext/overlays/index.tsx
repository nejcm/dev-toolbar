/**
 * `@nejcm/dev-toolbar/ext/overlays`
 *
 * Visual overlays over the running application, per `plans/dev-bar.md` §3G.
 * Consumes only the public extension contract — no `src/core/*` value
 * imports, types only (erased at build time).
 *
 * ```tsx
 * import { overlays } from "@nejcm/dev-toolbar/ext/overlays";
 *
 * // Build it ONCE, outside render.
 * const extensions = [overlays({ grid: { columns: 12, maxWidth: 1200 } })];
 * ```
 *
 * Four overlays ship, each toggled and persisted independently: layout boxes,
 * column grid, element inspector, and focus order. §3G lists nine more;
 * `OverlayId` in `./types` explains why they were left out.
 *
 * As the first extension drawing over the host app:
 * - Never intercepts a pointer event — the surface is `pointer-events: none
 *   !important`; the inspector only *observes* via a passive capturing
 *   listener + `elementFromPoint`.
 * - Draws below the toolbar (`z-index: -1 !important` inside the toolbar
 *   root's own stacking context), never over it.
 * - Mutates no host DOM node — geometry comes from read-only APIs. Sole
 *   exception: the layout-boxes stylesheet, torn down on toggle-off, hide,
 *   and teardown.
 * - Observes nothing it isn't drawing for — listeners come off while the bar
 *   is hidden (this extension decides "hidden" for itself; core never pauses
 *   anybody, §13.2).
 * - A throw switches everything off — measurement runs inside animation
 *   frames and a `MutationObserver`, where nothing upstream could catch it.
 */
import { createOverlaysRuntime } from "./runtime";
import { OverlaysChip, OverlaysPanel, OverlaysSurface } from "./ui";
import { OVERLAY_IDS, OVERLAY_META } from "./types";
import { resolvePresentation, resolveStyleNonce } from "@nejcm/dev-toolbar/kit";
import type { CompactPresentationInput } from "@nejcm/dev-toolbar/kit";
import type { OverlaysRuntimeOptions } from "./runtime";
import type { OverlaysSnapshot } from "./types";
import type {
  DevToolbarExtension,
  ExtensionRuntimeApi,
  ToolbarAlign,
  ToolbarCommand,
} from "../../core/contract";

/**
 * `deferOutlinesUntilStyleNonce` is omitted on purpose: it is how `overlays()`
 * itself wires the boxes sheet to the overlay surface's nonce, not a knob a
 * consumer of the extension has any use for.
 */
export interface OverlaysOptions extends Omit<
  OverlaysRuntimeOptions,
  "deferOutlinesUntilStyleNonce"
> {
  /** Extension id. Default `"overlays"`. */
  id?: string;
  /**
   * Bar label, used by the error chip, the bar trigger's accessible name and
   * the panel's accessible name. Default `"Overlays"`.
   */
  label?: string;
  align?: ToolbarAlign;
  order?: number;
  /**
   * Overflow collapse order. Default `50`. Nothing is lost on collapse — the
   * overlays keep drawing and the palette keeps toggling them.
   */
  priority?: number;
  hidden?: boolean;
  /** Keep the panel mounted after it closes. Default `false` — it holds no state. */
  keepMounted?: boolean;
  /**
   * Inject this extension's stylesheet. Default `true`. If core's
   * `injectStyles` is off, turn this off too and ship `OVERLAYS_CSS` yourself.
   * Does not cover the layout-boxes sheet, which is the overlay itself and is
   * added/removed with its toggle regardless.
   */
  injectStyles?: boolean;
  /**
   * CSP nonce for this extension's stylesheets — the panel/chip sheet and the
   * layout-boxes sheet. Wins over the `styleNonce` slot prop core forwards
   * from `<DevToolbar>`.
   */
  styleNonce?: string;
  /**
   * How the bar control presents itself: a preset, your own icon, a render
   * callback and an accessible-name override. A bare preset is the shorthand —
   * `presentation: "icon-value"`.
   *
   * One control, so each knob is invoked once per render, in the bar and in the
   * `⋮` menu alike, with the same `OverlaysSnapshot` the panel and the overlay
   * surface read — which layers are on, the hover target, the focus scan and
   * any error. The presets operate on the **short bar word** (`"overlays"`):
   * `label` stays the overflow and accessible-name identity, so `"icon-label"`
   * paints `"overlays"` in the bar and `"Overlays"` in the menu.
   *
   * **The error tag is not yours to restyle.** It sits outside both the preset
   * and `render`, after the contents, under every preset including `"icon"` —
   * a measurement that threw switched every overlay off, and that is state
   * rather than presentation. `render` supplies the children of the chip
   * carrying `data-dtb-active` and the dot, so the state attributes,
   * `aria-expanded` and `title` stay the extension's; returning `undefined`
   * falls through to the preset. `name` overrides the `aria-label`, and a
   * whitespace-only return is ignored. Prefer a name that does not change with
   * the *count* — `(s) => \`Overlays ${s.activeCount}\`` renames the control on
   * every toggle and a screen reader re-announces it.
   *
   * Nothing here reaches the store: the icon and the callbacks are held in this
   * closure and passed as props, because a `ReactNode` cannot be signed.
   *
   * `docs/adr/ADR-004-per-extension-bar-presentation.md`.
   */
  presentation?: CompactPresentationInput<OverlaysSnapshot>;
}

/**
 * Builds the extension. Call it once — the returned object owns the store and,
 * once started, every listener and the layout-boxes stylesheet.
 */
export function overlays(options: OverlaysOptions = {}): DevToolbarExtension {
  const {
    id = "overlays",
    label = "Overlays",
    align = "start",
    order = 20,
    priority = 50,
    hidden,
    keepMounted = false,
    injectStyles = true,
    styleNonce: optionNonce,
    // Destructured out rather than read off `options`: everything this factory
    // does not name is spread into `createOverlaysRuntime` below, and an icon
    // or a callback has no business reaching the runtime.
    presentation: presentationOption,
    ...runtimeOptions
  } = options;

  // Resolved once, here, rather than per render: this is the closure the icon
  // and the callbacks live in, exactly as `label` and `injectStyles` do.
  const presentation = resolvePresentation(presentationOption);

  // Built here, not in start(api): slot functions run during the toolbar's
  // first render, before any effect fires. deferOutlinesUntilStyleNonce holds
  // the boxes sheet (first-writer-wins) until the overlay surface has learned
  // <DevToolbar styleNonce>, unless a factory nonce releases the wait now.
  const runtime = createOverlaysRuntime({
    ...runtimeOptions,
    deferOutlinesUntilStyleNonce: true,
  });
  if (optionNonce) runtime.setStyleNonce(optionNonce);

  /** Function form of `commands` (§13.1) so the Show/Hide label matches live state. */
  const toggles = (): ToolbarCommand[] =>
    OVERLAY_IDS.map((overlayId) => {
      const meta = OVERLAY_META[overlayId];
      const on = runtime.isOn(overlayId);
      return {
        id: `${id}.toggle.${overlayId}`,
        label: `${on ? "Hide" : "Show"} overlay: ${meta.label}`,
        group: "Overlays",
        keywords: ["overlay", "inspect", "visual", overlayId],
        run: () => runtime.toggle(overlayId),
      };
    });

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

    /** Which layers are on. `plans/agent-readable-toolbar.md` § Phase 1. */
    diagnostics: () => runtime.diagnostics(),

    compact: ({ isOverflowed, isPanelOpen, togglePanel, styleNonce }) => (
      <OverlaysChip
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
      <OverlaysPanel
        runtime={runtime}
        label={label}
        injectStyles={injectStyles}
        styleNonce={resolveStyleNonce(optionNonce, styleNonce)}
      />
    ),

    // Surface goes in `overlay`, not `panel`/`compact` (§13.2): a collapsed
    // `compact` isn't in the DOM, and `panel` is a bar-pinned drawer, not a
    // viewport-sized layer.
    overlay: ({ styleNonce }) => (
      <OverlaysSurface
        runtime={runtime}
        injectStyles={injectStyles}
        styleNonce={resolveStyleNonce(optionNonce, styleNonce)}
      />
    ),

    commands: () => [
      ...toggles(),
      {
        id: `${id}.disableAll`,
        label: "Turn every overlay off",
        group: "Overlays",
        keywords: ["reset", "clear", "off", "overlay"],
        run: () => runtime.disableAll(),
      },
    ],
  };
}

export {
  BOXES_CSS,
  BOXES_STYLE_ENTRY,
  DEFAULT_FOCUS_LIMIT,
  ENABLED_KEY,
  createOverlaysRuntime,
  setHostOutlines,
} from "./runtime";
export type { OverlaysRuntime, OverlaysRuntimeOptions } from "./runtime";
export { OVERLAYS_CSS, ensureOverlaysStyles } from "./css";
export {
  DEFAULT_GRID,
  NO_OVERLAYS,
  OVERLAY_IDS,
  OVERLAY_META,
  TABBABLE_SELECTOR,
  accessibleName,
  countEnabled,
  describeElement,
  isInToolbar,
  normalizeGrid,
  parseFlags,
  serializeFlags,
  tabIndexOf,
} from "./types";
export type {
  Edges,
  FocusItem,
  GridSettings,
  HoverTarget,
  OverlayFlags,
  OverlayId,
  OverlayMeta,
  OverlaysSnapshot,
  RectLike,
} from "./types";
