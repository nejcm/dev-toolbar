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
  // rAF timestamps and `performance.now()` share an origin in a browser, and
  // the collector compares visibility-change times against frame timestamps —
  // so the fake clock has to drive both. The epsilon puts an event fired
  // between two ticks strictly after the frame that preceded it, as a real
  // one is.
  vi.spyOn(performance, "now").mockImplementation(() => timestamp + 0.001);
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

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

const hide = () => setVisibility("hidden");
const show = () => setVisibility("visible");

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
    /**
     * Was a bare two-second gap. A gap with no visibility change in it is now
     * a stall rather than idleness, so the tab has to actually go away for
     * this to be the idle case it was always meant to describe.
     */
    const frames = installFrames();
    const clock = { t: 0 };
    const collector = createJankCollector({ idleGapMs: 500, frameMs: 1000 / 60 });
    const controller = new AbortController();
    collector.start(context(controller, clock));

    frames.tick(16);
    clock.t += 16;
    frames.tick(16);
    // The machine slept for two seconds with the tab backgrounded.
    hide();
    show();
    clock.t += 2000;
    frames.tick(2000);

    const detail = Object.fromEntries(collector.read(clock.t).detail);
    expect(detail["Frames discarded as idle"]).toBe("1");
    expect(detail["Dropped frames"]).toBe("0");
    expect(detail["Stalls >500 ms (session)"]).toBe("0");
    controller.abort();
  });

  it("discards a tab switch shorter than the idle gap", () => {
    /**
     * `document.visibilityState` was read inside the rAF callback, which the
     * browser only runs once the tab is visible again — so it was always
     * "visible" and a 600 ms trip to another tab was booked as ~35 dropped
     * frames. Only the visibilitychange listener can see it.
     */
    const frames = installFrames();
    const clock = { t: 0 };
    const collector = createJankCollector({ frameMs: 1000 / 60 });
    const controller = new AbortController();
    collector.start(context(controller, clock));

    frames.tick(16);
    clock.t += 16;
    frames.tick(16);
    hide();
    show();
    clock.t += 600;
    frames.tick(600);

    const view = collector.read(clock.t);
    const detail = Object.fromEntries(view.detail);
    expect(detail["Dropped frames"]).toBe("0");
    expect(detail["Frames discarded as idle"]).toBe("1");
    expect(detail["Stalls >1 s (session)"]).toBe("0");
    expect(view.display).toBe("0.0%");
    controller.abort();
  });

  it("records a stall while the tab stayed visible instead of silently dropping it", () => {
    /**
     * A 1.2 s blocked main thread is the worst jank there is, and used to be
     * discarded as "idle" — missing from the ratio and from the worst frame.
     */
    const frames = installFrames();
    const clock = { t: 0 };
    const collector = createJankCollector({ frameMs: 1000 / 60 });
    const controller = new AbortController();
    collector.start(context(controller, clock));

    frames.tick(16);
    clock.t += 16;
    frames.tick(16);
    clock.t += 1200;
    frames.tick(1200);

    const view = collector.read(clock.t);
    const detail = Object.fromEntries(view.detail);
    expect(detail["Stalls >1 s (session)"]).toBe("1");
    expect(detail["Frames discarded as idle"]).toBe("0");
    expect(detail["Longest stall (session)"]).toBe("1200 ms");
    // Its own row: a stall is not a frame, and a debugger pause landing here
    // must not become the session's worst frame for the rest of the session.
    expect(detail["Worst frame (session)"]).toBe("16.0 ms");
    // Deliberately outside the ratio: one stall would otherwise peg it.
    expect(detail["Dropped frames"]).toBe("0");
    expect(view.display).toBe("0.0%");
    expect(view.hint).toContain("counted separately");
    expect(view.hint).toContain("debugger paused on a breakpoint or a modal dialog");
    expect(collector.diagnostics(clock.t)).toMatchObject({
      stalls: 1,
      longestStall: 1200,
      worstFrame: 16,
    });

    collector.reset();
    expect(collector.diagnostics(clock.t)).toMatchObject({
      stalls: 0,
      longestStall: 0,
      worstFrame: 0,
    });
    controller.abort();
  });

  it("writes off a gap past the stall ceiling instead of enshrining a breakpoint", () => {
    /**
     * A debugger paused on a breakpoint and a modal `alert` fire no
     * `visibilitychange`, so a 45 s pause arrived looking exactly like a
     * blocked main thread and became the session's longest stall forever.
     */
    const frames = installFrames();
    const clock = { t: 0 };
    const collector = createJankCollector({ frameMs: 1000 / 60, stallCeilingMs: 30_000 });
    const controller = new AbortController();
    collector.start(context(controller, clock));

    frames.tick(16);
    clock.t += 16;
    frames.tick(16);
    clock.t += 45_000;
    frames.tick(45_000);

    const view = collector.read(clock.t);
    const detail = Object.fromEntries(view.detail);
    // No stall row at all: the pending view only grows one once a stall has
    // actually been recorded, and this gap was written off as absent.
    expect(detail["Stalls >1 s (session)"]).toBeUndefined();
    expect(detail["Frames discarded as idle"]).toBe("1");
    expect(collector.diagnostics(clock.t)).toMatchObject({
      stalls: 0,
      longestStall: 0,
      worstFrame: 16,
      discarded: 1,
    });
    controller.abort();
  });

  it("counts a stall that happens while the frame budget is still calibrating", () => {
    /**
     * Stall detection runs before the calibration branch on purpose: a block
     * during warm-up is still a block. Only the pacing history skips it.
     */
    const frames = installFrames();
    const clock = { t: 0 };
    const collector = createJankCollector();
    const controller = new AbortController();
    collector.start(context(controller, clock));

    frames.tick(16.67);
    for (let index = 0; index < 10; index += 1) frames.tick(16.67);
    frames.tick(1500);

    const view = collector.read(clock.t);
    expect(view.status).toBe("pending");
    const detail = Object.fromEntries(view.detail);
    expect(detail["Stalls >1 s (session)"]).toBe("1");
    expect(detail["Longest stall (session)"]).toBe("1500 ms");
    expect(collector.diagnostics(clock.t)).toMatchObject({
      stalls: 1,
      longestStall: 1500,
      worstFrame: 0,
      frameMs: null,
    });
    controller.abort();
  });

  it("attributes a visibility change to the delta that spans it, not the next one", () => {
    /**
     * A one-shot boolean was eaten by the ordinary frame already queued behind
     * the `hidden` event, and the 3 s gap that followed was then booked as a
     * stall. Each change is timed instead, and only the delta containing it is
     * discarded.
     */
    const frames = installFrames();
    const clock = { t: 0 };
    const collector = createJankCollector({ frameMs: 1000 / 60 });
    const controller = new AbortController();
    collector.start(context(controller, clock));

    frames.tick(16);
    clock.t += 16;
    frames.tick(16);
    hide();
    // The BeginMainFrame already in flight when the tab went away.
    clock.t += 16;
    frames.tick(16);
    show();
    clock.t += 3000;
    frames.tick(3000);

    const detail = Object.fromEntries(collector.read(clock.t).detail);
    expect(detail["Stalls >1 s (session)"]).toBe("0");
    expect(detail["Frames discarded as idle"]).toBe("2");
    controller.abort();
  });

  it("discards once when hidden and visible both fire before the next frame", () => {
    const frames = installFrames();
    const clock = { t: 0 };
    const collector = createJankCollector({ frameMs: 1000 / 60 });
    const controller = new AbortController();
    collector.start(context(controller, clock));

    frames.tick(16);
    clock.t += 16;
    frames.tick(16);
    hide();
    show();
    clock.t += 3000;
    frames.tick(3000);

    const detail = Object.fromEntries(collector.read(clock.t).detail);
    expect(detail["Stalls >1 s (session)"]).toBe("0");
    expect(detail["Frames discarded as idle"]).toBe("1");
    controller.abort();
  });

  it("discards a return whose marker is timed after the frame that spans it", () => {
    /**
     * The rAF timestamp is the frame's BeginFrame time, stamped before the
     * callback runs, while the listener records `performance.now()`. If the
     * main thread processes the visibility IPC after that stamp, the "visible"
     * marker reads *later* than the frame explaining the gap. A drain bounded
     * by the frame timestamp left it in the list, `visibilityState` already
     * said "visible", and a 1.2 s tab switch was booked as a stall.
     */
    const frames = installFrames();
    const clock = { t: 0 };
    const collector = createJankCollector({ frameMs: 1000 / 60 });
    const controller = new AbortController();
    collector.start(context(controller, clock));

    frames.tick(16);
    clock.t += 16;
    frames.tick(16);
    hide();
    // The BeginMainFrame already in flight when the tab went away eats the
    // `hidden` marker, exactly as it does in a browser.
    clock.t += 16;
    frames.tick(16);
    // The tab comes back. The next frame's BeginFrame time is 48 + 1200, and
    // the marker lands just after it.
    vi.mocked(performance.now).mockReturnValueOnce(1248.5);
    show();
    clock.t += 1200;
    frames.tick(1200);

    const detail = Object.fromEntries(collector.read(clock.t).detail);
    expect(detail["Stalls >1 s (session)"]).toBe("0");
    expect(detail["Frames discarded as idle"]).toBe("2");
    expect(collector.diagnostics(clock.t)).toMatchObject({ stalls: 0, discarded: 2 });
    controller.abort();
  });

  it("discards a throttled delta observed while the tab is still hidden", () => {
    /**
     * Background throttling produces ~1 s deltas with no further visibility
     * event; the callback that observes them runs while `visibilityState` is
     * still "hidden", which is the one reading that proves something.
     */
    const frames = installFrames();
    const clock = { t: 0 };
    const collector = createJankCollector({ frameMs: 1000 / 60 });
    const controller = new AbortController();
    collector.start(context(controller, clock));

    frames.tick(16);
    clock.t += 16;
    frames.tick(16);
    hide();
    clock.t += 1000;
    frames.tick(1000);
    clock.t += 1000;
    frames.tick(1000);
    show();

    const detail = Object.fromEntries(collector.read(clock.t).detail);
    expect(detail["Stalls >1 s (session)"]).toBe("0");
    expect(detail["Frames discarded as idle"]).toBe("2");
    controller.abort();
  });

  it("surfaces a stall that happened before the window went idle", () => {
    const frames = installFrames();
    const clock = { t: 0 };
    const collector = createJankCollector({ windowMs: 1000, frameMs: 1000 / 60 });
    const controller = new AbortController();
    collector.start(context(controller, clock));

    frames.tick(16);
    clock.t += 1200;
    frames.tick(1200);

    const view = collector.read(clock.t + 5000);
    expect(view.status).toBe("pending");
    const detail = Object.fromEntries(view.detail);
    expect(detail["Stalls >1 s (session)"]).toBe("1");
    expect(detail["Longest stall (session)"]).toBe("1200 ms");
    controller.abort();
  });

  it("stops listening for visibility changes when aborted", () => {
    installFrames();
    const clock = { t: 0 };
    const remove = vi.spyOn(document, "removeEventListener");
    const collector = createJankCollector();
    const controller = new AbortController();
    collector.start(context(controller, clock));
    controller.abort();
    expect(remove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });

  it("retains a full window of frames on a 120 Hz display", () => {
    /**
     * `historySize` was a flat 360 frames — three seconds at 120 Hz — while
     * the panel went on printing "Window: 5 s".
     */
    const frames = installFrames();
    const clock = { t: 0 };
    const frameMs = 1000 / 120;
    const collector = createJankCollector({ windowMs: 5000, frameMs });
    const controller = new AbortController();
    collector.start(context(controller, clock));

    frames.tick(frameMs);
    for (let index = 0; index < 700; index += 1) {
      clock.t += frameMs;
      frames.tick(frameMs);
    }

    const detail = Object.fromEntries(collector.read(clock.t).detail);
    expect(detail["Window"]).toBe("5 s");
    // 5 s at 120 Hz, not the 360 frames the old default retained.
    expect(Number(detail["Frames in window"])).toBeGreaterThan(590);
    controller.abort();
  });

  it("reports the window it can actually cover when history is too small", () => {
    const frames = installFrames();
    const clock = { t: 0 };
    const collector = createJankCollector({ windowMs: 5000, frameMs: 16, historySize: 10 });
    const controller = new AbortController();
    collector.start(context(controller, clock));

    frames.tick(16);
    for (let index = 0; index < 20; index += 1) {
      clock.t += 16;
      frames.tick(16);
    }

    const detail = Object.fromEntries(collector.read(clock.t).detail);
    expect(detail["Frames in window"]).toBe("10");
    // 10 retained intervals of 16 ms is 160 ms of coverage, not the 144 ms a
    // span measured from the oldest frame's *end* would report.
    expect(detail["Window"]).toBe("0.2 s");
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
