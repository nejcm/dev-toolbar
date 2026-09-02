import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createEventBus } from "../bus";
import type { AnyBusEvent, BusEvent, BusEventName, ToolbarEventMap } from "../bus";

interface Events extends Record<string, unknown> {
  tick: { n: number };
  tock: { n: number };
}

describe("createEventBus", () => {
  it("delivers to type subscribers and to onAny, with a timestamp", () => {
    let time = 41;
    const bus = createEventBus<Events>({ now: () => (time += 1) });
    const tick = vi.fn();
    const any = vi.fn();
    bus.on("tick", tick);
    bus.onAny(any);

    const event = bus.emit("tick", { n: 1 });
    bus.emit("tock", { n: 2 });

    expect(event).toEqual({ type: "tick", payload: { n: 1 }, at: 42 });
    expect(tick).toHaveBeenCalledTimes(1);
    expect(tick).toHaveBeenCalledWith({ n: 1 }, event);
    expect(any).toHaveBeenCalledTimes(2);
  });

  it("unsubscribes, and counts listeners", () => {
    const bus = createEventBus<Events>();
    const off = bus.on("tick", () => {});
    const offAny = bus.onAny(() => {});
    expect(bus.listenerCount("tick")).toBe(1);
    expect(bus.listenerCount()).toBe(2);
    off();
    expect(bus.listenerCount("tick")).toBe(0);
    offAny();
    expect(bus.listenerCount()).toBe(0);
  });

  it("once() fires exactly once", () => {
    const bus = createEventBus<Events>();
    const handler = vi.fn();
    bus.once("tick", handler);
    bus.emit("tick", { n: 1 });
    bus.emit("tick", { n: 2 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toEqual({ n: 1 });
    expect(bus.listenerCount("tick")).toBe(0);
  });

  it("unsubscribes on an AbortSignal — the shape start(api) hands you", () => {
    const bus = createEventBus<Events>();
    const controller = new AbortController();
    const handler = vi.fn();
    bus.on("tick", handler, { signal: controller.signal });
    bus.onAny(handler, { signal: controller.signal });
    expect(bus.listenerCount()).toBe(2);

    controller.abort();
    bus.emit("tick", { n: 1 });
    expect(handler).not.toHaveBeenCalled();
    expect(bus.listenerCount()).toBe(0);
  });

  it("never subscribes at all when the signal is already aborted", () => {
    const bus = createEventBus<Events>();
    const controller = new AbortController();
    controller.abort();
    bus.on("tick", () => {}, { signal: controller.signal });
    expect(bus.listenerCount()).toBe(0);
  });

  it("hands back a safe no-op unsubscribe when the signal was already aborted", () => {
    // `bind()` short-circuits an already-aborted signal to a `() => {}` it
    // returns without ever calling — the previous test never invokes what it
    // gets back. It could just as well have returned `unsubscribe` itself and
    // that test would still pass, since the `live` latch already makes a
    // second run of `unsubscribe` unobservable. This pins the narrower thing
    // that actually matters: whatever `bind()` hands back here is callable
    // and does not throw.
    const bus = createEventBus<Events>();
    const controller = new AbortController();
    controller.abort();
    const off = bus.on("tick", () => {}, { signal: controller.signal });
    expect(bus.listenerCount()).toBe(0);
    expect(() => off()).not.toThrow();
    expect(bus.listenerCount()).toBe(0);
  });

  it("logs a throwing handler's error to console.error when no onError is supplied", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const bus = createEventBus<Events>();
      bus.on("tick", () => {
        throw new Error("boom");
      });

      expect(() => bus.emit("tick", { n: 1 })).not.toThrow();
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith(
        '[dev-toolbar/runtime] a "tick" handler threw.',
        expect.any(Error),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("routes a throwing onAny handler through onError too, not just typed handlers", () => {
    const onError = vi.fn();
    const bus = createEventBus<Events>({ onError });
    const okTypeHandler = vi.fn();
    bus.on("tick", okTypeHandler);
    bus.onAny(() => {
      throw new Error("any handler boom");
    });

    expect(() => bus.emit("tick", { n: 1 })).not.toThrow();
    expect(okTypeHandler).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ type: "tick" }),
    );
  });

  it("contains a throwing handler instead of breaking the emitter", () => {
    const onError = vi.fn();
    const bus = createEventBus<Events>({ onError });
    const later = vi.fn();
    bus.on("tick", () => {
      throw new Error("boom");
    });
    bus.on("tick", later);

    expect(() => bus.emit("tick", { n: 1 })).not.toThrow();
    expect(later).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("lets a handler unsubscribe itself mid-dispatch", () => {
    const bus = createEventBus<Events>();
    const second = vi.fn();
    const off = bus.on("tick", () => off());
    bus.on("tick", second);
    bus.emit("tick", { n: 1 });
    expect(second).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount("tick")).toBe(1);
  });

  it("clear() drops everything", () => {
    const bus = createEventBus<Events>();
    bus.on("tick", () => {});
    bus.onAny(() => {});
    bus.clear();
    expect(bus.listenerCount()).toBe(0);
  });

  it("carries the shared ToolbarEventMap vocabulary", () => {
    const bus = createEventBus<ToolbarEventMap>();
    const handler = vi.fn();
    bus.on("network-end", handler);
    bus.emit("network-end", {
      requestId: "r1",
      ok: true,
      status: 200,
      duration: 12,
    });
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ requestId: "r1" });
  });

  it("names hydration before anything collects it", () => {
    // Reserved deliberately: the vocabulary should not gain a name per release.
    const bus = createEventBus<ToolbarEventMap>();
    const done = vi.fn();
    const failed = vi.fn();
    bus.on("hydration", done);
    bus.on("hydration-error", failed);
    bus.emit("hydration", { duration: 82, boundary: "root" });
    bus.emit("hydration-error", { message: "text content did not match" });
    expect(done.mock.calls[0]?.[0]).toEqual({ duration: 82, boundary: "root" });
    expect(failed).toHaveBeenCalledTimes(1);
  });
  it("survives an unsubscribe called twice without dropping a later subscriber", () => {
    const bus = createEventBus<Events>();
    const off = bus.on("tick", () => {});
    off();

    const later = vi.fn();
    bus.on("tick", later);
    off();

    bus.emit("tick", { n: 1 });
    expect(later).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount("tick")).toBe(1);
  });

  it("survives a once() unsubscribe reused as an effect cleanup after it fired", () => {
    // once() returns the same function it calls internally, so any React effect
    // returning it unsubscribes twice by construction.
    const bus = createEventBus<Events>();
    const off = bus.once("tick", () => {});
    bus.emit("tick", { n: 1 });

    const later = vi.fn();
    bus.on("tick", later);
    off();

    bus.emit("tick", { n: 2 });
    expect(later).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount("tick")).toBe(1);
  });

  it("survives a manual unsubscribe after the signal already aborted", () => {
    const bus = createEventBus<Events>();
    const controller = new AbortController();
    const off = bus.on("tick", () => {}, { signal: controller.signal });
    controller.abort();

    const later = vi.fn();
    bus.on("tick", later);
    off();

    bus.emit("tick", { n: 1 });
    expect(later).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount("tick")).toBe(1);
  });

  it("detaches the abort listener when unsubscribed by hand first", () => {
    const bus = createEventBus<Events>();
    const controller = new AbortController();
    const off = bus.on("tick", () => {}, { signal: controller.signal });
    off();
    expect(bus.listenerCount("tick")).toBe(0);

    const later = vi.fn();
    bus.on("tick", later);
    controller.abort();

    bus.emit("tick", { n: 1 });
    expect(later).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount("tick")).toBe(1);
  });

  it("does not let a stale unsubscribe undo a re-subscribed handler", () => {
    const bus = createEventBus<Events>();
    const handler = vi.fn();
    const off = bus.on("tick", handler);
    const offAny = bus.onAny(handler);
    off();
    offAny();

    bus.on("tick", handler);
    bus.onAny(handler);
    off();
    offAny();

    bus.emit("tick", { n: 1 });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(bus.listenerCount()).toBe(2);
  });

  it("survives an onAny unsubscribe called twice", () => {
    const bus = createEventBus<Events>();
    const offAny = bus.onAny(() => {});
    offAny();

    const later = vi.fn();
    bus.onAny(later);
    offAny();

    bus.emit("tick", { n: 1 });
    expect(later).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount()).toBe(1);
  });

  // These pin the semantics a zero-/one-listener fast path in `emit()` must
  // preserve: no allocation when nobody is listening, and — for exactly one
  // handler — the same unsubscribe-mid-dispatch and subscribe-mid-dispatch
  // behavior the general Array.from snapshot gives you for N handlers.
  describe("zero- and single-handler emit semantics", () => {
    it("calls nothing and still returns the event when nobody is listening", () => {
      const bus = createEventBus<Events>();
      const event = bus.emit("tick", { n: 1 });
      expect(event).toMatchObject({ type: "tick", payload: { n: 1 } });
      expect(bus.listenerCount()).toBe(0);
    });

    it("lets the sole handler unsubscribe itself mid-dispatch", () => {
      const bus = createEventBus<Events>();
      const handler = vi.fn(() => off());
      const off = bus.on("tick", handler);
      expect(() => bus.emit("tick", { n: 1 })).not.toThrow();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(bus.listenerCount("tick")).toBe(0);

      bus.emit("tick", { n: 2 });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("does not call a handler subscribed by the sole handler until the next emit", () => {
      const bus = createEventBus<Events>();
      const second = vi.fn();
      bus.on("tick", () => {
        bus.on("tick", second);
      });

      bus.emit("tick", { n: 1 });
      expect(second).not.toHaveBeenCalled();

      bus.emit("tick", { n: 2 });
      expect(second).toHaveBeenCalledTimes(1);
    });

    it("routes a sole handler's throw to onError and still runs onAny", () => {
      const onError = vi.fn();
      const bus = createEventBus<Events>({ onError });
      const any = vi.fn();
      bus.on("tick", () => {
        throw new Error("boom");
      });
      bus.onAny(any);

      expect(() => bus.emit("tick", { n: 1 })).not.toThrow();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(any).toHaveBeenCalledTimes(1);
    });

    it("does not call a replacement the sole handler subscribes right after unsubscribing itself, until the next emit", () => {
      const bus = createEventBus<Events>();
      const replacement = vi.fn();
      const off = bus.on("tick", () => {
        off();
        bus.on("tick", replacement);
      });

      bus.emit("tick", { n: 1 });
      expect(replacement).not.toHaveBeenCalled();

      bus.emit("tick", { n: 2 });
      expect(replacement).toHaveBeenCalledTimes(1);
    });

    it("drops onAny handlers for the current emit when the sole type handler calls clear() mid-dispatch", () => {
      // Matches the old two-snapshot semantics: the type loop ran to
      // completion (as a single call here) before `Array.from(anyHandlers)`
      // was ever taken, so a clear() during that call left nothing to snapshot.
      const bus = createEventBus<Events>();
      const any = vi.fn();
      bus.on("tick", () => {
        bus.clear();
      });
      bus.onAny(any);

      bus.emit("tick", { n: 1 });
      expect(any).not.toHaveBeenCalled();
      expect(bus.listenerCount()).toBe(0);
    });
  });

  // Type-level guards for the one place a caller has to switch on `event.type`.
  // Before `BusEvent` carried the name as a second parameter, `type` was
  // `string` and every `payload` in an `onAny` handler was `unknown` — the
  // index signature `Events extends Record<string, unknown>` forces onto
  // `ToolbarEventMap` swallowed the declared names whole.
  describe("event types", () => {
    it("keeps the emitted name as a literal on the returned event", () => {
      const bus = createEventBus<ToolbarEventMap>();
      expectTypeOf(bus.emit("navigation", { route: "/" })).toEqualTypeOf<
        BusEvent<ToolbarEventMap["navigation"], "navigation">
      >();
    });

    it("narrows an onAny payload when the handler switches on event.type", () => {
      const bus = createEventBus<ToolbarEventMap>();

      bus.onAny((payload, event) => {
        expectTypeOf(event).toEqualTypeOf<AnyBusEvent<ToolbarEventMap>>();
        expectTypeOf(event.type).toEqualTypeOf<BusEventName<ToolbarEventMap>>();
        expectTypeOf<BusEventName<ToolbarEventMap>>().toEqualTypeOf<
          | "navigation"
          | "interaction"
          | "long-task"
          | "network-start"
          | "network-end"
          | "react-commit"
          | "flag-changed"
          | "hydration"
          | "hydration-error"
        >();
        expectTypeOf(payload).toEqualTypeOf<ToolbarEventMap[BusEventName<ToolbarEventMap>]>();
        expectTypeOf(payload).not.toBeUnknown();

        if (event.type === "network-end") {
          expectTypeOf(event.payload).toEqualTypeOf<ToolbarEventMap["network-end"]>();
        }
        if (event.type === "navigation") {
          expectTypeOf(event.payload).toEqualTypeOf<{ route: string }>();
        }
      });
    });

    it("falls back to string for a bus with no event map", () => {
      const bus = createEventBus();
      bus.onAny((payload, event) => {
        expectTypeOf(event.type).toEqualTypeOf<string>();
        expectTypeOf(payload).toBeUnknown();
        expectTypeOf(event.payload).toBeUnknown();
      });
      expectTypeOf(bus.emit("anything", 1)).toEqualTypeOf<BusEvent<unknown, "anything">>();
    });
  });
});
