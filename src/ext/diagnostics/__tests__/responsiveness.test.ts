/**
 * §3E, and the one thing it must never do: report a number where the truth is
 * "this browser cannot tell me".
 *
 * jsdom has no `PerformanceObserver` at all, which makes it the ideal place to
 * pin the `"unavailable"` path — and a fake one lets the other three states be
 * driven deliberately rather than hoped for.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { LONG_TASK_THRESHOLD_MS, createResponsivenessMonitor } from "../responsiveness";

type Callback = (list: { getEntries(): unknown[] }) => void;

interface FakeObserverControl {
  emit(entryType: string, entries: unknown[]): void;
  /** Hands the callback a list object directly, so it can be made hostile. */
  emitRaw(entryType: string, list: { getEntries(): unknown[] }): void;
  observed: string[];
  disconnects: number;
}

/**
 * Installs a fake `PerformanceObserver`.
 *
 * @param supported `null` means "no `supportedEntryTypes` property at all",
 *   which is the older-engine shape where the only way to ask is to try.
 * @param throwFor entry types whose `observe()` throws, the Safari shape.
 */
function installObserver(supported: string[] | null, throwFor: string[] = []): FakeObserverControl {
  const control: FakeObserverControl = {
    observed: [],
    disconnects: 0,
    emit(entryType, entries) {
      control.emitRaw(entryType, { getEntries: () => entries });
    },
    emitRaw(entryType, list) {
      for (const [type, callback] of callbacks) {
        if (type === entryType) callback(list);
      }
    },
  };
  const callbacks: [string, Callback][] = [];

  class FakeObserver {
    static supportedEntryTypes?: string[];
    #callback: Callback;
    constructor(callback: Callback) {
      this.#callback = callback;
    }
    observe({ type }: { type: string }) {
      if (throwFor.includes(type)) throw new Error(`no ${type} here`);
      control.observed.push(type);
      callbacks.push([type, this.#callback]);
    }
    disconnect() {
      control.disconnects += 1;
    }
  }
  if (supported !== null) FakeObserver.supportedEntryTypes = supported;

  vi.stubGlobal("PerformanceObserver", FakeObserver);
  return control;
}

const longTask = (startTime: number, duration: number, attribution?: unknown) => ({
  entryType: "longtask",
  name: "self",
  startTime,
  duration,
  ...(attribution === undefined ? {} : { attribution }),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createResponsivenessMonitor — honest degradation", () => {
  it("says unknown, not zero, when there is no PerformanceObserver", () => {
    // jsdom's default. `vi.stubGlobal(undefined)` makes it explicit.
    vi.stubGlobal("PerformanceObserver", undefined);
    const monitor = createResponsivenessMonitor();
    monitor.start();
    const report = monitor.report();

    expect(report.longTasks.support).toBe("unavailable");
    // The assertion this whole module exists for.
    expect(report.longTasks.count).toBeNull();
    expect(report.longTasks.totalBlockingMs).toBeNull();
    expect(report.longTasks.worst).toBeNull();
    expect(report.longTasks.note).toContain("no PerformanceObserver");
    expect(report.longTasks.note).toContain("not zero");
    expect(report.interactions.count).toBeNull();
    expect(report.layoutShifts.count).toBeNull();
  });

  it("says unsupported when the engine lists other entry types but not this one", () => {
    // Firefox's shape today: `event` yes, `longtask` and `layout-shift` no.
    installObserver(["event", "paint", "navigation"]);
    const monitor = createResponsivenessMonitor();
    monitor.start();
    const report = monitor.report();

    expect(report.longTasks.support).toBe("unsupported");
    expect(report.longTasks.count).toBeNull();
    expect(report.longTasks.note).toContain('does not report "longtask"');
    expect(report.interactions.support).toBe("supported");
    expect(report.interactions.count).toBe(0);
    expect(report.layoutShifts.support).toBe("unsupported");
  });

  it("says failed, with the reason, when observe() throws for one type only", () => {
    // No `supportedEntryTypes`, so the only way to ask is to try — and one of
    // the three refuses. The other two must be unaffected.
    const control = installObserver(null, ["layout-shift"]);
    const monitor = createResponsivenessMonitor();
    monitor.start();
    const report = monitor.report();

    expect(control.observed).toEqual(["longtask", "event"]);
    expect(report.layoutShifts.support).toBe("failed");
    expect(report.layoutShifts.note).toContain("no layout-shift here");
    expect(report.layoutShifts.count).toBeNull();
    expect(report.longTasks.support).toBe("supported");
    expect(report.longTasks.count).toBe(0);
  });

  it("reports zero only when it is genuinely observing", () => {
    installObserver(["longtask", "event", "layout-shift"]);
    const monitor = createResponsivenessMonitor();
    monitor.start();
    const report = monitor.report();
    expect(report.longTasks.support).toBe("supported");
    expect(report.longTasks.count).toBe(0);
    expect(report.longTasks.totalBlockingMs).toBe(0);
    expect(report.longTasks.note).toContain("Observed via PerformanceObserver");
  });
});

describe("createResponsivenessMonitor — measurement", () => {
  it("sums blocking time as the excess over the 50 ms threshold", () => {
    const control = installObserver(["longtask"]);
    const monitor = createResponsivenessMonitor({ windowMs: 1_000_000 });
    monitor.start();
    control.emit("longtask", [longTask(10, 60), longTask(100, 250)]);

    const tasks = monitor.report().longTasks;
    expect(tasks.count).toBe(2);
    expect(tasks.totalDurationMs).toBe(310);
    expect(tasks.totalBlockingMs).toBe(
      60 - LONG_TASK_THRESHOLD_MS + (250 - LONG_TASK_THRESHOLD_MS),
    );
    expect(tasks.worst).toEqual({
      startTime: 100,
      durationMs: 250,
      attribution: null,
    });
    // Most recent first.
    expect(tasks.recent.map((sample) => sample.durationMs)).toEqual([250, 60]);
  });

  it("drops samples that have fallen out of the rolling window", () => {
    const control = installObserver(["longtask"]);
    const monitor = createResponsivenessMonitor({ windowMs: 1 });
    monitor.start();
    // startTime 0 is far outside a 1 ms window ending at performance.now().
    control.emit("longtask", [longTask(0, 900)]);
    expect(monitor.report().longTasks.count).toBe(0);
  });

  it("reduces task attribution to one line and redacts the container URL", () => {
    const control = installObserver(["longtask"]);
    const monitor = createResponsivenessMonitor({ windowMs: 1_000_000 });
    monitor.start();
    control.emit("longtask", [
      longTask(5, 80, [
        {
          name: "unknown",
          containerType: "iframe",
          containerId: "widget",
          containerName: "billing",
          containerSrc: "https://cdn.test/w.js?access_token=super-secret",
        },
      ]),
    ]);
    const attribution = monitor.report().longTasks.worst?.attribution ?? "";
    expect(attribution).toContain("iframe");
    expect(attribution).toContain("#widget");
    expect(attribution).toContain("[name=billing]");
    // The credential in the container URL must not survive into a ticket.
    expect(attribution).not.toContain("super-secret");
    expect(attribution).toContain("access_token=[redacted]");
  });

  it("counts slow interactions and names the worst event type", () => {
    const control = installObserver(["event"]);
    const monitor = createResponsivenessMonitor({
      windowMs: 1_000_000,
      slowInteractionMs: 200,
    });
    monitor.start();
    control.emit("event", [
      { startTime: 1, duration: 120, name: "pointerdown" },
      { startTime: 2, duration: 400, name: "click" },
    ]);
    const events = monitor.report().interactions;
    expect(events.count).toBe(2);
    expect(events.slowCount).toBe(1);
    expect(events.worstDurationMs).toBe(400);
    expect(events.worstType).toBe("click");
  });

  it("excludes layout shifts the browser attributed to recent input", () => {
    const control = installObserver(["layout-shift"]);
    const monitor = createResponsivenessMonitor({ windowMs: 1_000_000 });
    monitor.start();
    control.emit("layout-shift", [
      { startTime: 1, value: 0.25, hadRecentInput: false },
      { startTime: 2, value: 0.9, hadRecentInput: true },
    ]);
    const shifts = monitor.report().layoutShifts;
    expect(shifts.count).toBe(1);
    expect(shifts.total).toBe(0.25);
    expect(shifts.worst).toBe(0.25);
    expect(shifts.note).toContain("500 ms of user input are excluded");
  });

  it("redacts the reason an observe() failure gives, before it reaches a note", () => {
    // Browser-generated, so the risk is negligible — but it is the same
    // pattern as the reader's error paths, and the note travels into a ticket.
    // Masked on its own rather than behind the note's prose, which is the whole
    // point of that fix.
    const control = installObserver(null, []);
    void control;
    class Hostile {
      observe(): never {
        throw new Error("https://vendor.test/probe?api_key=OBSERVE-LEAK");
      }
      disconnect() {}
    }
    vi.stubGlobal("PerformanceObserver", Hostile);

    const monitor = createResponsivenessMonitor();
    monitor.start();
    const report = monitor.report();

    expect(report.longTasks.support).toBe("failed");
    expect(report.longTasks.note).not.toContain("OBSERVE-LEAK");
    expect(report.longTasks.note).toContain("api_key=[redacted]");
  });

  it("survives an entry list that throws when it is read", () => {
    // The observer callback is the §14.2 shape: a browser callback where
    // nothing upstream catches a throw and where it would recur on every
    // batch. `ingest` screens individual entries, so the reachable failure is
    // `getEntries()` itself — a proxied list, or a browser bug.
    const control = installObserver(["longtask"]);
    const monitor = createResponsivenessMonitor({ windowMs: 1_000_000 });
    monitor.start();

    expect(() =>
      control.emitRaw("longtask", {
        getEntries: () => {
          throw new Error("entry list exploded");
        },
      }),
    ).not.toThrow();

    // And it keeps working afterwards rather than being poisoned by it.
    control.emit("longtask", [longTask(1, 100)]);
    expect(monitor.report().longTasks.count).toBe(1);
  });

  it("survives malformed entries without letting the callback throw", () => {
    const control = installObserver(["longtask"]);
    const monitor = createResponsivenessMonitor({ windowMs: 1_000_000 });
    monitor.start();
    expect(() =>
      control.emit("longtask", [null, undefined, 42, "nope", { duration: "x" }]),
    ).not.toThrow();
    // The one object-shaped entry is recorded, with a zero duration rather than
    // a NaN that would poison every sum in the report.
    const tasks = monitor.report().longTasks;
    expect(tasks.count).toBe(1);
    expect(tasks.totalDurationMs).toBe(0);
  });
});

describe("createResponsivenessMonitor — lifecycle", () => {
  it("is idempotent and disconnects everything it observed", () => {
    const control = installObserver(["longtask", "event", "layout-shift"]);
    const monitor = createResponsivenessMonitor();
    monitor.start();
    monitor.start();
    expect(control.observed).toEqual(["longtask", "event", "layout-shift"]);
    monitor.stop();
    expect(control.disconnects).toBe(3);
  });

  it("keeps tearing down when one disconnect throws", () => {
    class Broken {
      static supportedEntryTypes = ["longtask", "event", "layout-shift"];
      observe() {}
      disconnect() {
        throw new Error("nope");
      }
    }
    vi.stubGlobal("PerformanceObserver", Broken);
    const monitor = createResponsivenessMonitor();
    monitor.start();
    expect(() => monitor.stop()).not.toThrow();
  });

  it("stops claiming observation once it has been torn down", () => {
    const control = installObserver(["longtask", "event", "layout-shift"]);
    const monitor = createResponsivenessMonitor({ windowMs: 1_000_000 });
    monitor.start();
    control.emit("longtask", [longTask(1, 100)]);
    expect(monitor.report().longTasks.support).toBe("supported");

    monitor.stop();
    const report = monitor.report();
    // "supported" after teardown would print "Observed via PerformanceObserver"
    // over a count that stopped moving when the extension did — the same class
    // of lie as a zero that means "unknown".
    expect(report.longTasks.support).toBe("stopped");
    expect(report.longTasks.count).toBeNull();
    expect(report.longTasks.note).toContain("has stopped");
    expect(report.interactions.support).toBe("stopped");
    expect(report.layoutShifts.support).toBe("stopped");

    // And a type that was never available does not get promoted to "stopped".
    const never = createResponsivenessMonitor();
    never.stop();
    expect(never.report().longTasks.support).toBe("unavailable");
  });

  it("reports observedForMs as zero before start and after stop", () => {
    installObserver(["longtask"]);
    const monitor = createResponsivenessMonitor();
    expect(monitor.report().observedForMs).toBe(0);
    monitor.start();
    monitor.stop();
    expect(monitor.report().observedForMs).toBe(0);
  });

  it("reset() clears the samples but not the support states", () => {
    const control = installObserver(["longtask"]);
    const monitor = createResponsivenessMonitor({ windowMs: 1_000_000 });
    monitor.start();
    control.emit("longtask", [longTask(1, 100)]);
    expect(monitor.report().longTasks.count).toBe(1);
    monitor.reset();
    expect(monitor.report().longTasks.count).toBe(0);
    expect(monitor.report().longTasks.support).toBe("supported");
  });
});
