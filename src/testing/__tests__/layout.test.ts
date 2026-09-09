/**
 * The fake layout's measurements, observer delivery and install lifetime.
 *
 * The patches are on shared objects (`HTMLElement.prototype`, `globalThis`), so
 * the only thing that makes them safe is that installing and restoring is
 * disciplined. Each case here is a way that discipline used to break: an
 * install that captured a *previous* value which was itself a fake, and then
 * put it back.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Measurer } from "../../core/measurer";
import { installToolbarLayout, restoreToolbarLayouts } from "../layout";

// The same well-known key `../layout` registers under, re-derived rather than
// imported: `Symbol.for` is the whole point of the seam.
const MEASURER_SLOT = Symbol.for("@nejcm/dev-toolbar.measurer");
type Slot = { [MEASURER_SLOT]?: Measurer };

/** The measurer a live install registered. Throws if nothing is installed. */
const measurer = (): Measurer => {
  const registered = (globalThis as Slot)[MEASURER_SLOT];
  if (!registered) throw new Error("no measurer registered");
  return registered;
};

// Captured before this file installs anything, so "restored" means restored to
// jsdom's own implementations rather than to some earlier fake. Descriptors are
// freshly allocated objects on every read, so the getter is what to compare.
const nativeOffsetWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetWidth",
)?.get;
const nativeClientWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "clientWidth",
)?.get;
const nativeGetComputedStyle = globalThis.getComputedStyle;
const nativeRect = HTMLElement.prototype.getBoundingClientRect;
const hadResizeObserver = "ResizeObserver" in globalThis;

const bar = () => {
  const element = document.createElement("div");
  element.dataset["dtbPart"] = "bar";
  return element;
};

const item = (id: string) => {
  const element = document.createElement("div");
  element.dataset["dtbPart"] = "item";
  element.dataset["dtbExtId"] = id;
  return element;
};

const root = () => {
  const element = document.createElement("div");
  element.dataset["dtbPart"] = "root";
  return element;
};

/** A bar with a region inside it, which is what `regionGap()` looks for. */
const barWithRegion = () => {
  const element = bar();
  const region = document.createElement("div");
  region.dataset["dtbPart"] = "region";
  element.append(region);
  return element;
};

/** Every patch this module makes, back the way jsdom had it. */
const isPristine = () =>
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth")?.get ===
    nativeOffsetWidth &&
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth")?.get ===
    nativeClientWidth &&
  HTMLElement.prototype.getBoundingClientRect === nativeRect &&
  globalThis.getComputedStyle === nativeGetComputedStyle &&
  "ResizeObserver" in globalThis === hadResizeObserver;

describe("installToolbarLayout", () => {
  afterEach(restoreToolbarLayouts);
  it("keeps observing remaining targets after unobserve()", () => {
    const handle = installToolbarLayout();
    const callback = vi.fn<ResizeObserverCallback>();
    const observer = new ResizeObserver(callback);
    const a = item("a");
    const b = item("b");

    observer.observe(a);
    observer.observe(b);
    handle.flush();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0].map((entry) => entry.target)).toEqual([a, b]);
    expect(callback.mock.calls[0]?.[1]).toBe(observer);

    observer.unobserve(a);
    handle.flush();
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback.mock.lastCall?.[0].map((entry) => entry.target)).toEqual([b]);

    observer.unobserve(b);
    handle.flush();
    expect(callback).toHaveBeenCalledTimes(2);

    observer.observe(a);
    observer.observe(a);
    handle.flush();
    expect(callback).toHaveBeenCalledTimes(3);
    expect(callback.mock.lastCall?.[0].map((entry) => entry.target)).toEqual([a]);

    observer.disconnect();
    handle.flush();
    expect(callback).toHaveBeenCalledTimes(3);

    observer.observe(b);
    handle.flush();
    expect(callback).toHaveBeenCalledTimes(4);
    observer.unobserve(b);
    handle.flush();
    expect(callback).toHaveBeenCalledTimes(4);
    handle.restore();
  });

  it("reports explicit zero padding and gap", () => {
    installToolbarLayout({ paddingX: 0, gap: 0 });
    expect(getComputedStyle(bar())).toMatchObject({
      paddingLeft: "0px",
      paddingRight: "0px",
      columnGap: "0px",
      gap: "0px",
    });
  });

  it("preserves computed styles when padding and gap are omitted", () => {
    const target = bar();
    target.style.cssText = "padding: 3px 5px; gap: 7px; column-gap: 9px";
    const nativeStyle = getComputedStyle(target);
    const handle = installToolbarLayout();
    expect(getComputedStyle(target)).toMatchObject({
      paddingLeft: nativeStyle.paddingLeft,
      paddingRight: nativeStyle.paddingRight,
      gap: nativeStyle.gap,
      columnGap: nativeStyle.columnGap,
    });
    handle.setGap(0);
    expect(getComputedStyle(target)).toMatchObject({
      gap: "0px",
      columnGap: "0px",
      paddingLeft: "5px",
    });
    handle.setPaddingX(0);
    expect(getComputedStyle(target).paddingLeft).toBe("0px");
  });

  it("missing getComputedStyle preserves fallback", () => {
    // docs/testing.md: omitting `paddingX`/`gap` leaves the original computed
    // styles unchanged, "preserving core's fallback when jsdom cannot resolve
    // them". A host with no `getComputedStyle` at all is the sharpest case of
    // "cannot resolve": `domMeasurer` guards both of its reads and answers
    // `undefined`, which a `CollapseReading` treats as "keep what the machine
    // already has". The registered measurer has to answer the same rather than
    // throw, or core loses a fallback it still guards for.
    const native = globalThis.getComputedStyle;
    installToolbarLayout();
    const target = barWithRegion();
    // Deleted, not set to `undefined`: that is why both guards are written as
    // `typeof`, which is the one read of an absent binding that is not a
    // `ReferenceError`.
    Reflect.deleteProperty(globalThis, "getComputedStyle");
    try {
      expect(measurer().padding(target)).toBeUndefined();
      expect(measurer().regionGap(target)).toBeUndefined();
    } finally {
      globalThis.getComputedStyle = native;
    }
  });

  it("does not inherit an outer install's style overrides when options are omitted", () => {
    const target = bar();
    const nativeStyle = getComputedStyle(target);
    installToolbarLayout({ paddingX: 12, gap: 8 });
    const inner = installToolbarLayout();
    expect(getComputedStyle(target)).toMatchObject({
      paddingLeft: nativeStyle.paddingLeft,
      gap: nativeStyle.gap,
    });
    inner.restore();
    expect(getComputedStyle(target)).toMatchObject({ paddingLeft: "12px", gap: "8px" });
  });

  it("sets padding and gap and notifies observers with the updated style", () => {
    const handle = installToolbarLayout({ paddingX: 12, gap: 8 });
    const target = bar();
    const seen: string[][] = [];
    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(target);
      seen.push([style.paddingLeft, style.paddingRight, style.columnGap, style.gap]);
    });
    observer.observe(target);

    handle.flush();
    handle.setPaddingX(6);
    handle.setGap(2);
    expect(seen).toEqual([
      ["12px", "12px", "8px", "8px"],
      ["6px", "6px", "8px", "8px"],
      ["6px", "6px", "2px", "2px"],
    ]);
  });

  it("leaves unrelated computed styles untouched and restores toolbar styles", () => {
    const unrelated = document.createElement("div");
    const target = bar();
    for (const element of [unrelated, target]) {
      element.style.cssText = "padding: 3px 5px; gap: 7px; column-gap: 9px; color: red";
      document.body.append(element);
    }
    try {
      const before = getComputedStyle(unrelated).cssText;
      const handle = installToolbarLayout({ paddingX: 12, gap: 8 });
      expect(getComputedStyle(unrelated).cssText).toBe(before);
      expect(getComputedStyle(unrelated)).toMatchObject({
        paddingLeft: "5px",
        paddingRight: "5px",
        columnGap: "9px",
        gap: "7px",
      });
      expect(getComputedStyle(target)).toMatchObject({
        paddingLeft: "12px",
        paddingRight: "12px",
        columnGap: "8px",
        gap: "8px",
        paddingTop: "3px",
      });
      expect(getComputedStyle(target).getPropertyValue("color")).toBe("rgb(255, 0, 0)");
      handle.restore();
      expect(globalThis.getComputedStyle).toBe(nativeGetComputedStyle);
      expect(getComputedStyle(target).cssText).toBe(before);
      expect(getComputedStyle(target).paddingLeft).toBe("5px");
      expect(getComputedStyle(target).gap).toBe("7px");
      expect(getComputedStyle(unrelated).cssText).toBe(before);
    } finally {
      unrelated.remove();
      target.remove();
    }
  });

  it.each(["inner", "outer", "all"])("restores stacked styles via %s", (first) => {
    const outer = installToolbarLayout({ paddingX: 6, gap: 2 });
    const inner = installToolbarLayout({ paddingX: 12, gap: 8 });
    expect(getComputedStyle(bar())).toMatchObject({ paddingLeft: "12px", gap: "8px" });
    if (first === "inner") {
      inner.restore();
      expect(getComputedStyle(bar())).toMatchObject({ paddingLeft: "6px", gap: "2px" });
      outer.restore();
    } else if (first === "outer") {
      outer.restore();
      expect(getComputedStyle(bar())).toMatchObject({ paddingLeft: "12px", gap: "8px" });
      inner.restore();
    } else {
      restoreToolbarLayouts();
    }
    expect(isPristine()).toBe(true);
  });

  it("delivers measured rectangles for every target and updates them on setters", () => {
    const handle = installToolbarLayout({ barWidth: 500, itemWidths: { a: 123 }, rootHeight: 42 });
    const targets = [bar(), item("a"), root(), document.createElement("div")];
    const callback = vi.fn<ResizeObserverCallback>();
    const observer = new ResizeObserver(callback);
    for (const target of targets) observer.observe(target);
    handle.flush();
    const entries = callback.mock.lastCall![0];
    expect(entries.map((entry) => entry.target)).toEqual(targets);
    expect(entries.map((entry) => [entry.contentRect.width, entry.contentRect.height])).toEqual([
      [500, 0],
      [123, 0],
      [500, 42],
      [0, 0],
    ]);
    expect(entries[1]?.contentRect.toJSON()).toMatchObject({ x: 0, y: 0, right: 123, bottom: 0 });
    handle.setItemWidth("a", 150);
    expect(callback.mock.lastCall?.[0][1]?.contentRect.width).toBe(150);
    handle.resize(600);
    expect(callback.mock.lastCall?.[0][0]?.contentRect.width).toBe(600);
    handle.setRootHeight(64);
    expect(callback.mock.lastCall?.[0][2]?.contentRect.height).toBe(64);
    expect(entries[1]?.contentRect.width).toBe(123);
  });

  it("defers width notifications and lets a selected observer deliver its own entries", () => {
    const handle = installToolbarLayout();
    const barCallback = vi.fn<ResizeObserverCallback>();
    const itemCallback = vi.fn<ResizeObserverCallback>();
    const barObserver = new ResizeObserver(barCallback);
    const itemObserver = new ResizeObserver(itemCallback);
    const barTarget = bar();
    const itemTarget = item("a");
    barObserver.observe(barTarget);
    itemObserver.observe(itemTarget);
    const observers = handle.getObservers();
    const barHandle = observers.find((observer) => observer.getTargets().includes(barTarget))!;
    const itemHandle = observers.find((observer) => observer.getTargets().includes(itemTarget))!;

    handle.setItemWidth("a", 900, false);
    handle.resize(999, false);
    expect(itemTarget.offsetWidth).toBe(900);
    expect(barTarget.clientWidth).toBe(999);
    expect(barCallback).not.toHaveBeenCalled();
    expect(itemCallback).not.toHaveBeenCalled();
    itemHandle.flush();
    expect(barCallback).not.toHaveBeenCalled();
    expect(itemCallback).toHaveBeenCalledTimes(1);
    expect(itemCallback.mock.lastCall?.[0][0]?.contentRect.width).toBe(900);
    barHandle.flush();
    expect(barCallback).toHaveBeenCalledTimes(1);
    expect(itemCallback).toHaveBeenCalledTimes(1);
    expect(barCallback.mock.lastCall?.[0][0]?.contentRect.width).toBe(999);

    itemObserver.disconnect();
    itemHandle.flush();
    expect(itemCallback).toHaveBeenCalledTimes(1);
    handle.restore();
    barHandle.flush();
    expect(barCallback).toHaveBeenCalledTimes(1);
  });

  it("inspects target snapshots through observation changes and disconnect", () => {
    const handle = installToolbarLayout();
    expect(handle.getObservers()).toEqual([]);
    const observer = new ResizeObserver(() => {});
    const handles = handle.getObservers();
    const observed = handles[0]!;
    expect(observed.getTargets()).toEqual([]);
    const a = item("a");
    const b = item("b");
    observer.observe(a);
    observer.observe(b);
    observer.observe(a);
    const before = observed.getTargets();
    expect(before).toEqual([a, b]);
    observer.unobserve(a);
    expect(observed.getTargets()).toEqual([b]);
    expect(before).toEqual([a, b]);
    observer.disconnect();
    expect(observed.getTargets()).toEqual([]);
    expect(handle.getObservers()).toEqual(handles);
    observer.observe(a);
    expect(observed.getTargets()).toEqual([a]);
    new ResizeObserver(() => {});
    expect(handles).toHaveLength(1);
    expect(handle.getObservers()).toHaveLength(2);
  });

  it("keeps observer inspection and selective delivery owned by their install", () => {
    const outer = installToolbarLayout();
    const callback = vi.fn<ResizeObserverCallback>();
    const observer = new ResizeObserver(callback);
    observer.observe(bar());
    const outerObserver = outer.getObservers()[0]!;
    const inner = installToolbarLayout({ barWidth: 222 });
    expect(inner.getObservers()).toEqual([]);
    outerObserver.flush();
    expect(callback.mock.lastCall?.[0][0]?.contentRect.width).toBe(222);
    outer.restore();
    outerObserver.flush();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(outer.getObservers()).toEqual([]);
    inner.restore();
  });

  it("starts from, and returns to, jsdom's own implementations", () => {
    expect(isPristine()).toBe(true);
    const handle = installToolbarLayout({ barWidth: 123 });
    expect(bar().offsetWidth).toBe(123);
    expect(isPristine()).toBe(false);
    handle.restore();
    expect(isPristine()).toBe(true);
    expect(bar().offsetWidth).toBe(0);
  });

  it("restores in any order, not only the reverse of installation", () => {
    const a = installToolbarLayout({ barWidth: 111 });
    const b = installToolbarLayout({ barWidth: 222 });

    // Insertion order — what a shared `unmountAll` array drains in, and what
    // used to leave `a`'s fake getter on the prototype for good.
    a.restore();
    b.restore();

    expect(isPristine()).toBe(true);
    expect(bar().offsetWidth).toBe(0);
  });

  it("treats a second restore() as a no-op, not as a second unpatch", () => {
    const a = installToolbarLayout({ barWidth: 111 });
    a.restore();
    a.restore();
    expect(isPristine()).toBe(true);

    // And a stale restore cannot take a *live* install's patches away.
    const b = installToolbarLayout({ barWidth: 222 });
    a.restore();
    expect(bar().offsetWidth).toBe(222);
    b.restore();
    expect(isPristine()).toBe(true);
  });

  it("stacks: the newest install measures, and restoring it hands back", () => {
    const outer = installToolbarLayout({ barWidth: 111, itemWidth: 11 });
    const inner = installToolbarLayout({ barWidth: 222, itemWidth: 22 });
    expect(bar().offsetWidth).toBe(222);

    inner.restore();
    expect(bar().offsetWidth).toBe(111);
    expect(isPristine()).toBe(false);

    outer.restore();
    expect(isPristine()).toBe(true);
  });

  it("keeps each install's observers, and each install's widths, separate", () => {
    const outer = installToolbarLayout({ barWidth: 111 });
    const outerSeen: number[] = [];
    const outerObserver = new ResizeObserver(() => outerSeen.push(bar().offsetWidth));
    outerObserver.observe(document.body);

    const inner = installToolbarLayout({ barWidth: 222 });
    const innerSeen: number[] = [];
    const innerObserver = new ResizeObserver(() => innerSeen.push(bar().offsetWidth));
    innerObserver.observe(document.body);

    // `outer.flush()` fires only what was constructed while `outer` was on top,
    // and the width it reads is the topmost install's — `inner`'s.
    outer.flush();
    expect(outerSeen).toEqual([222]);
    expect(innerSeen).toEqual([]);

    inner.resize(300);
    expect(innerSeen).toEqual([300]);

    inner.restore();
    // Restoring drops that install's observers rather than leaving a detached
    // set to be fired by a later flush.
    inner.flush();
    expect(innerSeen).toEqual([300]);

    outer.flush();
    expect(outerSeen).toEqual([222, 111]);

    outer.restore();
    expect(isPristine()).toBe(true);
  });

  it("leaves getBoundingClientRect alone for anything but the root", () => {
    const handle = installToolbarLayout({ barWidth: 640, rootHeight: 42 });
    const rect = root().getBoundingClientRect();
    expect(rect).toBeInstanceOf(DOMRect);
    expect(rect.height).toBe(42);
    expect(rect.toJSON()).toMatchObject({ width: 640, height: 42, right: 640, bottom: 42 });
    // A plain element still gets jsdom's own zero rect, not the fake one.
    expect(document.createElement("div").getBoundingClientRect().height).toBe(0);
    handle.restore();
  });

  it("setItemWidth() overrides one item's measured width and notifies observers", () => {
    const handle = installToolbarLayout({ itemWidth: 80 });
    const seen: number[] = [];
    const observer = new ResizeObserver(() => seen.push(item("a").offsetWidth));
    observer.observe(document.body);

    // Items without an override still read the default.
    expect(item("a").offsetWidth).toBe(80);
    expect(item("b").offsetWidth).toBe(80);

    handle.setItemWidth("a", 150);

    expect(item("a").offsetWidth).toBe(150);
    // Unrelated items are untouched.
    expect(item("b").offsetWidth).toBe(80);
    // And every observer under this install fired, exactly like resize().
    expect(seen).toEqual([150]);

    handle.restore();
  });

  it("setRootHeight() changes the height getBoundingClientRect() reports for the root", () => {
    const handle = installToolbarLayout({ barWidth: 700, rootHeight: 30 });
    const seen: number[] = [];
    const observer = new ResizeObserver(() => seen.push(root().getBoundingClientRect().height));
    observer.observe(document.body);

    expect(root().getBoundingClientRect().height).toBe(30);

    handle.setRootHeight(64);

    expect(root().getBoundingClientRect().height).toBe(64);
    // The width reported alongside it is unaffected.
    expect(root().getBoundingClientRect().width).toBe(700);
    expect(seen).toEqual([64]);

    handle.restore();
  });

  it("flush() fires every observer without changing any measurement", () => {
    const handle = installToolbarLayout({ barWidth: 500 });
    const seen: number[] = [];
    const observer = new ResizeObserver(() => seen.push(bar().offsetWidth));
    observer.observe(document.body);

    expect(seen).toEqual([]);
    handle.flush();
    expect(seen).toEqual([500]);
    handle.flush();
    expect(seen).toEqual([500, 500]);
    expect(bar().offsetWidth).toBe(500);

    handle.restore();
  });
});
