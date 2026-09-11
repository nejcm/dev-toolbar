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

/**
 * A tree whose unmount throws, i.e. ordinary application code with a failing
 * effect cleanup. React re-throws it out of `unmount()`, so it lands in
 * `cleanupToolbar()`'s loop.
 */
function Boom({ message }: { message: string }): null {
  useEffect(() => {
    return () => {
      throw new Error(message);
    };
  }, [message]);
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

    // StrictMode runs every cleanup in tree order, then every re-mount, so the
    // second pass must still see the fake — with the owner rendered after the
    // toolbar it didn't, throwing ReferenceError.
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

/**
 * Regression: a throwing `unmount()` used to abort the loop, and the list is
 * already detached — so the entries it never reached were unreachable, their
 * trees stayed mounted, and a fake kept answering the measurer slot.
 */
describe("cleanupToolbar() when an unmount throws", () => {
  it("unmounts the rest, restores the layout, and re-throws the failure", () => {
    const order: string[] = [];
    mountToolbar(<Tracker id="first" into={order} />);
    mountToolbar(<Boom message="second blew up" />);
    mountToolbar(<Tracker id="third" into={order} />);
    // A bare install, the case `cleanupToolbar()` is the only net for.
    installToolbarLayout({ barWidth: 321 });
    expect(measuredBarWidth()).toBe(321);

    expect(() => cleanupToolbar()).toThrow("second blew up");

    // "first" was queued behind the thrower and is the whole point: it is
    // already untracked, so nothing else could ever have unmounted it.
    expect(order).toEqual(["third", "first"]);
    expect(isPristine()).toBe(true);
  });

  it("does not retry the mount whose unmount threw", () => {
    mountToolbar(<Boom message="blew up once" />);

    expect(() => cleanupToolbar()).toThrow("blew up once");
    // Retrying teardown over a half-torn-down React root is worse than dropping
    // it, so the entry is marked done before `unmount()` is attempted.
    expect(() => cleanupToolbar()).not.toThrow();
  });

  it("reports every failure as an AggregateError when more than one throws", () => {
    const order: string[] = [];
    mountToolbar(<Tracker id="first" into={order} />);
    mountToolbar(<Boom message="older blew up" />);
    mountToolbar(<Boom message="newer blew up" />);
    let caught: unknown;

    try {
      cleanupToolbar();
    } catch (error) {
      caught = error;
    }

    // Newest first, matching the teardown order. Re-throwing only the first
    // would drop the rest, and these are independent trees — one failure is not
    // a variation on another.
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors.map((error: Error) => error.message)).toEqual([
      "newer blew up",
      "older blew up",
    ]);
    expect(order).toEqual(["first"]);
    expect(isPristine()).toBe(true);
  });
});
