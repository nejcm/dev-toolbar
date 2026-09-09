/** Item hosts directly in bar regions, excluding overflow copies and unowned markup. */
export const ITEM_SELECTOR = '[data-dtb-part="region"] > [data-dtb-part="item"][data-dtb-ext-id]';

export interface MeasurementObserver {
  sync(nodes: Iterable<Element>): void;
  disconnect(): void;
}

export interface Measurer {
  barWidth(bar: HTMLElement): number;
  itemWidth(host: HTMLElement): number;
  buttonWidth(button: HTMLElement | null): number;
  regionGap(bar: HTMLElement): number | undefined;
  padding(bar: HTMLElement): number | undefined;
  height(root: HTMLElement): number;
  observe(notify: () => void): MeasurementObserver | undefined;
}

function readPx(raw: string): number | undefined {
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export const domMeasurer: Measurer = {
  barWidth: (bar) => bar.clientWidth,
  itemWidth: (host) => host.offsetWidth,
  buttonWidth: (button) => button?.offsetWidth ?? 0,
  regionGap(bar) {
    if (typeof getComputedStyle !== "function") return undefined;
    const region = bar.querySelector<HTMLElement>('[data-dtb-part="region"]');
    if (!region) return undefined;
    const style = getComputedStyle(region);
    return readPx(style.columnGap || style.gap);
  },
  padding(bar) {
    if (typeof getComputedStyle !== "function") return undefined;
    const style = getComputedStyle(bar);
    return (readPx(style.paddingLeft) ?? 0) + (readPx(style.paddingRight) ?? 0);
  },
  height: (root) => root.getBoundingClientRect().height,
  observe(notify) {
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(notify);
    let observed = new Set<Element>();
    return {
      sync(nodes) {
        const next = new Set(nodes);
        for (const node of observed) {
          if (!next.has(node)) observer.unobserve(node);
        }
        for (const node of next) {
          // Re-observing an unchanged target queues another initial delivery.
          if (!observed.has(node)) observer.observe(node);
        }
        observed = next;
      },
      disconnect() {
        observer.disconnect();
        observed.clear();
      },
    };
  },
};

/**
 * The registry slot a test writes its own {@link Measurer} into.
 *
 * A well-known symbol on `globalThis` rather than an exported setter, on
 * purpose. The CJS build does not code-split, so a CommonJS consumer who
 * requires both `.` and `./testing` can end up with two inlined copies of this
 * module (AGENTS.md). `Symbol.for` keys the *global* symbol registry, so both
 * copies read the same slot and one registration answers both. A module-level
 * `let` behind a setter would reach only the copy the caller imported and
 * leave the other silently measuring the real DOM — wrong numbers instead of a
 * loud failure.
 *
 * Internal: re-exported from no entry point, so it is not a semver commitment.
 */
export const MEASURER_SLOT: unique symbol = Symbol.for("@nejcm/dev-toolbar.measurer");

/**
 * How the slot is typed without publishing it. Declaring the property on a
 * module-local type and casting at the single read site keeps it out of
 * `dist/*.d.ts` — `tsup`'s declaration rollup emits only what an entry point's
 * surface reaches, and augmenting `globalThis` here would instead publish the
 * property to every consumer's global scope.
 */
type MeasurerSlot = { [MEASURER_SLOT]?: Measurer | undefined };

/**
 * The measurer to read pixels through: the registered override if there is
 * one, otherwise the DOM.
 *
 * Resolved per call, never captured at import: a test registers its fake long
 * after this module was evaluated, and callers are effects that run again on
 * every commit. Call it inside the browser-only effect that measures, not at
 * module scope, so the server never touches the slot.
 */
export function resolveMeasurer(): Measurer {
  return (globalThis as MeasurerSlot)[MEASURER_SLOT] ?? domMeasurer;
}
