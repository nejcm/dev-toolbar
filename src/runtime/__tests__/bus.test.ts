import { describe, expect, it, vi } from "vitest";
import { createEventBus } from "../bus";
import type { ToolbarEventMap } from "../bus";

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
});
