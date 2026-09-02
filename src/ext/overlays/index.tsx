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
 * `OverlayId` in `./types` explains why they were left out (re-render flash
 * needs React internals; stacking-context/scroll-container overlays need
 * `getComputedStyle` on every element in the document).
 *
 * As the first extension drawing over the host app, its constraints matter as
 * much as its features:
 * - **Never intercepts a pointer event** — the surface and everything in it
 *   is `pointer-events: none !important`, so clicks always reach the page.
 *   The inspector only *observes* the pointer (passive capturing listener +
 *   `elementFromPoint`).
 * - **Draws below the toolbar, never over it** — `z-index: -1 !important`
 *   inside the toolbar root's stacking context, so overlays sit over the page
 *   but under the bar, panel and command palette.
 * - **Mutates no host DOM node** — no injected classes/inline styles;
 *   geometry comes from `getBoundingClientRect`, `getComputedStyle` and a
 *   `MutationObserver`. Sole exception: the layout-boxes stylesheet, one
 *   `<style>` in `document.head`, removed on toggle-off, hide, and teardown.
 * - **Observes nothing it isn't drawing for** — listeners are per-overlay and
 *   all come off while the bar is hidden (this extension decides "hidden"
 *   for itself; core never pauses anybody, §13.2).
 * - **A throw switches everything off** — measurement runs inside animation
 *   frames and a `MutationObserver`, where nothing upstream could catch it.
 *
 * Each overlay also contributes a toggle command (function-form `commands`,
 * since the Show/Hide label depends on live state).
 */
import { createOverlaysRuntime } from "./runtime";
import { OverlaysChip, OverlaysPanel, OverlaysSurface } from "./ui";
import { OVERLAY_IDS, OVERLAY_META } from "./types";
import type { OverlaysRuntimeOptions } from "./runtime";
import type {
  DevToolbarExtension,
  ExtensionRuntimeApi,
  ToolbarAlign,
  ToolbarCommand,
} from "../../core/contract";

export interface OverlaysOptions extends OverlaysRuntimeOptions {
  /** Extension id. Default `"overlays"`. */
  id?: string;
  /** Bar label, used by the error chip and the panel's accessible name. Default `"Overlays"`. */
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
    ...runtimeOptions
  } = options;

  // Built here, not in start(api): slot functions run during the toolbar's
  // first render, which is before any effect fires.
  const runtime = createOverlaysRuntime(runtimeOptions);

  /**
   * Function form of `commands` (§13.1), rebuilt each aggregation pass so the
   * Show/Hide label always matches live state. Pure and cheap: reads the
   * runtime's flag map, measures nothing.
   */
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
      <OverlaysChip
        runtime={runtime}
        label={label}
        isOverflowed={isOverflowed}
        isPanelOpen={isPanelOpen}
        injectStyles={injectStyles}
        onToggle={togglePanel}
      />
    ),

    panel: () => <OverlaysPanel runtime={runtime} label={label} injectStyles={injectStyles} />,

    /**
     * Surface goes in `overlay`, not `panel`/`compact` (§13.2): a collapsed
     * `compact` isn't in the DOM, so overlays would vanish on narrow windows,
     * and `panel` is a bar-pinned drawer rather than a viewport-sized layer.
     */
    overlay: () => <OverlaysSurface runtime={runtime} injectStyles={injectStyles} />,

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
