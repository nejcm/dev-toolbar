import type { ProfilerOnRenderCallback } from "react";
import type { Collector, CollectorContext } from "@nejcm/dev-toolbar/ext/metrics";
import { formatMs, severityFor } from "@nejcm/dev-toolbar/ext/metrics";
import { createTimeSeries } from "@nejcm/dev-toolbar/runtime";

export function createReactProfilerCollector() {
  const series = createTimeSeries(120);
  const baseDuration = createTimeSeries(120);
  let context: CollectorContext | undefined;
  let recording = true;
  const onRender: ProfilerOnRenderCallback = (
    _id,
    _phase,
    actual,
    base,
    _startTime,
    commitTime,
  ) => {
    if (!recording) return;
    series.push(commitTime, actual);
    baseDuration.push(commitTime, base);
    context?.invalidate();
  };
  const collector: Collector = {
    id: "react-profiler",
    estimatedCost: "moderate",
    supported: true,
    series,
    start(next) {
      context = next;
      recording = !next.signal.aborted;
      next.signal.addEventListener(
        "abort",
        () => {
          recording = false;
          context = undefined;
        },
        { once: true },
      );
    },
    read() {
      const value = series.last();
      return {
        id: collector.id,
        label: "react",
        title: "React Profiler",
        status: series.size ? "ok" : "pending",
        severity: severityFor(value, { warn: 16, bad: 50 }),
        display: formatMs(value),
        value,
        unit: "ms",
        hint: "Latest commit in the wrapped app tree. Requires a React profiling build in production.",
        detail: [
          ["Actual duration", formatMs(value)],
          ["Base duration", formatMs(baseDuration.last())],
          ["Commits", String(series.times.written)],
        ],
      };
    },
    reset() {
      series.clear();
      baseDuration.clear();
    },
    diagnostics() {
      return {
        commits: Array.from({ length: series.size }, (_, index) => ({
          at: series.times.at(index),
          actualDuration: series.values.at(index),
          baseDuration: baseDuration.values.at(index),
        })),
      };
    },
  };
  return { collector, onRender };
}
