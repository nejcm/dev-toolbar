/**
 * `@nejcm/dev-toolbar/ext/metrics`
 *
 * Memory, delay, jank and network, per `plans/dev-bar.md` §3D. Imports only
 * types from `src/core/*` (no runtime values), keeping this a genuinely
 * external consumer of the public extension contract.
 *
 * ```tsx
 * import { metrics } from "@nejcm/dev-toolbar/ext/metrics";
 *
 * // Build it ONCE, outside render — rebuilding it every render throws away
 * // every sample.
 * const extensions = [metrics()];
 *
 * <DevToolbar extensions={extensions}><App /></DevToolbar>
 * ```
 */
import { createMemoryCollector } from "./collectors/memory";
import { createDelayCollector } from "./collectors/delay";
import { createJankCollector } from "./collectors/jank";
import { createNetworkCollector } from "./collectors/network";
import { writeClipboardTextOrThrow } from "../../runtime";
import { createMetricsRuntime } from "./runtime";
import { MetricsChips, MetricsPanel } from "./ui";
import { METRIC_IDS, isMetricId } from "./types";
import { resolveStyleNonce } from "@nejcm/dev-toolbar/kit";
import type { Collector, CollectorId, MetricId } from "./types";
import type { MemoryCollectorOptions } from "./collectors/memory";
import type { DelayCollectorOptions } from "./collectors/delay";
import type { JankCollectorOptions } from "./collectors/jank";
import type { NetworkCollectorOptions } from "./collectors/network";
import type { DevToolbarExtension, ExtensionRuntimeApi, ToolbarAlign } from "../../core/contract";

export interface MetricsOptions {
  /** Extension id. Change it to mount two independent metric groups. Default `"metrics"`. */
  id?: string;
  /** Bar label, used by the error chip and the panel's accessible name. Default `"Metrics"`. */
  label?: string;
  align?: ToolbarAlign;
  order?: number;
  priority?: number;
  hidden?: boolean;
  /** Which metrics to run, in bar order. Default: all four, then custom collectors. */
  only?: readonly CollectorId[];
  /** Consumer-owned collectors, appended in registration order unless `only` is set. */
  collectors?: readonly Collector[];
  /** Aggregation rate. Default `2` Hz; §5 caps compact updates at 4. */
  updateHz?: number;
  /**
   * Inject this extension's stylesheet. Default `true`. Core's `injectStyles`
   * prop isn't visible to extensions, so if you turned that off, turn this
   * off too and ship `METRICS_CSS` yourself.
   */
  injectStyles?: boolean;
  /**
   * CSP nonce for this extension's stylesheet. Wins over the `styleNonce`
   * slot prop core forwards from `<DevToolbar>`.
   */
  styleNonce?: string;
  /** `false` switches a metric off entirely; an object configures it. */
  memory?: boolean | MemoryCollectorOptions;
  delay?: boolean | DelayCollectorOptions;
  jank?: boolean | JankCollectorOptions;
  network?: boolean | NetworkCollectorOptions;
}

function optionsFor<T extends object>(value: boolean | T | undefined): T | null {
  if (value === false) return null;
  if (value === true || value === undefined) return {} as T;
  return value;
}

/** Builds the extension. Call it once — the returned object owns the collectors, ring buffers and store. */
export function metrics(options: MetricsOptions = {}): DevToolbarExtension {
  const {
    id = "metrics",
    label = "Metrics",
    align = "start",
    order = 0,
    priority = 0,
    hidden,
    collectors: customCollectors = [],
    only = [...METRIC_IDS, ...customCollectors.map((collector) => collector.id)],
    updateHz = 2,
    injectStyles = true,
    styleNonce: optionNonce,
  } = options;

  const custom = new Map<CollectorId, Collector>();
  for (const collector of customCollectors) {
    if (!/^[A-Za-z0-9_-]+$/.test(collector.id)) {
      throw new Error(`[dev-toolbar/ext/metrics] Invalid collector id "${collector.id}".`);
    }
    if (isMetricId(collector.id)) {
      throw new Error(`[dev-toolbar/ext/metrics] Collector "${collector.id}" shadows a built-in.`);
    }
    if (custom.has(collector.id)) {
      throw new Error(`[dev-toolbar/ext/metrics] Duplicate collector id "${collector.id}".`);
    }
    custom.set(collector.id, collector);
  }

  const build: Record<MetricId, () => Collector | null> = {
    memory: () => {
      const config = optionsFor(options.memory);
      return config === null ? null : createMemoryCollector(config);
    },
    delay: () => {
      const config = optionsFor(options.delay);
      return config === null ? null : createDelayCollector(config);
    },
    jank: () => {
      const config = optionsFor(options.jank);
      return config === null ? null : createJankCollector(config);
    },
    network: () => {
      const config = optionsFor(options.network);
      return config === null ? null : createNetworkCollector(config);
    },
  };

  const collectors: Collector[] = [];
  for (const metricId of only) {
    if (!isMetricId(metricId) && !custom.has(metricId)) {
      throw new Error(`[dev-toolbar/ext/metrics] Unknown collector "${metricId}" in only.`);
    }
    if (collectors.some((collector) => collector.id === metricId)) continue;
    const collector = isMetricId(metricId) ? build[metricId]() : custom.get(metricId);
    if (collector) collectors.push(collector);
  }

  // Built here, not in start(api): slot functions run before any effect fires.
  const runtime = createMetricsRuntime({ collectors, updateHz });

  return {
    id,
    label,
    contractVersion: 2,
    align,
    order,
    priority,
    ...(hidden === undefined ? {} : { hidden }),

    start(api: ExtensionRuntimeApi) {
      return runtime.start(api);
    },

    compact: ({ isOverflowed, isPanelOpen, togglePanel, styleNonce }) => (
      <MetricsChips
        runtime={runtime}
        isOverflowed={isOverflowed}
        isPanelOpen={isPanelOpen}
        injectStyles={injectStyles}
        styleNonce={resolveStyleNonce(optionNonce, styleNonce)}
        onToggle={togglePanel}
      />
    ),

    /** The redacted collector dump, for `/ext/diagnostics`. Same builder `metrics.copy` uses. */
    diagnostics: () => runtime.diagnostics(),

    panel: ({ styleNonce }) => (
      <MetricsPanel
        runtime={runtime}
        injectStyles={injectStyles}
        styleNonce={resolveStyleNonce(optionNonce, styleNonce)}
      />
    ),

    commands: [
      {
        id: `${id}.reset`,
        label: "Reset performance metrics",
        group: "Metrics",
        keywords: ["clear", "performance", "memory", "jank"],
        run: () => runtime.reset(),
      },
      {
        id: `${id}.copy`,
        label: "Copy performance diagnostics",
        group: "Metrics",
        keywords: ["diagnostics", "clipboard", "report"],
        // Throws when the write fails, so the palette can report it.
        run: async () => {
          await writeClipboardTextOrThrow(JSON.stringify(runtime.diagnostics(), null, 2));
        },
      },
    ],
  };
}

export { METRICS_CSS, ensureMetricsStyles } from "./css";
export { createMetricsRuntime } from "./runtime";
export type { MetricsRuntime, MetricsRuntimeOptions } from "./runtime";
export { createDelayCollector, supportsEventTiming } from "./collectors/delay";
export { createJankCollector } from "./collectors/jank";
export { createMemoryCollector, readPerformanceMemory } from "./collectors/memory";
export { createNetworkCollector, instrumentFetch, instrumentXhr } from "./collectors/network";
export type { DelayCollectorOptions, InteractionRecord } from "./collectors/delay";
export type { JankCollectorOptions } from "./collectors/jank";
export type { MemoryCollectorOptions } from "./collectors/memory";
export type { NetworkCollectorOptions, NetworkEntry, NetworkSink } from "./collectors/network";
export { METRIC_IDS, severityFor } from "./types";
export type {
  Collector,
  CollectorContext,
  CollectorId,
  MetricId,
  MetricStatus,
  MetricView,
  MetricsSnapshot,
  NetworkEntryView,
  Severity,
  Thresholds,
} from "./types";
export { formatBytes, formatCount, formatMs, formatPercent, NOT_AVAILABLE } from "./format";
