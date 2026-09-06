import { afterEach, expect, it, vi } from "vitest";
import { fakeExtensionApi } from "@nejcm/dev-toolbar/testing";
import { createMetricsRuntime } from "../index";
import { createReactProfilerCollector } from "../../../../examples/playground/src/collectors/reactProfiler";
import { createWebVitalsCollector } from "../../../../examples/playground/src/collectors/webVitals";

function observers(types = ["largest-contentful-paint", "layout-shift", "event"]) {
  const active = new Map<
    string,
    { callback: PerformanceObserverCallback; observer: PerformanceObserver }
  >();
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    "PerformanceObserver",
    class {
      static supportedEntryTypes = types;
      constructor(private callback: PerformanceObserverCallback) {}
      observe(options: PerformanceObserverInit) {
        observe(options);
        active.set(options.type!, {
          callback: this.callback,
          observer: this as unknown as PerformanceObserver,
        });
      }
      disconnect = disconnect;
    },
  );
  const emit = (type: string, entries: object[]) => {
    const entry = active.get(type)!;
    entry.callback({ getEntries: () => entries } as PerformanceObserverEntryList, entry.observer);
  };
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([
    { startTime: 0, responseStart: 80 },
  ] as unknown as PerformanceEntry[]);
  return { observe, disconnect, emit };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("collects both Profiler durations per commit, resets, and stops on abort", () => {
  const { collector, onRender } = createReactProfilerCollector();
  const runtime = createMetricsRuntime({ collectors: [collector] });
  const first = fakeExtensionApi();
  runtime.start(first.api);
  for (let i = 0; i < 130; i++) onRender("app", "update", i, i + 10, i, i + 1);
  expect(collector.series.size).toBe(120);
  expect(collector.diagnostics(0)).toMatchObject({
    commits: expect.arrayContaining([{ at: 130, actualDuration: 129, baseDuration: 139 }]),
  });
  first.abort();
  onRender("app", "update", 999, 999, 1, 2);
  expect(collector.series.last()).toBe(129);
  const second = fakeExtensionApi();
  runtime.start(second.api);
  onRender("app", "update", 3, 4, 1, 2);
  expect(collector.series.last()).toBe(3);
  runtime.reset();
  expect(collector.diagnostics(0)).toEqual({ commits: [] });
  expect(collector.read(0).status).toBe("pending");
  second.abort();
});

it("uses three observers for LCP, CLS sessions and grouped INP; reads navigation TTFB", () => {
  const fake = observers();
  Object.defineProperty(performance, "interactionCount", { configurable: true, value: 50 });
  try {
    const collector = createWebVitalsCollector();
    const controller = new AbortController();
    const invalidate = vi.fn();
    collector.start({ signal: controller.signal, now: () => 100, invalidate });
    expect(fake.observe.mock.calls.map(([options]) => options)).toEqual([
      { type: "largest-contentful-paint", buffered: true },
      { type: "layout-shift", buffered: true },
      { type: "event", buffered: true, durationThreshold: 16 },
    ]);
    fake.emit("largest-contentful-paint", [{ startTime: 1200 }]);
    fake.emit("layout-shift", [
      { startTime: 100, value: 0.1, hadRecentInput: false },
      { startTime: 500, value: 0.2, hadRecentInput: false },
      { startTime: 600, value: 5, hadRecentInput: true },
      { startTime: 2000, value: 0.2, hadRecentInput: false },
    ]);
    fake.emit("event", [
      { startTime: 1, interactionId: 1, duration: 200 },
      { startTime: 2, interactionId: 1, duration: 300 },
      { startTime: 3, interactionId: 2, duration: 100 },
      { startTime: 4, interactionId: 0, duration: 900 },
    ]);
    expect(collector.diagnostics(0)).toEqual({ lcp: 1200, cls: 0.1 + 0.2, inp: 100, ttfb: 80 });
    expect(collector.series.last()).toBe(1200);
    expect(invalidate).toHaveBeenCalledTimes(3);
    controller.abort();
    expect(fake.disconnect).toHaveBeenCalledTimes(3);
    fake.emit("largest-contentful-paint", [{ startTime: 1500 }]);
    expect(collector.series.last()).toBe(1200);
    collector.reset();
    expect(collector.diagnostics(0)).toEqual({ lcp: null, cls: 0, inp: null, ttfb: 80 });
  } finally {
    Reflect.deleteProperty(performance, "interactionCount");
  }
});

it("survives StrictMode teardown before the first buffered delivery", () => {
  const fake = observers();
  const collector = createWebVitalsCollector();
  const first = new AbortController();
  collector.start({ signal: first.signal, now: () => 1000, invalidate: vi.fn() });
  first.abort();
  const second = new AbortController();
  collector.start({ signal: second.signal, now: () => 1001, invalidate: vi.fn() });
  fake.emit("largest-contentful-paint", [{ startTime: 500 }]);
  expect(collector.series.last()).toBe(500);
  second.abort();
});

it("degrades absent observers and entry types independently", () => {
  vi.stubGlobal("PerformanceObserver", undefined);
  const unsupported = createWebVitalsCollector();
  expect(unsupported.supported).toBe(false);
  expect(unsupported.read(0).status).toBe("unsupported");
  const fake = observers(["layout-shift"]);
  const partial = createWebVitalsCollector();
  const controller = new AbortController();
  partial.start({ signal: controller.signal, now: () => 0, invalidate: vi.fn() });
  expect(fake.observe).toHaveBeenCalledOnce();
  expect(partial.read(0).status).toBe("unsupported");
  expect(partial.diagnostics(0)).toEqual({ lcp: null, cls: 0, inp: null, ttfb: 80 });
  controller.abort();
});

it("starts the CLS session at its first shift rather than navigation", () => {
  const fake = observers();
  const collector = createWebVitalsCollector();
  const controller = new AbortController();
  collector.start({ signal: controller.signal, now: () => 0, invalidate: vi.fn() });
  fake.emit(
    "layout-shift",
    [500, 1400, 2300, 3200, 4100, 5000].map((startTime) => ({
      startTime,
      value: 0.1,
      hadRecentInput: false,
    })),
  );
  expect(collector.diagnostics(0)).toMatchObject({ cls: 0.6 });
  controller.abort();
});
