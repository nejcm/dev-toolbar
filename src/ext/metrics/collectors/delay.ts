/**
 * Interaction latency, INP-shaped. [dev-toolbar/ext/metrics]
 *
 * Event Timing is the only way to see the whole interaction — input delay,
 * handler processing and the paint that follows — and it is not available
 * everywhere. `PerformanceObserver.supportedEntryTypes` is checked first, the
 * `observe()` call is still wrapped, and both `durationThreshold` and
 * `buffered` are treated as optional: Safari has historically thrown on
 * unknown options rather than ignoring them.
 *
 * The chip shows the *worst* interaction in a rolling window, not the latest.
 * Which one it is has to be unambiguous, so the panel says both.
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
  // No list at all means an old polyfill; assume unsupported rather than
  // throwing inside observe().
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
 * One part of a target description, masked **before** it is joined.
 *
 * `redact()` on a bare string is value-shape matching and nothing else, which
 * is the correct treatment here: there is no key, and the hazard is a value
 * that *looks* like a credential. Same helper, same reasoning, as `part()` in
 * `/ext/diagnostics`' `responsiveness.ts`.
 *
 * A string in, a string out — `redact()`'s own overload says so, so nothing
 * here re-coerces the result. Coercing a value whose *type* is a claim rather
 * than a fact is the caller's job, and `describe()` below does it where it
 * applies.
 */
const part = (value: string): string => {
  try {
    return redact(value);
  } catch {
    // Only reachable through a hostile global, and this runs inside a
    // `PerformanceObserver` callback where nothing upstream would catch it.
    return "[unreadable]";
  }
};

/**
 * A DOM target reduced to `tag#id.class`, **with each part masked before the
 * join**.
 *
 * This was the last known instance of the join defect `/ext/diagnostics`
 * §15.3 named and P4's §16.8 turned into a checklist, and it was recorded in
 * §15.7 as deliberately unfixed. `id` and `className` are live DOM attributes,
 * so they are foreign; the assembled string was handed to metrics' `redact()`
 * pass, whose value matching is anchored to the *whole* string, so a
 * credential-shaped `id` was findable on its own and unfindable the moment
 * `tag` was in front of it.
 *
 * Plausibility is lower here than in the diagnostics cases — a DOM `id` or
 * class would have to *be* credential-shaped rather than merely contain
 * something — but the fix is the same line, and leaving the register's last
 * open item open would make its own standard look optional.
 */
function describe(target: Element | null | undefined): string {
  if (!target || typeof target.tagName !== "string") return "unknown";
  // The tag name is not foreign — it comes from a fixed HTML vocabulary — but
  // it costs nothing to run it through the same helper, and doing so removes
  // the question of which of the three parts was exempt and why.
  const tag = part(target.tagName.toLowerCase());
  // Coerced, and not for the type: `id` is a live DOM attribute, so "declared
  // `string`" is a claim about the lib types rather than a fact about the
  // object that arrived. `part()` masks a string; making it one is this line's
  // business — through `safeString`, because a bare `String()` here would sit
  // outside every guard, and `describe()` runs inside a `PerformanceObserver`
  // callback where a throw has nothing above it to catch.
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
            at: context.now(),
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

      // Three attempts, narrowing: the full option set, then without the
      // threshold, then the legacy entryTypes form. Any of them may throw.
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

      context.signal.addEventListener("abort", () => observer.disconnect(), {
        once: true,
      });
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
