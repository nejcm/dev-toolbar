/**
 * Teardown, from both ends: what Testing Library's own `cleanup()` reaches, and
 * what `cleanupToolbar()` reaches when nothing else does.
 *
 * `renderWithToolbar({ layout })` writes two `globalThis` slots — core's
 * measurer and the `ResizeObserver` jsdom lacks. A test that never called
 * `unmount()` used to leave those installed for the rest of the file, because
 * `cleanup()` does not call the handle's `unmount` wrapper — it unmounts the
 * tree it rendered. So the teardown is registered where `cleanup()` will find
 * it: an effect cleanup inside that tree.
 */
import { useEffect } from "react";
import { cleanup } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it } from "vitest";
import {
  cleanupToolbar,
  installToolbarLayout,
  makeExtension,
  mountToolbar,
} from "@nejcm/dev-toolbar/testing";

const MEASURER_SLOT = Symbol.for("@nejcm/dev-toolbar.measurer");
type Slot = { [MEASURER_SLOT]?: { barWidth(bar: HTMLElement): number } };

const isPristine = () => !(MEASURER_SLOT in globalThis) && !("ResizeObserver" in globalThis);

const bar = () => {
  const element = document.createElement("div");
  element.dataset["dtbPart"] = "bar";
  return element;
};

/**
 * The bar width the live install reports to core. Read through the registered
 * measurer, since the fake patches no DOM read — `bar().offsetWidth` is
 * jsdom's zero whether an install is live or not.
 */
const measuredBarWidth = () => (globalThis as Slot)[MEASURER_SLOT]?.barWidth(bar());

/**
 * Records what a *consumer's* mount effect sees. `new ResizeObserver()` in an
 * effect is ordinary application code, so the fake has to be installed for
 * every pass of the tree, not merely for the last one.
 */
function Measurer({ into }: { into: string[] }): null {
  useEffect(() => {
    into.push(typeof ResizeObserver);
    const observer = new ResizeObserver(() => {});
    observer.observe(document.body);
    return () => observer.disconnect();
  }, [into]);
  return null;
}

/** Pushes its id when React unmounts it, so teardown order is observable. */
function Tracker({ id, into }: { id: string; into: string[] }): null {
  useEffect(() => {
    return () => {
      into.push(id);
    };
  }, [id, into]);
  return null;
}

describe("Testing Library cleanup()", () => {
  it("restores the fake layout, even though nothing called unmount()", () => {
    expect(isPristine()).toBe(true);
    mountToolbar(null, { layout: { barWidth: 640 } });
    expect(measuredBarWidth()).toBe(640);

    cleanup();

    expect(measuredBarWidth()).toBeUndefined();
    expect(isPristine()).toBe(true);
  });

  it("survives StrictMode's double-invoked effects", () => {
    const seen: string[] = [];
    const mounted = mountToolbar(<Measurer into={seen} />, {
      extensions: [makeExtension({ id: "a" }), makeExtension({ id: "b" })],
      layout: { barWidth: 640, itemWidth: 200 },
      renderOptions: { wrapper: StrictMode },
    });

    // StrictMode runs *every* cleanup in tree order and only then every
    // re-mount, so the whole second pass of the subtree must still see the
    // fake. With the owner rendered after the toolbar it did not: an effect
    // that constructs a ResizeObserver threw ReferenceError on the second
    // pass, because the owner's own cleanup had already deleted the global.
    expect(seen).toEqual(["function", "function"]);

    // The owner effect ran mount → cleanup → mount. A cleanup-only owner would
    // have unregistered the fake here, mid-test.
    expect(measuredBarWidth()).toBe(640);
    expect(mounted.toolbar.bar()).not.toBeNull();

    // And the collapse still recomputes, which is the whole reason the fake
    // layout exists: two 200px items do not fit in 300px.
    expect(mounted.toolbar.overflowedIds()).toEqual([]);
    mounted.toolbar.resize(300);
    expect(mounted.toolbar.overflowedIds()).toContain("b");

    cleanup();
    expect(isPristine()).toBe(true);
  });
});

describe("mountToolbar / cleanupToolbar", () => {
  it("unmounts what it mounted, newest first", () => {
    const order: string[] = [];
    mountToolbar(<Tracker id="first" into={order} />);
    mountToolbar(<Tracker id="second" into={order} />);
    mountToolbar(<Tracker id="third" into={order} />);

    cleanupToolbar();

    expect(order).toEqual(["third", "second", "first"]);
    expect(document.querySelector('[data-dtb-part="root"]')).toBeNull();
  });

  it("does not unmount a mount the test already unmounted itself", () => {
    const order: string[] = [];
    const first = mountToolbar(<Tracker id="first" into={order} />);
    mountToolbar(<Tracker id="second" into={order} />);

    first.unmount();
    // Idempotent, so a test may unmount defensively without bookkeeping.
    first.unmount();
    expect(order).toEqual(["first"]);

    cleanupToolbar();
    expect(order).toEqual(["first", "second"]);
  });

  it("restores a bare installToolbarLayout() whose restore() was missed", () => {
    installToolbarLayout({ barWidth: 480 });
    installToolbarLayout({ barWidth: 481 });
    expect(measuredBarWidth()).toBe(481);

    cleanupToolbar();

    expect(isPristine()).toBe(true);
    // And with nothing left to do it is still safe to call.
    cleanupToolbar();
    expect(isPristine()).toBe(true);
  });
});
