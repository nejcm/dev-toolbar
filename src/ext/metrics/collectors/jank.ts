/**
 * Dropped frames. [dev-toolbar/ext/metrics]
 *
 * Reads the shared frame source in `frames.ts`, which owns the loop, the
 * visibility and stall classification and the frame-budget calibration.
 */
import { createTimeSeries } from "../../../runtime";
import { clampCapacity } from "../../../runtime/ringBuffer";
import { formatMs, formatPercent, NOT_AVAILABLE } from "../format";
import type { Collector, CollectorContext, MetricView, Thresholds } from "../types";
import { severityFor } from "../types";
import {
  CALIBRATION_FRAMES,
  createFrameSource,
  formatGap,
  formatSeconds,
  UNSUPPORTED_REASON,
} from "./frames";
import type { Frame, FrameOptions, FrameSource } from "./frames";

export interface JankCollectorOptions extends FrameOptions {
  /** Rolling active window. Default `5000` ms, per §3D. */
  windowMs?: number;
  /** Frames retained. Defaults to cover `windowMs` at `frameMs` (or 4 ms) plus slack. */
  historySize?: number;
  /** Fractions, not percentages. Default `{ warn: 0.02, bad: 0.05 }`. */
  thresholds?: Thresholds;
}

export function createJankCollector(options: JankCollectorOptions = {}): Collector {
  return createJankReader(createFrameSource(options), options);
}

/** Jank over a frame source another reader may share; its classifier options are the source's. */
export function createJankReader(
  source: FrameSource,
  options: JankCollectorOptions = {},
): Collector {
  const { windowMs = 5000, thresholds = { warn: 0.02, bad: 0.05 } } = options;
  const historySize = source.retain(windowMs, options.historySize);
  const slots = clampCapacity(historySize);
  const series = createTimeSeries(120);
  const { supported } = source;
  let worstFrame = 0;

  const gapText = formatGap(source.idleGapMs);
  const stallLabel = `Stalls >${gapText} (session)`;

  const summarise = (now: number) => {
    const since = now - windowMs;
    let expected = 0;
    let dropped = 0;
    let count = 0;
    let slowest = 0;
    // Use the interval start: N 16 ms frames span N intervals; `now - oldest.at` loses one.
    let earliestStart = Number.POSITIVE_INFINITY;
    const { frames } = source;
    // The shared ring may hold more than this reader's own history; scan only that.
    for (let index = Math.max(0, frames.size - slots); index < frames.size; index += 1) {
      const frame = frames.at(index);
      // Calibration frames have no budget to be dropped against.
      if (frame === undefined || frame.at < since || frame.expected === 0) continue;
      expected += frame.expected;
      dropped += frame.dropped;
      count += 1;
      if (frame.delta > slowest) slowest = frame.delta;
      if (frame.at - frame.delta < earliestStart) earliestStart = frame.at - frame.delta;
    }
    // A young or undersized ring can cover less than `windowMs`; report the retained span.
    const retainedMs = count > 0 ? now - earliestStart : windowMs;
    return {
      count,
      expected,
      dropped,
      slowest,
      effectiveWindowMs: Math.min(windowMs, retainedMs),
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
          unsupportedReason: UNSUPPORTED_REASON,
        }),
    series,
    start(context: CollectorContext) {
      let sinceSample = 0;
      source.start(context, (frame: Frame) => {
        if (frame.expected === 0) return;
        if (frame.delta > worstFrame) worstFrame = frame.delta;
        sinceSample += 1;
        // One sparkline point per ~500 ms of frames, not one per frame.
        if (sinceSample >= 30) {
          sinceSample = 0;
          series.push(context.now(), summarise(context.now()).ratio);
          context.invalidate();
        }
      });
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
          hint: UNSUPPORTED_REASON,
          detail,
        };
      }

      const window = summarise(now);
      if (window.count === 0) {
        const calibrating = source.frameMs === null && source.calibrationSamples > 0;
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
            ? `Calibrating the display cadence: ${source.calibrationSamples} of ${CALIBRATION_FRAMES} active frame intervals measured.`
            : "Idle: no frames were produced in the rolling window, which is not the same as no jank.",
          detail: [
            ...(calibrating
              ? ([
                  ["Calibration intervals", `${source.calibrationSamples} / ${CALIBRATION_FRAMES}`],
                ] as [string, string][])
              : []),
            ["Frames discarded as idle", String(source.discarded)],
            ...(source.stalls > 0
              ? ([
                  [stallLabel, String(source.stalls)],
                  ["Longest stall (session)", formatMs(source.longestStall, 1)],
                ] as [string, string][])
              : []),
          ],
        };
      }

      detail.push(
        ["Frames in window", String(window.count)],
        ["Expected frames", String(window.expected)],
        ["Dropped frames", String(window.dropped)],
        ["Slowest frame", formatMs(window.slowest, 1)],
        ["Worst frame (session)", formatMs(worstFrame, 1)],
        ["Frames discarded as idle", String(source.discarded)],
        [stallLabel, String(source.stalls)],
      );
      if (source.stalls > 0)
        detail.push(["Longest stall (session)", formatMs(source.longestStall, 1)]);
      detail.push(
        ["Frame budget", formatMs(source.frameMs ?? Number.NaN, 2)],
        ["Window", formatSeconds(window.effectiveWindowMs)],
      );

      return {
        id: "jank",
        label: "jank",
        title: "Jank",
        status: "ok",
        severity: severityFor(window.ratio, thresholds),
        display: formatPercent(window.ratio),
        value: window.ratio * 100,
        unit: "%",
        hint: `Dropped frames over expected frames, across the last ${formatSeconds(window.effectiveWindowMs)} of active frames. Stalls longer than ${gapText} are counted separately, not in this ratio — and a debugger paused on a breakpoint or a modal dialog counts as one.`,
        detail,
      };
    },
    reset() {
      source.reset();
      series.clear();
      worstFrame = 0;
    },
    diagnostics(now: number) {
      return {
        supported,
        ...summarise(now),
        worstFrame,
        longestStall: source.longestStall,
        discarded: source.discarded,
        stalls: source.stalls,
        frameMs: source.frameMs,
        historySize,
        calibrationSamples: source.calibrationSamples,
      };
    },
  };
}
