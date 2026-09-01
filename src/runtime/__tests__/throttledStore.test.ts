import { describe, expect, it, vi } from "vitest";
import { createThrottledStore } from "../throttledStore";

/** A hand-cranked clock plus timer queue, so no global fake timers are needed. */
function harness() {
  let time = 0;
  let pending: { at: number; callback: () => void } | null = null;
  return {
    now: () => time,
    schedule: (callback: () => void, delayMs: number) => {
      pending = { at: time + delayMs, callback };
      return () => {
        pending = null;
      };
    },
    advance(ms: number) {
      const target = time + ms;
      while (pending && pending.at <= target) {
        const due = pending;
        time = due.at;
        pending = null;
        due.callback();
      }
      time = target;
    },
    get scheduled() {
      return pending !== null;
    },
  };
}

describe("createThrottledStore", () => {
  it("coalesces a burst into one notification and keeps the last value", () => {
    const clock = harness();
    const store = createThrottledStore(0, {
      intervalMs: 250,
      now: clock.now,
      schedule: clock.schedule,
    });
    const listener = vi.fn();
    store.subscribe(listener);

    // 60 writes in the same millisecond — a 60 Hz sampler inside one frame.
    for (let index = 1; index <= 60; index += 1) store.set(index);

    // Leading edge published the first one immediately…
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(1);
    // …and the other 59 are pending behind a single trailing publish.
    expect(store.peek()).toBe(60);
    expect(clock.scheduled).toBe(true);

    clock.advance(250);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()).toBe(60);
    expect(store.published).toBe(2);
  });

  it("keeps getSnapshot stable between notifications", () => {
    const clock = harness();
    const store = createThrottledStore("a", {
      intervalMs: 100,
      now: clock.now,
      schedule: clock.schedule,
    });
    store.subscribe(() => {});
    store.set("b"); // leading edge
    store.set("c");
    store.set("d");
    // Snapshot must not move without a notification, or useSyncExternalStore
    // would render values it was never told about.
    expect(store.getSnapshot()).toBe("b");
    expect(store.getSnapshot()).toBe("b");
    clock.advance(100);
    expect(store.getSnapshot()).toBe("d");
  });

  it("publishes at most once per interval under sustained writes", () => {
    const clock = harness();
    const store = createThrottledStore(0, {
      intervalMs: 250,
      now: clock.now,
      schedule: clock.schedule,
    });
    store.subscribe(() => {});

    // ~16 ms apart for 2 seconds: 125 writes.
    for (let index = 0; index < 125; index += 1) {
      store.set(index);
      clock.advance(16);
    }
    // 2000 ms at 4 Hz is 8 publishes, plus the leading edge.
    expect(store.published).toBeLessThanOrEqual(9);
    expect(store.published).toBeGreaterThan(4);
  });

  it("skips the notification when the value did not change", () => {
    const clock = harness();
    const store = createThrottledStore(
      { count: 0 },
      {
        intervalMs: 100,
        now: clock.now,
        schedule: clock.schedule,
        equals: (a, b) => a.count === b.count,
      },
    );
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ count: 0 });
    clock.advance(500);
    expect(listener).not.toHaveBeenCalled();
    store.set({ count: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("flush() publishes immediately and cancels the trailing timer", () => {
    const clock = harness();
    const store = createThrottledStore(0, {
      intervalMs: 250,
      now: clock.now,
      schedule: clock.schedule,
    });
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(1);
    store.set(2);
    expect(clock.scheduled).toBe(true);
    store.flush();
    expect(clock.scheduled).toBe(false);
    expect(store.getSnapshot()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("update() reads the pending value, not the published one", () => {
    const clock = harness();
    const store = createThrottledStore(0, {
      intervalMs: 250,
      now: clock.now,
      schedule: clock.schedule,
    });
    store.update((previous) => previous + 1); // leading edge -> 1
    store.update((previous) => previous + 1); // pending 2
    store.update((previous) => previous + 1); // pending 3
    expect(store.getSnapshot()).toBe(1);
    expect(store.peek()).toBe(3);
    clock.advance(250);
    expect(store.getSnapshot()).toBe(3);
  });

  it("unsubscribes, and destroy() stops writes and timers", () => {
    const clock = harness();
    const store = createThrottledStore(0, {
      intervalMs: 250,
      now: clock.now,
      schedule: clock.schedule,
    });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set(1);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    clock.advance(500);
    store.set(2);
    expect(listener).toHaveBeenCalledTimes(1);

    store.destroy();
    store.set(3);
    clock.advance(500);
    expect(store.getSnapshot()).toBe(2);
  });

  it("survives a throwing listener", () => {
    const clock = harness();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createThrottledStore(0, {
      intervalMs: 10,
      now: clock.now,
      schedule: clock.schedule,
    });
    const good = vi.fn();
    store.subscribe(() => {
      throw new Error("boom");
    });
    store.subscribe(good);
    store.set(1);
    expect(good).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
