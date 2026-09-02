/**
 * The subscription parity `createMockBus()` claims.
 *
 * The double is only useful if a collector written against the real bus can be
 * pointed at it unchanged, and the `bus` option in `/ext/metrics` now asks for
 * `BusLike` — `emit` plus `on(type, handler, { signal })` — precisely so it
 * can be. That type says nothing about *behaviour*, and a callee is allowed to
 * declare fewer parameters than its caller passes, so a mock that accepted
 * `options` and ignored it would typecheck and then leak every subscription
 * past teardown. These are the assertions that hold it to the contract.
 *
 * Nothing here imports `../../runtime`: `src/core/__tests__/boundary.test.ts`
 * walks every file under `src/testing`, this directory included, and fails on
 * a specifier naming `runtime/` or `ext/`. The type-level half of the parity
 * check therefore lives in `src/ext/metrics/__tests__/network.test.ts`, which
 * may name both sides.
 */
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createMockBus } from "../mockBus";

describe("createMockBus — options.signal", () => {
  it("never subscribes at all when the signal has already aborted", () => {
    const bus = createMockBus();
    const controller = new AbortController();
    controller.abort();

    const handler = vi.fn();
    const off = bus.on("navigation", handler, { signal: controller.signal });

    expect(bus.listenerCount()).toBe(0);
    bus.emit("navigation", { route: "/orders" });
    expect(handler).not.toHaveBeenCalled();
    // The event was still recorded — an aborted subscriber is not a dead bus.
    expect(bus.events("navigation")).toHaveLength(1);

    // And the returned function is inert rather than throwing or double-freeing.
    expect(() => off()).not.toThrow();
    expect(bus.listenerCount()).toBe(0);
  });

  it("unsubscribes when the signal aborts", () => {
    const bus = createMockBus();
    const controller = new AbortController();
    const handler = vi.fn();
    bus.on("navigation", handler, { signal: controller.signal });

    bus.emit("navigation", { route: "/a" });
    expect(handler).toHaveBeenCalledTimes(1);

    controller.abort();
    expect(bus.listenerCount()).toBe(0);
    bus.emit("navigation", { route: "/b" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not evict a later subscriber when a stale unsubscribe is called", () => {
    // The bug the latch exists for: `off()` after the signal already ran it
    // would find its own captured set empty and delete whatever set the map
    // holds for that type by then — which by then belongs to somebody else.
    const bus = createMockBus();
    const controller = new AbortController();
    const first = vi.fn();
    const off = bus.on("navigation", first, { signal: controller.signal });

    controller.abort();
    expect(bus.listenerCount("navigation")).toBe(0);

    const second = vi.fn();
    bus.on("navigation", second);
    off();

    expect(bus.listenerCount("navigation")).toBe(1);
    bus.emit("navigation", { route: "/still-here" });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("latches a manual unsubscribe so the second call is a no-op", () => {
    const bus = createMockBus();
    const off = bus.on("navigation", vi.fn());
    off();
    const other = vi.fn();
    bus.on("navigation", other);
    off();

    bus.emit("navigation", { route: "/a" });
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("honours the signal for once() — including the redundant cleanup call", () => {
    const bus = createMockBus();
    const controller = new AbortController();
    const handler = vi.fn();
    // `once()` hands back the very function it calls on delivery, so a React
    // effect returning it runs it a second time; that must not evict anyone.
    const off = bus.once("navigation", handler, { signal: controller.signal });

    bus.emit("navigation", { route: "/a" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount()).toBe(0);

    const other = vi.fn();
    bus.on("navigation", other);
    off();
    controller.abort();
    bus.emit("navigation", { route: "/b" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("drops a once() subscriber that never fired when the signal aborts", () => {
    const bus = createMockBus();
    const controller = new AbortController();
    const handler = vi.fn();
    bus.once("navigation", handler, { signal: controller.signal });

    controller.abort();
    bus.emit("navigation", { route: "/a" });
    expect(handler).not.toHaveBeenCalled();
    expect(bus.listenerCount()).toBe(0);
  });

  it("honours the signal for onAny()", () => {
    const bus = createMockBus();
    const controller = new AbortController();
    const seen: string[] = [];
    bus.onAny((_payload, event) => seen.push(event.type), { signal: controller.signal });

    bus.emit("navigation", { route: "/a" });
    expect(seen).toEqual(["navigation"]);
    expect(bus.listenerCount()).toBe(1);

    controller.abort();
    bus.emit("long-task", { duration: 90 });
    expect(seen).toEqual(["navigation"]);
    expect(bus.listenerCount()).toBe(0);
  });

  it("never subscribes onAny() to an already-aborted signal", () => {
    const bus = createMockBus();
    const controller = new AbortController();
    controller.abort();
    const handler = vi.fn();
    const off = bus.onAny(handler, { signal: controller.signal });

    expect(bus.listenerCount()).toBe(0);
    bus.emit("navigation", { route: "/a" });
    expect(handler).not.toHaveBeenCalled();
    expect(() => off()).not.toThrow();
  });
});

describe("createMockBus — emit", () => {
  it("hands back the event with its name as a literal, as BusEvent does", () => {
    const bus = createMockBus({ now: 500 });
    const event = bus.emit("navigation", { route: "/orders" });

    // The load-bearing bit: `type` is `"navigation"`, not `string`. A widened
    // `type` is what made `MockBusEvent` unassignable to `BusEvent<T, K>` and
    // the whole double unusable where a bus was asked for.
    expectTypeOf(event.type).toEqualTypeOf<"navigation">();
    expectTypeOf(event.payload).toEqualTypeOf<{ route: string }>();
    expect(event).toEqual({ type: "navigation", payload: { route: "/orders" }, at: 500 });
  });
});
