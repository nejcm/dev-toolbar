import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CollapseMachine } from "./collapse";
import type { CollapseItem, CollapseReading } from "./collapse";
import type { DevToolbarClassNames, DevToolbarExtension } from "./contract";
import { cx } from "./context";
import { ITEM_SELECTOR, resolveMeasurer } from "./measurer";
import type { MeasurementObserver } from "./measurer";

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
  const itemObserverRef = useRef<MeasurementObserver | null>(null);
  // The decision and everything it depends on live in the machine, which is
  // only ever fed from committed contexts — effects and observer callbacks,
  // never render — so what it holds is the committed decision and React state
  // follows it below. Created once; `gap` seeds it until the DOM reports one.
  const [machine] = useState(
    () => new CollapseMachine({ gap, buttonWidth: DEFAULT_OVERFLOW_BUTTON_WIDTH }),
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(machine.collapsed);
  // React follows the machine, never the other way round: a render React
  // discarded cannot leave the two disagreeing, because the next commit's
  // layout effect syncs again. Same instance means React has nothing to do.
  const sync = useCallback(() => setCollapsed(machine.collapsed), [machine]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = `dtb-overflow-menu-${useId()}`;

  const roster: CollapseItem[] = [
    ...startItems.map((extension) => rosterItem(extension, "start")),
    ...endItems.map((extension) => rosterItem(extension, "end")),
  ];

  /**
   * The CSS-constrained width of every rendered item host, and — as a side effect of
   * walking the same `NodeList` — the item `ResizeObserver` brought in line
   * with it.
   */
  const measureWidths = useCallback((bar: HTMLElement): [string, number][] => {
    const measurer = resolveMeasurer();
    const nodes = bar.querySelectorAll<HTMLElement>(ITEM_SELECTOR);
    const observer = itemObserverRef.current;
    observer?.sync(nodes);

    const widths: [string, number][] = [];
    for (const node of nodes) {
      const id = node.dataset["dtbExtId"];
      if (id) widths.push([id, measurer.itemWidth(node)]);
    }
    return widths;
  }, []);

  /** Everything the bar can report about itself, as one reading. */
  const readBar = useCallback(
    (bar: HTMLElement): CollapseReading => {
      const measurer = resolveMeasurer();
      return {
        barWidth: measurer.barWidth(bar),
        gap: measurer.regionGap(bar),
        padding: measurer.padding(bar),
        buttonWidth: measurer.buttonWidth(buttonRef.current),
        widths: measureWidths(bar),
      };
    },
    [measureWidths],
  );

  // Every commit is a chance to measure what it rendered — a returning item,
  // the ⋮ button appearing, a start region emptying — and to feed the roster.
  // Sticky widths inside the machine are what let a collapsed item come back.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const reading = readBar(bar);
    machine.measure({
      items: roster,
      ...reading,
      // The prop is the fallback for a host whose computed style has no gap.
      gap: reading.gap ?? gap,
    });
    sync();
  });

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    // Only to build the subscriptions, which are used here and torn down with
    // the effect. The two callbacks below deliberately resolve nothing: they
    // outlive this commit, so they read pixels through `readBar`/`measureWidths`,
    // which resolve per call — the slot can change between two deliveries.
    const measurer = resolveMeasurer();

    // Padding changes resize the bar's content box; gap alone can leave collapse stale and chips clipped.
    // Item callbacks do not refresh gap; a full bar reading (e.g. on resize) does.
    const read = () => {
      if (machine.measure(readBar(bar))) sync();
    };

    read();

    // No ResizeObserver: fall back to window resize only. Polling would burn a
    // timer forever in every host that lacks the API, for a bar that is mostly
    // static — the collapse simply stays as measured until the window changes.
    const barObserver = measurer.observe(read);
    if (!barObserver) {
      if (typeof window === "undefined") return;
      window.addEventListener("resize", read);
      return () => window.removeEventListener("resize", read);
    }

    barObserver.sync([bar]);

    // Every delivery reaches the machine, latched or not: a chip cycling with
    // the decision is refused inside it, and a chip that genuinely grows past
    // the cycle must still be heard — which is what the cycle detection is for.
    const itemObserver = measurer.observe(() => {
      const node = barRef.current;
      if (!node) return;
      if (machine.measure({ widths: measureWidths(node) })) sync();
    });
    itemObserverRef.current = itemObserver ?? null;
    itemObserver?.sync(bar.querySelectorAll<HTMLElement>(ITEM_SELECTOR));

    return () => {
      barObserver.disconnect();
      itemObserver?.disconnect();
      itemObserverRef.current = null;
    };
  }, [machine, readBar, measureWidths, sync]);

  // Nothing overflows any more, so close the menu. Deriving this during
  // render instead would silently reopen it the next time the bar narrows.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    if (collapsed.size === 0) setMenuOpen(false);
  }, [collapsed]);

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

  const isOverflowed = (extension: DevToolbarExtension) => collapsed.has(extension.id);
  const overflowed = [...startItems, ...endItems].filter(isOverflowed);
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

function rosterItem(extension: DevToolbarExtension, region: CollapseItem["region"]): CollapseItem {
  return { id: extension.id, priority: extension.priority ?? 0, region };
}
