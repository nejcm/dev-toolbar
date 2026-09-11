/**
 * The subscription parity `createMockBus()` claims: `BusLike`'s `emit`/`on`
 * shape says nothing about *behaviour*, so a mock that accepted `options` and
 * ignored it would typecheck while leaking every subscription past teardown.
 * These assertions hold it to the contract.
 *
 * Nothing here imports `../../runtime` — `src/testing` may not (AGENTS.md
 * layering). The type-level half of the parity check lives in
 * `src/ext/metrics/__tests__/network.test.ts`.
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

describe("createMockBus — emit error handling", () => {
  it("does not let a throwing handler stop the rest, or propagate to the emitter", () => {
    const bus = createMockBus({ onError: vi.fn() });
    const boom = vi.fn(() => {
      throw new Error("boom");
    });
    const after = vi.fn();
    bus.on("navigation", boom);
    bus.on("navigation", after);

    expect(() => bus.emit("navigation", { route: "/a" })).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("routes a thrown error to onError with the error and the event, defaulting to console.error", () => {
    const onError = vi.fn();
    const bus = createMockBus({ onError });
    const error = new Error("boom");
    bus.on("navigation", () => {
      throw error;
    });

    const event = bus.emit("navigation", { route: "/a" });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, event);
  });

  it("logs via console.error when no onError is supplied", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bus = createMockBus();
    bus.on("navigation", () => {
      throw new Error("boom");
    });

    bus.emit("navigation", { route: "/a" });

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("also protects onAny subscribers from a throwing type handler and each other", () => {
    const onError = vi.fn();
    const bus = createMockBus({ onError });
    const survivor = vi.fn();
    bus.on("navigation", () => {
      throw new Error("type handler boom");
    });
    bus.onAny(() => {
      throw new Error("onAny boom");
    });
    bus.onAny(survivor);

    bus.emit("navigation", { route: "/a" });

    expect(onError).toHaveBeenCalledTimes(2);
    expect(survivor).toHaveBeenCalledTimes(1);
  });
});

describe("createMockBus — events()", () => {
  it("returns a snapshot copy, not the live internal history", () => {
    const bus = createMockBus();
    bus.emit("navigation", { route: "/a" });
    const captured = bus.events();

    bus.emit("navigation", { route: "/b" });

    expect(captured).toHaveLength(1);
    expect(bus.events()).toHaveLength(2);
  });

  it("clearEvents() does not retroactively affect an already-captured snapshot", () => {
    const bus = createMockBus();
    bus.emit("navigation", { route: "/a" });
    const captured = bus.events();

    bus.clearEvents();

    expect(captured).toHaveLength(1);
    expect(bus.events()).toHaveLength(0);
  });

  it("evicts the oldest events once historyLimit is exceeded", () => {
    const bus = createMockBus({ historyLimit: 2 });
    bus.emit("navigation", { route: "/a" });
    bus.emit("navigation", { route: "/b" });
    bus.emit("navigation", { route: "/c" });

    const events = bus.events("navigation");
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.payload)).toEqual([{ route: "/b" }, { route: "/c" }]);
  });
});

describe("createMockBus — once() and onAny() without a signal", () => {
  it("once() fires exactly one time then unsubscribes", () => {
    const bus = createMockBus();
    const handler = vi.fn();
    bus.once("navigation", handler);

    bus.emit("navigation", { route: "/a" });
    bus.emit("navigation", { route: "/b" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      { route: "/a" },
      expect.objectContaining({ type: "navigation" }),
    );
    expect(bus.listenerCount("navigation")).toBe(0);
  });

  it("once()'s returned unsubscribe is a no-op if called after it already fired", () => {
    const bus = createMockBus();
    const handler = vi.fn();
    const off = bus.once("navigation", handler);

    bus.emit("navigation", { route: "/a" });
    expect(() => off()).not.toThrow();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("onAny() receives every emitted event regardless of type", () => {
    const bus = createMockBus();
    const seen: string[] = [];
    bus.onAny((_payload, event) => seen.push(event.type));

    bus.emit("navigation", { route: "/a" });
    bus.emit("long-task", { duration: 5 });

    expect(seen).toEqual(["navigation", "long-task"]);
  });

  it("onAny()'s returned unsubscribe stops future deliveries", () => {
    const bus = createMockBus();
    const handler = vi.fn();
    const off = bus.onAny(handler);

    bus.emit("navigation", { route: "/a" });
    off();
    bus.emit("navigation", { route: "/b" });

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("createMockBus — listenerCount()", () => {
  it("counts subscribers across on(), once() and onAny(), total and per-type", () => {
    const bus = createMockBus();
    bus.on("navigation", vi.fn());
    bus.on("navigation", vi.fn());
    bus.on("long-task", vi.fn());
    bus.once("navigation", vi.fn());
    bus.onAny(vi.fn());

    expect(bus.listenerCount("navigation")).toBe(3);
    expect(bus.listenerCount("long-task")).toBe(1);
    expect(bus.listenerCount("interaction")).toBe(0);
    expect(bus.listenerCount()).toBe(5);
  });

  it("drops to 0 once every subscriber unsubscribes", () => {
    const bus = createMockBus();
    const offA = bus.on("navigation", vi.fn());
    const offB = bus.onAny(vi.fn());

    offA();
    offB();

    expect(bus.listenerCount()).toBe(0);
  });
});

describe("createMockBus — reset()", () => {
  it("drops subscribers, history and pending timers", () => {
    const bus = createMockBus();
    const handler = vi.fn();
    bus.on("navigation", handler);
    bus.onAny(vi.fn());
    bus.emit("navigation", { route: "/a" });
    bus.clock.setTimeout(vi.fn(), 10);

    bus.reset();

    expect(bus.listenerCount()).toBe(0);
    expect(bus.events()).toHaveLength(0);
    expect(bus.clock.pending()).toBe(0);

    bus.emit("navigation", { route: "/b" });
    expect(handler).toHaveBeenCalledTimes(1); // still just the pre-reset call
  });
});

describe("createMockBus — clearEvents()", () => {
  it("drops recorded history but leaves subscribers and timers untouched", () => {
    const bus = createMockBus();
    const handler = vi.fn();
    bus.on("navigation", handler);
    bus.emit("navigation", { route: "/a" });
    bus.clock.setTimeout(vi.fn(), 10);

    bus.clearEvents();

    expect(bus.events()).toHaveLength(0);
    expect(bus.listenerCount("navigation")).toBe(1);
    expect(bus.clock.pending()).toBe(1);

    bus.emit("navigation", { route: "/b" });
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
