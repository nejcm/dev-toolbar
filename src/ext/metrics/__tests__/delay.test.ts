import { afterEach, describe, expect, it, vi } from "vitest";
import { createDelayCollector, supportsEventTiming } from "../collectors/delay";

type Callback = (list: { getEntries(): unknown[] }) => void;

interface Installed {
  emit(entries: unknown[]): void;
  observed: PerformanceObserverInit[];
  disconnected: number;
}

const original = Object.getOwnPropertyDescriptor(globalThis, "PerformanceObserver");

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
  else delete (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver;
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

  it("uses the measured start time for buffered interactions", () => {
    /**
     * Buffered entries were stamped with callback delivery time. A ten-minute-old
     * interaction therefore appeared current and its sparkline point moved to the
     * delivery timestamp.
     */
    const observer = install({});
    const clock = { t: 600_000 };
    const collector = createDelayCollector({ windowMs: 30_000 });
    const controller = new AbortController();
    collector.start(context(controller, clock));

    observer.emit([entry({ startTime: 20_000, duration: 1800 })]);

    expect(collector.series.lastAt()).toBe(20_000);
    expect(collector.read(clock.t).status).toBe("pending");
    controller.abort();
  });

  it("clears buffered interactions when observation stops", () => {
    /**
     * A real stop and restart creates a new buffered observer. Keeping the old
     * ring let the browser's replay accumulate on top of dead samples.
     */
    const observer = install({});
    const clock = { t: 100 };
    const collector = createDelayCollector();
    const controller = new AbortController();
    collector.start(context(controller, clock));
    observer.emit([entry({ startTime: 100 })]);
    expect(collector.read(clock.t).status).toBe("ok");

    controller.abort();

    expect(collector.series.size).toBe(0);
    expect(collector.read(clock.t).status).toBe("pending");
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

    expect(Object.fromEntries(collector.read(0).detail)["Worst target"]).toBe("button#buy.primary");
    controller.abort();
  });

  it("masks each part of the target before joining them", () => {
    // `id`/`className` are foreign DOM attributes, and `redact()` matches value
    // shapes anchored to the whole string — so a credential-shaped `id` was
    // findable on its own but not once `tag` was joined in front of it. A
    // JWT-shaped id is exactly the shape that only an anchored matcher catches
    // pre-join, which is why it's the fixture here.
    const observer = install({});
    const clock = { t: 0 };
    const collector = createDelayCollector();
    const controller = new AbortController();
    collector.start(context(controller, clock));

    const target = document.createElement("button");
    target.id = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQxxxxx";
    target.className = "Bearer sk-live-abcdef123456";
    observer.emit([entry({ target })]);

    const described = Object.fromEntries(collector.read(0).detail)["Worst target"] as string;
    expect(described).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(described).not.toContain("sk-live-abcdef123456");
    expect(described).toBe("button#[redacted].Bearer");
    controller.abort();
  });

  it("leaves an ordinary target readable, so the masking is not a blanket one", () => {
    const observer = install({});
    const clock = { t: 0 };
    const collector = createDelayCollector();
    const controller = new AbortController();
    collector.start(context(controller, clock));

    const target = document.createElement("a");
    target.id = "checkout-cta";
    target.className = "btn btn-primary";
    observer.emit([entry({ target })]);

    expect(Object.fromEntries(collector.read(0).detail)["Worst target"]).toBe("a#checkout-cta.btn");
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

describe("delay collector — grouping by interactionId", () => {
  it("folds the entries of one interaction into a single record, INP-style", () => {
    /**
     * One tap emits the three entries the spec gives an interactionId —
     * pointerdown, pointerup and click — plus the compat mouse events, which
     * get id 0. Counting entries made "Interactions seen" read 3 after one
     * click; the spec's grouping makes it 1, with the interaction's duration
     * being its *longest* entry.
     */
    const observer = install({});
    const collector = createDelayCollector();
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));

    observer.emit([
      entry({ interactionId: 7, name: "pointerdown", duration: 40 }),
      entry({ interactionId: 7, name: "pointerup", duration: 24 }),
      entry({ interactionId: 7, name: "click", duration: 320 }),
    ]);

    const view = collector.read(0);
    const detail = Object.fromEntries(view.detail);
    expect(view.display).toBe("320 ms");
    expect(detail["Interactions seen"]).toBe("1");
    expect(detail["Entries in worst interaction"]).toBe("3");
    expect(detail["Event entries seen"]).toBe("3");
    expect(detail["Worst (rolling window)"]).toBe("320 ms — click");
    expect(view.hint).toContain("grouped by interactionId");
    controller.abort();
  });

  it("keeps the breakdown of the interaction's longest entry", () => {
    const observer = install({});
    const collector = createDelayCollector();
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));

    // The longer entry is delivered *second* but started *first*: the record's
    // breakdown must follow the longest entry while its `at` moves back to the
    // interaction's earliest start.
    observer.emit([
      entry({ interactionId: 3, name: "pointerup", startTime: 100, duration: 40 }),
      entry({
        interactionId: 3,
        name: "pointerdown",
        startTime: 50,
        duration: 400,
        processingStart: 60,
        processingEnd: 410,
      }),
    ]);

    const detail = Object.fromEntries(collector.read(0).detail);
    expect(detail["Worst (rolling window)"]).toBe("400 ms — pointerdown");
    expect(detail["Input delay"]).toBe("10.0 ms");
    expect(detail["Handler processing"]).toBe("350 ms");
    // The record starts at the interaction's earliest entry, whatever order
    // the entries arrived in.
    expect((collector.diagnostics(0) as { worst: { at: number } }).worst.at).toBe(50);
    expect(collector.series.times.at(0)).toBe(100);
    expect(collector.series.times.at(1)).toBe(50);
    controller.abort();
  });

  it("groups entries that arrive in separate observer callbacks", () => {
    const observer = install({});
    const collector = createDelayCollector();
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));

    observer.emit([entry({ interactionId: 9, name: "pointerdown", duration: 40 })]);
    observer.emit([entry({ interactionId: 9, name: "click", duration: 240 })]);

    const detail = Object.fromEntries(collector.read(0).detail);
    expect(detail["Interactions seen"]).toBe("1");
    expect(detail["Entries in worst interaction"]).toBe("2");
    expect(collector.read(0).display).toBe("240 ms");
    controller.abort();
  });

  it("does not group distinct interactions", () => {
    const observer = install({});
    const collector = createDelayCollector();
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));

    observer.emit([
      entry({ interactionId: 1, name: "click", duration: 40 }),
      entry({ interactionId: 2, name: "click", duration: 320 }),
    ]);

    const detail = Object.fromEntries(collector.read(0).detail);
    expect(detail["Interactions seen"]).toBe("2");
    expect(collector.read(0).display).toBe("320 ms");
    controller.abort();
  });

  it("drops interactionId 0 entries, which the spec says are not interactions", () => {
    // A slow `mouseover` handler is a real problem, but it is not an
    // interaction and must not be reported as one.
    const observer = install({});
    const collector = createDelayCollector();
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));

    observer.emit([entry({ interactionId: 0, name: "mouseover", duration: 320 })]);

    expect(collector.read(0).status).toBe("pending");
    expect(collector.diagnostics(0)).toMatchObject({
      entriesSeen: 1,
      interactionsSeen: 0,
      nonInteractionEntries: 1,
    });
    controller.abort();
  });

  it("keeps interactionId 0 entries when includeNonInteractions is set", () => {
    const observer = install({});
    const collector = createDelayCollector({ includeNonInteractions: true });
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));

    observer.emit([
      entry({ interactionId: 0, name: "mouseover", duration: 320 }),
      entry({ interactionId: 0, name: "mouseover", duration: 96 }),
    ]);

    const view = collector.read(0);
    const detail = Object.fromEntries(view.detail);
    expect(view.display).toBe("320 ms");
    // They cannot be grouped — they all share id 0 — so each is its own record.
    expect(detail["Interactions seen"]).toBe("0");
    expect(detail["Non-interaction entries kept"]).toBe("2");
    controller.abort();
  });

  it("falls back to one record per entry when the engine reports no interactionId", () => {
    const observer = install({});
    const collector = createDelayCollector();
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));

    observer.emit([
      entry({ name: "pointerdown", duration: 40 }),
      entry({ name: "click", duration: 320 }),
    ]);

    const view = collector.read(0);
    const detail = Object.fromEntries(view.detail);
    expect(view.display).toBe("320 ms");
    expect(detail["Interactions seen"]).toBeUndefined();
    expect(detail["Event entries seen"]).toBe("2");
    expect(view.hint).toContain("no interactionId");
    controller.abort();
  });

  it("holds the worst interaction even when a burst evicts it from the ring", () => {
    /**
     * The ring is bounded, so a burst of interactions used to push the worst
     * one out of it long before its window ended and the chip silently
     * dropped to the burst's own maximum.
     */
    const observer = install({});
    const collector = createDelayCollector({ historySize: 4, windowMs: 30_000 });
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));

    observer.emit([entry({ interactionId: 1, name: "click", duration: 900, startTime: 0 })]);
    for (let id = 2; id <= 12; id += 1) {
      observer.emit([entry({ interactionId: id, name: "keydown", duration: 24, startTime: id })]);
    }

    const view = collector.read(1000);
    expect(view.display).toBe("900 ms");
    expect(Object.fromEntries(view.detail)["Latest interaction"]).toBe("24 ms — keydown");
    controller.abort();
  });

  it("lets the held worst age out of the window", () => {
    const observer = install({});
    const collector = createDelayCollector({ historySize: 4, windowMs: 5000 });
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));

    observer.emit([entry({ interactionId: 1, name: "click", duration: 900, startTime: 0 })]);
    observer.emit([entry({ interactionId: 2, name: "keydown", duration: 24, startTime: 6000 })]);

    expect(collector.read(6000).display).toBe("24 ms");
    controller.abort();
  });

  it("does not let a late, stale entry displace the held worst", () => {
    /**
     * A buffered or straddling callback can deliver a long entry whose
     * startTime is already outside the window. Promoting it dropped the held
     * worst, `worstIn()` then filtered the stale record out by `at`, and the
     * chip fell to whatever the bounded ring still held.
     */
    const observer = install({});
    const collector = createDelayCollector({ historySize: 4, windowMs: 5000 });
    const controller = new AbortController();
    collector.start(context(controller, { t: 10_000 }));

    observer.emit([entry({ interactionId: 1, name: "click", duration: 900, startTime: 10_000 })]);
    // A burst that evicts the worst interaction from the four-slot ring.
    for (let id = 2; id <= 12; id += 1) {
      observer.emit([
        entry({ interactionId: id, name: "keydown", duration: 24, startTime: 10_000 + id }),
      ]);
    }
    // Late delivery of an entry that started long before the window opened.
    observer.emit([entry({ interactionId: 99, name: "click", duration: 2000, startTime: 0 })]);

    const view = collector.read(10_100);
    expect(view.display).toBe("900 ms");
    expect((collector.diagnostics(10_100) as { worst: { at: number } }).worst.at).toBe(10_000);
    controller.abort();
  });

  it("names Event Timing's 8 ms rounding so a reader is not confused", () => {
    const observer = install({});
    const collector = createDelayCollector();
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));
    observer.emit([entry({ interactionId: 1, duration: 320 })]);

    expect(Object.fromEntries(collector.read(0).detail)["Resolution"]).toBe(
      "8 ms — Event Timing rounds durations",
    );
    controller.abort();
  });

  it("forgets grouped state on reset", () => {
    const observer = install({});
    const collector = createDelayCollector();
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));
    observer.emit([entry({ interactionId: 1, duration: 320 })]);
    expect(collector.read(0).status).toBe("ok");

    collector.reset();

    expect(collector.read(0).status).toBe("pending");
    expect(collector.diagnostics(0)).toMatchObject({
      interactionsSeen: 0,
      entriesSeen: 0,
      worst: null,
    });

    // The same interactionId after a reset starts a new record rather than
    // reviving the cleared one.
    observer.emit([entry({ interactionId: 1, duration: 96 })]);
    expect(Object.fromEntries(collector.read(0).detail)["Interactions seen"]).toBe("1");
    controller.abort();
  });
});
