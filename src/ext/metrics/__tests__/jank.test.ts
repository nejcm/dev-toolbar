import { afterEach, describe, expect, it, vi } from "vitest";
import { createJankCollector } from "../collectors/jank";

const originalRaf = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
const originalCaf = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");

interface Frames {
  tick(deltaMs: number): void;
  cancelled: number[];
  pending: boolean;
}

function installFrames(): Frames {
  let callback: FrameRequestCallback | null = null;
  let handle = 0;
  let timestamp = 0;
  const state: Frames = {
    tick(deltaMs) {
      const next = callback;
      callback = null;
      timestamp += deltaMs;
      next?.(timestamp);
    },
    cancelled: [],
    get pending() {
      return callback !== null;
    },
  };
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: (fn: FrameRequestCallback) => {
      callback = fn;
      handle += 1;
      return handle;
    },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    writable: true,
    value: (id: number) => {
      state.cancelled.push(id);
      callback = null;
    },
  });
  return state;
}

function restore() {
  for (const [name, descriptor] of [
    ["requestAnimationFrame", originalRaf],
    ["cancelAnimationFrame", originalCaf],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
}

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

const context = (controller: AbortController, clock: { t: number }) => ({
  signal: controller.signal,
  now: () => clock.t,
  invalidate: vi.fn(),
});

describe("jank collector — rAF present", () => {
  it("counts dropped frames over the rolling window", () => {
    const frames = installFrames();
    const clock = { t: 0 };
    const collector = createJankCollector({ windowMs: 5000, frameMs: 1000 / 60 });
    expect(collector.supported).toBe(true);

    const controller = new AbortController();
    collector.start(context(controller, clock));

    // The first frame has no predecessor, so it only seeds `previous`.
    frames.tick(16);
    for (let index = 0; index < 20; index += 1) {
      clock.t += 16;
      frames.tick(16);
    }
    let view = collector.read(clock.t);
    expect(view.status).toBe("ok");
    expect(view.severity).toBe("ok");
    expect(view.display).toBe("0.0%");

    // One 100 ms frame: ~6 expected frames, 5 of them dropped.
    clock.t += 100;
    frames.tick(100);
    view = collector.read(clock.t);
    const detail = Object.fromEntries(view.detail);
    expect(detail["Dropped frames"]).toBe("5");
    expect(Number.parseFloat(view.display)).toBeGreaterThan(15);
    expect(view.severity).toBe("bad");
    expect(detail["Slowest frame"]).toBe("100 ms");

    controller.abort();
    expect(frames.cancelled.length).toBe(1);
    expect(frames.pending).toBe(false);
  });

  it("calibrates a 30 Hz display without treating every frame as dropped", () => {
    /**
     * The fixed 60 Hz budget classified every ordinary 33.33 ms frame as one
     * dropped frame, leaving a 30 Hz display permanently bad.
     */
    const frames = installFrames();
    const clock = { t: 0 };
    const collector = createJankCollector();
    const controller = new AbortController();
    collector.start(context(controller, clock));

    frames.tick(33.33);
    for (let index = 0; index < 120; index += 1) {
      clock.t += 33.33;
      frames.tick(33.33);
    }
    clock.t += 33.33;
    frames.tick(33.33);

    const diagnostics = collector.diagnostics(clock.t) as {
      frameMs: number | null;
      dropped: number;
      count: number;
    };
    expect(collector.read(clock.t).display).toBe("0.0%");
    expect(diagnostics.dropped).toBe(0);
    expect(diagnostics.frameMs).toBeCloseTo(33.33, 2);
    expect(diagnostics.count).toBe(1);
    controller.abort();
  });

  it("reports calibration progress while active frames warm the budget", () => {
    /**
     * Calibration deliberately withholds its first 120 intervals from jank
     * history, so the empty history used to label active startup as idle.
     */
    const frames = installFrames();
    const clock = { t: 0 };
    const collector = createJankCollector();
    const controller = new AbortController();
    collector.start(context(controller, clock));
    frames.tick(16.67);
    for (let index = 0; index < 30; index += 1) frames.tick(16.67);

    const view = collector.read(clock.t);
    expect(view.status).toBe("pending");
    expect(view.hint).toBe(
      "Calibrating the display cadence: 30 of 120 active frame intervals measured.",
    );
    expect(Object.fromEntries(view.detail)["Calibration intervals"]).toBe("30 / 120");
    controller.abort();
  });

  it("ignores a janky startup when calibrating the frame budget", () => {
    /**
     * A median over the first 30 deltas adopted startup stalls as the display
     * cadence. Calibration must use the later stable majority instead.
     */
    const frames = installFrames();
    const clock = { t: 0 };
    const collector = createJankCollector();
    const controller = new AbortController();
    collector.start(context(controller, clock));

    frames.tick(16.67);
    for (let index = 0; index < 30; index += 1) frames.tick(80);
    for (let index = 0; index < 90; index += 1) frames.tick(16.67);
    frames.tick(16.67);

    const diagnostics = collector.diagnostics(clock.t) as {
      frameMs: number | null;
      dropped: number;
    };
    expect(diagnostics.dropped).toBe(0);
    expect(diagnostics.frameMs).toBeCloseTo(16.67, 2);
    controller.abort();
  });

  it("ignores an anomalously short calibration delta", () => {
    const frames = installFrames();
    const clock = { t: 0 };
    const collector = createJankCollector();
    const controller = new AbortController();
    collector.start(context(controller, clock));

    frames.tick(16.67);
    frames.tick(1);
    for (let index = 0; index < 119; index += 1) frames.tick(16.67);

    const diagnostics = collector.diagnostics(clock.t) as { frameMs: number | null };
    expect(diagnostics.frameMs).toBeCloseTo(16.67, 2);
    controller.abort();
  });

  it("uses an explicit frame budget without calibration", () => {
    const frames = installFrames();
    const clock = { t: 0 };
    const collector = createJankCollector({ frameMs: 20 });
    const controller = new AbortController();
    collector.start(context(controller, clock));
    frames.tick(20);
    frames.tick(40);

    const diagnostics = collector.diagnostics(clock.t) as {
      frameMs: number | null;
      dropped: number;
      count: number;
    };
    expect(diagnostics.frameMs).toBe(20);
    expect(diagnostics.count).toBe(1);
    expect(diagnostics.dropped).toBe(1);
    controller.abort();
  });

  it("discards an idle gap instead of calling it a hundred dropped frames", () => {
    const frames = installFrames();
    const clock = { t: 0 };
    const collector = createJankCollector({ idleGapMs: 500, frameMs: 1000 / 60 });
    const controller = new AbortController();
    collector.start(context(controller, clock));

    frames.tick(16);
    clock.t += 16;
    frames.tick(16);
    // The machine slept for two seconds.
    clock.t += 2000;
    frames.tick(2000);

    const detail = Object.fromEntries(collector.read(clock.t).detail);
    expect(detail["Frames discarded as idle"]).toBe("1");
    expect(detail["Dropped frames"]).toBe("0");
    controller.abort();
  });

  it("says 'idle', not 'no jank', when the window holds no frames", () => {
    installFrames();
    const clock = { t: 0 };
    const collector = createJankCollector({ windowMs: 1000 });
    const controller = new AbortController();
    collector.start(context(controller, clock));

    const view = collector.read(10_000);
    expect(view.status).toBe("pending");
    expect(view.severity).toBe("unknown");
    expect(view.hint).toContain("not the same as no jank");
    controller.abort();
  });

  it("resets its history", () => {
    const frames = installFrames();
    const clock = { t: 0 };
    const collector = createJankCollector({ frameMs: 1000 / 60 });
    const controller = new AbortController();
    collector.start(context(controller, clock));
    frames.tick(16);
    clock.t += 16;
    frames.tick(16);
    expect(collector.read(clock.t).status).toBe("ok");
    collector.reset();
    expect(collector.read(clock.t).status).toBe("pending");
    controller.abort();
  });
});

describe("jank collector — rAF absent", () => {
  it("degrades to NA rather than throwing", () => {
    delete (globalThis as Record<string, unknown>)["requestAnimationFrame"];
    delete (globalThis as Record<string, unknown>)["cancelAnimationFrame"];
    const collector = createJankCollector();
    expect(collector.supported).toBe(false);
    expect(collector.unsupportedReason).toContain("requestAnimationFrame");
    const view = collector.read(0);
    expect(view.status).toBe("unsupported");
    expect(view.display).toBe("NA");
    expect(collector.diagnostics(0)).toMatchObject({ supported: false });
  });
});
