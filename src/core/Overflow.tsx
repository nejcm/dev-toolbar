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
const DEFAULT_GAP = 2;
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
 * one before the `···` button, which undercounts when the start region has no
 * items or the end region has none by props — both still reserve a gap since
 * the (empty) region elements are always present. Read from props rather than
 * rendered children so available width only ever shrinks and recompute can't
 * oscillate, at the cost of over-charging one gap once collapsed.
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
 * What can take focus inside the `···` popup. Deliberately shallow: the popup
 * holds extensions' compact slots, and the first thing in the first of them is
 * where a keyboard user expects to land.
 */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])';

/**
 * The bar row itself. Measures rendered items with a `ResizeObserver` and
 * collapses the lowest-priority ones into a `···` menu.
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
  // Read back out of the DOM so overriding --dtb-gap or restyling the ···
  // button keeps the collapse math honest.
  const gapRef = useRef(gap);
  const buttonWidthRef = useRef(DEFAULT_OVERFLOW_BUTTON_WIDTH);
  const reservedRef = useRef(0);
  // Last measured `clientWidth` (padding box). Reserved width is applied at
  // use, so a collapse that changes it takes effect without waiting for resize.
  const [available, setAvailable] = useState(0);
  const [overflowIds, setOverflowIds] = useState<Set<string>>(() => new Set<string>());
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

  const recompute = useCallback((width: number) => {
    const items: MeasuredItem[] = listRef.current.map((extension) => ({
      id: extension.id,
      priority: extension.priority ?? 0,
      width: widthsRef.current.get(extension.id) ?? 0,
    }));
    const next = computeOverflow(items, width, buttonWidthRef.current, gapRef.current);
    setOverflowIds((previous) => (sameSet(previous, next) ? previous : next));
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

    const nodes = bar.querySelectorAll<HTMLElement>(
      '[data-dtb-part="region"] > [data-dtb-part="item"][data-dtb-ext-id]',
    );
    for (const node of nodes) {
      const id = node.dataset["dtbExtId"];
      if (!id) continue;
      const width = node.offsetWidth;
      if (width > 0) widthsRef.current.set(id, width);
    }
    recompute(contentWidth(available || bar.clientWidth));
  });

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;

    const read = () => {
      const width = bar.clientWidth;
      setAvailable(width);
      recompute(contentWidth(width));
    };

    read();

    if (typeof ResizeObserver === "undefined") {
      if (typeof window === "undefined") return;
      window.addEventListener("resize", read);
      return () => window.removeEventListener("resize", read);
    }

    const observer = new ResizeObserver(read);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [recompute]);

  // Nothing overflows any more, so close the menu. Deriving this during
  // render instead would silently reopen it the next time the bar narrows.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    if (overflowIds.size === 0) setMenuOpen(false);
  }, [overflowIds]);

  // Move focus into the ··· popup when it opens, so a keyboard user reaches
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
            {"···"}
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
