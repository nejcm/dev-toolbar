/**
 * Everything the metrics extension owns that is not React.
 * [dev-toolbar/ext/metrics]
 *
 * Collectors write raw samples into ring buffers as fast as the platform hands
 * them over. Nothing renders from that. A ticker aggregates on a slow interval
 * and writes a snapshot into a `createThrottledStore`, which is what the bar
 * subscribes to — so a 60 Hz rAF loop moves a chip at most `updateHz` times a
 * second, per the §5 budget.
 *
 * It is constructed by `metrics()`, *not* by `start(api)`. Slot functions run
 * during the toolbar's first render, which is before any effect — and therefore
 * before `start(api)` — so anything a chip reads has to exist by the time the
 * factory returns.
 */
import { createThrottledStore, redact, redactUrl } from "../../runtime";
import type { ThrottledStore } from "../../runtime";
import type { ExtensionRuntimeApi, ToolbarStorage } from "../../core/contract";
import type { Collector, MetricId, MetricView, MetricsSnapshot } from "./types";

export interface MetricsRuntimeOptions {
  collectors: readonly Collector[];
  /** Aggregation ticks per second. Default `2`; §5 caps compact updates at 4. */
  updateHz?: number;
}

export interface MetricsRuntime {
  readonly store: ThrottledStore<MetricsSnapshot>;
  readonly collectors: readonly Collector[];
  readonly order: readonly MetricId[];
  /** `null` until `start(api)` runs. See the note above about render order. */
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

function emptyView(id: MetricId): MetricView {
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
    const view = snapshot.views[id];
    out += `${id}:${view.status}:${view.severity}:${view.display};`;
  }
  out += `#${snapshot.requests.length}:${snapshot.requests[0]?.id ?? ""}:${
    snapshot.requests[0]?.state ?? ""
  }`;
  return out;
}

export function createMetricsRuntime(
  options: MetricsRuntimeOptions,
): MetricsRuntime {
  const { collectors, updateHz = 2 } = options;
  const order = collectors.map((collector) => collector.id);
  const tickMs = Math.max(100, Math.round(1000 / Math.max(0.5, updateHz)));

  let revision = 0;
  let storage: ToolbarStorage | null = null;
  let dirty = false;

  const build = (): MetricsSnapshot => {
    const at = now();
    const views = {} as Record<MetricId, MetricView>;
    let seriesWritten = 0;
    let requests: MetricsSnapshot["requests"] = [];
    for (const id of ["memory", "delay", "jank", "network"] as MetricId[]) {
      views[id] = emptyView(id);
    }
    for (const collector of collectors) {
      views[collector.id] = collector.read(at);
      seriesWritten += collector.series.times.written;
      if (collector.entries) requests = collector.entries(at);
    }
    revision += 1;
    return { revision, at, order, views, requests, seriesWritten };
  };

  const store = createThrottledStore<MetricsSnapshot>(build(), {
    intervalMs: tickMs,
    equals: (a, b) => signature(a) === signature(b),
  });

  const publish = () => store.set(build());

  /**
   * Collectors call this from a `fetch` wrapper or an observer callback, which
   * can happen hundreds of times per tick. Building a snapshot per call would
   * defeat the point, so it is folded into one microtask; the store then throttles
   * the notification on top of that.
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
          // A collector that cannot start must not take the others with it,
          // and must not take down the toolbar's start(api).
          // eslint-disable-next-line no-console
          console.error(
            `[dev-toolbar/ext/metrics] the "${collector.id}" collector threw from start().`,
            error,
          );
        }
      }

      const timer = setInterval(publish, tickMs);
      publish();

      // Core reports visibility and never pauses us — the decision is ours.
      // Aggregation is the only thing that stops: collectors keep filling their
      // buffers, so nothing cumulative is corrupted by a closed bar, and the
      // rolling windows stay honest because they are computed from timestamps
      // rather than accumulated per tick.
      const stopWatching = api.subscribeVisibility(() => {
        publish();
      });

      // The store belongs to the runtime, not to one start/stop cycle, so it
      // is deliberately NOT destroyed here. React StrictMode (and every dev
      // double-invoke) runs mount → cleanup → mount: destroying the store on
      // that first cleanup dropped React's subscription and made every later
      // write a no-op, freezing the chips at their mount-time values while the
      // collectors happily kept collecting. Found in a browser, not in jsdom.
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
      const payload: Record<string, unknown> = {
        generatedAt: new Date().toISOString(),
        userAgent:
          typeof navigator === "undefined" ? null : navigator.userAgent,
        // Explicitly, not by hoping `redact()` recognises it: the page URL is
        // the single most likely credential carrier in the whole dump. An OAuth
        // implicit-flow callback is `?access_token=…` in the address bar, and
        // this is headed for a clipboard and from there usually a ticket.
        url: typeof location === "undefined" ? null : redactUrl(location.href),
      };
      for (const collector of collectors) {
        payload[collector.id] = collector.diagnostics(at);
      }
      // Every request URL was already masked on the way into the ring; this
      // second pass catches credential-shaped values anywhere else in the dump.
      return redact(payload);
    },
    flush() {
      publish();
      store.flush();
    },
  };
}
