import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryCollector, readPerformanceMemory } from "../collectors/memory";

const context = (controller: AbortController, clock: { t: number }) => ({
  signal: controller.signal,
  now: () => clock.t,
  invalidate: vi.fn(),
});

afterEach(() => {
  vi.useRealTimers();
});

describe("memory collector — API present", () => {
  it("reports used heap, share of limit and the last-minute change", () => {
    vi.useFakeTimers();
    const clock = { t: 0 };
    let used = 40_000_000;
    const collector = createMemoryCollector({
      sampleMs: 1000,
      read: () => ({
        usedJSHeapSize: used,
        totalJSHeapSize: 80_000_000,
        jsHeapSizeLimit: 100_000_000,
      }),
    });
    expect(collector.supported).toBe(true);

    const controller = new AbortController();
    collector.start(context(controller, clock));

    let view = collector.read(clock.t);
    expect(view.status).toBe("ok");
    expect(view.severity).toBe("ok"); // 40% of the limit
    expect(view.display).toBe("38 MB");

    used = 80_000_000;
    clock.t = 30_000;
    vi.advanceTimersByTime(30_000);
    view = collector.read(clock.t);
    expect(view.severity).toBe("bad"); // 80% of the limit
    expect(Object.fromEntries(view.detail)["Share of limit"]).toBe("80.0%");
    expect(Object.fromEntries(view.detail)["Change (last minute)"]).toBe(
      "+38.1 MB",
    );

    controller.abort();
  });

  it("flags sustained monotonic growth even below the ratio thresholds", () => {
    vi.useFakeTimers();
    const clock = { t: 0 };
    let used = 1_000_000;
    const collector = createMemoryCollector({
      sampleMs: 5000,
      read: () => ({
        usedJSHeapSize: used,
        totalJSHeapSize: 10_000_000,
        jsHeapSizeLimit: 1_000_000_000,
      }),
    });
    const controller = new AbortController();
    collector.start(context(controller, clock));

    for (let step = 0; step < 12; step += 1) {
      used += 100_000;
      clock.t += 5000;
      vi.advanceTimersByTime(5000);
    }

    const view = collector.read(clock.t);
    expect(Object.fromEntries(view.detail)["Sustained growth"]).toBe("yes");
    expect(view.severity).toBe("warn");
    controller.abort();
  });

  it("stops sampling once the signal aborts", () => {
    vi.useFakeTimers();
    const clock = { t: 0 };
    const read = vi.fn(() => ({
      usedJSHeapSize: 1,
      totalJSHeapSize: 2,
      jsHeapSizeLimit: 4,
    }));
    const collector = createMemoryCollector({ sampleMs: 100, read });
    const controller = new AbortController();
    collector.start(context(controller, clock));
    vi.advanceTimersByTime(500);
    const calls = read.mock.calls.length;
    controller.abort();
    vi.advanceTimersByTime(5000);
    expect(read.mock.calls.length).toBe(calls);
  });

  it("resets to pending", () => {
    const collector = createMemoryCollector({
      read: () => ({
        usedJSHeapSize: 1,
        totalJSHeapSize: 2,
        jsHeapSizeLimit: 4,
      }),
    });
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));
    expect(collector.read(0).status).toBe("ok");
    collector.reset();
    expect(collector.read(0).status).toBe("pending");
    expect(collector.read(0).display).toBe("…");
    controller.abort();
  });
});

describe("memory collector — API absent", () => {
  it("degrades to NA without throwing, and says why", () => {
    const collector = createMemoryCollector({ read: () => null });
    expect(collector.supported).toBe(false);
    expect(collector.unsupportedReason).toContain("Chromium");

    const view = collector.read(0);
    expect(view.status).toBe("unsupported");
    expect(view.display).toBe("NA");
    expect(view.severity).toBe("unknown");
    expect(Number.isNaN(view.value)).toBe(true);
    expect(view.hint).toContain("Chromium-only");
    // Starting an unsupported collector must still be harmless.
    const controller = new AbortController();
    expect(() =>
      collector.start(context(controller, { t: 0 })),
    ).not.toThrow();
    controller.abort();
    expect(collector.diagnostics(0)).toMatchObject({ supported: false });
  });

  it("reads nothing from a performance object without .memory", () => {
    expect(readPerformanceMemory({})).toBeNull();
    expect(readPerformanceMemory(undefined)).toBeNull();
    // Present but nonsense: a zero limit would make every ratio Infinity.
    expect(
      readPerformanceMemory({
        memory: { usedJSHeapSize: 1, totalJSHeapSize: 2, jsHeapSizeLimit: 0 },
      }),
    ).toBeNull();
    expect(
      readPerformanceMemory({
        memory: { usedJSHeapSize: 1, totalJSHeapSize: 2, jsHeapSizeLimit: 4 },
      }),
    ).toEqual({ usedJSHeapSize: 1, totalJSHeapSize: 2, jsHeapSizeLimit: 4 });
  });
});
