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
import { createThrottledStore, redact, redactUrl, snapshotEquals } from "../../runtime";
import { readPreference, writePreference } from "@nejcm/dev-toolbar/kit";
import type { Preference } from "@nejcm/dev-toolbar/kit";
import type { ThrottledStore } from "../../runtime";
import type { ExtensionRuntimeApi, ToolbarStorage } from "../../core/contract";
import { isMetricId, metricView } from "./types";
import type { Collector, CollectorId, MetricView, MetricsSnapshot, NetworkExport } from "./types";

export interface MetricsRuntimeOptions {
  collectors: readonly Collector[];
  /** Aggregation ticks per second. Default `2`; §5 caps compact updates at 4. */
  updateHz?: number;
}

export interface MetricsRuntime {
  readonly store: ThrottledStore<MetricsSnapshot>;
  readonly collectors: readonly Collector[];
  readonly order: readonly CollectorId[];
  /**
   * `null` until `start(api)` runs.
   *
   * @deprecated Nothing in the package reads it any more: every persisted
   * preference goes through `readPreference`/`writePreference` from
   * `@nejcm/dev-toolbar/kit`, which guard the adapter for you. Use those with
   * `api.storage` instead. Removal is a published-API change and waits for the
   * next major.
   */
  storage(): ToolbarStorage | null;
  /**
   * The persisted panel tab, fail-safe: `null` when nothing valid is stored or
   * the adapter throws. Only an id in `order` is returned.
   */
  readTab(): CollectorId | null;
  /** Persists the panel tab; a throwing adapter costs the preference, not the panel. */
  writeTab(id: CollectorId): void;
  start(api: ExtensionRuntimeApi): () => void;
  reset(): void;
  diagnostics(): unknown;
  /**
   * The redacted request tail, for `network.export` and for a bug report.
   * Returns the same `requests` array `store.getSnapshot()` holds, not a
   * second mapping, so an agent and the panel can never disagree about
   * redaction, ordering or shape.
   */
  exportRequests(limit?: number): NetworkExport;
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

const TAB_KEY = "tab";

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
    // Per-build counters; nothing renders them. Anchored: a collector may be called `revision`.
    equals: snapshotEquals({ ignorePaths: [["revision"], ["at"]] }),
  });

  const publish = () => store.set(build());

  /** Folds bursty collector calls into one microtask; the store throttles on top of that. */
  const invalidate = () => {
    if (dirty) return;
    dirty = true;
    queueMicrotask(() => {
      dirty = false;
      publish();
    });
  };

  // The stored value is the raw id, not JSON: a consumer's persisted tab from
  // before this moved behind the runtime must still read back.
  const tab: Preference<CollectorId | null> = {
    key: TAB_KEY,
    encoding: "string",
    fallback: null,
    isValue: (value): value is CollectorId => typeof value === "string" && order.includes(value),
  };
  const readTab = (): CollectorId | null => readPreference(storage, tab);
  const writeTab = (id: CollectorId): void => writePreference(storage, tab, id);

  return {
    store,
    collectors,
    order,
    storage: () => storage,
    readTab,
    writeTab,
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

      // Core reports visibility but never pauses us; only aggregation stops here.
      const stopWatching = api.subscribeVisibility(() => {
        publish();
      });

      // The store outlives one start/stop cycle, deliberately not destroyed
      // here — StrictMode's mount → cleanup → mount would otherwise drop
      // React's subscription and freeze the chips.
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
    exportRequests(limit?: number) {
      // Not `peek()` alone: a request that landed since the last tick would be
      // missing, and this call wants the tail as it is *now*.
      publish();
      store.flush();
      const snapshot = store.getSnapshot();
      const keep = limit === undefined ? Infinity : Math.max(0, Math.floor(limit));
      // Slice only when the limit bites, so the identity below holds otherwise.
      const requests =
        keep >= snapshot.requests.length ? snapshot.requests : snapshot.requests.slice(0, keep);
      return {
        generatedAt: new Date().toISOString(),
        // The page URL is the likeliest credential carrier here, and this is
        // headed for a clipboard or an agent.
        url: typeof location === "undefined" ? null : redactUrl(location.href),
        count: requests.length,
        retained: snapshot.requests.length,
        truncated: requests.length < snapshot.requests.length,
        requests,
      };
    },
    diagnostics() {
      const at = now();
      const latest = store.peek();
      const payload: Record<string, unknown> = {
        generatedAt: new Date().toISOString(),
        userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
        // Explicit redactUrl, not left to `redact()`: the page URL is the most
        // likely credential carrier here (e.g. an OAuth callback).
        url: typeof location === "undefined" ? null : redactUrl(location.href),
        // Numeric values, not formatted chip text — read from the last
        // published snapshot since diagnostics runs on every roster read.
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
