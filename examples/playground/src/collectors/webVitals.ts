import type { Collector, CollectorContext } from "@nejcm/dev-toolbar/ext/metrics";
import { formatMs, severityFor } from "@nejcm/dev-toolbar/ext/metrics";
import { createTimeSeries } from "@nejcm/dev-toolbar/runtime";

type Shift = PerformanceEntry & { value: number; hadRecentInput: boolean };
type Interaction = PerformanceEntry & { interactionId: number };

export function createWebVitalsCollector(): Collector {
  const series = createTimeSeries(120);
  const supported = typeof PerformanceObserver !== "undefined";
  const available = new Set(supported ? PerformanceObserver.supportedEntryTypes : []);
  let lcp = Number.NaN;
  let cls = Number.NaN;
  let inp = Number.NaN;
  let ttfb = Number.NaN;
  let sessionStart = Number.NEGATIVE_INFINITY;
  let lastShift = 0;
  let sessionValue = 0;
  const cutoffs = new Map<string, number>();
  let interactionBaseline = 0;
  let context: CollectorContext | undefined;
  const interactions = new Map<number, number>();
  const finite = (value: number) => (Number.isFinite(value) ? value : null);
  const collector: Collector = {
    id: "web-vitals",
    estimatedCost: "minimal",
    supported,
    get unsupportedReason() {
      if (!supported) return "PerformanceObserver is unavailable.";
      return available.has("largest-contentful-paint")
        ? undefined
        : "Largest Contentful Paint entries are unavailable.";
    },
    series,
    start(next) {
      context = next;
      if (next.signal.aborted) return;
      const navigation = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      ttfb =
        navigation && navigation.responseStart > 0
          ? navigation.responseStart - navigation.startTime
          : Number.NaN;
      const observe = (type: string, receive: (entries: PerformanceEntry[]) => void) => {
        if (!available.has(type)) return;
        const observer = new PerformanceObserver((list) => {
          if (next.signal.aborted) return;
          const entries = list
            .getEntries()
            .filter((entry) => entry.startTime > (cutoffs.get(type) ?? -1));
          receive(entries);
          for (const entry of entries)
            cutoffs.set(type, Math.max(cutoffs.get(type) ?? -1, entry.startTime));
          next.invalidate();
        });
        try {
          observer.observe({
            type,
            buffered: true,
            ...(type === "event" ? { durationThreshold: 16 } : {}),
          });
          if (type === "layout-shift" && !Number.isFinite(cls)) cls = 0;
        } catch {
          available.delete(type);
          observer.disconnect();
          return;
        }
        next.signal.addEventListener(
          "abort",
          () => {
            observer.disconnect();
          },
          { once: true },
        );
      };
      observe("largest-contentful-paint", (entries) => {
        for (const entry of entries) {
          lcp = entry.startTime;
          series.push(next.now(), lcp);
        }
      });
      observe("layout-shift", (entries) => {
        for (const entry of entries as Shift[]) {
          if (entry.hadRecentInput) continue;
          if (entry.startTime - lastShift >= 1000 || entry.startTime - sessionStart >= 5000) {
            sessionStart = entry.startTime;
            sessionValue = 0;
          }
          lastShift = entry.startTime;
          sessionValue += entry.value;
          cls = Math.max(Number.isFinite(cls) ? cls : 0, sessionValue);
        }
      });
      observe("event", (entries) => {
        for (const entry of entries as Interaction[]) {
          if (!entry.interactionId) continue;
          interactions.set(
            entry.interactionId,
            Math.max(interactions.get(entry.interactionId) ?? 0, entry.duration),
          );
          if (interactions.size > 10) {
            const smallest = [...interactions].sort((a, b) => a[1] - b[1])[0]!;
            interactions.delete(smallest[0]);
          }
        }
        const durations = [...interactions.values()].sort((a, b) => b - a);
        const count = Math.max(
          0,
          ((performance as Performance & { interactionCount?: number }).interactionCount ?? 0) -
            interactionBaseline,
        );
        inp = durations[Math.min(Math.floor(count / 50), durations.length - 1)] ?? Number.NaN;
      });
    },
    read() {
      return {
        id: collector.id,
        label: "LCP",
        title: "Web vitals",
        status:
          !supported || !available.has("largest-contentful-paint")
            ? "unsupported"
            : Number.isFinite(lcp)
              ? "ok"
              : "pending",
        severity: severityFor(lcp, { warn: 2500, bad: 4000 }),
        display: formatMs(lcp),
        value: lcp,
        unit: "ms",
        hint: "Live page estimates: LCP on the chip; CLS, INP and TTFB below. No attribution or bfcache handling.",
        detail: [
          ["LCP", formatMs(lcp)],
          ["CLS", Number.isFinite(cls) ? cls.toFixed(3) : "NA"],
          ["INP estimate", formatMs(inp)],
          ["TTFB", formatMs(ttfb)],
        ],
      };
    },
    reset() {
      lcp = inp = Number.NaN;
      cls = available.has("layout-shift") ? 0 : Number.NaN;
      sessionStart = Number.NEGATIVE_INFINITY;
      lastShift = sessionValue = 0;
      interactions.clear();
      if (context) {
        for (const type of available) cutoffs.set(type, context.now());
      }
      interactionBaseline =
        (performance as Performance & { interactionCount?: number }).interactionCount ?? 0;
      series.clear();
    },
    diagnostics() {
      return { lcp: finite(lcp), cls: finite(cls), inp: finite(inp), ttfb: finite(ttfb) };
    },
  };
  return collector;
}
