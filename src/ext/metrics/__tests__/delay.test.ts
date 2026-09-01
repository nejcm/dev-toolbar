import { afterEach, describe, expect, it, vi } from "vitest";
import { createDelayCollector, supportsEventTiming } from "../collectors/delay";

type Callback = (list: { getEntries(): unknown[] }) => void;

interface Installed {
  emit(entries: unknown[]): void;
  observed: PerformanceObserverInit[];
  disconnected: number;
}

const original = Object.getOwnPropertyDescriptor(
  globalThis,
  "PerformanceObserver",
);

function install(options: {
  supportedEntryTypes?: string[];
  observeThrowsFor?: (init: PerformanceObserverInit) => boolean;
}): Installed {
  const state: Installed = { emit: () => {}, observed: [], disconnected: 0 };

  class Fake {
    constructor(private readonly callback: Callback) {
      state.emit = (entries) => this.callback({ getEntries: () => entries });
    }
    observe(init: PerformanceObserverInit) {
      if (options.observeThrowsFor?.(init)) throw new TypeError("bad option");
      state.observed.push(init);
    }
    disconnect() {
      state.disconnected += 1;
    }
  }
  Object.defineProperty(Fake, "supportedEntryTypes", {
    value: options.supportedEntryTypes ?? ["event"],
  });

  Object.defineProperty(globalThis, "PerformanceObserver", {
    configurable: true,
    writable: true,
    value: Fake,
  });
  return state;
}

function uninstall() {
  if (original) Object.defineProperty(globalThis, "PerformanceObserver", original);
  else
    delete (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver;
}

afterEach(uninstall);

const entry = (over: Partial<Record<string, unknown>> = {}) => ({
  entryType: "event",
  name: "pointerdown",
  startTime: 100,
  duration: 320,
  processingStart: 140,
  processingEnd: 260,
  target: null,
  ...over,
});

const context = (controller: AbortController, clock: { t: number }) => ({
  signal: controller.signal,
  now: () => clock.t,
  invalidate: vi.fn(),
});

describe("delay collector — Event Timing present", () => {
  it("reports the worst interaction in the rolling window, not the latest", () => {
    const observer = install({});
    const clock = { t: 1000 };
    const collector = createDelayCollector({ windowMs: 30_000 });
    expect(collector.supported).toBe(true);

    const controller = new AbortController();
    const ctx = context(controller, clock);
    collector.start(ctx);
    expect(observer.observed[0]).toMatchObject({
      type: "event",
      buffered: true,
      durationThreshold: 16,
    });

    observer.emit([entry({ duration: 320 })]);
    clock.t = 2000;
    observer.emit([entry({ duration: 90, name: "click" })]);
    expect(ctx.invalidate).toHaveBeenCalled();

    const view = collector.read(clock.t);
    expect(view.status).toBe("ok");
    expect(view.display).toBe("320 ms");
    expect(view.severity).toBe("warn"); // 200 < 320 <= 500
    const detail = Object.fromEntries(view.detail);
    expect(detail["Worst (rolling window)"]).toBe("320 ms — pointerdown");
    expect(detail["Latest interaction"]).toBe("90 ms — click");
    expect(detail["Input delay"]).toBe("40.0 ms");
    expect(detail["Handler processing"]).toBe("120 ms");
    expect(detail["Presentation"]).toBe("160 ms");
    controller.abort();
    expect(observer.disconnected).toBe(1);
  });

  it("lets an old interaction age out of the rolling window", () => {
    const observer = install({});
    const clock = { t: 0 };
    const collector = createDelayCollector({ windowMs: 5000 });
    const controller = new AbortController();
    collector.start(context(controller, clock));

    observer.emit([entry({ duration: 900 })]);
    expect(collector.read(clock.t).display).toBe("900 ms");

    clock.t = 6000;
    // Nothing new arrived; the window simply moved past it.
    expect(collector.read(clock.t).status).toBe("pending");
    expect(collector.read(clock.t).display).toBe("\u2014");
    controller.abort();
  });

  it("describes the target element", () => {
    const observer = install({});
    const clock = { t: 0 };
    const collector = createDelayCollector();
    const controller = new AbortController();
    collector.start(context(controller, clock));

    const target = document.createElement("button");
    target.id = "buy";
    target.className = "primary large";
    observer.emit([entry({ target })]);

    expect(Object.fromEntries(collector.read(0).detail)["Worst target"]).toBe(
      "button#buy.primary",
    );
    controller.abort();
  });

  it("falls back through narrower observe() shapes when options are rejected", () => {
    const observer = install({
      observeThrowsFor: (init) =>
        (init as { durationThreshold?: number }).durationThreshold !== undefined,
    });
    const collector = createDelayCollector();
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));
    // The first shape threw; the second was accepted.
    expect(observer.observed).toEqual([{ type: "event", buffered: true }]);
    expect(collector.supported).toBe(true);
    controller.abort();
  });

  it("degrades when every observe() shape is rejected", () => {
    install({ observeThrowsFor: () => true });
    const collector = createDelayCollector();
    const controller = new AbortController();
    expect(() => collector.start(context(controller, { t: 0 }))).not.toThrow();
    expect(collector.supported).toBe(false);
    const view = collector.read(0);
    expect(view.status).toBe("unsupported");
    expect(view.display).toBe("NA");
    expect(view.hint).toContain("rejected every Event Timing option shape");
    controller.abort();
  });
});

describe("delay collector — Event Timing absent", () => {
  it("is unsupported when PerformanceObserver does not list 'event'", () => {
    install({ supportedEntryTypes: ["longtask", "paint"] });
    const collector = createDelayCollector();
    expect(supportsEventTiming()).toBe(false);
    expect(collector.supported).toBe(false);
    const view = collector.read(0);
    expect(view.display).toBe("NA");
    expect(view.severity).toBe("unknown");
  });

  it("is unsupported when PerformanceObserver is missing entirely", () => {
    delete (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver;
    expect(supportsEventTiming()).toBe(false);
    const collector = createDelayCollector();
    expect(collector.supported).toBe(false);
    expect(collector.read(0).status).toBe("unsupported");
    expect(collector.diagnostics(0)).toMatchObject({ supported: false });
  });
});
