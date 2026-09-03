/**
 * Dropped frames. [dev-toolbar/ext/metrics]
 *
 * A rAF loop plus the exclusions §3D asks for: a backgrounded tab, a
 * minimised window, sleep/wake and browser throttling all produce enormous
 * frame deltas that are *not* jank, so anything longer than `idleGapMs` is
 * discarded rather than counted as dropped frames.
 *
 * Core reports visibility but never pauses an extension, so counting uses a
 * rolling window rather than a cumulative total — stopping the loop while the
 * bar is hidden can't corrupt it.
 */
import { createRingBuffer, createTimeSeries } from "../../../runtime";
import { formatMs, formatPercent, NOT_AVAILABLE } from "../format";
import type { Collector, CollectorContext, MetricView, Thresholds } from "../types";
import { severityFor } from "../types";

interface Frame {
  at: number;
  delta: number;
  expected: number;
  dropped: number;
}

export interface JankCollectorOptions {
  /** Rolling active window. Default `5000` ms, per §3D. */
  windowMs?: number;
  /**
   * Target frame budget override. Without one, the collector calibrates once
   * from its first 120 active frame intervals; only `reset()` recalibrates it.
   * Set this explicitly on displays whose refresh rate switches at runtime.
   * Calibration intervals are not recorded as jank, so `worstFrame` also
   * excludes startup stalls from those first 120 intervals.
   */
  frameMs?: number;
  /**
   * Deltas longer than this are treated as "the page was not animating" and
   * discarded instead of counted. Default `1000` ms.
   */
  idleGapMs?: number;
  /** Frames retained. Default `360` — six seconds at 60 Hz. */
  historySize?: number;
  /** Fractions, not percentages. Default `{ warn: 0.02, bad: 0.05 }`. */
  thresholds?: Thresholds;
}

export function createJankCollector(options: JankCollectorOptions = {}): Collector {
  const {
    windowMs = 5000,
    idleGapMs = 1000,
    historySize = 360,
    thresholds = { warn: 0.02, bad: 0.05 },
  } = options;
  const frameMsOverride = options.frameMs;

  const frames = createRingBuffer<Frame>(historySize);
  const series = createTimeSeries(120);
  const calibrationSamples: number[] = [];
  const supported =
    typeof requestAnimationFrame === "function" && typeof cancelAnimationFrame === "function";
  let worstFrame = 0;
  let discarded = 0;
  let calibratedFrameMs = frameMsOverride ?? null;

  const percentile = (sorted: readonly number[], fraction: number): number =>
    sorted[Math.floor((sorted.length - 1) * fraction)] as number;

  const calibrate = (): number => {
    const sorted = [...calibrationSamples].sort((left, right) => left - right);
    // p20 already ignores a right tail of startup stalls. The removed IQR
    // fence did not improve those cases; mixed refresh-rate clusters need an
    // explicit `frameMs` until a mode-based estimator can distinguish them.
    return percentile(sorted, 0.2);
  };

  const summarise = (now: number) => {
    const since = now - windowMs;
    let expected = 0;
    let dropped = 0;
    let count = 0;
    let slowest = 0;
    for (let index = 0; index < frames.size; index += 1) {
      const frame = frames.at(index);
      if (frame === undefined || frame.at < since) continue;
      expected += frame.expected;
      dropped += frame.dropped;
      count += 1;
      if (frame.delta > slowest) slowest = frame.delta;
    }
    return {
      count,
      expected,
      dropped,
      slowest,
      ratio: expected > 0 ? dropped / expected : Number.NaN,
    };
  };

  return {
    id: "jank",
    estimatedCost: "moderate",
    supported,
    ...(supported
      ? {}
      : {
          unsupportedReason: "requestAnimationFrame is unavailable, so frames cannot be timed.",
        }),
    series,
    start(context: CollectorContext) {
      let previous = 0;
      let handle = 0;
      let stopped = false;
      let sinceSample = 0;

      const loop = (timestamp: number) => {
        if (stopped) return;
        handle = requestAnimationFrame(loop);
        if (previous !== 0) {
          const delta = timestamp - previous;
          // Backgrounded tab, sleep, or throttling: not a dropped frame, an absent one.
          const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
          if (delta > idleGapMs || hidden) {
            discarded += 1;
          } else if (calibratedFrameMs === null) {
            if (Number.isFinite(delta) && delta > 0) calibrationSamples.push(delta);
            if (calibrationSamples.length >= 120) {
              calibratedFrameMs = calibrate();
              context.invalidate();
            }
          } else {
            const expected = Math.max(1, Math.round(delta / calibratedFrameMs));
            frames.push({
              at: context.now(),
              delta,
              expected,
              dropped: Math.max(0, expected - 1),
            });
            if (delta > worstFrame) worstFrame = delta;
            sinceSample += 1;
            // One sparkline point per ~500 ms of frames, not one per frame.
            if (sinceSample >= 30) {
              sinceSample = 0;
              series.push(context.now(), summarise(context.now()).ratio);
              context.invalidate();
            }
          }
        }
        previous = timestamp;
      };

      handle = requestAnimationFrame(loop);
      context.signal.addEventListener(
        "abort",
        () => {
          stopped = true;
          cancelAnimationFrame(handle);
        },
        { once: true },
      );
    },
    read(now: number): MetricView {
      const detail: [string, string][] = [];
      if (!supported) {
        return {
          id: "jank",
          label: "jank",
          title: "Jank",
          status: "unsupported",
          severity: "unknown",
          display: NOT_AVAILABLE,
          value: Number.NaN,
          unit: "%",
          hint: "requestAnimationFrame is unavailable, so frames cannot be timed.",
          detail,
        };
      }

      const window = summarise(now);
      if (window.count === 0) {
        const calibrating = calibratedFrameMs === null && calibrationSamples.length > 0;
        return {
          id: "jank",
          label: "jank",
          title: "Jank",
          status: "pending",
          severity: "unknown",
          display: "—",
          value: Number.NaN,
          unit: "%",
          hint: calibrating
            ? `Calibrating the display cadence: ${calibrationSamples.length} of 120 active frame intervals measured.`
            : "Idle: no frames were produced in the rolling window, which is not the same as no jank.",
          detail: calibrating
            ? [
                ["Calibration intervals", `${calibrationSamples.length} / 120`],
                ["Frames discarded as idle", String(discarded)],
              ]
            : [["Frames discarded as idle", String(discarded)]],
        };
      }

      detail.push(
        ["Frames in window", String(window.count)],
        ["Expected frames", String(window.expected)],
        ["Dropped frames", String(window.dropped)],
        ["Slowest frame", formatMs(window.slowest, 1)],
        ["Worst frame (session)", formatMs(worstFrame, 1)],
        ["Frames discarded as idle", String(discarded)],
        ["Frame budget", formatMs(calibratedFrameMs ?? Number.NaN, 2)],
        ["Window", `${Math.round(windowMs / 1000)} s`],
      );

      return {
        id: "jank",
        label: "jank",
        title: "Jank",
        status: "ok",
        severity: severityFor(window.ratio, thresholds),
        display: formatPercent(window.ratio),
        value: window.ratio,
        unit: "%",
        hint: `Dropped frames over expected frames, across the last ${Math.round(windowMs / 1000)} s of active frames.`,
        detail,
      };
    },
    reset() {
      frames.clear();
      series.clear();
      worstFrame = 0;
      discarded = 0;
      calibrationSamples.length = 0;
      calibratedFrameMs = frameMsOverride ?? null;
    },
    diagnostics(now: number) {
      return {
        supported,
        ...summarise(now),
        worstFrame,
        discarded,
        frameMs: calibratedFrameMs,
        calibrationSamples: calibrationSamples.length,
      };
    },
  };
}
