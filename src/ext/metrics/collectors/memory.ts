/**
 * JS heap usage. [dev-toolbar/ext/metrics]
 *
 * `performance.memory` is a non-standard Chromium API. Other browsers return
 * `unsupported`; it reports JS heap, not process memory.
 *
 * A site-isolated desktop renderer gets precise live values. Otherwise, including
 * most Android sites or disabled site isolation, values are quantized and cached
 * for up to 20 minutes. Since the mode is not exposed, a long run of identical
 * readings marks the source rate-limited instead of presenting stale values as live.
 */
import { createTimeSeries } from "../../../runtime";
import { formatBytes, formatBytesDelta, formatPercent, NOT_AVAILABLE } from "../format";
import type { Collector, CollectorContext, MetricView, Thresholds } from "../types";
import { severityFor } from "../types";

interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export function readPerformanceMemory(
  source: unknown = typeof performance === "undefined" ? undefined : performance,
): PerformanceMemory | null {
  const memory = (source as { memory?: Partial<PerformanceMemory> } | undefined)?.memory;
  if (!memory) return null;
  const { usedJSHeapSize, totalJSHeapSize, jsHeapSizeLimit } = memory;
  if (
    typeof usedJSHeapSize !== "number" ||
    typeof totalJSHeapSize !== "number" ||
    typeof jsHeapSizeLimit !== "number" ||
    !(jsHeapSizeLimit > 0)
  ) {
    return null;
  }
  return { usedJSHeapSize, totalJSHeapSize, jsHeapSizeLimit };
}

export interface MemoryCollectorOptions {
  /** Poll interval. Default `2000` ms — a heap read is cheap but not free. */
  sampleMs?: number;
  /** Samples kept for the sparkline. Default `90` (three minutes at 2 s). */
  historySize?: number;
  /** Fractions of the heap limit. Default `{ warn: 0.5, bad: 0.75 }`. */
  thresholds?: Thresholds;
  /** Window for the growth read-out. Default `60000` ms. */
  growthWindowMs?: number;
  /** Injectable for tests. Defaults to the real `performance`. */
  read?: () => PerformanceMemory | null;
}

const GROWTH_MIN_SAMPLES = 5;
const GROWTH_MIN_DELTA_BYTES = 1024 * 1024;
const GROWTH_MIN_DELTA_RATIO = 0.01;
/** Sub-windows the growth window is split into to read the heap's floor. */
const GROWTH_BUCKETS = 4;

/** A byte-identical run this long indicates a rate-limited source. */
const FROZEN_MIN_SAMPLES = 30;
const FROZEN_MIN_MS = 60_000;

/** Formats a duration for labels that state the span actually covered. */
function formatSpan(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  const minutes = ms / 60_000;
  if (minutes < 1.5) return "minute";
  return `${Math.round(minutes)} min`;
}

export function createMemoryCollector(options: MemoryCollectorOptions = {}): Collector {
  const {
    sampleMs = 2000,
    historySize = 90,
    thresholds = { warn: 0.5, bad: 0.75 },
    growthWindowMs = 60_000,
    read = () => readPerformanceMemory(),
  } = options;

  const series = createTimeSeries(historySize);
  const supported = read() !== null;
  let latest: PerformanceMemory | null = null;
  /** Length of the current run of identical `usedJSHeapSize` readings. */
  let identicalRun = 0;
  /** Timestamp the current identical run started at. */
  let identicalSince = Number.NaN;
  /**
   * Sticky once a run indicates browser rate limiting: the 20-minute cache
   * turning over yields one changed value, which must not flip the panel back
   * to "live" and re-enable growth detection over quantized numbers.
   */
  let rateLimited = false;

  const sample = (now: number) => {
    const memory = read();
    if (!memory) return;
    if (latest && memory.usedJSHeapSize === latest.usedJSHeapSize) {
      identicalRun += 1;
    } else {
      identicalRun = 1;
      identicalSince = now;
    }
    if (identicalRun >= FROZEN_MIN_SAMPLES && now - identicalSince >= FROZEN_MIN_MS) {
      rateLimited = true;
    }
    latest = memory;
    series.push(now, memory.usedJSHeapSize);
  };

  /** Index of the oldest retained sample at or after `since`, or `-1`. */
  const firstIndexSince = (since: number): number => {
    for (let index = 0; index < series.size; index += 1) {
      if (series.times.at(index) >= since) return index;
    }
    return -1;
  };

  /**
   * Detect a rising *floor* rather than a monotonic series: minor GCs make leaks
   * sawtooth. Compare each bucket's minimum; require non-decreasing floors, rises
   * in most buckets, and a material net gain.
   */
  const sustainedGrowth = (now: number): boolean => {
    // A rate-limited source repeats one cached number; growth is undetectable.
    if (rateLimited) return false;
    const since = now - growthWindowMs;
    const count = series.countSince(since);
    if (count < GROWTH_MIN_SAMPLES) return false;
    const first = series.size - count;

    const floors: number[] = [];
    for (let bucket = 0; bucket < GROWTH_BUCKETS; bucket += 1) {
      const start = first + Math.floor((bucket * count) / GROWTH_BUCKETS);
      const end = first + Math.floor(((bucket + 1) * count) / GROWTH_BUCKETS);
      let min = Number.POSITIVE_INFINITY;
      for (let index = start; index < end; index += 1) {
        const value = series.values.at(index);
        if (value < min) min = value;
      }
      if (!Number.isFinite(min)) return false;
      floors.push(min);
    }

    let rising = 0;
    for (let bucket = 1; bucket < floors.length; bucket += 1) {
      const previous = floors[bucket - 1] as number;
      const current = floors[bucket] as number;
      if (current < previous) return false;
      if (current > previous) rising += 1;
    }
    const firstFloor = floors[0] as number;
    const net = (floors[floors.length - 1] as number) - firstFloor;
    const material = Math.max(GROWTH_MIN_DELTA_BYTES, firstFloor * GROWTH_MIN_DELTA_RATIO);
    return net >= material && rising > (floors.length - 1) / 2;
  };

  return {
    id: "memory",
    estimatedCost: "minimal",
    supported,
    ...(supported
      ? {}
      : {
          unsupportedReason:
            "performance.memory is Chromium-only. Firefox and Safari expose no heap size.",
        }),
    series,
    start(context: CollectorContext) {
      sample(context.now());
      context.invalidate();
      const timer = setInterval(() => {
        sample(context.now());
      }, sampleMs);
      context.signal.addEventListener("abort", () => clearInterval(timer), {
        once: true,
      });
    },
    read(now: number): MetricView {
      const detail: [string, string][] = [];
      if (!supported) {
        return {
          id: "memory",
          label: "mem",
          title: "Memory",
          status: "unsupported",
          severity: "unknown",
          display: NOT_AVAILABLE,
          value: Number.NaN,
          unit: "bytes",
          hint: "performance.memory is Chromium-only; no heap figures are available in this browser.",
          detail,
        };
      }
      if (!latest || series.size === 0) {
        return {
          id: "memory",
          label: "mem",
          title: "Memory",
          status: "pending",
          severity: "unknown",
          display: "…",
          value: Number.NaN,
          unit: "bytes",
          hint: "Waiting for the first heap sample.",
          detail,
        };
      }

      const ratio = latest.usedJSHeapSize / latest.jsHeapSizeLimit;
      const growing = sustainedGrowth(now);

      // Use the oldest retained sample to label the covered span; a young window has no sample at
      // `now - growthWindowMs`.
      const baselineIndex = firstIndexSince(now - growthWindowMs);
      const baseline = baselineIndex < 0 ? Number.NaN : series.values.at(baselineIndex);
      const spanMs = baselineIndex < 0 ? Number.NaN : now - series.times.at(baselineIndex);
      const change = Number.isFinite(baseline) ? latest.usedJSHeapSize - baseline : Number.NaN;
      const spanLabel = formatSpan(
        Number.isFinite(spanMs) && spanMs < growthWindowMs - sampleMs ? spanMs : growthWindowMs,
      );

      detail.push(
        ["Used JS heap", formatBytes(latest.usedJSHeapSize, 1)],
        ["Total allocated", formatBytes(latest.totalJSHeapSize, 1)],
        ["Heap limit", formatBytes(latest.jsHeapSizeLimit, 1)],
        ["Share of limit", formatPercent(ratio)],
        [`Change (last ${spanLabel})`, rateLimited ? NOT_AVAILABLE : formatBytesDelta(change)],
        ["Sustained growth", rateLimited ? "unknown" : growing ? "yes" : "no"],
        ["Sampling", rateLimited ? "rate-limited" : "live"],
      );

      const base = severityFor(ratio, thresholds);
      const hint = rateLimited
        ? "This browser rate-limits performance.memory: the reading is rounded and can be up to 20 minutes old, so change and growth cannot be read from it."
        : growing
          ? "The used JS heap's floor rose across the window without falling back, by a material amount."
          : "Used JS heap, as a share of the browser's heap limit. Not process memory.";
      return {
        id: "memory",
        label: "mem",
        title: "Memory",
        status: "ok",
        severity: growing && base === "ok" ? "warn" : growing ? "bad" : base,
        display: formatBytes(latest.usedJSHeapSize),
        value: latest.usedJSHeapSize,
        unit: "bytes",
        hint,
        detail,
      };
    },
    reset() {
      series.clear();
      latest = null;
      identicalRun = 0;
      identicalSince = Number.NaN;
      rateLimited = false;
    },
    diagnostics(now: number) {
      return {
        supported,
        latest,
        ratio: latest ? latest.usedJSHeapSize / latest.jsHeapSizeLimit : null,
        sustainedGrowth: supported && !rateLimited ? sustainedGrowth(now) : null,
        sampling: supported ? (rateLimited ? "rate-limited" : "live") : null,
        identicalRun,
        samples: series.size,
      };
    },
  };
}
