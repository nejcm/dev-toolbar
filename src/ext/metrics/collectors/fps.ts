/** Frames per second of active time, graded by shortfall. [dev-toolbar/ext/metrics] */
import { createTimeSeries } from "../../../runtime";
import { clampCapacity } from "../../../runtime/ringBuffer";
import { NOT_AVAILABLE } from "../format";
import type { Collector, CollectorContext, MetricView, Thresholds } from "../types";
import { severityFor } from "../types";
import {
  CALIBRATION_FRAMES,
  createFrameSource,
  formatGap,
  formatSeconds,
  UNSUPPORTED_REASON,
} from "./frames";
import type { FrameSource } from "./frames";

export interface FpsCollectorOptions {
  /** Rolling active window. Default `5000` ms. */
  windowMs?: number;
  /** Frames retained. Defaults to cover `windowMs` at `frameMs` (or 4 ms) plus slack. */
  historySize?: number;
  /** Shortfall fractions, `1 − fps / refresh rate`. Default `{ warn: 0.1, bad: 0.25 }`. */
  thresholds?: Thresholds;
}

export function createFpsCollector(options: FpsCollectorOptions = {}): Collector {
  return createFpsReader(createFrameSource(), options);
}

/** FPS over a frame source another reader may share. */
export function createFpsReader(source: FrameSource, options: FpsCollectorOptions = {}): Collector {
  const { windowMs = 5000, thresholds = { warn: 0.1, bad: 0.25 } } = options;
  const historySize = source.retain(windowMs, options.historySize);
  const slots = clampCapacity(historySize);
  const series = createTimeSeries(120);
  const { supported } = source;
  const gapText = formatGap(source.idleGapMs);

  const summarise = (now: number) => {
    const since = now - windowMs;
    const bucketCount = Math.max(1, Math.ceil(windowMs / 1000));
    const bucketFrames = Array.from({ length: bucketCount }, () => 0);
    const bucketMs = Array.from({ length: bucketCount }, () => 0);
    let count = 0;
    let activeMs = 0;
    const { frames } = source;
    // The shared ring may hold more than this reader's own history; scan only that.
    for (let index = Math.max(0, frames.size - slots); index < frames.size; index += 1) {
      const frame = frames.at(index);
      if (frame === undefined || frame.at < since) continue;
      count += 1;
      activeMs += frame.delta;
      const bucket = Math.min(bucketCount - 1, Math.floor((now - frame.at) / 1000));
      bucketFrames[bucket] = (bucketFrames[bucket] as number) + 1;
      bucketMs[bucket] = (bucketMs[bucket] as number) + frame.delta;
    }
    let minFps = Number.NaN;
    for (let bucket = 0; bucket < bucketCount; bucket += 1) {
      const ms = bucketMs[bucket] as number;
      if (ms <= 0) continue;
      const rate = ((bucketFrames[bucket] as number) * 1000) / ms;
      if (Number.isNaN(minFps) || rate < minFps) minFps = rate;
    }
    const fps = activeMs > 0 ? (count * 1000) / activeMs : Number.NaN;
    const refreshHz = source.frameMs === null ? Number.NaN : 1000 / source.frameMs;
    return { count, activeMs, fps, minFps, refreshHz, shortfall: 1 - fps / refreshHz };
  };

  const calibrationRow = (): [string, string][] =>
    source.frameMs === null
      ? [["Calibration intervals", `${source.calibrationSamples} / ${CALIBRATION_FRAMES}`]]
      : [];

  return {
    id: "fps",
    estimatedCost: "moderate",
    supported,
    ...(supported ? {} : { unsupportedReason: UNSUPPORTED_REASON }),
    series,
    start(context: CollectorContext) {
      let sinceSample = 0;
      source.start(context, () => {
        sinceSample += 1;
        // One sparkline point per ~500 ms of frames, not one per frame.
        if (sinceSample >= 30) {
          sinceSample = 0;
          series.push(context.now(), summarise(context.now()).fps);
          context.invalidate();
        }
      });
    },
    read(now: number): MetricView {
      const base = { id: "fps", label: "fps", title: "Frame rate", unit: "fps" } as const;
      if (!supported) {
        return {
          ...base,
          status: "unsupported",
          severity: "unknown",
          display: NOT_AVAILABLE,
          value: Number.NaN,
          hint: UNSUPPORTED_REASON,
          detail: [],
        };
      }

      const window = summarise(now);
      if (window.count === 0) {
        return {
          ...base,
          status: "pending",
          severity: "unknown",
          display: "—",
          value: Number.NaN,
          hint: "Idle: no frames were produced in the rolling window, so there is no rate to report.",
          detail: calibrationRow(),
        };
      }

      const calibrating = source.frameMs === null;
      return {
        ...base,
        status: "ok",
        severity: severityFor(window.shortfall, thresholds),
        display: `${Math.round(window.fps)} fps`,
        value: window.fps,
        hint: calibrating
          ? `Calibrating the display cadence: ${source.calibrationSamples} of ${CALIBRATION_FRAMES} active frame intervals measured, so there is no refresh rate to judge this against yet.`
          : `Frames delivered per second of active time, across the last ${formatSeconds(window.activeMs)} of it. Severity is the shortfall against the ${Math.round(window.refreshHz)} Hz refresh rate; hidden-tab gaps and stalls longer than ${gapText} are not active time.`,
        detail: [
          ["Frames in window", String(window.count)],
          ["Active window", formatSeconds(window.activeMs)],
          ["Min FPS in window", `${Math.round(window.minFps)} fps`],
          ["Refresh rate", calibrating ? "calibrating" : `${Math.round(window.refreshHz)} Hz`],
          ...calibrationRow(),
        ],
      };
    },
    reset() {
      source.reset();
      series.clear();
    },
    diagnostics(now: number) {
      return {
        supported,
        ...summarise(now),
        frameMs: source.frameMs,
        historySize,
        calibrationSamples: source.calibrationSamples,
      };
    },
  };
}
