/**
 * `@nejcm/dev-toolbar/ext/overlays`
 *
 * Visual overlays over the running application, per `plans/dev-bar.md` §3G.
 * Written strictly as a consumer of the public extension contract: nothing here
 * imports a *value* from `src/core/*`, only types, which erase at build time.
 *
 * ```tsx
 * import { overlays } from "@nejcm/dev-toolbar/ext/overlays";
 *
 * // Build it ONCE, outside render.
 * const extensions = [overlays({ grid: { columns: 12, maxWidth: 1200 } })];
 * ```
 *
 * Four overlays ship, each toggled on its own and each persisted:
 *
 * | | What it answers |
 * | --- | --- |
 * | **Layout boxes** | where the boxes actually are, and which wrapper is the one adding the gap |
 * | **Column grid** | whether this lines up with the design's grid |
 * | **Element inspector** | what is under the pointer, how big it is, what it is called |
 * | **Focus order** | what order `Tab` visits things in, and which of them have no accessible name |
 *
 * §3G lists nine more. `OverlayId` in `./types` says which were left out and
 * why — the short version is that re-render flash needs React's internals, and
 * stacking-context and scroll-container overlays need `getComputedStyle` on
 * every element in the document, which is the one cost profile §3G tells you not
 * to pay.
 *
 * This is the first extension that draws over the host application, so the
 * things it refuses to do are as much a part of the design as the overlays:
 *
 * - **It never intercepts a pointer event.** The drawing surface, and
 *   everything in it, is `pointer-events: none !important`, so a click always
 *   lands on the page underneath. The `!important` is the whole guarantee: this
 *   package's CSS is layered precisely so that unlayered app CSS beats it, and
 *   a stray `div { pointer-events: auto }` would otherwise turn the overlay into
 *   a viewport-sized click trap. The inspector *observes* the pointer through a
 *   passive capturing listener and `elementFromPoint`; it never consumes it.
 * - **It draws below the toolbar, never over it.** The surface sits at
 *   `z-index: -1 !important` inside the toolbar root, whose own stacking context
 *   is above the application — so overlays paint over the page and under the
 *   bar, the panel and the command palette. `!important` for the same reason as
 *   above: `div { z-index: 0 }` would otherwise lift it to bar level.
 * - **It mutates no host DOM node.** No injected classes, no inline styles on
 *   your elements. Geometry is read with `getBoundingClientRect`,
 *   `getComputedStyle` and a `MutationObserver`. The single exception is the
 *   layout-boxes stylesheet, which is one `<style>` element in `document.head`,
 *   removed when the overlay goes off, when the bar is hidden, and on teardown.
 * - **It observes nothing it is not drawing for.** Listeners are attached per
 *   overlay, and all of them come off while the bar is hidden — core reports
 *   visibility and never pauses anybody, so this extension decides what hidden
 *   means for itself (§13.2).
 * - **A throw switches everything off.** Measurement happens inside animation
 *   frames and a `MutationObserver`, where nothing upstream can catch it and
 *   where it would recur every frame.
 *
 * Each overlay also contributes a toggle command, so the palette can drive them
 * without the panel. The list is the function form of `commands`, because the
 * labels say what a run will *do* and that depends on live state.
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
   * Overflow collapse order. Default `50`: worth keeping longer than a memory
   * readout, and nothing is lost when it does collapse — the overlays keep
   * drawing and the palette keeps toggling them.
   */
  priority?: number;
  hidden?: boolean;
  /** Keep the panel mounted after it closes. Default `false` — it holds no state. */
  keepMounted?: boolean;
  /**
   * Inject this extension's stylesheet. Default `true`. Core's own
   * `injectStyles` prop is not visible to extensions, so if you turned that off
   * turn this off too and ship `OVERLAYS_CSS` yourself.
   *
   * The layout-boxes sheet is **not** covered by this: it is not styling for
   * this extension's own UI, it *is* the overlay, and it is added and removed
   * with the toggle either way.
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
   * Enumerated on every aggregation pass, not once in the factory — the
   * function form of `commands` (§13.1).
   *
   * The reason is the label: "Show" and "Hide" are different promises, and a
   * palette row that said "Show layout boxes" over an overlay that was already
   * on would be the same class of lie as a badge that says *overridden* over an
   * application that never heard about it. Command identity is the `id`, so
   * rebuilding these objects each pass costs one array; `run` resolves through
   * the runtime either way.
   *
   * Pure and cheap, as the contract requires: it reads the flag map the runtime
   * already holds and measures nothing.
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
     * The surface goes in `overlay`, not `panel` or `compact`, for the reason
     * the slot was added (§13.2): a collapsed `compact` is not in the DOM at
     * all, so overlays would vanish exactly when the window got narrow, and a
     * panel is a drawer pinned to the bar rather than a viewport-sized layer.
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
