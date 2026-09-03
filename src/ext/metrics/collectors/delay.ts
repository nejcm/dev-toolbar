/**
 * Interaction latency, INP-shaped. [dev-toolbar/ext/metrics]
 *
 * Event Timing (input delay + handler processing + paint) isn't available
 * everywhere: `supportedEntryTypes` is checked first, and `observe()` is
 * still wrapped since Safari has historically thrown on unknown options.
 *
 * The chip shows the *worst* interaction in the rolling window, not the
 * latest; the panel shows both to avoid ambiguity.
 */
import { createRingBuffer, createTimeSeries, redact } from "../../../runtime";
import { formatMs, NOT_AVAILABLE } from "../format";
import type { Collector, CollectorContext, MetricView, Thresholds } from "../types";
import { severityFor } from "../types";

export interface InteractionRecord {
  at: number;
  name: string;
  duration: number;
  inputDelay: number;
  processing: number;
  presentation: number;
  target: string;
}

export interface DelayCollectorOptions {
  /** Rolling window for "worst". Default `30000` ms, per §3D. */
  windowMs?: number;
  /** Entries shorter than this are not reported. Default `16` ms. */
  durationThreshold?: number;
  /** Interactions retained for the panel list. Default `50`. */
  historySize?: number;
  /** Milliseconds. Default `{ warn: 200, bad: 500 }`, aligned with INP guidance. */
  thresholds?: Thresholds;
}

interface EventTiming extends PerformanceEntry {
  processingStart: number;
  processingEnd: number;
  target?: Element | null;
  interactionId?: number;
}

/** True when this browser can report Event Timing entries at all. */
export function supportsEventTiming(): boolean {
  if (typeof PerformanceObserver === "undefined") return false;
  const types = (PerformanceObserver as unknown as { supportedEntryTypes?: readonly string[] })
    .supportedEntryTypes;
  // No list at all means an old polyfill; assume unsupported rather than throwing in observe().
  return Array.isArray(types) && types.includes("event");
}

/** `String(value)` on a hostile object can itself throw. */
const safeString = (value: unknown): string => {
  try {
    return String(value);
  } catch {
    return "[unreadable]";
  }
};

/**
 * Masks one part of a target description **before** it is joined.
 *
 * `redact()` on a bare string does value-shape matching only — correct here
 * since there's no key, just a value that might *look* like a credential.
 */
const part = (value: string): string => {
  try {
    return redact(value);
  } catch {
    // Only reachable through a hostile global; this runs inside a
    // `PerformanceObserver` callback where nothing upstream would catch it.
    return "[unreadable]";
  }
};

/**
 * A DOM target reduced to `tag#id.class`, **with each part masked before the
 * join**. Joining first and redacting after would let a credential-shaped
 * `id` hide behind the `tag` prefix, since redact's value matching is
 * anchored to the whole string.
 */
function describe(target: Element | null | undefined): string {
  if (!target || typeof target.tagName !== "string") return "unknown";
  const tag = part(target.tagName.toLowerCase());
  // `id` is a live DOM attribute, so it's foreign despite the declared type;
  // safeString avoids a bare String() throwing inside this observer callback.
  const id = target.id ? `#${part(safeString(target.id))}` : "";
  const first =
    typeof target.className === "string" && target.className.trim() !== ""
      ? `.${part(target.className.trim().split(/\s+/)[0] as string)}`
      : "";
  return `${tag}${id}${first}`;
}

export function createDelayCollector(options: DelayCollectorOptions = {}): Collector {
  const {
    windowMs = 30_000,
    durationThreshold = 16,
    historySize = 50,
    thresholds = { warn: 200, bad: 500 },
  } = options;

  const series = createTimeSeries(historySize);
  const interactions = createRingBuffer<InteractionRecord>(historySize);
  let observerFailed: string | null = null;
  let seen = 0;

  const worstIn = (now: number): InteractionRecord | null => {
    let worst: InteractionRecord | null = null;
    const since = now - windowMs;
    for (let index = 0; index < interactions.size; index += 1) {
      const record = interactions.at(index);
      if (record === undefined || record.at < since) continue;
      if (worst === null || record.duration > worst.duration) worst = record;
    }
    return worst;
  };

  return {
    id: "delay",
    estimatedCost: "minimal",
    get supported() {
      return supportsEventTiming() && observerFailed === null;
    },
    get unsupportedReason() {
      return (
        observerFailed ?? 'PerformanceObserver does not report "event" entries in this browser.'
      );
    },
    series,
    start(context: CollectorContext) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType !== "event") continue;
          const event = entry as EventTiming;
          const inputDelay = Math.max(0, event.processingStart - event.startTime);
          const processing = Math.max(0, event.processingEnd - event.processingStart);
          const record: InteractionRecord = {
            at: Number.isFinite(event.startTime) ? event.startTime : context.now(),
            name: event.name,
            duration: event.duration,
            inputDelay,
            processing,
            presentation: Math.max(0, event.duration - inputDelay - processing),
            target: describe(event.target),
          };
          interactions.push(record);
          series.push(record.at, record.duration);
          seen += 1;
        }
        context.invalidate();
      });

      // Narrowing attempts: full option set, then without threshold, then legacy entryTypes.
      const attempts: PerformanceObserverInit[] = [
        { type: "event", buffered: true, durationThreshold } as PerformanceObserverInit,
        { type: "event", buffered: true },
        { entryTypes: ["event"] },
      ];
      let observing = false;
      for (const init of attempts) {
        try {
          observer.observe(init);
          observing = true;
          break;
        } catch {
          /* try the next shape */
        }
      }
      if (!observing) {
        observerFailed = "PerformanceObserver.observe() rejected every Event Timing option shape.";
        context.invalidate();
        return;
      }

      context.signal.addEventListener(
        "abort",
        () => {
          try {
            observer.disconnect();
          } finally {
            // A real restart constructs a new buffered observer, so retained
            // entries can replay into a new cycle. Clearing does not address
            // StrictMode's double-invoke, and need not: buffered delivery is
            // queued as a task, and StrictMode disconnects the first observer
            // before that task runs.
            series.clear();
            interactions.clear();
            seen = 0;
          }
        },
        { once: true },
      );
    },
    read(now: number): MetricView {
      const detail: [string, string][] = [];
      if (!supportsEventTiming() || observerFailed !== null) {
        return {
          id: "delay",
          label: "delay",
          title: "Delay",
          status: "unsupported",
          severity: "unknown",
          display: NOT_AVAILABLE,
          value: Number.NaN,
          unit: "ms",
          hint:
            observerFailed ??
            "Event Timing is unavailable, so interaction latency cannot be measured here.",
          detail,
        };
      }

      const worst = worstIn(now);
      const last = interactions.last() ?? null;
      if (!worst || !last) {
        return {
          id: "delay",
          label: "delay",
          title: "Delay",
          status: "pending",
          severity: "unknown",
          display: "—",
          value: Number.NaN,
          unit: "ms",
          hint: `No interaction longer than ${durationThreshold} ms in the last ${Math.round(windowMs / 1000)} s.`,
          detail,
        };
      }

      detail.push(
        ["Worst (rolling window)", `${formatMs(worst.duration)} — ${worst.name}`],
        ["Worst target", worst.target],
        ["Input delay", formatMs(worst.inputDelay, 1)],
        ["Handler processing", formatMs(worst.processing, 1)],
        ["Presentation", formatMs(worst.presentation, 1)],
        ["Latest interaction", `${formatMs(last.duration)} — ${last.name}`],
        ["Window", `${Math.round(windowMs / 1000)} s`],
        ["Interactions seen", String(seen)],
      );

      return {
        id: "delay",
        label: "delay",
        title: "Delay",
        status: "ok",
        severity: severityFor(worst.duration, thresholds),
        display: formatMs(worst.duration),
        value: worst.duration,
        unit: "ms",
        hint: `Worst interaction in the last ${Math.round(windowMs / 1000)} s, not the latest one.`,
        detail,
      };
    },
    reset() {
      series.clear();
      interactions.clear();
      seen = 0;
    },
    diagnostics(now: number) {
      return {
        supported: supportsEventTiming() && observerFailed === null,
        observerFailed,
        windowMs,
        seen,
        worst: worstIn(now),
        recent: interactions.latest(10),
      };
    },
  };
}
