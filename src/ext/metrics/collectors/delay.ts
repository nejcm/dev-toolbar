/**
 * Interaction latency, INP-shaped. [dev-toolbar/ext/metrics]
 *
 * Event Timing may be unavailable. Check `supportedEntryTypes` first and catch
 * `observe()`, which has historically thrown for unknown options in Safari.
 *
 * Entries sharing a non-zero `interactionId` fold into one interaction, whose
 * duration is its longest entry's (see `includeNonInteractions` below for how
 * ids are assigned). Engines without `interactionId` use one record per entry
 * and say so in the hint.
 *
 * The chip shows the *worst* interaction in the rolling window; the panel also
 * shows the latest.
 */
import { createRingBuffer, createTimeSeries, redact } from "../../../runtime";
import { formatMs, NOT_AVAILABLE } from "../format";
import type { Collector, CollectorContext, MetricView, Thresholds } from "../types";
import { severityFor } from "../types";

export interface InteractionRecord {
  /** Earliest `startTime` across folded entries. */
  at: number;
  /** Event type of the *longest* entry, e.g. `"pointerdown"`. */
  name: string;
  /** Longest entry's duration, INP's per-interaction number. */
  duration: number;
  inputDelay: number;
  processing: number;
  presentation: number;
  target: string;
  /** Non-zero `interactionId`, `0` for a non-interaction, or `undefined` when unsupported. */
  interactionId: number | undefined;
  /** Event entries folded into this record. `1` when ungrouped. */
  entries: number;
}

export interface DelayCollectorOptions {
  /** Rolling window for "worst". Default `30000` ms, per §3D. */
  windowMs?: number;
  /** Entries shorter than this are not reported. Default `16` ms. */
  durationThreshold?: number;
  /**
   * Interactions retained for the panel. Default `50`. Grouped entries share one slot; the held
   * worst interaction stays outside the ring until it ages out, so this affects panel history and
   * sparkline coverage, not chip accuracy. Each slot retains an object and sample arrays.
   */
  historySize?: number;
  /**
   * Keep entries with `interactionId` 0. Default `false`.
   *
   * Per the Event Timing spec's *computing interactionId* algorithm, non-zero
   * ids go to `keydown`/`keyup`, `pointerdown`/`pointerup`, `click`,
   * `contextmenu`, and IME-composition `input`; the down event inherits the
   * completing up event's id. Everything else — `mousedown`/`mouseup`,
   * `mouseover`/`pointerover`/`pointermove`, `keypress`, composition events,
   * non-composition `input`, `pointercancel` — gets 0. These are slow
   * handlers, not interactions; enable this to inspect them, one record each
   * since they cannot be grouped.
   */
  includeNonInteractions?: boolean;
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

/** Event Timing rounds `duration` to 8 ms; expose the limit in the detail panel. */
const RESOLUTION_MS = 8;

/**
 * Corrections append sparkline samples because `TimeSeries` cannot update in place. Four samples
 * per ring slot keeps sparkline coverage close to the panel's interaction history.
 */
const SERIES_SAMPLES_PER_INTERACTION = 4;

export function createDelayCollector(options: DelayCollectorOptions = {}): Collector {
  const {
    windowMs = 30_000,
    durationThreshold = 16,
    historySize = 50,
    includeNonInteractions = false,
    thresholds = { warn: 200, bad: 500 },
  } = options;

  const series = createTimeSeries(historySize * SERIES_SAMPLES_PER_INTERACTION);
  const interactions = createRingBuffer<InteractionRecord>(historySize);
  /**
   * Live interactions by `interactionId`, so a later `click` entry can be
   * folded into the `pointerdown` record instead of pushing a second row.
   * Pruned on eviction, so it never outgrows the ring.
   */
  const byId = new Map<number, InteractionRecord>();
  let observerFailed: string | null = null;
  /** Distinct non-zero ids ever seen. */
  let interactionsSeen = 0;
  /** Raw `event` entries ever seen. */
  let entriesSeen = 0;
  /** Entries with id 0, reported but not interactions. */
  let nonInteractionEntries = 0;
  /**
   * False once an entry lacks a usable `interactionId`. Cleared by `forget()`,
   * unlike the diagnostics monitor: the hint only renders once a post-reset
   * record exists, and that record re-derives it.
   */
  let groupingAvailable = true;
  /** Holds the window's worst interaction outside the ring until it ages out. */
  let worstHeld: InteractionRecord | null = null;

  const forget = () => {
    series.clear();
    interactions.clear();
    byId.clear();
    worstHeld = null;
    interactionsSeen = 0;
    entriesSeen = 0;
    nonInteractionEntries = 0;
    groupingAvailable = true;
  };

  /** Promotes `record` when it beats the held worst or that record has aged out. */
  const hold = (record: InteractionRecord): void => {
    if (worstHeld === null) {
      worstHeld = record;
      return;
    }
    // A newer start time establishes the aging boundary for the held record.
    if (worstHeld.at < record.at - windowMs) {
      worstHeld = record;
      return;
    }
    // Do not promote a late record already older than the held record's window; the next read would
    // filter the newly held record out as expired.
    if (record.at < worstHeld.at - windowMs) return;
    if (record.duration > worstHeld.duration) worstHeld = record;
  };

  const worstIn = (now: number): InteractionRecord | null => {
    let worst: InteractionRecord | null = null;
    const since = now - windowMs;
    if (worstHeld !== null && worstHeld.at >= since) worst = worstHeld;
    for (let index = 0; index < interactions.size; index += 1) {
      const record = interactions.at(index);
      if (record === undefined || record.at < since) continue;
      if (worst === null || record.duration > worst.duration) worst = record;
    }
    return worst;
  };

  const remember = (record: InteractionRecord): void => {
    // Remove an evicted id from the live map.
    if (interactions.size === interactions.capacity) {
      const evicted = interactions.at(0);
      if (
        evicted !== undefined &&
        evicted.interactionId !== undefined &&
        byId.get(evicted.interactionId) === evicted
      ) {
        byId.delete(evicted.interactionId);
      }
    }
    interactions.push(record);
    if (record.interactionId !== undefined && record.interactionId !== 0) {
      byId.set(record.interactionId, record);
      interactionsSeen += 1;
    }
    series.push(record.at, record.duration);
    hold(record);
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
          entriesSeen += 1;

          // Preserve `undefined`: `0` means "not part of an interaction", unlike an omitted id.
          const id =
            typeof event.interactionId === "number" && Number.isFinite(event.interactionId)
              ? event.interactionId
              : undefined;
          if (id === undefined) groupingAvailable = false;
          if (id === 0) {
            nonInteractionEntries += 1;
            if (!includeNonInteractions) continue;
          }

          const at = Number.isFinite(event.startTime) ? event.startTime : context.now();
          const inputDelay = Math.max(0, event.processingStart - event.startTime);
          const processing = Math.max(0, event.processingEnd - event.processingStart);
          const existing = id !== undefined && id !== 0 ? byId.get(id) : undefined;

          if (existing !== undefined) {
            existing.entries += 1;
            // Use the earliest entry time regardless of delivery order.
            if (at < existing.at) existing.at = at;
            // INP uses the longest entry's duration and breakdown.
            if (event.duration > existing.duration) {
              existing.name = event.name;
              existing.duration = event.duration;
              existing.inputDelay = inputDelay;
              existing.processing = processing;
              existing.presentation = Math.max(0, event.duration - inputDelay - processing);
              existing.target = describe(event.target);
              // A correction appends a sample because `TimeSeries` cannot update in place.
              series.push(existing.at, existing.duration);
              hold(existing);
            }
            continue;
          }

          remember({
            at,
            name: event.name,
            duration: event.duration,
            inputDelay,
            processing,
            presentation: Math.max(0, event.duration - inputDelay - processing),
            target: describe(event.target),
            interactionId: id,
            entries: 1,
          });
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
            forget();
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

      const seconds = Math.round(windowMs / 1000);
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
          hint: `No interaction longer than ${durationThreshold} ms in the last ${seconds} s.`,
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
        ["Window", `${seconds} s`],
      );
      if (groupingAvailable) {
        detail.push(
          ["Interactions seen", String(interactionsSeen)],
          ["Entries in worst interaction", String(worst.entries)],
        );
      }
      detail.push(["Event entries seen", String(entriesSeen)]);
      if (nonInteractionEntries > 0) {
        detail.push([
          includeNonInteractions
            ? "Non-interaction entries kept"
            : "Non-interaction entries skipped",
          String(nonInteractionEntries),
        ]);
      }
      detail.push(["Resolution", `${RESOLUTION_MS} ms — Event Timing rounds durations`]);

      return {
        id: "delay",
        label: "delay",
        title: "Delay",
        status: "ok",
        severity: severityFor(worst.duration, thresholds),
        display: formatMs(worst.duration),
        value: worst.duration,
        unit: "ms",
        hint: groupingAvailable
          ? `Worst interaction in the last ${seconds} s, not the latest one. Entries are grouped by interactionId the way INP measures them.`
          : `Worst event entry in the last ${seconds} s; this browser reports no interactionId, so entries are not grouped into interactions.`,
        detail,
      };
    },
    reset() {
      forget();
    },
    diagnostics(now: number) {
      return {
        supported: supportsEventTiming() && observerFailed === null,
        observerFailed,
        windowMs,
        grouped: groupingAvailable,
        includeNonInteractions,
        interactionsSeen,
        entriesSeen,
        nonInteractionEntries,
        worst: worstIn(now),
        recent: interactions.latest(10),
      };
    },
  };
}
