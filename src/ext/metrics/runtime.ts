/**
 * Everything the metrics extension owns that is not React.
 * [dev-toolbar/ext/metrics]
 *
 * Collectors write raw samples into ring buffers as fast as the platform hands
 * them over. A ticker aggregates on a slow interval and writes a snapshot into
 * a `createThrottledStore`, which the bar subscribes to — so a 60 Hz rAF loop
 * moves a chip at most `updateHz` times a second, per the §5 budget.
 *
 * Constructed by `metrics()`, not by `start(api)`: slot functions run during
 * the toolbar's first render, before any effect (and therefore before
 * `start(api)`), so anything a chip reads must exist by the time the factory
 * returns.
 */
import { createThrottledStore, redact, redactUrl } from "../../runtime";
import type { ThrottledStore } from "../../runtime";
import type { ExtensionRuntimeApi, ToolbarStorage } from "../../core/contract";
import { isMetricId, metricView } from "./types";
import type { Collector, CollectorId, MetricView, MetricsSnapshot } from "./types";

export interface MetricsRuntimeOptions {
  collectors: readonly Collector[];
  /** Aggregation ticks per second. Default `2`; §5 caps compact updates at 4. */
  updateHz?: number;
}

export interface MetricsRuntime {
  readonly store: ThrottledStore<MetricsSnapshot>;
  readonly collectors: readonly Collector[];
  readonly order: readonly CollectorId[];
  /** `null` until `start(api)` runs. */
  storage(): ToolbarStorage | null;
  start(api: ExtensionRuntimeApi): () => void;
  reset(): void;
  diagnostics(): unknown;
  /** Rebuilds and publishes now. Used by tests and by the panel's Reset. */
  flush(): void;
}

const now = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

function emptyView(id: CollectorId): MetricView {
  return {
    id,
    label: id,
    title: id,
    status: "unsupported",
    severity: "unknown",
    display: "NA",
    value: Number.NaN,
    unit: "",
    hint: "This metric is switched off.",
    detail: [],
  };
}

/** Cheap equality on what is actually painted, so an idle page publishes nothing. */
function signature(snapshot: MetricsSnapshot): string {
  let out = `${snapshot.seriesWritten}|`;
  for (const id of snapshot.order) {
    const view = metricView(snapshot, id);
    out += isMetricId(id)
      ? `${id}:${view.status}:${view.severity}:${view.display};`
      : JSON.stringify(view);
  }
  out += `#${snapshot.requests.length}:${snapshot.requests[0]?.id ?? ""}:${
    snapshot.requests[0]?.state ?? ""
  }`;
  return out;
}

export function createMetricsRuntime(options: MetricsRuntimeOptions): MetricsRuntime {
  const { collectors, updateHz = 2 } = options;
  const order = collectors.map((collector) => collector.id);
  const tickMs = Math.max(100, Math.round(1000 / Math.max(0.5, updateHz)));

  let revision = 0;
  let storage: ToolbarStorage | null = null;
  let dirty = false;

  const build = (): MetricsSnapshot => {
    const at = now();
    const views: Record<keyof MetricsSnapshot["views"], MetricView> = {
      memory: emptyView("memory"),
      delay: emptyView("delay"),
      jank: emptyView("jank"),
      network: emptyView("network"),
    };
    const custom: Record<string, MetricView> = Object.create(null);
    let seriesWritten = 0;
    let requests: MetricsSnapshot["requests"] = [];
    for (const collector of collectors) {
      const view = collector.read(at);
      if (isMetricId(collector.id)) views[collector.id] = view;
      else custom[collector.id] = view;
      seriesWritten += collector.series.times.written;
      if (collector.entries) requests = collector.entries(at);
    }
    revision += 1;
    return { revision, at, order, views, custom, requests, seriesWritten };
  };

  const store = createThrottledStore<MetricsSnapshot>(build(), {
    intervalMs: tickMs,
    equals: (a, b) => signature(a) === signature(b),
  });

  const publish = () => store.set(build());

  /**
   * Collectors call this from a `fetch` wrapper or observer callback, possibly
   * hundreds of times per tick, so calls are folded into one microtask; the
   * store then throttles the notification on top of that.
   */
  const invalidate = () => {
    if (dirty) return;
    dirty = true;
    queueMicrotask(() => {
      dirty = false;
      publish();
    });
  };

  return {
    store,
    collectors,
    order,
    storage: () => storage,
    start(api: ExtensionRuntimeApi) {
      storage = api.storage;
      const context = { signal: api.signal, now, invalidate };

      for (const collector of collectors) {
        if (!collector.supported) continue;
        try {
          collector.start(context);
        } catch (error) {
          // A failing collector must not take the others, or start(api), down.
          // eslint-disable-next-line no-console
          console.error(
            `[dev-toolbar/ext/metrics] the "${collector.id}" collector threw from start().`,
            error,
          );
        }
      }

      const timer = setInterval(publish, tickMs);
      publish();

      // Core reports visibility but never pauses us. Only aggregation stops:
      // collectors keep filling buffers, and rolling windows stay honest since
      // they're computed from timestamps rather than accumulated per tick.
      const stopWatching = api.subscribeVisibility(() => {
        publish();
      });

      // The store belongs to the runtime, not one start/stop cycle, so it is
      // deliberately NOT destroyed here. React StrictMode's mount → cleanup →
      // mount would otherwise drop React's subscription on the first cleanup,
      // freezing the chips while collectors kept collecting.
      const dispose = () => {
        clearInterval(timer);
        stopWatching();
      };
      api.signal.addEventListener("abort", dispose, { once: true });
      return dispose;
    },
    reset() {
      for (const collector of collectors) collector.reset();
      publish();
      store.flush();
    },
    diagnostics() {
      const at = now();
      const latest = store.peek();
      const payload: Record<string, unknown> = {
        generatedAt: new Date().toISOString(),
        userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
        // Explicit redactUrl, not left to `redact()`: the page URL is the most
        // likely credential carrier here (e.g. an OAuth `?access_token=…`
        // callback), and this is headed for a clipboard.
        url: typeof location === "undefined" ? null : redactUrl(location.href),
        /**
         * Numeric values, not formatted chip text (`plans/agent-readable-toolbar.md`
         * § Phase 1). Read from the last published snapshot because diagnostics
         * runs on every roster read.
         */
        metrics: latest.order.map((id) => {
          const view = metricView(latest, id);
          return {
            id,
            status: view.status,
            severity: view.severity,
            // Keep the in-memory and JSON shapes aligned.
            value: Number.isFinite(view.value) ? view.value : null,
            unit: view.unit,
          };
        }),
      };
      const custom: Record<string, unknown> = Object.create(null);
      for (const collector of collectors) {
        if (isMetricId(collector.id)) payload[collector.id] = collector.diagnostics(at);
        else custom[collector.id] = collector.diagnostics(at);
      }
      if (Object.keys(custom).length > 0) payload.custom = custom;
      // Catch credential-shaped values added to the payload above.
      return redact(payload);
    },
    flush() {
      publish();
      store.flush();
    },
  };
}
