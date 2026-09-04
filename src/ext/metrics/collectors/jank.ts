/**
 * Dropped frames. [dev-toolbar/ext/metrics]
 *
 * Core reports visibility but never pauses extensions, so this loop keeps
 * running through hidden tabs, minimised windows, sleep/wake and throttling,
 * and discards the deltas those produce itself to keep the rolling window valid.
 *
 * Deltas over `idleGapMs` with no spanning visibility change are main-thread
 * stalls. They stay out of the dropped/expected ratio and `worstFrame`, so a
 * 3 s debugger pause cannot add ~180 expected frames and mask later jank.
 * Visible gaps over `stallCeilingMs` are treated as absent. A frontmost display
 * sleep can still look like a stall, which is safer than silently dropping it.
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
   * Target frame budget override. Without one, calibration uses the first 120 active intervals;
   * only `reset()` recalibrates. Set it when the refresh rate can switch. Calibration intervals
   * stay out of `worstFrame`; stall detection runs first and still reports in `stalls`/
   * `longestStall`.
   */
  frameMs?: number;
  /**
   * Deltas over this threshold are not frame pacing. If a visibility change spans the gap, discard
   * it; otherwise record a stall outside the dropped-frame ratio. Default `1000` ms.
   */
  idleGapMs?: number;
  /**
   * Visible gaps over this threshold are treated as absent. Debugger pauses, modal dialogs, and
   * synchronous XHR emit no `visibilitychange`, but longer gaps are unlikely page work. Default
   * `30_000` ms.
   */
  stallCeilingMs?: number;
  /**
   * Frames retained. Defaults to enough for `windowMs` at `frameMs` when given, else 4 ms
   * (~240 Hz), plus 250 slots of slack. Override for unusual refresh rates or memory limits.
   */
  historySize?: number;
  /** Fractions, not percentages. Default `{ warn: 0.02, bad: 0.05 }`. */
  thresholds?: Thresholds;
}

export function createJankCollector(options: JankCollectorOptions = {}): Collector {
  const {
    windowMs = 5000,
    idleGapMs = 1000,
    stallCeilingMs = 30_000,
    thresholds = { warn: 0.02, bad: 0.05 },
  } = options;
  const frameMsOverride = options.frameMs;
  // Covers the requested window plus one second of slack.
  const historySize =
    options.historySize ?? Math.ceil(windowMs / (frameMsOverride ?? 4)) + Math.ceil(1000 / 4);

  const frames = createRingBuffer<Frame>(historySize);
  const series = createTimeSeries(120);
  const calibrationSamples: number[] = [];
  const supported =
    typeof requestAnimationFrame === "function" && typeof cancelAnimationFrame === "function";
  let worstFrame = 0;
  let longestStall = 0;
  let discarded = 0;
  let stalls = 0;
  let calibratedFrameMs = frameMsOverride ?? null;

  const formatSeconds = (ms: number): string => `${Number((ms / 1000).toFixed(1))} s`;
  const gapText = idleGapMs >= 1000 ? formatSeconds(idleGapMs) : `${Math.round(idleGapMs)} ms`;
  const stallLabel = `Stalls >${gapText} (session)`;

  const percentile = (sorted: readonly number[], fraction: number): number =>
    sorted[Math.floor((sorted.length - 1) * fraction)] as number;

  const calibrate = (): number => {
    const sorted = [...calibrationSamples].sort((left, right) => left - right);
    // p20 ignores startup stalls; mixed refresh-rate clusters need explicit `frameMs` until a
    // mode-based estimator can distinguish them.
    return percentile(sorted, 0.2);
  };

  const summarise = (now: number) => {
    const since = now - windowMs;
    let expected = 0;
    let dropped = 0;
    let count = 0;
    let slowest = 0;
    // Use the interval start: N 16 ms frames span N intervals; `now - oldest.at` loses one.
    let earliestStart = Number.POSITIVE_INFINITY;
    for (let index = 0; index < frames.size; index += 1) {
      const frame = frames.at(index);
      if (frame === undefined || frame.at < since) continue;
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
          unsupportedReason: "requestAnimationFrame is unavailable, so frames cannot be timed.",
        }),
    series,
    start(context: CollectorContext) {
      let previous = 0;
      let handle = 0;
      let stopped = false;
      let sinceSample = 0;
      // Record visibility-change times because rAF stops while hidden and its callback runs after
      // return. rAF timestamps and `performance.now()` share an origin.
      const changedAt: number[] = [];
      const doc = typeof document === "undefined" ? null : document;
      const onVisibilityChange = () => {
        changedAt.push(
          typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : context.now(),
        );
      };
      doc?.addEventListener("visibilitychange", onVisibilityChange);

      const loop = (timestamp: number) => {
        if (stopped) return;
        handle = requestAnimationFrame(loop);
        if (previous !== 0) {
          const delta = timestamp - previous;
          // Drain all markers delivered before this callback. rAF timestamps are stamped before
          // the callback, so a `timestamp` bound can miss a visibility IPC handled after that
          // stamp. Only markers after `previous` belong to this delta.
          let wentAway = false;
          while (changedAt.length > 0) {
            if ((changedAt.shift() as number) > previous) wentAway = true;
          }
          // `hidden` confirms an ongoing background interval; `visible` cannot rule out a completed
          // one because the callback runs after return.
          if (wentAway || doc?.visibilityState === "hidden" || delta > stallCeilingMs) {
            // Hidden gaps and visible gaps past the ceiling are absent, not dropped frames.
            discarded += 1;
          } else if (delta > idleGapMs) {
            // Visible gaps over `idleGapMs` are stalls, kept out of the ratio and `worstFrame`.
            stalls += 1;
            if (delta > longestStall) longestStall = delta;
            context.invalidate();
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
          doc?.removeEventListener("visibilitychange", onVisibilityChange);
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
          detail: [
            ...(calibrating
              ? ([["Calibration intervals", `${calibrationSamples.length} / 120`]] as [
                  string,
                  string,
                ][])
              : []),
            ["Frames discarded as idle", String(discarded)],
            ...(stalls > 0
              ? ([
                  [stallLabel, String(stalls)],
                  ["Longest stall (session)", formatMs(longestStall, 1)],
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
        ["Frames discarded as idle", String(discarded)],
        [stallLabel, String(stalls)],
      );
      if (stalls > 0) detail.push(["Longest stall (session)", formatMs(longestStall, 1)]);
      detail.push(
        ["Frame budget", formatMs(calibratedFrameMs ?? Number.NaN, 2)],
        ["Window", formatSeconds(window.effectiveWindowMs)],
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
        hint: `Dropped frames over expected frames, across the last ${formatSeconds(window.effectiveWindowMs)} of active frames. Stalls longer than ${gapText} are counted separately, not in this ratio — and a debugger paused on a breakpoint or a modal dialog counts as one.`,
        detail,
      };
    },
    reset() {
      frames.clear();
      series.clear();
      worstFrame = 0;
      longestStall = 0;
      discarded = 0;
      stalls = 0;
      calibrationSamples.length = 0;
      calibratedFrameMs = frameMsOverride ?? null;
    },
    diagnostics(now: number) {
      return {
        supported,
        ...summarise(now),
        worstFrame,
        longestStall,
        discarded,
        stalls,
        frameMs: calibratedFrameMs,
        historySize,
        calibrationSamples: calibrationSamples.length,
      };
    },
  };
}
