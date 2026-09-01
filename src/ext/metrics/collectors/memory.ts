/**
 * JS heap usage. [dev-toolbar/ext/metrics]
 *
 * `performance.memory` is a non-standard Chromium extension. Everywhere else
 * this collector reports `unsupported` and the chip renders `NA` — the one
 * thing it must never do is imply the number is missing because the page is
 * healthy. It is also *not* process memory, and the panel says so.
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

  const sample = (now: number) => {
    const memory = read();
    if (!memory) return;
    latest = memory;
    series.push(now, memory.usedJSHeapSize);
  };

  /** Monotonic climb across the whole growth window is the leak signature. */
  const sustainedGrowth = (now: number): boolean => {
    const since = now - growthWindowMs;
    const count = series.countSince(since);
    if (count < GROWTH_MIN_SAMPLES) return false;
    const first = series.size - count;
    for (let index = first + 1; index < series.size; index += 1) {
      if (series.values.at(index) <= series.values.at(index - 1)) return false;
    }
    return true;
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
      const baseline = series.valueAt(now - growthWindowMs);
      const change = Number.isFinite(baseline) ? latest.usedJSHeapSize - baseline : Number.NaN;

      detail.push(
        ["Used JS heap", formatBytes(latest.usedJSHeapSize, 1)],
        ["Total allocated", formatBytes(latest.totalJSHeapSize, 1)],
        ["Heap limit", formatBytes(latest.jsHeapSizeLimit, 1)],
        ["Share of limit", formatPercent(ratio)],
        ["Change (last minute)", formatBytesDelta(change)],
        ["Sustained growth", growing ? "yes" : "no"],
      );

      const base = severityFor(ratio, thresholds);
      return {
        id: "memory",
        label: "mem",
        title: "Memory",
        status: "ok",
        severity: growing && base === "ok" ? "warn" : growing ? "bad" : base,
        display: formatBytes(latest.usedJSHeapSize),
        value: latest.usedJSHeapSize,
        unit: "bytes",
        hint: growing
          ? "Used JS heap has climbed on every sample for the last minute."
          : "Used JS heap, as a share of the browser's heap limit. Not process memory.",
        detail,
      };
    },
    reset() {
      series.clear();
      latest = null;
    },
    diagnostics(now: number) {
      return {
        supported,
        latest,
        ratio: latest ? latest.usedJSHeapSize / latest.jsHeapSizeLimit : null,
        sustainedGrowth: supported ? sustainedGrowth(now) : null,
        samples: series.size,
      };
    },
  };
}
