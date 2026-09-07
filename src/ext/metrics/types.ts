/**
 * Shared vocabulary for `/ext/metrics`. [dev-toolbar/ext/metrics]
 *
 * Severity lives here, not in core, since "healthy" is app-specific. Every
 * threshold below is a default you are expected to override.
 */
import type { Severity as KitSeverity } from "@nejcm/dev-toolbar/kit";
import type { TimeSeries } from "../../runtime";

export type MetricId = "memory" | "delay" | "jank" | "network";

export type CollectorId = MetricId | (string & {});

export const METRIC_IDS: readonly MetricId[] = ["memory", "delay", "jank", "network"];

/** `"unknown"` is a real state: it is what an unsupported platform API looks like. */
export type Severity = KitSeverity;

export type MetricStatus =
  /** The platform API this metric needs does not exist here. */
  | "unsupported"
  /** Supported, but nothing has been measured yet. */
  | "pending"
  | "ok";

/** Two boundaries, `ok | warn | bad`. Set either to `Infinity` to disable it. */
export interface Thresholds {
  warn: number;
  bad: number;
}

export function severityFor(value: number, thresholds: Thresholds): Severity {
  if (!Number.isFinite(value)) return "unknown";
  if (value > thresholds.bad) return "bad";
  if (value > thresholds.warn) return "warn";
  return "ok";
}

export interface MetricView {
  id: CollectorId;
  /** Bar chip label, e.g. `"mem"`. */
  label: string;
  /** Panel section heading, e.g. `"Memory"`. */
  title: string;
  status: MetricStatus;
  severity: Severity;
  /** Formatted for display. `"NA"` when unsupported. */
  display: string;
  /** The number the sparkline scales against. `NaN` when unknown. */
  value: number;
  unit: string;
  /** One sentence: what this measures, or why it is unavailable here. */
  hint: string;
  /** Rows shown in the panel, already formatted. */
  detail: readonly [label: string, value: string][];
}

export interface NetworkEntryView {
  id: string;
  method: string;
  /** Already through `redactUrl()`. */
  url: string;
  startedAt: number;
  /** Bus event span; patched fetch ends at headers, patched XHR after the response body. */
  duration: number;
  status: number | undefined;
  state: "active" | "ok" | "failed" | "aborted";
  bytes: number | undefined;
  error: string | undefined;
}

/**
 * What `network.export` returns, and what a bug report gets pasted into.
 * `requests` is the array the panel is rendering, not a re-derivation of it.
 */
export interface NetworkExport {
  generatedAt: string;
  /** The page, redacted. `null` outside a browser. */
  url: string | null;
  /** Entries in `requests`, which it never disagrees with. */
  count: number;
  /** Requests the collector is holding, of which `requests` may be the newest slice. */
  retained: number;
  /** `count < retained`: older retained requests were not returned. */
  truncated: boolean;
  /** Newest first, already through `redactUrl()`. */
  requests: readonly NetworkEntryView[];
}

export interface MetricsSnapshot {
  /** Bumped on every publish. Sparklines read the rings directly and key off this. */
  revision: number;
  at: number;
  /** Only the metrics that are switched on, in bar order. */
  order: readonly CollectorId[];
  views: Readonly<Record<MetricId, MetricView>>;
  custom: Readonly<Record<string, MetricView>>;
  /** Newest first, already redacted. Empty unless the network collector runs. */
  requests: readonly NetworkEntryView[];
  /** Total samples ever written across every series. Drives sparkline refresh. */
  seriesWritten: number;
}

export interface CollectorContext {
  /** Aborted when the extension is torn down. Straight from `start(api)`. */
  signal: AbortSignal;
  now(): number;
  /** Publish sooner than the next scheduled tick. Coalesced by the store. */
  invalidate(): void;
}

export interface Collector {
  readonly id: CollectorId;
  /** §5's cost annotation. Surfaced in the panel so the cost is not a secret. */
  readonly estimatedCost: "minimal" | "moderate" | "high";
  /** False when the platform API is missing. `start()` is then never called. */
  readonly supported: boolean;
  /** Why it is unsupported, when it is. */
  readonly unsupportedReason?: string;
  start(context: CollectorContext): void;
  /** Aggregates the raw buffers into something renderable. Called per tick. */
  read(now: number): MetricView;
  /** History behind the sparkline. */
  readonly series: TimeSeries;
  reset(): void;
  /**
   * Rows for a metric whose detail is a table rather than a handful of
   * label/value pairs. Only the network collector has one.
   */
  entries?(now: number): readonly NetworkEntryView[];
  /** JSON-safe, redacted dump for "Copy diagnostic data". */
  diagnostics(now: number): unknown;
}

export function isMetricId(id: CollectorId): id is MetricId {
  return METRIC_IDS.includes(id as MetricId);
}

export function metricView(snapshot: MetricsSnapshot, id: CollectorId): MetricView {
  return isMetricId(id) ? snapshot.views[id] : snapshot.custom[id]!;
}
