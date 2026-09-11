import { useEffect } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DevToolbar } from "@nejcm/dev-toolbar";
import { cleanupToolbar, installToolbarLayout, makeExtension } from "@nejcm/dev-toolbar/testing";
import { reinstallToolbarLayout } from "../../testing/layout";
import type { Measurer } from "../measurer";
import { domMeasurer, ITEM_SELECTOR, MEASURER_SLOT, resolveMeasurer } from "../measurer";

/**
 * Nested `finally`s guarantee the measurer slot is always deleted, even if
 * `cleanup()` throws (an unmounting tree's own effect cleanup can throw). The
 * slot lives in the process-wide symbol registry, so leaving it behind would
 * silently answer a later suite's measurements — Vitest skips remaining
 * `afterEach` hooks once one throws, so `cleanupToolbar()` is not a second net.
 */
function teardown(): void {
  try {
    cleanup();
  } finally {
    try {
      vi.restoreAllMocks();
      cleanupToolbar();
    } finally {
      delete (globalThis as { [MEASURER_SLOT]?: unknown })[MEASURER_SLOT];
    }
  }
}

afterEach(teardown);

/** A tree whose unmount throws out of Testing Library's `cleanup()`. */
function ThrowOnCleanup() {
  useEffect(
    () => () => {
      throw new Error("dev-toolbar layout teardown probe");
    },
    [],
  );
  return <div />;
}

function part(name: string, id?: string): HTMLElement {
  const node = document.createElement("div");
  node.dataset["dtbPart"] = name;
  if (id !== undefined) node.dataset["dtbExtId"] = id;
  return node;
}

const visibleIds = () =>
  [...document.querySelectorAll<HTMLElement>(ITEM_SELECTOR)].map(
    (node) => node.dataset["dtbExtId"],
  );

describe("the published layout fake's measurer", () => {
  it("answers every option and handle mutation, leaving the DOM at jsdom's zeros", () => {
    const layout = installToolbarLayout({
      barWidth: 400,
      itemWidth: 60,
      itemWidths: { a: 90 },
      overflowButtonWidth: 32,
      paddingX: 8,
      gap: 4,
      rootHeight: 42,
    });
    const measurer = resolveMeasurer();
    expect(measurer).not.toBe(domMeasurer);
    const bar = part("bar");
    const region = part("region");
    bar.append(region);
    const a = part("item", "a");
    const b = part("item", "b");
    const button = part("overflow-button");
    const root = part("root");
    // The install doesn't patch DOM reads, so the DOM stays at jsdom's zeros
    // while the measurer reports the configured options.
    const untouched = () => {
      expect(bar.clientWidth).toBe(0);
      expect(a.offsetWidth).toBe(0);
      expect(button.offsetWidth).toBe(0);
      expect(root.getBoundingClientRect().height).toBe(0);
      // Compared against a control element, not a literal: the assertion is
      // "no interception", not jsdom's particular initial value.
      expect(getComputedStyle(bar).paddingLeft).toBe(
        getComputedStyle(document.createElement("div")).paddingLeft,
      );
    };
    const check = () => {
      expect(measurer.buttonWidth(null)).toBe(0);
      untouched();
    };
    check();
    expect(measurer.barWidth(bar)).toBe(400);
    expect(measurer.itemWidth(a)).toBe(90);
    expect(measurer.itemWidth(b)).toBe(60);
    expect(measurer.buttonWidth(button)).toBe(32);
    expect(measurer.padding(bar)).toBe(16);
    expect(measurer.regionGap(bar)).toBe(4);
    expect(measurer.height(root)).toBe(42);
    layout.resize(210, false);
    layout.setItemWidth("a", 110, false);
    layout.setItemWidth("b", 0, false);
    layout.setRootHeight(53);
    layout.setPaddingX(0);
    layout.setGap(0);
    check();
    expect(measurer.barWidth(bar)).toBe(210);
    expect(measurer.itemWidth(a)).toBe(110);
    expect(measurer.itemWidth(b)).toBe(0);
    expect(measurer.height(root)).toBe(53);
    expect(measurer.padding(bar)).toBe(0);
    expect(measurer.regionGap(bar)).toBe(0);
    expect(measurer.itemWidth(part("item"))).toBe(0);
  });

  it("preserves computed-style readings when padding and gap are omitted", () => {
    const bar = part("bar");
    const region = part("region");
    bar.style.cssText = "padding-left: 5px; padding-right: 7px";
    region.style.cssText = "gap: 9px; column-gap: 11px";
    bar.append(region);
    document.body.append(bar);
    try {
      const layout = installToolbarLayout();
      const measurer = resolveMeasurer();
      expect(measurer.padding(bar)).toBe(12);
      expect(measurer.regionGap(bar)).toBe(11);
      layout.setPaddingX(3);
      layout.setGap(2);
      expect(measurer.padding(bar)).toBe(6);
      expect(measurer.regionGap(bar)).toBe(2);
      expect(getComputedStyle(bar).getPropertyValue("padding-left")).toBe("5px");
      expect(getComputedStyle(region).getPropertyValue("column-gap")).toBe("11px");
      region.remove();
      expect(measurer.regionGap(bar)).toBeUndefined();
    } finally {
      bar.remove();
    }
  });

  it.each(["inner", "outer"])("shares the install stack when restoring %s first", (first) => {
    const bar = part("bar");
    const outer = installToolbarLayout({ barWidth: 400 });
    const measurer = resolveMeasurer();
    const inner = installToolbarLayout({ barWidth: 200 });
    expect(resolveMeasurer().barWidth(bar)).toBe(200);
    expect(measurer.barWidth(bar)).toBe(200);
    outer.resize(500, false);
    if (first === "inner") {
      inner.restore();
      expect(measurer.barWidth(bar)).toBe(500);
    } else {
      outer.restore();
      expect(measurer.barWidth(bar)).toBe(200);
    }
    inner.restore();
    outer.restore();
    expect(Object.hasOwn(globalThis, MEASURER_SLOT)).toBe(false);
    expect(resolveMeasurer()).toBe(domMeasurer);
    // Never patched, so an emptied stack falls back to jsdom's own zero.
    expect(domMeasurer.barWidth(bar)).toBe(0);

    reinstallToolbarLayout(outer);
    expect(resolveMeasurer().barWidth(bar)).toBe(500);
    expect(bar.clientWidth).toBe(0);
    outer.restore();
    expect(Object.hasOwn(globalThis, MEASURER_SLOT)).toBe(false);
  });

  it("restores a pre-existing slot descriptor after the last install", () => {
    const descriptor = { configurable: true, enumerable: false, get: () => domMeasurer };
    Object.defineProperty(globalThis, MEASURER_SLOT, descriptor);
    const outer = installToolbarLayout();
    const inner = installToolbarLayout();
    outer.restore();
    expect(resolveMeasurer()).not.toBe(domMeasurer);
    inner.restore();
    expect(Object.getOwnPropertyDescriptor(globalThis, MEASURER_SLOT)).toEqual(descriptor);
  });

  it("parses a non-finite override away exactly as a computed style would", () => {
    // Not a realistic option value — the point is that a non-finite override
    // reads as "unresolved" rather than as a pixel count.
    const bar = part("bar");
    bar.append(part("region"));
    const layout = installToolbarLayout();
    const measurer = resolveMeasurer();
    layout.setGap(Number.NaN);
    layout.setPaddingX(Number.POSITIVE_INFINITY);
    expect(measurer.regionGap(bar)).toBeUndefined();
    expect(measurer.regionGap(bar)).toBe(domMeasurer.regionGap(bar));
    expect(measurer.padding(bar)).toBe(0);
    expect(measurer.padding(bar)).toBe(domMeasurer.padding(bar));
  });

  it("reports no observation where the host has no ResizeObserver, as core's fallback needs", () => {
    installToolbarLayout();
    const measurer = resolveMeasurer();
    expect(measurer.observe(vi.fn())).not.toBeUndefined();
    vi.stubGlobal("ResizeObserver", undefined);
    try {
      expect(measurer.observe(vi.fn())).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("syncs targets and delivers only the named observer with no callback arguments", () => {
    const layout = installToolbarLayout();
    const notify = vi.fn();
    const observer = resolveMeasurer().observe(notify)!;
    const [handle] = layout.getObservers();
    const a = part("item", "a");
    const b = part("item", "b");
    observer.sync([a, b, a]);
    const snapshot = handle!.getTargets();
    expect(snapshot).toEqual([a, b]);
    expect(notify).not.toHaveBeenCalled();
    observer.sync([b]);
    observer.sync([b]);
    expect(snapshot).toEqual([a, b]);
    expect(handle!.getTargets()).toEqual([b]);
    layout.resize(100, false);
    layout.setItemWidth("b", 70, false);
    expect(notify).not.toHaveBeenCalled();
    handle!.flush();
    expect(notify.mock.calls).toEqual([[]]);
    observer.sync([]);
    handle!.flush();
    expect(notify).toHaveBeenCalledTimes(1);
    observer.sync([a]);
    observer.disconnect();
    expect(handle!.getTargets()).toEqual([]);
    layout.flush();
    expect(notify).toHaveBeenCalledTimes(1);
    observer.sync([b]);
    handle!.flush();
    expect(notify).toHaveBeenCalledTimes(2);
    layout.restore();
    handle!.flush();
    expect(notify).toHaveBeenCalledTimes(2);
    expect(layout.getObservers()).toEqual([]);
  });

  it("keeps observer ownership while nested installs supply the current measurements", () => {
    const bar = part("bar");
    const outer = installToolbarLayout({ barWidth: 400 });
    const widths: number[] = [];
    resolveMeasurer()
      .observe(() => widths.push(resolveMeasurer().barWidth(bar)))!
      .sync([bar]);
    const inner = installToolbarLayout({ barWidth: 200 });
    const notify = vi.fn();
    resolveMeasurer().observe(notify)!.sync([bar]);
    outer.flush();
    expect(widths).toEqual([200]);
    expect(notify).not.toHaveBeenCalled();
    inner.flush();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(widths).toEqual([200]);
    inner.restore();
    outer.flush();
    expect(widths).toEqual([200, 400]);
  });

  it("drives collapse and height through three independent observers without one DOM measurement", () => {
    const layout = installToolbarLayout({ barWidth: 1000, itemWidth: 60, paddingX: 0, gap: 2 });
    const offsetWidth = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get");
    const clientWidth = vi.spyOn(HTMLElement.prototype, "clientWidth", "get");
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    const computedStyle = vi.spyOn(globalThis, "getComputedStyle");
    const extensions = [
      makeExtension({ id: "a", priority: 3 }),
      makeExtension({ id: "b", priority: 1 }),
      makeExtension({ id: "c", priority: 2 }),
    ];
    const view = render(
      <DevToolbar extensions={extensions}>
        <div />
      </DevToolbar>,
    );
    const observers = layout.getObservers();
    expect(observers).toHaveLength(3);
    expect(
      observers.map((observer) =>
        observer.getTargets().map((node) => (node as HTMLElement).dataset["dtbPart"]),
      ),
      // The middle observer holds the item hosts and both regions: hosts catch
      // a chip resizing itself, regions catch a gap-only change that resizes
      // no host when several share a region.
    ).toEqual([["bar"], ["item", "item", "item", "region", "region"], ["root"]]);
    const [bar, items, height] = observers;
    expect(visibleIds()).toEqual(["a", "b", "c"]);
    layout.resize(100, false);
    // Isolated: feeds `--dev-toolbar-height` and nothing the collapse machine reads.
    act(() => height!.flush());
    expect(visibleIds()).toEqual(["a", "b", "c"]);
    // Deliberately not isolated from the bar's width: its callback takes a
    // full bar reading, so it collapses on this flush against the new
    // `barWidth` instead of deciding from a stale gap.
    act(() => items!.flush());
    expect(visibleIds()).toEqual(["a"]);
    // Nothing left for the bar's own delivery to change.
    act(() => bar!.flush());
    expect(visibleIds()).toEqual(["a"]);
    act(() => layout.setRootHeight(57));
    expect(document.documentElement.style.getPropertyValue("--dev-toolbar-height")).toBe("57px");
    expect(offsetWidth).not.toHaveBeenCalled();
    expect(clientWidth).not.toHaveBeenCalled();
    expect(rect).not.toHaveBeenCalled();
    expect(computedStyle).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /More developer toolbar items/ })).not.toBeNull();
    view.unmount();
    expect(observers.map((observer) => observer.getTargets())).toEqual([[], [], []]);
  });

  it("hands the slot back even when the teardown's own cleanup throws", () => {
    // A fake registered before the install (so the install's baseline restores
    // it, not nothing), plus a tree whose effect cleanup throws out of
    // `cleanup()`. `teardown()` is invoked directly rather than through
    // `afterEach`, since an `afterEach` that throws fails the *next* test.
    const prior: Measurer = { ...domMeasurer, barWidth: () => 17 };
    (globalThis as { [MEASURER_SLOT]?: Measurer | undefined })[MEASURER_SLOT] = prior;
    installToolbarLayout({ barWidth: 400 });
    render(<ThrowOnCleanup />);

    // The original error, unmasked by the teardown machinery.
    expect(teardown).toThrow("dev-toolbar layout teardown probe");

    // Both process-wide steps still happened: install retired, slot empty
    // rather than holding the fake the baseline restored.
    expect(Object.hasOwn(globalThis, MEASURER_SLOT)).toBe(false);
    expect(resolveMeasurer()).toBe(domMeasurer);
  });
});
