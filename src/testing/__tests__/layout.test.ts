/**
 * The fake layout's measurements, observer delivery and install lifetime.
 *
 * The two things an install owns are `globalThis` state — the measurer slot
 * core reads through, and the `ResizeObserver` jsdom lacks — so installing and
 * restoring must stay disciplined (e.g. never capturing a *previous* value
 * that was itself a fake, then putting that back).
 *
 * Measurements are asserted through the registered `Measurer`, since that is
 * the only way core sees them. The complementary assertion — that a live
 * install leaves every DOM read at jsdom's own answer — lives in
 * `src/core/__tests__/layoutMeasurer.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Measurer } from "../../core/measurer";
import { installToolbarLayout, restoreToolbarLayouts } from "../layout";

// The same well-known key `../layout` registers under, re-derived rather than
// imported: `Symbol.for` is the whole point of the seam.
const MEASURER_SLOT = Symbol.for("@nejcm/dev-toolbar.measurer");
type Slot = { [MEASURER_SLOT]?: Measurer };

// Captured before this file installs anything, so "restored" means restored to
// what the runner started with rather than to some earlier fake.
const nativeSlot = Object.getOwnPropertyDescriptor(globalThis, MEASURER_SLOT);
const hadResizeObserver = "ResizeObserver" in globalThis;

/** The measurer a live install registered. Throws if nothing is installed. */
const measurer = (): Measurer => {
  const registered = (globalThis as Slot)[MEASURER_SLOT];
  if (!registered) throw new Error("no measurer registered");
  return registered;
};

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

const overflowButton = () => {
  const element = document.createElement("button");
  element.dataset["dtbPart"] = "overflow-button";
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

/** Both globals this module writes, back the way the runner had them. */
const isPristine = () =>
  Object.getOwnPropertyDescriptor(globalThis, MEASURER_SLOT)?.value === nativeSlot?.value &&
  "ResizeObserver" in globalThis === hadResizeObserver;

/** Reported padding on one side, from the `paddingX` the measurer doubles. */
const paddingX = (target: HTMLElement) => (measurer().padding(target) ?? 0) / 2;

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
    const target = barWithRegion();
    // An explicit `0` is an override, not an omission: it must report `0`
    // rather than fall through to the element's own computed style.
    target.style.cssText = "padding: 3px 5px";
    document.body.append(target);
    try {
      expect(measurer().padding(target)).toBe(0);
      expect(measurer().regionGap(target)).toBe(0);
    } finally {
      target.remove();
    }
  });

  it("preserves computed styles when padding and gap are omitted", () => {
    const target = barWithRegion();
    const region = target.firstElementChild as HTMLElement;
    target.style.cssText = "padding: 3px 5px";
    region.style.cssText = "gap: 7px; column-gap: 9px";
    document.body.append(target);
    try {
      const handle = installToolbarLayout();
      // Core's own fallback, still in play: the numbers are the element's.
      expect(measurer().padding(target)).toBe(10);
      expect(measurer().regionGap(target)).toBe(9);
      handle.setGap(0);
      expect(measurer().regionGap(target)).toBe(0);
      expect(paddingX(target)).toBe(5);
      handle.setPaddingX(0);
      expect(measurer().padding(target)).toBe(0);
    } finally {
      target.remove();
    }
  });

  it("missing getComputedStyle preserves fallback", () => {
    // No `getComputedStyle` at all must answer `undefined`, same as
    // `domMeasurer`'s own guard, so core keeps its existing value rather than
    // throwing.
    const native = globalThis.getComputedStyle;
    installToolbarLayout();
    const target = barWithRegion();
    // Deleted, not `undefined`: `typeof` is the one read of an absent binding
    // that isn't a `ReferenceError`.
    Reflect.deleteProperty(globalThis, "getComputedStyle");
    try {
      expect(measurer().padding(target)).toBeUndefined();
      expect(measurer().regionGap(target)).toBeUndefined();
    } finally {
      globalThis.getComputedStyle = native;
    }
  });

  it("does not inherit an outer install's style overrides when options are omitted", () => {
    const target = barWithRegion();
    target.style.cssText = "padding: 3px 5px";
    (target.firstElementChild as HTMLElement).style.cssText = "column-gap: 9px";
    document.body.append(target);
    try {
      installToolbarLayout({ paddingX: 12, gap: 8 });
      const inner = installToolbarLayout();
      expect(paddingX(target)).toBe(5);
      expect(measurer().regionGap(target)).toBe(9);
      inner.restore();
      expect(paddingX(target)).toBe(12);
      expect(measurer().regionGap(target)).toBe(8);
    } finally {
      target.remove();
    }
  });

  it("sets padding and gap and notifies observers with the updated measurements", () => {
    const handle = installToolbarLayout({ paddingX: 12, gap: 8 });
    const target = barWithRegion();
    const seen: number[][] = [];
    const observer = new ResizeObserver(() => {
      seen.push([paddingX(target), measurer().regionGap(target) ?? -1]);
    });
    observer.observe(target);

    handle.flush();
    handle.setPaddingX(6);
    handle.setGap(2);
    expect(seen).toEqual([
      [12, 8],
      [6, 8],
      [6, 2],
    ]);
  });

  it("leaves getComputedStyle itself alone, for toolbar parts as much as anything else", () => {
    const unrelated = document.createElement("div");
    const target = barWithRegion();
    for (const element of [unrelated, target]) {
      element.style.cssText = "padding: 3px 5px; gap: 7px; column-gap: 9px; color: red";
      document.body.append(element);
    }
    try {
      const before = getComputedStyle(unrelated).cssText;
      const handle = installToolbarLayout({ paddingX: 12, gap: 8 });
      // A live install must not fight a consumer's own styles or stubs — the
      // override reaches core through the measurer only.
      expect(getComputedStyle(target).cssText).toBe(before);
      expect(getComputedStyle(target)).toMatchObject({
        paddingLeft: "5px",
        paddingRight: "5px",
        columnGap: "9px",
        gap: "7px",
      });
      expect(getComputedStyle(unrelated).cssText).toBe(before);
      expect(paddingX(target)).toBe(12);
      handle.restore();
      expect(getComputedStyle(target).paddingLeft).toBe("5px");
      expect(getComputedStyle(unrelated).cssText).toBe(before);
    } finally {
      unrelated.remove();
      target.remove();
    }
  });

  it.each(["inner", "outer", "all"])("restores stacked spacing via %s", (first) => {
    const target = barWithRegion();
    const outer = installToolbarLayout({ paddingX: 6, gap: 2 });
    const inner = installToolbarLayout({ paddingX: 12, gap: 8 });
    expect([paddingX(target), measurer().regionGap(target)]).toEqual([12, 8]);
    if (first === "inner") {
      inner.restore();
      expect([paddingX(target), measurer().regionGap(target)]).toEqual([6, 2]);
      outer.restore();
    } else if (first === "outer") {
      outer.restore();
      expect([paddingX(target), measurer().regionGap(target)]).toEqual([12, 8]);
      inner.restore();
    } else {
      restoreToolbarLayouts();
    }
    expect(isPristine()).toBe(true);
  });

  it("delivers a measured rectangle per target, and never rewrites a delivered entry", () => {
    const handle = installToolbarLayout({
      barWidth: 500,
      itemWidths: { a: 123 },
      overflowButtonWidth: 29,
      rootHeight: 42,
    });
    const targets = [bar(), item("a"), root(), overflowButton(), document.createElement("div")];
    const callback = vi.fn<ResizeObserverCallback>();
    const observer = new ResizeObserver(callback);
    for (const target of targets) observer.observe(target);
    handle.flush();
    const entries = callback.mock.lastCall![0];
    expect(entries.map((entry) => entry.target)).toEqual(targets);
    // A consumer's own observer reads these entries directly, so a zero
    // rectangle would silently send `if (width < 500)` down the wrong branch.
    expect(entries.map((entry) => [entry.contentRect.width, entry.contentRect.height])).toEqual([
      [500, 0],
      [123, 0],
      [500, 42],
      [29, 0],
      [0, 0],
    ]);
    expect(entries.map((entry) => entry.borderBoxSize)).toEqual([[], [], [], [], []]);

    // Matches a real entry's shape: `DOMRectReadOnly`, not `DOMRect` — derived
    // edges show up in `toJSON()`, but own keys and a spread stay empty.
    const itemRect = entries[1]!.contentRect;
    expect(itemRect).toBeInstanceOf(DOMRectReadOnly);
    expect(itemRect).not.toBeInstanceOf(DOMRect);
    expect(itemRect.toJSON()).toMatchObject({ x: 0, y: 0, right: 123, bottom: 0 });
    expect(Object.keys(itemRect)).toEqual([]);
    expect({ ...itemRect }).toEqual({});

    const [barTarget, itemTarget, rootTarget] = targets as (HTMLElement | undefined)[];
    expect(measurer().barWidth(barTarget!)).toBe(500);
    expect(measurer().itemWidth(itemTarget!)).toBe(123);
    expect(measurer().height(rootTarget!)).toBe(42);

    handle.setItemWidth("a", 150);
    expect(callback.mock.lastCall?.[0][1]?.contentRect.width).toBe(150);
    expect(measurer().itemWidth(itemTarget!)).toBe(150);
    handle.resize(600);
    expect(callback.mock.lastCall?.[0][0]?.contentRect.width).toBe(600);
    handle.setRootHeight(64);
    expect(callback.mock.lastCall?.[0][2]?.contentRect.height).toBe(64);
    expect(callback).toHaveBeenCalledTimes(4);

    // Entries captured at the first flush still read what they were
    // delivered with, three setters later.
    expect(itemRect.width).toBe(123);
    expect(entries[0]?.contentRect.width).toBe(500);
    expect(entries[2]?.contentRect.height).toBe(42);
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
    // Measured immediately, delivered to nobody: that is what `false` buys.
    expect(measurer().itemWidth(itemTarget)).toBe(900);
    expect(measurer().barWidth(barTarget)).toBe(999);
    expect(barCallback).not.toHaveBeenCalled();
    expect(itemCallback).not.toHaveBeenCalled();
    itemHandle.flush();
    expect(barCallback).not.toHaveBeenCalled();
    expect(itemCallback).toHaveBeenCalledTimes(1);
    expect(itemCallback.mock.lastCall?.[0].map((entry) => entry.target)).toEqual([itemTarget]);
    barHandle.flush();
    expect(barCallback).toHaveBeenCalledTimes(1);
    expect(itemCallback).toHaveBeenCalledTimes(1);
    expect(barCallback.mock.lastCall?.[0].map((entry) => entry.target)).toEqual([barTarget]);

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
    const target = bar();
    const seen: number[] = [];
    const observer = new ResizeObserver(() => seen.push(measurer().barWidth(target)));
    observer.observe(target);
    const outerObserver = outer.getObservers()[0]!;
    const inner = installToolbarLayout({ barWidth: 222 });
    expect(inner.getObservers()).toEqual([]);
    outerObserver.flush();
    // Fired by the outer handle, measured by the inner install: the topmost
    // one answers, whoever delivered.
    expect(seen).toEqual([222]);
    outer.restore();
    outerObserver.flush();
    expect(seen).toEqual([222]);
    expect(outer.getObservers()).toEqual([]);
    inner.restore();
  });

  it("starts from, and returns to, the globals the runner had", () => {
    expect(isPristine()).toBe(true);
    const handle = installToolbarLayout({ barWidth: 123 });
    expect(measurer().barWidth(bar())).toBe(123);
    expect(isPristine()).toBe(false);
    handle.restore();
    expect(isPristine()).toBe(true);
    expect((globalThis as Slot)[MEASURER_SLOT]).toBeUndefined();
  });

  it("restores in any order, not only the reverse of installation", () => {
    const a = installToolbarLayout({ barWidth: 111 });
    const b = installToolbarLayout({ barWidth: 222 });

    // Insertion order, not reverse — used to leave `a`'s fakes registered for good.
    a.restore();
    b.restore();

    expect(isPristine()).toBe(true);
  });

  it("treats a second restore() as a no-op, not as a second unpatch", () => {
    const a = installToolbarLayout({ barWidth: 111 });
    a.restore();
    a.restore();
    expect(isPristine()).toBe(true);

    // And a stale restore cannot take a *live* install's registration away.
    const b = installToolbarLayout({ barWidth: 222 });
    a.restore();
    expect(measurer().barWidth(bar())).toBe(222);
    b.restore();
    expect(isPristine()).toBe(true);
  });

  it("stacks: the newest install measures, and restoring it hands back", () => {
    const outer = installToolbarLayout({ barWidth: 111, itemWidth: 11 });
    const inner = installToolbarLayout({ barWidth: 222, itemWidth: 22 });
    expect(measurer().barWidth(bar())).toBe(222);
    expect(measurer().itemWidth(item("a"))).toBe(22);

    inner.restore();
    expect(measurer().barWidth(bar())).toBe(111);
    expect(measurer().itemWidth(item("a"))).toBe(11);
    expect(isPristine()).toBe(false);

    outer.restore();
    expect(isPristine()).toBe(true);
  });

  it("keeps each install's observers, and each install's widths, separate", () => {
    const outer = installToolbarLayout({ barWidth: 111 });
    const outerSeen: number[] = [];
    const outerObserver = new ResizeObserver(() => outerSeen.push(measurer().barWidth(bar())));
    outerObserver.observe(document.body);

    const inner = installToolbarLayout({ barWidth: 222 });
    const innerSeen: number[] = [];
    const innerObserver = new ResizeObserver(() => innerSeen.push(measurer().barWidth(bar())));
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

  it("never touches an element's own rectangle, root or not", () => {
    const handle = installToolbarLayout({ barWidth: 640, rootHeight: 42 });
    const rootTarget = root();
    // The root's height reaches core through `Measurer.height`;
    // `getBoundingClientRect()` stays jsdom's own, unpatched.
    expect(measurer().height(rootTarget)).toBe(42);
    const rect = rootTarget.getBoundingClientRect();
    expect(rect.height).toBe(0);
    expect(rect.width).toBe(0);
    // jsdom's own zero rectangle, not a synthesized one: a plain object,
    // neither a `DOMRect` nor carrying `toJSON()`.
    expect(rect).not.toBeInstanceOf(DOMRect);
    expect((rect as { toJSON?: unknown }).toJSON).toBeUndefined();
    expect(document.createElement("div").getBoundingClientRect().height).toBe(0);
    handle.restore();
  });

  it("setItemWidth() overrides one item's measured width and notifies observers", () => {
    const handle = installToolbarLayout({ itemWidth: 80 });
    const seen: number[] = [];
    const observer = new ResizeObserver(() => seen.push(measurer().itemWidth(item("a"))));
    observer.observe(document.body);

    // Items without an override still read the default.
    expect(measurer().itemWidth(item("a"))).toBe(80);
    expect(measurer().itemWidth(item("b"))).toBe(80);

    handle.setItemWidth("a", 150);

    expect(measurer().itemWidth(item("a"))).toBe(150);
    // Unrelated items are untouched.
    expect(measurer().itemWidth(item("b"))).toBe(80);
    // And every observer under this install fired, exactly like resize().
    expect(seen).toEqual([150]);

    handle.restore();
  });

  it("setRootHeight() changes the height the measurer reports for the root", () => {
    const handle = installToolbarLayout({ barWidth: 700, rootHeight: 30 });
    const seen: number[] = [];
    const observer = new ResizeObserver(() => seen.push(measurer().height(root())));
    observer.observe(document.body);

    expect(measurer().height(root())).toBe(30);

    handle.setRootHeight(64);

    expect(measurer().height(root())).toBe(64);
    // The bar width reported alongside it is unaffected.
    expect(measurer().barWidth(bar())).toBe(700);
    expect(seen).toEqual([64]);

    handle.restore();
  });

  it("flush() fires every observer without changing any measurement", () => {
    const handle = installToolbarLayout({ barWidth: 500 });
    const seen: number[] = [];
    const observer = new ResizeObserver(() => seen.push(measurer().barWidth(bar())));
    observer.observe(document.body);

    expect(seen).toEqual([]);
    handle.flush();
    expect(seen).toEqual([500]);
    handle.flush();
    expect(seen).toEqual([500, 500]);
    expect(measurer().barWidth(bar())).toBe(500);

    handle.restore();
  });
});
