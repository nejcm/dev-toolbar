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
import { formatCurl } from "./curl";
import { writeClipboardTextOrThrow } from "../../runtime";
import { createMetricsRuntime } from "./runtime";
import { MetricsChips, MetricsPanel } from "./ui";
import { METRIC_IDS, isMetricId } from "./types";
import { resolvePresentation, resolveStyleNonce } from "@nejcm/dev-toolbar/kit";
import type { CompactPresentationInput } from "@nejcm/dev-toolbar/kit";
import type { Collector, CollectorId, MetricId, MetricView } from "./types";
import type { MemoryCollectorOptions } from "./collectors/memory";
import type { DelayCollectorOptions } from "./collectors/delay";
import type { JankCollectorOptions } from "./collectors/jank";
import type { NetworkCollector, NetworkCollectorOptions } from "./collectors/network";
import type {
  AnyToolbarCommand,
  DevToolbarExtension,
  ExtensionRuntimeApi,
  ToolbarAlign,
  ToolbarCommand,
} from "../../core/contract";
import type { NetworkEntryView, NetworkExport } from "./types";

export interface MetricsOptions {
  /** Extension id. Change it to mount two independent metric groups. Default `"metrics"`. */
  id?: string;
  /**
   * Bar label, used by the error chip, the bar trigger's accessible name and
   * the panel's accessible name. Default `"Metrics"`.
   */
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
  /**
   * How the bar control presents itself: a preset, your own icon, a render
   * callback and an accessible-name override. A bare preset is the shorthand —
   * `presentation: "icon-value"`.
   *
   * The callback knobs are invoked **once per metric per render**, in bar
   * order, in the bar and in the `⋮` menu alike, and the `MetricView` they
   * receive says which metric it is: `icon: (m) => ICONS[m.id]` needs no icon
   * map. `render` supplies the children of the element carrying that metric's
   * `data-dtb-metric` — the chip in the bar, the row `<button>` in the menu —
   * so the state attributes and `title` stay the extension's; returning
   * `undefined` falls through to the preset. `name` overrides the `aria-label`
   * and is invoked with the first metric in bar order, since one trigger names
   * the whole readout; a whitespace-only return is ignored. Return something
   * that does not change with the metric's *value*: the `MetricView` carries
   * `display`, so `(m) => \`Memory ${m.display}\`` renames the control on every
   * publish and a screen reader re-announces it — the churn the comment on the
   * trigger's `aria-label` in `ui.tsx` exists to avoid.
   *
   * Nothing here reaches the store: the icon and the callbacks are held in this
   * closure and passed as props, because a `ReactNode` cannot be signed and the
   * metrics store republishes on a signature change.
   *
   * `docs/adr/ADR-004-per-extension-bar-presentation.md`.
   */
  presentation?: CompactPresentationInput<MetricView>;
  /** `false` switches a metric off entirely; an object configures it. */
  memory?: boolean | MemoryCollectorOptions;
  delay?: boolean | DelayCollectorOptions;
  jank?: boolean | JankCollectorOptions;
  network?: boolean | NetworkCollectorOptions;
}

// Matches `redact()`'s own array cutoff (docs/ext/metrics.md), so an unbounded
// export doesn't reach an agent truncated with a `count` that disagrees with it.
const EXPORT_MAX_REQUESTS = 200;

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

  // Resolved once, here, rather than per render: this is the closure the icon
  // and the callbacks live in, exactly as `label` and `injectStyles` do.
  const presentation = resolvePresentation(options.presentation);

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

  let networkCollector: NetworkCollector | null = null;

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
      if (config === null) return null;
      // Kept so the `network.*` commands below can reach the one collector
      // that owns the request tail.
      networkCollector = createNetworkCollector(config);
      return networkCollector;
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

  // Contributed only while the network collector is running: an always-listed
  // command that always throws is worse than an absent one.
  const networkCommands = (network: NetworkCollector): AnyToolbarCommand[] => {
    const requestFor = (requestId: string | undefined): NetworkEntryView => {
      const { requests } = runtime.exportRequests();
      const found =
        requestId === undefined
          ? requests[0]
          : requests.find((request) => request.id === requestId);
      if (found === undefined) {
        throw new Error(
          requestId === undefined
            ? "No request has been recorded yet."
            : `No retained request has id "${requestId}". Ids come from ${id}.network.export.`,
        );
      }
      return found;
    };

    const exportCommand: ToolbarCommand<{ limit?: number; copy?: boolean } | void, NetworkExport> =
      {
        id: `${id}.network.export`,
        label: "Export recent requests",
        description:
          "Returns the retained request tail as JSON — method, URL, status, duration, " +
          "size, state and error per request, newest first — drawn from the same " +
          "entries the network panel lists, in the same order and already through " +
          "`redactUrl()` (the panel shows the newest 30 of them). No raw header " +
          "value and no body is captured — `bytes` is a number a recorder " +
          "reported, not header text — so neither can appear here. At most 200 requests come " +
          "back per call: `count` is always `requests.length`, `retained` is how many " +
          "the collector holds (100 by default), and `truncated` is true when older " +
          "retained requests were left out — there is no paging past them. Omit " +
          "`limit` for the newest 200; pass `copy: true` to also put the JSON on the " +
          "clipboard for a bug report, which throws if the clipboard is unavailable.",
        group: "Metrics",
        keywords: ["network", "requests", "export", "json", "har", "report"],
        input: {
          fields: {
            limit: {
              type: "number",
              description: "Keep only the newest N requests. Omit for the newest 200, the cap.",
            },
            copy: {
              type: "boolean",
              default: false,
              description: "Also write the JSON to the clipboard.",
            },
          },
        },
        run: async (input) => {
          const { limit, copy } = input ?? {};
          if (limit !== undefined && (typeof limit !== "number" || !Number.isFinite(limit))) {
            throw new Error("`limit` must be a finite number.");
          }
          const payload = runtime.exportRequests(
            limit === undefined ? EXPORT_MAX_REQUESTS : Math.min(limit, EXPORT_MAX_REQUESTS),
          );
          if (copy === true) {
            await writeClipboardTextOrThrow(
              JSON.stringify(payload, null, 2),
              "The same payload is this command's return value.",
            );
          }
          return payload;
        },
      };

    const copyAsCurlCommand: ToolbarCommand<{ id?: string; copy?: boolean } | void, string> = {
      id: `${id}.network.copyAsCurl`,
      label: "Copy request as curl",
      description:
        "Renders one retained request as a `curl` line and copies it: the request " +
        "whose `id` you pass, or the most recent one. Method and URL only — no raw " +
        "header value, body or cookie is captured anywhere in this extension, so the " +
        "line identifies a request rather than replaying it. The URL is the " +
        "normalised, redacted request — parsed the way the browser parses it, so " +
        "the line runs where the recorded string would not, then masked again on " +
        "the way out so `user:pass@` userinfo and credential-shaped query " +
        "parameters cannot reach the clipboard. One limit: a hostname holding any " +
        "of ``!\"$&'()*+,;=`{}`` parses in a browser but not in curl, which " +
        "answers `URL rejected: Bad hostname` — such a host resolves nowhere " +
        "either way. Returns the line; pass " +
        "`copy: false` to skip the clipboard entirely.",
      group: "Metrics",
      keywords: ["network", "curl", "copy", "request", "clipboard", "repro"],
      input: {
        fields: {
          id: {
            type: "string",
            description: `A request id from ${id}.network.export. Omit for the most recent request.`,
          },
          copy: {
            type: "boolean",
            default: true,
            description: "Write the line to the clipboard. `false` only returns it.",
          },
        },
      },
      run: async (input) => {
        const { id: requestId, copy } = input ?? {};
        if (requestId !== undefined && typeof requestId !== "string") {
          throw new Error("`id` must be a string.");
        }
        const request = requestFor(requestId);
        const command = formatCurl(request, { redact: network.redactOptions });
        if (copy !== false) {
          await writeClipboardTextOrThrow(
            command,
            "The line is this command's return value; copy it from there.",
          );
        }
        return command;
      },
    };

    const clearCommand: ToolbarCommand<void, void> = {
      id: `${id}.network.clear`,
      label: "Clear recorded requests",
      description:
        "Drops every retained request and the network counters. Only the network " +
        `collector — the other metrics keep their history; ${id}.reset clears those too.`,
      group: "Metrics",
      keywords: ["network", "clear", "requests", "reset"],
      run: () => {
        network.reset();
        runtime.flush();
      },
    };

    const pauseCommand: ToolbarCommand<{ paused?: boolean } | void, { paused: boolean }> = {
      id: `${id}.network.pause`,
      label: "Pause or resume request recording",
      description:
        "Stops recording new requests. Omit `paused` to toggle. Already-retained " +
        "requests stay readable and exportable while paused, and the chip reads " +
        "`paused` so the state is never a secret. The `fetch`/`XMLHttpRequest` " +
        "wrapper stays installed: it is shared with everything else observing " +
        "requests, so pausing one recorder must not unpatch it for the rest.",
      group: "Metrics",
      keywords: ["network", "pause", "resume", "record", "freeze"],
      input: {
        fields: {
          paused: {
            type: "boolean",
            description: "`true` pauses, `false` resumes. Omit to toggle the current state.",
          },
        },
      },
      run: (input) => {
        const next = input?.paused;
        if (next !== undefined && typeof next !== "boolean") {
          throw new Error("`paused` must be a boolean, or omitted to toggle.");
        }
        const paused = network.setPaused(next ?? !network.isPaused());
        runtime.flush();
        return { paused };
      },
    };

    return [exportCommand, copyAsCurlCommand, clearCommand, pauseCommand];
  };

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
        label={label}
        presentation={presentation}
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
      ...(networkCollector === null ? [] : networkCommands(networkCollector)),
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
export type {
  NetworkCollector,
  NetworkCollectorOptions,
  NetworkEntry,
  NetworkSink,
  NetworkSinkResult,
} from "./collectors/network";
export { formatCurl } from "./curl";
export type { CurlOptions } from "./curl";
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
  NetworkExport,
  Severity,
  Thresholds,
} from "./types";
export { formatBytes, formatCount, formatMs, formatPercent, NOT_AVAILABLE } from "./format";
