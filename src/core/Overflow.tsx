import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { DevToolbarClassNames, DevToolbarExtension } from "./contract";
import { cx } from "./context";

export interface MeasuredItem {
  id: string;
  priority: number;
  width: number;
}

/**
 * Decides which item ids collapse into the overflow menu.
 *
 * Lowest `priority` collapses first; ties break toward the later item. Returns
 * an empty set when `available` is not a positive number, so a non-measuring
 * environment (SSR, jsdom without a ResizeObserver) renders everything.
 */
export function computeOverflow(
  items: readonly MeasuredItem[],
  available: number,
  overflowButtonWidth: number,
  gap: number,
): Set<string> {
  const overflow = new Set<string>();
  if (!(available > 0) || items.length === 0) return overflow;

  const widthOf = (list: readonly MeasuredItem[]) =>
    list.reduce((sum, item) => sum + item.width, 0) + Math.max(0, list.length - 1) * gap;

  if (widthOf(items) <= available) return overflow;

  const candidates = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.priority - b.item.priority || b.index - a.index);

  for (const candidate of candidates) {
    overflow.add(candidate.item.id);
    const remaining = items.filter((item) => !overflow.has(item.id));
    const needed = widthOf(remaining) + (remaining.length > 0 ? gap : 0) + overflowButtonWidth;
    if (needed <= available) break;
  }

  return overflow;
}

export interface OverflowBarProps {
  startItems: readonly DevToolbarExtension[];
  endItems: readonly DevToolbarExtension[];
  renderItem: (extension: DevToolbarExtension, options: { isOverflowed: boolean }) => ReactNode;
  classNames?: DevToolbarClassNames | undefined;
  gap?: number;
  overflowLabel?: string;
}

/** Fallbacks used only until the DOM has been measured. */
const DEFAULT_GAP = 10;
const DEFAULT_OVERFLOW_BUTTON_WIDTH = 28;

function readPx(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(raw ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readGap(element: HTMLElement, fallback: number): number {
  if (typeof getComputedStyle !== "function") return fallback;
  const style = getComputedStyle(element);
  return readPx(style.columnGap || style.gap, fallback);
}

/**
 * Width of the bar that items may not fill: its horizontal padding (included
 * in `clientWidth`) plus any inter-region gap the item math doesn't already
 * charge for. `computeOverflow` charges one gap per adjacent item pair plus
 * one before the `⋮` button, which undercounts when the start region has no
 * items or the end region has none — both still reserve a gap, since the
 * (empty) region elements are always present.
 *
 * The two emptiness tests are read from different places on purpose, and the
 * asymmetry is the point:
 *
 * - `startRegionEmpty` is read from the *rendered* children, because the start
 *   region really is empty exactly when every start item has collapsed.
 * - `endItemsEmpty` is read from the *props*, because the end region also
 *   hosts the `⋮` button: once anything collapses it is never empty, so
 *   rendered children would report "not empty" for a region that holds nothing
 *   but the button whose width `computeOverflow` already charges separately.
 *
 * Both directions therefore only ever *shrink* available width as items
 * collapse, which is what stops recompute oscillating: the start term can flip
 * 0 → gap once, and the end term is fixed for a given `endItems` array. The
 * cost is one gap of hysteresis — a bar whose start region has collapsed empty
 * is charged a gap that the flattened item math would already have covered had
 * anything come back, so re-expansion needs one gap more room than the
 * collapse gave up.
 */
function readReserved(
  bar: HTMLElement,
  gap: number,
  startRegionEmpty: boolean,
  endItemsEmpty: boolean,
): number {
  const interRegionGaps = (startRegionEmpty ? gap : 0) + (endItemsEmpty ? gap : 0);
  if (typeof getComputedStyle !== "function") return interRegionGaps;
  const style = getComputedStyle(bar);
  return readPx(style.paddingLeft, 0) + readPx(style.paddingRight, 0) + interRegionGaps;
}

/**
 * The item hosts the bar measures. The direct-child `>` combinator is
 * load-bearing: it structurally excludes the copies rendered inside the `⋮`
 * popup, whose hosts carry `data-dtb-part="overflow-menu-item"` but whose
 * *contents* may nest anything. One selector, used by every caller, so no
 * second one can drift away from it.
 */
const ITEM_SELECTOR = '[data-dtb-part="region"] > [data-dtb-part="item"][data-dtb-ext-id]';

/**
 * Brings `observed` in line with `nodes`, observing and unobserving only the
 * difference. Re-`observe()`ing an already-observed element is specified to
 * drop and re-add the observation, which queues a fresh initial notification —
 * a cheap way to spin the ResizeObserver loop, so it is avoided here.
 */
function syncObserved(
  observer: ResizeObserver,
  observed: Set<Element>,
  nodes: ArrayLike<Element>,
): void {
  const next = new Set<Element>();
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node) next.add(node);
  }
  for (const node of observed) {
    if (next.has(node)) continue;
    observer.unobserve(node);
    observed.delete(node);
  }
  for (const node of next) {
    if (observed.has(node)) continue;
    observer.observe(node);
    observed.add(node);
  }
}

/**
 * How many times item resizes may flip the collapsed set before the bar stops
 * listening to them, until its own width changes again.
 *
 * The case this guards is a chip that re-renders to a width that depends on the
 * collapse state — one rendering wider in the bar than in the `⋮` popup, say.
 * Collapsing it changes its width, which changes the collapse decision, so
 * there is no fixed point to settle on and no amount of debouncing converges
 * it. A hard bound terminates it instead. Four leaves room for the legitimate
 * multi-step settling of several chips measuring at once.
 *
 * Scope, precisely: this bounds the *observer* path only. A chip whose width
 * changes **synchronously** with the collapse — measurably different on the
 * very next layout, without a ResizeObserver delivery in between — loops
 * through the dependency-less layout effect below, which measures and
 * recomputes on every render and is not latched. That loop ends in React's
 * "Maximum update depth exceeded", and it predates this observer: the layout
 * effect behaved this way before per-item observation existed, so nothing here
 * made it newly reachable. Fixing it would mean latching the render path too,
 * which is a larger change than this one.
 */
const MAX_ITEM_DRIVEN_FLIPS = 4;

/**
 * What can take focus inside the `⋮` popup. Deliberately shallow: the popup
 * holds extensions' compact slots, and the first thing in the first of them is
 * where a keyboard user expects to land.
 */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])';

/**
 * The bar row itself. Measures rendered items with a `ResizeObserver` and
 * collapses the lowest-priority ones into a `⋮` menu.
 */
export function OverflowBar({
  startItems,
  endItems,
  renderItem,
  classNames,
  gap = DEFAULT_GAP,
  overflowLabel = "More developer toolbar items",
}: OverflowBarProps): ReactNode {
  const barRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const widthsRef = useRef(new Map<string, number>());
  // Read back out of the DOM so overriding --dtb-item-gap or restyling the ⋮
  // button keeps the collapse math honest.
  const gapRef = useRef(gap);
  const buttonWidthRef = useRef(DEFAULT_OVERFLOW_BUTTON_WIDTH);
  const reservedRef = useRef(0);
  // Last measured `clientWidth` (padding box). Reserved width is applied at
  // use, so a collapse that changes it takes effect without waiting for resize.
  const [available, setAvailable] = useState(0);
  // The same value, readable from a ResizeObserver callback without closing
  // over the state — the callbacks are created once and must not go stale.
  const availableRef = useRef(0);
  const [overflowIds, setOverflowIds] = useState<Set<string>>(() => new Set<string>());
  // Mirrors the committed `overflowIds`, so `recompute` can report whether it
  // actually flipped the set. Re-synced from committed state at the top of the
  // layout effect below, which is the only place a discarded render can be
  // told apart from a committed one.
  const overflowIdsRef = useRef(overflowIds);
  // Item-driven flips since the bar's own observer last reported a new width.
  const itemFlipsRef = useRef(0);
  const itemObserverRef = useRef<ResizeObserver | null>(null);
  const observedItemsRef = useRef(new Set<Element>());
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = `dtb-overflow-menu-${useId()}`;

  const all = [...startItems, ...endItems];
  // Read through a ref so `recompute` (and the ResizeObserver effect) stays
  // stable across renders that only rebuild the item arrays.
  const listRef = useRef(all);
  // oxlint-disable-next-line react/refs -- written in render on purpose, above.
  listRef.current = all;

  /** A measured padding-box width minus everything that is not item space. */
  const contentWidth = (barWidth: number) => Math.max(0, barWidth - reservedRef.current);

  /** @returns whether the collapsed set changed. */
  const recompute = useCallback((width: number): boolean => {
    const items: MeasuredItem[] = listRef.current.map((extension) => ({
      id: extension.id,
      priority: extension.priority ?? 0,
      width: widthsRef.current.get(extension.id) ?? 0,
    }));
    const next = computeOverflow(items, width, buttonWidthRef.current, gapRef.current);
    if (sameSet(overflowIdsRef.current, next)) return false;
    overflowIdsRef.current = next;
    setOverflowIds(next);
    return true;
  }, []);

  /**
   * Caches the natural width of every rendered item host and brings the item
   * `ResizeObserver` in line with the same `NodeList`.
   *
   * @returns whether any cached width changed.
   */
  const measureWidths = useCallback((bar: HTMLElement): boolean => {
    const nodes = bar.querySelectorAll<HTMLElement>(ITEM_SELECTOR);
    const observer = itemObserverRef.current;
    if (observer) syncObserved(observer, observedItemsRef.current, nodes);

    let changed = false;
    for (const node of nodes) {
      const id = node.dataset["dtbExtId"];
      if (!id) continue;
      const width = node.offsetWidth;
      if (width <= 0 || widthsRef.current.get(id) === width) continue;
      widthsRef.current.set(id, width);
      changed = true;
    }
    return changed;
  }, []);

  // Cache natural widths of whatever is currently rendered, then recompute.
  // Widths are sticky, so a collapsed item can expand again.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;

    const region = bar.querySelector<HTMLElement>('[data-dtb-part="region"]');
    if (region) gapRef.current = readGap(region, gap);
    const startRegion = bar.querySelector<HTMLElement>(
      '[data-dtb-part="region"][data-dtb-align="start"]',
    );
    reservedRef.current = readReserved(
      bar,
      gapRef.current,
      !startRegion?.querySelector('[data-dtb-part="item"]'),
      endItems.length === 0,
    );
    const buttonWidth = buttonRef.current?.offsetWidth ?? 0;
    if (buttonWidth > 0) buttonWidthRef.current = buttonWidth;

    // Only a committed render reaches here, so this is where the mirror is
    // guaranteed to agree with the state React actually rendered.
    overflowIdsRef.current = overflowIds;
    measureWidths(bar);
    recompute(contentWidth(available || bar.clientWidth));
  });

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;

    // The bar's own geometry. It is fixed-height and full-width, so this fires
    // for a viewport or container change and essentially nothing else — which
    // is exactly why it cannot see a chip growing on its own tick, and why a
    // new width here is the honest signal that the item latch may reopen.
    const read = () => {
      const width = bar.clientWidth;
      if (width !== availableRef.current) {
        availableRef.current = width;
        itemFlipsRef.current = 0;
        setAvailable(width);
      }
      measureWidths(bar);
      recompute(contentWidth(width));
    };

    read();

    // No ResizeObserver: fall back to window resize only. Polling would burn a
    // timer forever in every host that lacks the API, for a bar that is mostly
    // static — the collapse simply stays as measured until the window changes.
    if (typeof ResizeObserver === "undefined") {
      if (typeof window === "undefined") return;
      window.addEventListener("resize", read);
      return () => window.removeEventListener("resize", read);
    }

    const barObserver = new ResizeObserver(read);
    barObserver.observe(bar);

    /**
     * Item hosts are `flex: 0 0 auto; max-width: 100%` (`src/styles.css`), so
     * unlike the flex-constrained regions they really do resize with their
     * content: this is what notices a chip re-rendering wider on its own store
     * change, which no render of *this* component would otherwise measure.
     */
    // Copied out of the ref so the cleanup below closes over this effect's own
    // set rather than reading `.current` after a later effect replaced it.
    const observedItems = observedItemsRef.current;

    const itemObserver = new ResizeObserver(() => {
      const node = barRef.current;
      if (!node) return;
      // Latched: past the bound, item resizes stop driving the collapse until
      // the bar's own observer reports a different width. Returning before any
      // state or DOM is touched is what makes the loop terminate rather than
      // merely slow down.
      if (itemFlipsRef.current >= MAX_ITEM_DRIVEN_FLIPS) return;
      if (!measureWidths(node)) return;
      if (recompute(contentWidth(availableRef.current || node.clientWidth))) {
        itemFlipsRef.current += 1;
      }
    });
    itemObserverRef.current = itemObserver;
    syncObserved(itemObserver, observedItems, bar.querySelectorAll<HTMLElement>(ITEM_SELECTOR));

    return () => {
      barObserver.disconnect();
      itemObserver.disconnect();
      itemObserverRef.current = null;
      observedItems.clear();
    };
  }, [recompute, measureWidths]);

  // Nothing overflows any more, so close the menu. Deriving this during
  // render instead would silently reopen it the next time the bar narrows.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    if (overflowIds.size === 0) setMenuOpen(false);
  }, [overflowIds]);

  // Move focus into the ⋮ popup when it opens, so a keyboard user reaches
  // the collapsed items. Falls back to the popup itself if nothing inside
  // can take focus.
  useEffect(() => {
    if (!menuOpen) return;
    const menu = menuRef.current;
    if (!menu) return;
    (menu.querySelector<HTMLElement>(FOCUSABLE) ?? menu).focus();
  }, [menuOpen]);

  // Dismiss on Escape or an outside click. Escape returns focus to the
  // button; an outside click leaves focus wherever the click put it.
  useEffect(() => {
    if (!menuOpen || typeof document === "undefined") return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setMenuOpen(false);
      buttonRef.current?.focus();
    };
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setMenuOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("mousedown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [menuOpen]);

  const isOverflowed = (extension: DevToolbarExtension) => overflowIds.has(extension.id);
  const overflowed = all.filter(isOverflowed);
  const visibleStart = startItems.filter((item) => !isOverflowed(item));
  const visibleEnd = endItems.filter((item) => !isOverflowed(item));

  return (
    <div
      ref={barRef}
      data-dtb-part="bar"
      className={cx(classNames?.bar)}
      role="toolbar"
      aria-label="Developer toolbar"
    >
      <div data-dtb-part="region" data-dtb-align="start" className={cx(classNames?.region)}>
        {visibleStart.map((extension) => renderItem(extension, { isOverflowed: false }))}
      </div>
      <div data-dtb-part="region" data-dtb-align="end" className={cx(classNames?.region)}>
        {visibleEnd.map((extension) => renderItem(extension, { isOverflowed: false }))}
        {overflowed.length > 0 ? (
          <button
            ref={buttonRef}
            type="button"
            data-dtb-part="overflow-button"
            className={cx(classNames?.overflowButton)}
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            aria-label={overflowLabel}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {"⋮"}
          </button>
        ) : null}
      </div>
      {/* A disclosure, not an ARIA menu: entries render their own interactive
          content, which a `menuitem` may not contain. Instead: `aria-expanded`/
          `aria-controls` on the button, focus moved in on open, Escape out.
          Positioned with `inset-inline-end` in styles.css so it mirrors under
          `dir="rtl"`. */}
      {menuOpen && overflowed.length > 0 ? (
        <div
          ref={menuRef}
          id={menuId}
          data-dtb-part="overflow-menu"
          className={cx(classNames?.overflowMenu)}
          role="group"
          aria-label={overflowLabel}
          tabIndex={-1}
        >
          {overflowed.map((extension) => (
            <div
              key={extension.id}
              data-dtb-part="overflow-menu-item"
              data-dtb-ext-id={extension.id}
              className={cx(classNames?.overflowMenuItem)}
            >
              {renderItem(extension, { isOverflowed: true })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}
