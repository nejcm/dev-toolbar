/**
 * The shared frame source behind `fps` and `jank`. [dev-toolbar/ext/metrics]
 *
 * Core reports visibility but never pauses extensions, so this loop keeps
 * running through hidden tabs, minimised windows, sleep/wake and throttling,
 * and discards the deltas those produce itself to keep the rolling window valid.
 *
 * Deltas over `idleGapMs` with no spanning visibility change are main-thread
 * stalls. They stay out of every reader's window, so a 3 s debugger pause
 * cannot add ~180 expected frames and mask later jank.
 * Visible gaps over `stallCeilingMs` are treated as absent. A frontmost display
 * sleep can still look like a stall, which is safer than silently dropping it.
 *
 * One rAF loop runs while any reader is started; it stops once every reader's
 * signal has aborted.
 */
import { createRingBuffer } from "../../../runtime";
import type { RingBuffer } from "../../../runtime";
import type { CollectorContext } from "../types";

export interface Frame {
  at: number;
  delta: number;
  /** `0` while the frame budget is still calibrating. */
  expected: number;
  dropped: number;
}

export interface FrameOptions {
  /**
   * Target frame budget override. Without one, calibration uses the first 120
   * active intervals; only `reset()` recalibrates. Set it when the refresh
   * rate can switch.
   */
  frameMs?: number;
  /**
   * Deltas over this threshold are not frame pacing: discarded if a
   * visibility change spans the gap, else recorded as a stall outside every
   * frame window. Default `1000` ms.
   */
  idleGapMs?: number;
  /**
   * Visible gaps over this threshold are treated as absent — a debugger
   * pause, modal dialog, or sync XHR emits no `visibilitychange`, but a
   * longer gap is unlikely page work. Default `30_000` ms.
   */
  stallCeilingMs?: number;
}

export interface FrameSource {
  readonly supported: boolean;
  readonly idleGapMs: number;
  /** Every active frame, calibration included. Re-read it: `retain()` can replace it. */
  readonly frames: RingBuffer<Frame>;
  /** The override, else the calibrated budget, else `null` while calibrating. */
  readonly frameMs: number | null;
  readonly calibrationSamples: number;
  readonly discarded: number;
  readonly stalls: number;
  readonly longestStall: number;
  /** Grows the ring to cover `windowMs` for one more reader; returns that reader's size. */
  retain(windowMs: number, historySize?: number): number;
  start(context: CollectorContext, onFrame: (frame: Frame) => void): void;
  reset(): void;
}

export const CALIBRATION_FRAMES = 120;

export const UNSUPPORTED_REASON =
  "requestAnimationFrame is unavailable, so frames cannot be timed.";

export const formatSeconds = (ms: number): string => `${Number((ms / 1000).toFixed(1))} s`;

export const formatGap = (ms: number): string =>
  ms >= 1000 ? formatSeconds(ms) : `${Math.round(ms)} ms`;

interface Reader {
  context: CollectorContext;
  onFrame: (frame: Frame) => void;
}

export function createFrameSource(options: FrameOptions = {}): FrameSource {
  const { idleGapMs = 1000, stallCeilingMs = 30_000 } = options;
  const frameMsOverride = options.frameMs;
  const supported =
    typeof requestAnimationFrame === "function" && typeof cancelAnimationFrame === "function";
  const calibrationSamples: number[] = [];
  const readers = new Set<Reader>();
  let capacity = 1;
  let ring: RingBuffer<Frame> | null = null;
  let calibratedFrameMs = frameMsOverride ?? null;
  let discarded = 0;
  let stalls = 0;
  let longestStall = 0;
  let stop: (() => void) | null = null;

  const frames = (): RingBuffer<Frame> => (ring ??= createRingBuffer<Frame>(capacity));

  const calibrate = (): number => {
    const sorted = [...calibrationSamples].sort((left, right) => left - right);
    // p20 ignores startup stalls; mixed refresh-rate clusters need explicit `frameMs` until a
    // mode-based estimator can distinguish them.
    return sorted[Math.floor((sorted.length - 1) * 0.2)] as number;
  };

  const invalidate = () => {
    for (const reader of readers) reader.context.invalidate();
  };

  const begin = (context: CollectorContext) => {
    let previous = 0;
    let handle = 0;
    let stopped = false;
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
          stalls += 1;
          if (delta > longestStall) longestStall = delta;
          invalidate();
        } else {
          let expected = 0;
          if (calibratedFrameMs === null) {
            if (Number.isFinite(delta) && delta > 0) calibrationSamples.push(delta);
            if (calibrationSamples.length >= CALIBRATION_FRAMES) {
              calibratedFrameMs = calibrate();
              invalidate();
            }
          } else {
            expected = Math.max(1, Math.round(delta / calibratedFrameMs));
          }
          const frame = {
            at: context.now(),
            delta,
            expected,
            dropped: Math.max(0, expected - 1),
          };
          frames().push(frame);
          for (const reader of readers) reader.onFrame(frame);
        }
      }
      previous = timestamp;
    };

    handle = requestAnimationFrame(loop);
    return () => {
      stopped = true;
      cancelAnimationFrame(handle);
      doc?.removeEventListener("visibilitychange", onVisibilityChange);
    };
  };

  return {
    supported,
    idleGapMs,
    get frames() {
      return frames();
    },
    get frameMs() {
      return calibratedFrameMs;
    },
    get calibrationSamples() {
      return calibrationSamples.length;
    },
    get discarded() {
      return discarded;
    },
    get stalls() {
      return stalls;
    },
    get longestStall() {
      return longestStall;
    },
    retain(windowMs, historySize) {
      // Covers the requested window plus one second of slack.
      const size =
        historySize ?? Math.ceil(windowMs / (frameMsOverride ?? 4)) + Math.ceil(1000 / 4);
      if (size > capacity) {
        capacity = size;
        if (ring !== null) {
          const grown = createRingBuffer<Frame>(capacity);
          ring.forEach((frame) => grown.push(frame));
          ring = grown;
        }
      }
      return size;
    },
    start(context, onFrame) {
      if (context.signal.aborted) return;
      const reader = { context, onFrame };
      readers.add(reader);
      stop ??= begin(context);
      context.signal.addEventListener(
        "abort",
        () => {
          readers.delete(reader);
          if (readers.size > 0) return;
          stop?.();
          stop = null;
        },
        { once: true },
      );
    },
    reset() {
      ring?.clear();
      discarded = 0;
      stalls = 0;
      longestStall = 0;
      calibrationSamples.length = 0;
      calibratedFrameMs = frameMsOverride ?? null;
    },
  };
}
