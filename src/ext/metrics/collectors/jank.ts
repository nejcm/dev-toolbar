/**
 * Dropped frames. [dev-toolbar/ext/metrics]
 *
 * A rAF loop that only does arithmetic, plus the exclusions §3D asks for: a
 * backgrounded tab, a minimised window, a machine waking from sleep and
 * browser throttling all produce enormous frame deltas that are *not* jank.
 * Anything longer than `idleGapMs` is discarded rather than counted as a
 * hundred dropped frames.
 *
 * Note the lifecycle decision this depends on: core reports visibility but
 * never pauses an extension. Frame counting here is a rolling window rather
 * than a cumulative total precisely so that stopping the loop while the bar is
 * hidden cannot corrupt it.
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
  /** Target frame budget. Default `1000 / 60`. */
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

export function createJankCollector(
  options: JankCollectorOptions = {},
): Collector {
  const {
    windowMs = 5000,
    frameMs = 1000 / 60,
    idleGapMs = 1000,
    historySize = 360,
    thresholds = { warn: 0.02, bad: 0.05 },
  } = options;

  const frames = createRingBuffer<Frame>(historySize);
  const series = createTimeSeries(120);
  const supported =
    typeof requestAnimationFrame === "function" &&
    typeof cancelAnimationFrame === "function";
  let worstFrame = 0;
  let discarded = 0;

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
          unsupportedReason:
            "requestAnimationFrame is unavailable, so frames cannot be timed.",
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
          // A backgrounded tab, a sleeping machine or a throttled timer: not
          // a dropped frame, an absent one.
          const hidden =
            typeof document !== "undefined" && document.visibilityState === "hidden";
          if (delta > idleGapMs || hidden) {
            discarded += 1;
          } else {
            const expected = Math.max(1, Math.round(delta / frameMs));
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
        return {
          id: "jank",
          label: "jank",
          title: "Jank",
          status: "pending",
          severity: "unknown",
          display: "—",
          value: Number.NaN,
          unit: "%",
          hint: "Idle: no frames were produced in the rolling window, which is not the same as no jank.",
          detail: [["Frames discarded as idle", String(discarded)]],
        };
      }

      detail.push(
        ["Frames in window", String(window.count)],
        ["Expected frames", String(window.expected)],
        ["Dropped frames", String(window.dropped)],
        ["Slowest frame", formatMs(window.slowest, 1)],
        ["Worst frame (session)", formatMs(worstFrame, 1)],
        ["Frames discarded as idle", String(discarded)],
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
    },
    diagnostics(now: number) {
      return {
        supported,
        ...summarise(now),
        worstFrame,
        discarded,
      };
    },
  };
}
