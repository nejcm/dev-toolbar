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

describe("createMockBus — clock", () => {
  it("advances now(), fires setTimeout once and drops it, and leaves later timers pending", () => {
    const bus = createMockBus();
    const fired = vi.fn();
    const later = vi.fn();
    bus.clock.setTimeout(fired, 10);
    bus.clock.setTimeout(later, 100);

    bus.clock.advance(10);

    expect(fired).toHaveBeenCalledTimes(1);
    expect(later).not.toHaveBeenCalled();
    expect(bus.clock.now()).toBe(10);
    expect(bus.clock.pending()).toBe(1);
  });

  it("fires a setInterval repeatedly and keeps it pending", () => {
    const bus = createMockBus();
    const tick = vi.fn();
    bus.clock.setInterval(tick, 5);

    bus.clock.advance(23);

    // due at 5, 10, 15, 20 — 25 is past the advanced target.
    expect(tick).toHaveBeenCalledTimes(4);
    expect(bus.clock.now()).toBe(23);
    expect(bus.clock.pending()).toBe(1);
  });

  it("clearTimers() drops every pending timer without firing it", () => {
    const bus = createMockBus();
    const timeoutCb = vi.fn();
    const intervalCb = vi.fn();
    bus.clock.setTimeout(timeoutCb, 10);
    bus.clock.setInterval(intervalCb, 5);
    expect(bus.clock.pending()).toBe(2);

    bus.clock.clearTimers();

    expect(bus.clock.pending()).toBe(0);
    bus.clock.advance(100);
    expect(timeoutCb).not.toHaveBeenCalled();
    expect(intervalCb).not.toHaveBeenCalled();
  });

  it("the cancel function returned by setTimeout/setInterval removes only that timer", () => {
    const bus = createMockBus();
    const kept = vi.fn();
    const cancelled = vi.fn();
    bus.clock.setTimeout(kept, 10);
    const cancel = bus.clock.setTimeout(cancelled, 10);
    expect(bus.clock.pending()).toBe(2);

    cancel();
    expect(bus.clock.pending()).toBe(1);

    bus.clock.advance(10);
    expect(kept).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
  });

  it("advance(0) is allowed and leaves now() unchanged", () => {
    const bus = createMockBus();
    expect(() => bus.clock.advance(0)).not.toThrow();
    expect(bus.clock.now()).toBe(0);
  });

  it("advance() rejects a negative number of ms", () => {
    const bus = createMockBus();
    expect(() => bus.clock.advance(-1)).toThrow(/non-negative/);
  });

  it("setInterval(cb, 0) fires on a consistent 1ms cadence rather than immediately then 1ms", () => {
    const bus = createMockBus();
    const fireTimes: number[] = [];
    bus.clock.setInterval(() => fireTimes.push(bus.clock.now()), 0);

    bus.clock.advance(3);

    // Every firing — including the first — is spaced 1ms apart, so the very
    // first fire lands at 1ms, not at 0ms (which would mean "immediately").
    expect(fireTimes).toEqual([1, 2, 3]);
  });

  it("setTimeout(cb, 0) still fires immediately, since one-shot delays may be 0", () => {
    const bus = createMockBus();
    const cb = vi.fn();
    bus.clock.setTimeout(cb, 0);

    bus.clock.advance(0);

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("throws a descriptive error instead of silently truncating a runaway timer loop", () => {
    const bus = createMockBus();
    let count = 0;
    bus.clock.setInterval(() => {
      count += 1;
    }, 1);

    // Requesting far more firings than the 100,000-firing guard allows must
    // throw rather than quietly returning a wrong `now()`/fire-count.
    expect(() => bus.clock.advance(200_000)).toThrow(/exceeded 100000 timer firings.*200000ms/s);

    // The throw aborts mid-advance rather than unwinding it: state reflects
    // exactly the 100,000 firings that already happened, and the timer that
    // tripped the guard is still pending, not lost.
    expect(count).toBe(100_000);
    expect(bus.clock.now()).toBe(100_000);
    expect(bus.clock.pending()).toBe(1);
  });

  it("does not throw for a legitimate high fire count within the guard", () => {
    const bus = createMockBus();
    let count = 0;
    bus.clock.setInterval(() => {
      count += 1;
    }, 1);

    bus.clock.advance(20_000);

    expect(count).toBe(20_000);
    expect(bus.clock.now()).toBe(20_000);
  });

  it("completes exactly at the firing cap without a false-positive throw", () => {
    const bus = createMockBus();
    let count = 0;
    bus.clock.setInterval(() => {
      count += 1;
    }, 1);

    // Exactly 100,000 firings for a plain 1ms interval must succeed: the
    // guard should only trip when a timer is genuinely still due afterward.
    expect(() => bus.clock.advance(100_000)).not.toThrow();
    expect(count).toBe(100_000);
    expect(bus.clock.now()).toBe(100_000);

    const bus2 = createMockBus();
    bus2.clock.setInterval(() => {}, 1);
    expect(() => bus2.clock.advance(100_001)).toThrow(/exceeded 100000 timer firings/);
  });

  it("setTime() jumps backward without firing timers, and forward while firing due ones", () => {
    const bus = createMockBus({ now: 50 });
    const cb = vi.fn();
    bus.clock.setTimeout(cb, 10); // due at 60

    bus.clock.setTime(20);
    expect(bus.clock.now()).toBe(20);
    expect(cb).not.toHaveBeenCalled();

    bus.clock.setTime(60);
    expect(bus.clock.now()).toBe(60);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("setTime() rejects a non-finite value instead of leaving now() as NaN", () => {
    const bus = createMockBus();
    expect(() => bus.clock.setTime(Number.NaN)).toThrow(/finite/);
    expect(bus.clock.now()).toBe(0);
  });

  it("setInterval(cb, NaN) is treated as a 1ms interval rather than a dead pending timer", () => {
    const bus = createMockBus();
    const cb = vi.fn();
    bus.clock.setInterval(cb, Number.NaN);

    bus.clock.advance(3);

    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("setInterval(cb, Infinity) never fires, unlike NaN", () => {
    const bus = createMockBus();
    const cb = vi.fn();
    bus.clock.setInterval(cb, Number.POSITIVE_INFINITY);

    bus.clock.advance(10_000);

    expect(cb).not.toHaveBeenCalled();
    expect(bus.clock.pending()).toBe(1);
  });
});
