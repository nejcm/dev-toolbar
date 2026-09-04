import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryCollector, readPerformanceMemory } from "../collectors/memory";

const context = (controller: AbortController, clock: { t: number }) => ({
  signal: controller.signal,
  now: () => clock.t,
  invalidate: vi.fn(),
});

function growthFor(samples: readonly number[]): { detail: string; diagnostic: boolean } {
  vi.useFakeTimers();
  const clock = { t: 0 };
  let used = samples[0] as number;
  const collector = createMemoryCollector({
    sampleMs: 1000,
    read: () => ({
      usedJSHeapSize: used,
      totalJSHeapSize: 200_000_000,
      jsHeapSizeLimit: 1_000_000_000,
    }),
  });
  const controller = new AbortController();
  collector.start(context(controller, clock));
  for (const next of samples.slice(1)) {
    used = next;
    clock.t += 1000;
    vi.advanceTimersByTime(1000);
  }
  const result = {
    detail: Object.fromEntries(collector.read(clock.t).detail)["Sustained growth"] as string,
    diagnostic: (collector.diagnostics(clock.t) as { sustainedGrowth: boolean }).sustainedGrowth,
  };
  controller.abort();
  return result;
}

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
    // The label states the span it actually covers: 30 s in, not a full minute.
    expect(Object.fromEntries(view.detail)["Change (last 30 s)"]).toBe("+38.1 MB");
    expect(Object.fromEntries(view.detail)["Sampling"]).toBe("live");

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
      // 200 KB a tick: the floor of the window has to gain a material 1 MB.
      used += 200_000;
      clock.t += 5000;
      vi.advanceTimersByTime(5000);
    }

    const view = collector.read(clock.t);
    expect(Object.fromEntries(view.detail)["Sustained growth"]).toBe("yes");
    expect(view.severity).toBe("warn");
    controller.abort();
  });

  it("allows plateaus when the floor rises by a material amount", () => {
    /**
     * Strictly increasing samples missed sustained growth whenever the reported
     * heap repeated a value between meaningful increases.
     */
    const result = growthFor([
      100_000_000, 101_000_000, 101_000_000, 102_000_000, 103_000_000, 103_000_000,
    ]);
    expect(result.detail).toBe("yes");
    expect(result.diagnostic).toBe(true);
  });

  it("requires a material net increase", () => {
    /**
     * D5 guard: the rejected non-decreasing-plus-positive-delta rule classified
     * tiny increases as growth even when every sample rose.
     */
    const result = growthFor([100_000_000, 100_000_100, 100_000_200, 100_000_300, 100_000_400]);
    expect(result.detail).toBe("no");
    expect(result.diagnostic).toBe(false);
  });

  it("requires the floor to rise on most steps", () => {
    /** D5 guard: one step up followed by a flat floor is not sustained growth. */
    const result = growthFor([100_000_000, 102_000_000, 102_000_000, 102_000_000, 102_000_000]);
    expect(result.detail).toBe("no");
    expect(result.diagnostic).toBe(false);
  });

  it("flags a sawtooth whose floor rises", () => {
    /**
     * A leaking page still runs minor GCs, so its used heap falls between
     * samples. The signal is the floor, not a monotonic climb — the old
     * "any decrease disqualifies" rule made this case, the realistic one,
     * unreportable.
     */
    const result = growthFor([
      100_000_000, 104_000_000, 101_000_000, 105_000_000, 102_000_000, 106_000_000, 103_000_000,
      107_000_000,
    ]);
    expect(result.detail).toBe("yes");
    expect(result.diagnostic).toBe(true);
  });

  it("does not flag a sawtooth whose floor is flat", () => {
    /** Churn without a leak: big swings, but the heap keeps returning to the same floor. */
    const result = growthFor([
      100_000_000, 108_000_000, 100_000_000, 109_000_000, 100_500_000, 107_000_000, 100_000_000,
      110_000_000,
    ]);
    expect(result.detail).toBe("no");
    expect(result.diagnostic).toBe(false);
  });

  it("reports a rate-limited source instead of presenting stale numbers as live", () => {
    /**
     * Outside a site-locked renderer (Android Chrome, or site isolation off)
     * Chromium quantizes performance.memory and refreshes it at most every 20
     * minutes, so the poll returns one identical number for a very long time.
     */
    vi.useFakeTimers();
    const clock = { t: 0 };
    const collector = createMemoryCollector({
      sampleMs: 1000,
      read: () => ({
        usedJSHeapSize: 40_000_000,
        totalJSHeapSize: 80_000_000,
        jsHeapSizeLimit: 1_000_000_000,
      }),
    });
    const controller = new AbortController();
    collector.start(context(controller, clock));

    // Under a minute of identical readings is still "live" — a still heap happens.
    for (let step = 0; step < 40; step += 1) {
      clock.t += 1000;
      vi.advanceTimersByTime(1000);
    }
    expect(Object.fromEntries(collector.read(clock.t).detail)["Sampling"]).toBe("live");

    for (let step = 0; step < 40; step += 1) {
      clock.t += 1000;
      vi.advanceTimersByTime(1000);
    }
    const view = collector.read(clock.t);
    const detail = Object.fromEntries(view.detail);
    expect(detail["Sampling"]).toBe("rate-limited");
    // Growth cannot be read off a frozen source, so it is unknown, not "no".
    expect(detail["Sustained growth"]).toBe("unknown");
    expect(detail["Change (last minute)"]).toBe("NA");
    expect(view.hint).toContain("20 minutes");
    expect(collector.diagnostics(clock.t)).toMatchObject({
      sampling: "rate-limited",
      sustainedGrowth: null,
    });

    // Reset clears the observation along with the samples.
    collector.reset();
    clock.t += 1000;
    vi.advanceTimersByTime(1000);
    expect(Object.fromEntries(collector.read(clock.t).detail)["Sampling"]).toBe("live");
    controller.abort();
  });

  it("stays rate-limited once the source refreshes its cached number", () => {
    /**
     * The 20-minute cache does eventually turn over, so a rate-limited source
     * emits one changed value and then freezes again. Treating that single
     * change as proof of a live source would flip the panel back to "live" and
     * re-enable a growth read-out computed from quantized, stale numbers.
     */
    vi.useFakeTimers();
    const clock = { t: 0 };
    let used = 40_000_000;
    const collector = createMemoryCollector({
      sampleMs: 1000,
      read: () => ({
        usedJSHeapSize: used,
        totalJSHeapSize: 80_000_000,
        jsHeapSizeLimit: 1_000_000_000,
      }),
    });
    const controller = new AbortController();
    collector.start(context(controller, clock));

    for (let step = 0; step < 80; step += 1) {
      clock.t += 1000;
      vi.advanceTimersByTime(1000);
    }
    expect(Object.fromEntries(collector.read(clock.t).detail)["Sampling"]).toBe("rate-limited");

    used = 44_000_000;
    clock.t += 1000;
    vi.advanceTimersByTime(1000);

    const detail = Object.fromEntries(collector.read(clock.t).detail);
    expect(detail["Sampling"]).toBe("rate-limited");
    expect(detail["Sustained growth"]).toBe("unknown");
    expect(collector.diagnostics(clock.t)).toMatchObject({
      sampling: "rate-limited",
      sustainedGrowth: null,
    });
    controller.abort();
  });

  it("never calls a genuinely moving heap rate-limited", () => {
    /** The detector must key on identical readings, not on a quiet-looking heap. */
    vi.useFakeTimers();
    const clock = { t: 0 };
    let used = 40_000_000;
    const collector = createMemoryCollector({
      sampleMs: 1000,
      read: () => ({
        usedJSHeapSize: used,
        totalJSHeapSize: 80_000_000,
        jsHeapSizeLimit: 1_000_000_000,
      }),
    });
    const controller = new AbortController();
    collector.start(context(controller, clock));

    for (let step = 0; step < 200; step += 1) {
      // A tiny wobble either way: nothing a growth rule would flag, but never
      // twice the same byte count.
      used += step % 2 === 0 ? 4096 : -2048;
      clock.t += 1000;
      vi.advanceTimersByTime(1000);
    }

    const detail = Object.fromEntries(collector.read(clock.t).detail);
    expect(detail["Sampling"]).toBe("live");
    expect(detail["Sustained growth"]).toBe("no");
    expect(collector.diagnostics(clock.t)).toMatchObject({ sampling: "live", identicalRun: 1 });
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
    expect(() => collector.start(context(controller, { t: 0 }))).not.toThrow();
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
