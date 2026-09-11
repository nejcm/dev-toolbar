/**
 * `domMeasurer` against a DOM that actually reports sizes, via
 * `src/test-utils/dom-layout.ts`, which patches the reads under test
 * (`clientWidth`, `offsetWidth`, `getComputedStyle`, `getBoundingClientRect`).
 * The published fake (`installToolbarLayout()`) can't serve here — it patches
 * no DOM read, so `domMeasurer` would just see jsdom's zeros — but it's still
 * used below for the one thing it does provide: a `ResizeObserver`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { installToolbarLayout, cleanupToolbar } from "@nejcm/dev-toolbar/testing";
import { ITEM_SELECTOR as publishedSelector } from "@nejcm/dev-toolbar";
import { patchDomLayout } from "../../test-utils/dom-layout";
import type { DomLayoutHandle, DomLayoutOptions } from "../../test-utils/dom-layout";
import { domMeasurer, ITEM_SELECTOR } from "../measurer";

let patched: DomLayoutHandle | undefined;

/** Installs the patching fixture for one test; the `afterEach` unpatches. */
const patchLayout = (options: DomLayoutOptions): DomLayoutHandle => {
  patched = patchDomLayout(options);
  return patched;
};

afterEach(() => {
  patched?.restore();
  patched = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanupToolbar();
});

function element(part: string, id?: string): HTMLElement {
  const node = document.createElement("div");
  node.dataset["dtbPart"] = part;
  if (id) node.dataset["dtbExtId"] = id;
  return node;
}

describe("domMeasurer", () => {
  it("reads widths, spacing and height through the same DOM operations as production", () => {
    const layout = patchLayout({
      barWidth: 320,
      itemWidths: { a: 101 },
      overflowButtonWidth: 29,
      paddingX: 6.5,
      gap: 12.5,
      rootHeight: 40.5,
    });
    const bar = element("bar");
    bar.append(element("region"));
    const item = element("item", "a");
    const button = element("overflow-button");
    const root = element("root");
    expect(domMeasurer.barWidth(bar)).toBe(320);
    expect(domMeasurer.itemWidth(item)).toBe(101);
    expect(domMeasurer.buttonWidth(button)).toBe(29);
    expect(domMeasurer.regionGap(bar)).toBe(12.5);
    expect(domMeasurer.padding(bar)).toBe(13);
    expect(domMeasurer.height(root)).toBe(40.5);
    layout.resize(400);
    layout.setItemWidth("a", 0);
    expect(domMeasurer.barWidth(bar)).toBe(400);
    expect(domMeasurer.itemWidth(item)).toBe(0);
    expect(domMeasurer.buttonWidth(null)).toBe(0);
  });

  it("keeps padding-box and natural widths independent of transformed rectangles", () => {
    const bar = element("bar");
    const item = element("item", "a");
    Object.defineProperty(bar, "clientWidth", { value: 320 });
    Object.defineProperty(item, "offsetWidth", { value: 100 });
    vi.spyOn(item, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 200, 20));
    expect(domMeasurer.barWidth(bar)).toBe(320);
    expect(domMeasurer.itemWidth(item)).toBe(100);
    expect(domMeasurer.buttonWidth(item)).toBe(100);
  });

  it("reads resolved spacing, including zero and fractional asymmetric padding", () => {
    const bar = element("bar");
    const region = element("region");
    bar.append(region);
    document.body.append(bar);
    try {
      bar.style.cssText = "padding-left: 2.5px; padding-right: 7px";
      region.style.cssText = "gap: 8px; column-gap: 0px";
      expect(domMeasurer.regionGap(bar)).toBe(0);
      expect(domMeasurer.padding(bar)).toBe(9.5);
      region.style.cssText = "column-gap: 8px";
      expect(domMeasurer.regionGap(bar)).toBe(8);
      region.style.columnGap = "normal";
      expect(domMeasurer.regionGap(bar)).toBeUndefined();
    } finally {
      bar.remove();
    }
  });

  it("leaves unreadable spacing absent and defaults unreadable padding sides to zero", () => {
    const bar = element("bar");
    expect(domMeasurer.regionGap(bar)).toBeUndefined();
    expect(domMeasurer.padding(bar)).toBe(0);
    vi.stubGlobal("getComputedStyle", undefined);
    expect(domMeasurer.regionGap(bar)).toBeUndefined();
    expect(domMeasurer.padding(bar)).toBeUndefined();
  });

  it("exports one selector that excludes popup copies, nested content and unidentified hosts", () => {
    const bar = element("bar");
    const region = element("region");
    const host = element("item", "a");
    host.append(element("item", "nested"));
    region.append(host, element("item"));
    const popup = element("overflow-menu-item", "b");
    popup.append(element("item", "b"));
    bar.append(region, popup);
    expect(publishedSelector).toBe(ITEM_SELECTOR);
    expect([...bar.querySelectorAll(ITEM_SELECTOR)]).toEqual([host]);
  });

  it("observes only target differences and can reuse a disconnected subscription", () => {
    const layout = installToolbarLayout();
    const observe = vi.spyOn(ResizeObserver.prototype, "observe");
    const unobserve = vi.spyOn(ResizeObserver.prototype, "unobserve");
    const notify = vi.fn();
    const observer = domMeasurer.observe(notify)!;
    const a = element("item", "a");
    const b = element("item", "b");
    observer.sync([a, a, b]);
    observer.sync([b, a]);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(unobserve).not.toHaveBeenCalled();
    layout.flush();
    expect(notify).toHaveBeenCalledTimes(1);
    observer.sync([b]);
    expect(unobserve).toHaveBeenCalledExactlyOnceWith(a);
    observer.disconnect();
    layout.flush();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(layout.getObservers()[0]?.getTargets()).toEqual([]);
    observer.sync([b]);
    expect(observe).toHaveBeenCalledTimes(3);
    layout.flush();
    expect(notify).toHaveBeenCalledTimes(2);
    observer.sync([]);
    layout.flush();
    expect(notify).toHaveBeenCalledTimes(2);
    observer.disconnect();
  });

  it("returns no subscription when ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    expect(domMeasurer.observe(vi.fn())).toBeUndefined();
  });
});
