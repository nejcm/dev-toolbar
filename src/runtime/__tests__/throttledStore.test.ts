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

  it("subscribe() after destroy() returns a safe no-op unsubscribe", () => {
    const clock = harness();
    const store = createThrottledStore(0, {
      intervalMs: 250,
      now: clock.now,
      schedule: clock.schedule,
    });
    store.destroy();

    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    // set()/flush() are already no-ops post-destroy, so this alone would
    // pass without the fix too — the retention fix itself (not adding the
    // listener to the set) isn't observable through the public surface.
    // This pins the documented contract: subscribing after destroy never
    // notifies, and the returned unsubscribe is always safe to call.
    store.set(1);
    clock.advance(500);
    store.flush();
    expect(listener).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });

  it("destroy() cancels a pending trailing timer before it fires", () => {
    const clock = harness();
    const store = createThrottledStore(0, {
      intervalMs: 250,
      now: clock.now,
      schedule: clock.schedule,
    });
    const listener = vi.fn();
    store.subscribe(listener);

    store.set(1); // leading edge, published
    store.set(2); // books a trailing publish
    expect(clock.scheduled).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    store.destroy();
    expect(clock.scheduled).toBe(false);

    clock.advance(500);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(1);
  });

  it("destroy() without flush drops the pending trailing write permanently", () => {
    const clock = harness();
    const store = createThrottledStore(0, {
      intervalMs: 250,
      now: clock.now,
      schedule: clock.schedule,
    });
    const listener = vi.fn();
    store.subscribe(listener);

    store.set(1); // leading edge, published
    store.set(2); // books a trailing publish, never fires

    store.destroy();
    // flush() is a no-op post-destroy, so the pending 2 is unreachable —
    // there is no way to recover it once destroy() has run.
    store.flush();
    expect(store.getSnapshot()).toBe(1);
    expect(store.peek()).toBe(2); // still visible for diagnostics, just never published
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("destroy({ flush: true }) publishes the pending value before tearing down", () => {
    const clock = harness();
    const store = createThrottledStore(0, {
      intervalMs: 250,
      now: clock.now,
      schedule: clock.schedule,
    });
    const listener = vi.fn();
    store.subscribe(listener);

    store.set(1); // leading edge, published
    store.set(2); // books a trailing publish
    expect(clock.scheduled).toBe(true);

    store.destroy({ flush: true });
    expect(store.getSnapshot()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(clock.scheduled).toBe(false);

    // Regression: destroy() is idempotent even with flush — a second call
    // on an already-destroyed store must not publish or notify again.
    store.destroy({ flush: true });
    expect(store.getSnapshot()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);

    // Destroy still tears down afterward: no further writes or subscriptions.
    store.set(3);
    expect(store.getSnapshot()).toBe(2);
    const laterListener = vi.fn();
    store.subscribe(laterListener);
    clock.advance(500);
    expect(laterListener).not.toHaveBeenCalled();
  });

  it("destroy({ flush: true }) leaves no timer even if a listener writes re-entrantly", () => {
    const clock = harness();
    const store = createThrottledStore(0, {
      intervalMs: 250,
      now: clock.now,
      schedule: clock.schedule,
    });
    store.subscribe(() => {
      // A listener reacting to the teardown publish writes again. `destroyed`
      // isn't set until after publish() returns, so this write is accepted
      // and can book its own trailing timer — destroy() must still cancel
      // it afterward, or a timer would outlive the store.
      store.set(999);
    });

    store.set(1); // leading edge, published
    store.set(2); // books a trailing publish

    store.destroy({ flush: true });
    expect(store.getSnapshot()).toBe(2);
    expect(clock.scheduled).toBe(false);

    clock.advance(10_000);
    expect(clock.scheduled).toBe(false);
    expect(store.getSnapshot()).toBe(2);
  });

  it("destroy({ flush: true }) is a no-op when there is nothing pending", () => {
    const clock = harness();
    const store = createThrottledStore(0, {
      intervalMs: 250,
      now: clock.now,
      schedule: clock.schedule,
    });
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(1); // leading edge, published; nothing left pending

    store.destroy({ flush: true });
    expect(store.getSnapshot()).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1); // no extra notification
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

  it("routes a throwing listener's error through onError instead of console.error", () => {
    const clock = harness();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const onError = vi.fn();
    const thrown = new Error("boom");
    const store = createThrottledStore<number>(0, {
      intervalMs: 10,
      now: clock.now,
      schedule: clock.schedule,
      onError,
    });
    const good = vi.fn();
    store.subscribe(() => {
      throw thrown;
    });
    store.subscribe(good);

    store.set(1);

    expect(good).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(thrown, 1);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("reports the throwing pass's own value even when an earlier listener republishes re-entrantly", () => {
    const clock = harness();
    const onError = vi.fn();
    const thrown = new Error("boom");
    // intervalMs: 0 so a re-entrant set() inside a listener publishes
    // synchronously instead of booking a trailing timer.
    const store = createThrottledStore<number>(0, {
      intervalMs: 0,
      now: clock.now,
      schedule: clock.schedule,
      onError,
    });
    store.subscribe(() => {
      // Republishes before the next listener in *this* pass has run,
      // advancing the module-level `published` from 1 to 2.
      store.set(2);
    });
    store.subscribe(() => {
      throw thrown;
    });

    store.set(1); // leading edge: this pass publishes 1

    expect(store.getSnapshot()).toBe(2);
    // The nested pass (triggered by the re-entrant set(2)) reports its own
    // value, 2. The outer pass's throw — from the same listener set, after
    // the nested publish already advanced `published` — must still report
    // 1: the value *this* pass delivered, not whatever is newest by the
    // time the throw happens.
    expect(onError).toHaveBeenNthCalledWith(1, thrown, 2);
    expect(onError).toHaveBeenNthCalledWith(2, thrown, 1);
    expect(onError).toHaveBeenCalledTimes(2);
  });
});
