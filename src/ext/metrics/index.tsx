/**
 * `@nejcm/dev-toolbar/ext/metrics`
 *
 * Memory, delay, jank and network, per `plans/dev-bar.md` §3D. Written strictly
 * as a consumer of the public extension contract: nothing here imports a value
 * from `src/core/*` — only types, which erase at build time. That is deliberate.
 * If this extension needed a runtime import from core, so would every other
 * extension, and the two would have to be resolved to the same module instance
 * to share React context. Types-only keeps `/ext/metrics` a genuinely external
 * consumer of the same contract a stranger's package would use.
 *
 * ```tsx
 * import { metrics } from "@nejcm/dev-toolbar/ext/metrics";
 *
 * // Build it ONCE, outside render. The object identity is the extension's
 * // lifecycle: rebuilding it every render throws away every sample.
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
import { METRIC_IDS } from "./types";
import type { Collector, MetricId } from "./types";
import type { MemoryCollectorOptions } from "./collectors/memory";
import type { DelayCollectorOptions } from "./collectors/delay";
import type { JankCollectorOptions } from "./collectors/jank";
import type { NetworkCollectorOptions } from "./collectors/network";
import type {
  DevToolbarExtension,
  ExtensionRuntimeApi,
  ToolbarAlign,
} from "../../core/contract";

export interface MetricsOptions {
  /** Extension id. Change it to mount two independent metric groups. Default `"metrics"`. */
  id?: string;
  /** Bar label, used by the error chip and the panel's accessible name. Default `"Metrics"`. */
  label?: string;
  align?: ToolbarAlign;
  order?: number;
  priority?: number;
  hidden?: boolean;
  /** Which metrics to run, in bar order. Default: all four. */
  only?: readonly MetricId[];
  /** Aggregation rate. Default `2` Hz; §5 caps compact updates at 4. */
  updateHz?: number;
  /**
   * Inject this extension's stylesheet. Default `true`.
   *
   * Core's own `injectStyles` prop is not visible to extensions, so if you
   * turned that off you must turn this off too and ship `METRICS_CSS` yourself.
   */
  injectStyles?: boolean;
  /** `false` switches a metric off entirely; an object configures it. */
  memory?: boolean | MemoryCollectorOptions;
  delay?: boolean | DelayCollectorOptions;
  jank?: boolean | JankCollectorOptions;
  network?: boolean | NetworkCollectorOptions;
}

function optionsFor<T extends object>(
  value: boolean | T | undefined,
): T | null {
  if (value === false) return null;
  if (value === true || value === undefined) return {} as T;
  return value;
}

/**
 * Builds the extension. Call it once — the returned object owns the collectors,
 * the ring buffers and the store.
 */
export function metrics(options: MetricsOptions = {}): DevToolbarExtension {
  const {
    id = "metrics",
    label = "Metrics",
    align = "start",
    order = 0,
    priority = 0,
    hidden,
    only = METRIC_IDS,
    updateHz = 2,
    injectStyles = true,
  } = options;

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
    const collector = build[metricId]?.();
    if (collector) collectors.push(collector);
  }

  // Built here, not in start(api): slot functions run during the toolbar's
  // first render, which is before any effect fires.
  const runtime = createMetricsRuntime({ collectors, updateHz });

  return {
    id,
    label,
    contractVersion: 1,
    align,
    order,
    priority,
    ...(hidden === undefined ? {} : { hidden }),

    start(api: ExtensionRuntimeApi) {
      return runtime.start(api);
    },

    compact: ({ isOverflowed, isPanelOpen, togglePanel }) => (
      <MetricsChips
        runtime={runtime}
        isOverflowed={isOverflowed}
        isPanelOpen={isPanelOpen}
        injectStyles={injectStyles}
        onToggle={togglePanel}
      />
    ),

    /**
     * The redacted collector dump, for `/ext/diagnostics` — **P3**. The same
     * builder `metrics.copy` uses; every request URL is already masked on the
     * way into the ring and the whole payload goes through `redact()` again.
     */
    diagnostics: () => runtime.diagnostics(),

    panel: () => <MetricsPanel runtime={runtime} injectStyles={injectStyles} />,

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
        // Through `/runtime`, which throws when the write did not happen —
        // the palette reports a throw and closes over a resolve (§13.4), so
        // the old optional-chained call silently did nothing and looked fine.
        run: async () => {
          await writeClipboardTextOrThrow(
            JSON.stringify(runtime.diagnostics(), null, 2),
          );
        },
      },
    ],
  };
}

export { METRICS_CSS, ensureMetricsStyles } from "./css";
export { createMetricsRuntime } from "./runtime";
export type { MetricsRuntime, MetricsRuntimeOptions } from "./runtime";
export {
  createDelayCollector,
  supportsEventTiming,
} from "./collectors/delay";
export { createJankCollector } from "./collectors/jank";
export {
  createMemoryCollector,
  readPerformanceMemory,
} from "./collectors/memory";
export {
  createNetworkCollector,
  instrumentFetch,
  instrumentXhr,
} from "./collectors/network";
export type { DelayCollectorOptions, InteractionRecord } from "./collectors/delay";
export type { JankCollectorOptions } from "./collectors/jank";
export type { MemoryCollectorOptions } from "./collectors/memory";
export type {
  NetworkCollectorOptions,
  NetworkEntry,
  NetworkSink,
} from "./collectors/network";
export { METRIC_IDS, severityFor } from "./types";
export type {
  Collector,
  CollectorContext,
  MetricId,
  MetricStatus,
  MetricView,
  MetricsSnapshot,
  NetworkEntryView,
  Severity,
  Thresholds,
} from "./types";
export {
  formatBytes,
  formatCount,
  formatMs,
  formatPercent,
  NOT_AVAILABLE,
} from "./format";
