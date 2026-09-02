/**
 * The fake layout's *install lifetime*, not its measurements — those are
 * exercised all over `src/core/__tests__` and every extension suite.
 *
 * The patches are on shared objects (`HTMLElement.prototype`, `globalThis`), so
 * the only thing that makes them safe is that installing and restoring is
 * disciplined. Each case here is a way that discipline used to break: an
 * install that captured a *previous* value which was itself a fake, and then
 * put it back.
 */
import { describe, expect, it } from "vitest";
import { installToolbarLayout } from "../layout";

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
const nativeRect = HTMLElement.prototype.getBoundingClientRect;
const hadResizeObserver = "ResizeObserver" in globalThis;

const bar = () => {
  const element = document.createElement("div");
  element.dataset["dtbPart"] = "bar";
  return element;
};

/** Every patch this module makes, back the way jsdom had it. */
const isPristine = () =>
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth")?.get ===
    nativeOffsetWidth &&
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth")?.get ===
    nativeClientWidth &&
  HTMLElement.prototype.getBoundingClientRect === nativeRect &&
  "ResizeObserver" in globalThis === hadResizeObserver;

describe("installToolbarLayout", () => {
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
    const root = document.createElement("div");
    root.dataset["dtbPart"] = "root";
    expect(root.getBoundingClientRect().height).toBe(42);
    // A plain element still gets jsdom's own zero rect, not the fake one.
    expect(document.createElement("div").getBoundingClientRect().height).toBe(0);
    handle.restore();
  });
});
