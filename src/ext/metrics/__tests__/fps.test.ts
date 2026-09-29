import { afterEach, describe, expect, it, vi } from "vitest";
import { installAnimationFrames } from "../../../test-utils/animation-frames";
import type { FakeFrames } from "../../../test-utils/animation-frames";
import { createFpsCollector, createFpsReader } from "../collectors/fps";
import { createFrameSource } from "../collectors/frames";
import type { Collector } from "../types";

let frames: FakeFrames | null = null;

afterEach(() => {
  frames?.restore();
  frames = null;
  vi.restoreAllMocks();
});

const now = () => performance.now();

function started(collector: Collector) {
  const controller = new AbortController();
  collector.start({ signal: controller.signal, now, invalidate: vi.fn() });
  return controller;
}

function run(collector: Collector, deltaMs: number, count: number) {
  for (let index = 0; index < count; index += 1) frames!.tick(deltaMs);
  return collector.read(now());
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("fps collector", () => {
  it.each([
    [60, 55, "ok"],
    [60, 53, "warn"],
    [60, 46, "warn"],
    [60, 44, "bad"],
    [120, 110, "ok"],
    [120, 106, "warn"],
    [120, 92, "warn"],
    [120, 88, "bad"],
  ])("grades %d Hz at %d fps as %s by shortfall", (hz, fps, severity) => {
    frames = installAnimationFrames();
    const collector = createFpsReader(createFrameSource({ frameMs: 1000 / hz }));
    started(collector);
    frames.tick(1000 / hz);
    const view = run(collector, 1000 / fps, 100);
    expect(view.display).toBe(`${fps} fps`);
    expect(view.severity).toBe(severity);
    expect(Object.fromEntries(view.detail)["Refresh rate"]).toBe(`${hz} Hz`);
  });

  it("leaves stalls and hidden-tab gaps out of active time", () => {
    frames = installAnimationFrames();
    const collector = createFpsReader(createFrameSource({ frameMs: 1000 / 60 }), {
      windowMs: 10_000,
    });
    started(collector);
    run(collector, 1000 / 60, 60);
    frames.tick(1200);
    setVisibility("hidden");
    setVisibility("visible");
    frames.tick(3000);
    const view = run(collector, 1000 / 60, 60);
    expect(view.display).toBe("60 fps");
    expect(view.severity).toBe("ok");
    expect(Object.fromEntries(view.detail)["Active window"]).toBe("2 s");
  });

  it("reports the slowest one-second bucket as the minimum", () => {
    frames = installAnimationFrames();
    const collector = createFpsReader(createFrameSource({ frameMs: 1000 / 60 }));
    started(collector);
    run(collector, 1000 / 60, 60);
    const view = run(collector, 1000 / 30, 30);
    expect(Object.fromEntries(view.detail)["Min FPS in window"]).toBe("30 fps");
    expect(view.display).toBe("45 fps");
  });

  it("shows a value while calibrating, with severity unknown until the refresh rate is known", () => {
    frames = installAnimationFrames();
    const collector = createFpsCollector();
    started(collector);
    frames.tick(16.67);
    let view = run(collector, 16.67, 30);
    expect(view).toMatchObject({ status: "ok", severity: "unknown", display: "60 fps" });
    expect(view.hint).toContain("Calibrating the display cadence: 30 of 120");
    expect(Object.fromEntries(view.detail)).toMatchObject({
      "Refresh rate": "calibrating",
      "Calibration intervals": "30 / 120",
    });

    view = run(collector, 16.67, 90);
    expect(view.severity).toBe("ok");
    expect(Object.fromEntries(view.detail)["Refresh rate"]).toBe("60 Hz");
    expect(Object.fromEntries(view.detail)["Calibration intervals"]).toBeUndefined();
  });

  it("samples the sparkline every 30 frames", () => {
    frames = installAnimationFrames();
    const collector = createFpsReader(createFrameSource({ frameMs: 1000 / 60 }));
    started(collector);
    frames.tick(1000 / 60);
    run(collector, 1000 / 60, 61);
    expect(collector.series.size).toBe(2);
    expect(collector.series.last()).toBeCloseTo(60, 5);
  });

  it("says idle when the window holds no frames, and resets its history", () => {
    frames = installAnimationFrames();
    const collector = createFpsReader(createFrameSource({ frameMs: 1000 / 60 }));
    started(collector);
    expect(collector.read(now())).toMatchObject({ status: "pending", severity: "unknown" });
    frames.tick(1000 / 60);
    expect(run(collector, 1000 / 60, 40).status).toBe("ok");
    collector.reset();
    expect(collector.read(now()).status).toBe("pending");
    expect(collector.series.size).toBe(0);
    expect(collector.diagnostics(now())).toMatchObject({ count: 0, frameMs: 1000 / 60 });
  });

  it("degrades to NA without requestAnimationFrame, with jank's reason", () => {
    const raf = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
    delete (globalThis as Record<string, unknown>)["requestAnimationFrame"];
    try {
      const collector = createFpsCollector();
      expect(collector.supported).toBe(false);
      expect(collector.unsupportedReason).toBe(
        "requestAnimationFrame is unavailable, so frames cannot be timed.",
      );
      expect(collector.read(0)).toMatchObject({ status: "unsupported", display: "NA" });
    } finally {
      if (raf) Object.defineProperty(globalThis, "requestAnimationFrame", raf);
    }
  });
});
