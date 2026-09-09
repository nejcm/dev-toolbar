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
