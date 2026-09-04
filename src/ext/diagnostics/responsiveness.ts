/**
 * §3E — long-task and responsiveness observation. [dev-toolbar/ext/diagnostics]
 *
 * Monitors `longtask`, `event`, and `layout-shift` via `PerformanceObserver`
 * so "the page felt stuck" can be traced to whichever is the culprit.
 *
 * None of the three entry types is universally supported, and even feature
 * detection is unreliable (`supportedEntryTypes` isn't everywhere; `observe()`
 * throws on some engines, no-ops on others). So every count is `number | null`
 * — **never report zero when the browser simply can't count them**; "unknown"
 * keeps a bug report's line of investigation open where a false "0" closes it.
 *
 * Per §14.2: the observer callback is wrapped (nothing upstream catches a
 * throw there), and `observe()` is attempted per entry type in its own `try`
 * so one unsupported type doesn't cost the others.
 */
import { createRingBuffer, redact, redactUrl } from "../../runtime";
import { describeSupport } from "./types";
import type {
  InteractionReport,
  LayoutShiftReport,
  LongTaskReport,
  LongTaskSample,
  ResponsivenessReport,
  SupportState,
} from "./types";

/** The threshold that defines a long task, per the Long Tasks specification. */
export const LONG_TASK_THRESHOLD_MS = 50;

export interface ResponsivenessOptions {
  /** Rolling window every count is measured over, ms. Default `60000`. */
  windowMs?: number;
  /** Samples retained per entry type. Default `120`. For `event`, non-zero ids share one slot. */
  historySize?: number;
  /** Long tasks listed in `recent`. Default `5`. */
  recentSize?: number;
  /** An `event` entry longer than this counts as slow, ms. Default `200`. */
  slowInteractionMs?: number;
  /**
   * Clock. Default `performance.now()`, falling back to `Date.now()`.
   * Injectable so tests can drive it without fake timers, and so the
   * reader's failure guard around `report()` is an actually-tested path.
   */
  now?: () => number;
}

export interface ResponsivenessMonitor {
  /** Idempotent: calling it twice does not double-observe. */
  start(): void;
  stop(): void;
  reset(): void;
  report(): ResponsivenessReport;
  /** Test seam: feed entries without a real `PerformanceObserver`. */
  ingest(entryType: string, entries: readonly unknown[]): void;
  /** Test seam: what `observe()` actually achieved, per entry type. */
  readonly support: Readonly<Record<string, SupportState>>;
}

interface TimedSample {
  at: number;
  value: number;
  label?: string;
  attribution?: string | null;
  /**
   * `PerformanceEventTiming.interactionId`: non-zero groups entries; `0` means no interaction;
   * `undefined` means the engine does not report it.
   *
   * Per the Event Timing specification's *computing interactionId* algorithm, non-zero ids go to
   * `keydown`/`keyup`, `pointerdown`/`pointerup`, `click`, `contextmenu`, and IME-composition
   * `input`; `keydown`/`pointerdown` inherit the completing `keyup`/`pointerup` id. All
   * other events get 0, including `mousedown`/`mouseup`, `mouseover`/`pointerover`/`pointermove`,
   * `keypress`, `compositionstart`/`update`/`end`, non-composition `input`, and `pointercancel`,
   * which leaves `pointerdown` at 0.
   */
  interactionId?: number;
  /** Raw `event` entries folded into this sample; `1` for ungrouped samples and other rings. */
  entries?: number;
}

/**
 * Guarded so a hostile `performance.now` only costs the responsiveness
 * section, not the whole snapshot (an uncaught throw here would degrade the
 * entire capture to `failedSnapshot`).
 */
const defaultNow = (): number => {
  try {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
  } catch {
    /* fall through to the wall clock */
  }
  try {
    return Date.now();
  } catch {
    return 0;
  }
};

/** The three entry types, and the field on the report each one feeds. */
const LONG_TASK = "longtask";
const EVENT = "event";
const LAYOUT_SHIFT = "layout-shift";

interface EntryLike {
  startTime?: unknown;
  duration?: unknown;
  name?: unknown;
  value?: unknown;
  hadRecentInput?: unknown;
  attribution?: unknown;
  interactionId?: unknown;
}

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** Masks one foreign field before it is joined to anything else (see `describeAttribution`). */
const part = (value: string): string => {
  try {
    return redact(value);
  } catch {
    return "[unreadable]";
  }
};

/** `String(value)` on a hostile object can itself throw. */
const safeString = (value: unknown): string => {
  try {
    return String(value);
  } catch {
    return "a value that could not be described";
  }
};

/**
 * `TaskAttributionTiming` reduced to one line, or `null`.
 *
 * Fields come from the host page's own markup, so they're foreign data.
 * `containerSrc` is a URL and gets `redactUrl` explicitly (like `location.href`
 * in `/ext/metrics`). The other three are masked **individually, before the
 * join** (§11.3): `redact()`'s matching is anchored, so it masks a string that
 * *is* `Bearer …`, not one that merely contains it — masking the assembled
 * sentence would find nothing. Redact the parts, then build the sentence.
 */
function describeAttribution(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const first = raw[0] as {
    name?: unknown;
    containerType?: unknown;
    containerName?: unknown;
    containerId?: unknown;
    containerSrc?: unknown;
  } | null;
  if (first === null || typeof first !== "object") return null;
  const parts: string[] = [];
  if (typeof first.containerType === "string" && first.containerType !== "") {
    parts.push(part(first.containerType));
  } else if (typeof first.name === "string" && first.name !== "") {
    parts.push(part(first.name));
  }
  if (typeof first.containerId === "string" && first.containerId !== "") {
    parts.push(`#${part(first.containerId)}`);
  }
  if (typeof first.containerName === "string" && first.containerName !== "") {
    parts.push(`[name=${part(first.containerName)}]`);
  }
  if (typeof first.containerSrc === "string" && first.containerSrc !== "") {
    parts.push(redactUrl(first.containerSrc));
  }
  return parts.length === 0 ? null : parts.join(" ");
}

export function createResponsivenessMonitor(
  options: ResponsivenessOptions = {},
): ResponsivenessMonitor {
  const {
    windowMs = 60_000,
    historySize = 120,
    recentSize = 5,
    slowInteractionMs = 200,
    now = defaultNow,
  } = options;

  const longTasks = createRingBuffer<TimedSample>(historySize);
  const interactions = createRingBuffer<TimedSample>(historySize);
  const shifts = createRingBuffer<TimedSample>(historySize);
  /** Maps non-zero ids to live samples so later entries fold into one slot. Removed on eviction. */
  const byInteractionId = new Map<number, TimedSample>();
  /**
   * Sticky false once an entry lacks a usable `interactionId`; an empty window cannot establish
   * that the engine lacks the field. `reset()` preserves it because page capability does not
   * change.
   */
  let groupingAvailable = true;

  const support: Record<string, SupportState> = {
    [LONG_TASK]: "unavailable",
    [EVENT]: "unavailable",
    [LAYOUT_SHIFT]: "unavailable",
  };
  const detail: Record<string, string | undefined> = {};

  let observers: PerformanceObserver[] = [];
  let startedAt: number | null = null;

  const record = (entryType: string, entry: EntryLike): void => {
    const at = numberOr(entry.startTime, now());
    if (entryType === LONG_TASK) {
      longTasks.push({
        at,
        value: numberOr(entry.duration, 0),
        attribution: describeAttribution(entry.attribution),
      });
      return;
    }
    if (entryType === EVENT) {
      // Preserve `undefined`: `0` means "not part of an interaction", unlike an omitted id.
      const id =
        typeof entry.interactionId === "number" && Number.isFinite(entry.interactionId)
          ? entry.interactionId
          : undefined;
      if (id === undefined) groupingAvailable = false;
      const value = numberOr(entry.duration, 0);
      const label = typeof entry.name === "string" ? entry.name : "event";
      const existing = id === undefined || id === 0 ? undefined : byInteractionId.get(id);
      if (existing !== undefined) {
        // Group at ingest so one interaction uses one ring slot.
        existing.entries = (existing.entries ?? 1) + 1;
        // Use the earliest entry time regardless of delivery order.
        if (at < existing.at) existing.at = at;
        // INP uses the longest entry's duration.
        if (value > existing.value) {
          existing.value = value;
          existing.label = label;
        }
        return;
      }
      const sample: TimedSample = {
        at,
        value,
        label,
        entries: 1,
        ...(id === undefined ? {} : { interactionId: id }),
      };
      // Remove an evicted id from the live map.
      if (interactions.size === interactions.capacity) {
        const evicted = interactions.at(0);
        if (
          evicted?.interactionId !== undefined &&
          byInteractionId.get(evicted.interactionId) === evicted
        ) {
          byInteractionId.delete(evicted.interactionId);
        }
      }
      interactions.push(sample);
      if (id !== undefined && id !== 0) byInteractionId.set(id, sample);
      return;
    }
    if (entryType === LAYOUT_SHIFT) {
      // Per spec, a shift within 500ms of input is "expected" — counting it
      // would make every dialog open look like a layout bug.
      if (entry.hadRecentInput === true) return;
      shifts.push({ at, value: numberOr(entry.value, 0) });
    }
  };

  const ingest = (entryType: string, entries: readonly unknown[]): void => {
    for (const entry of entries) {
      if (entry === null || typeof entry !== "object") continue;
      record(entryType, entry as EntryLike);
    }
  };

  const observe = (entryType: string): void => {
    const Ctor = (
      globalThis as {
        PerformanceObserver?: typeof PerformanceObserver;
      }
    ).PerformanceObserver;
    if (typeof Ctor !== "function") {
      support[entryType] = "unavailable";
      return;
    }
    // `supportedEntryTypes` is the only non-throwing way to ask, but it's absent
    // on older engines — there, just try `observe()` and let the throw answer.
    const supported = (Ctor as unknown as { supportedEntryTypes?: readonly string[] })
      .supportedEntryTypes;
    if (Array.isArray(supported) && !supported.includes(entryType)) {
      support[entryType] = "unsupported";
      return;
    }
    try {
      const observer = new Ctor((list) => {
        // §14.2: nothing upstream catches a throw here, and it would recur per entry.
        try {
          ingest(entryType, list.getEntries());
        } catch {
          /* a malformed entry must not take the page down */
        }
      });
      observer.observe({ type: entryType, buffered: true });
      observers.push(observer);
      support[entryType] = "supported";
    } catch (error) {
      support[entryType] = "failed";
      // Message reaches a `note`/ticket, so it's masked (same pattern as
      // runtime.ts). `safeString` first since `error.message` isn't reliably
      // a string on a hostile subclass.
      detail[entryType] = part(safeString(error instanceof Error ? error.message : error));
    }
  };

  const windowed = (
    ring: ReturnType<typeof createRingBuffer<TimedSample>>,
    since: number,
  ): TimedSample[] => {
    const out: TimedSample[] = [];
    for (let index = 0; index < ring.size; index += 1) {
      const sample = ring.at(index);
      if (sample === undefined || sample.at < since) continue;
      out.push(sample);
    }
    return out;
  };

  const longTaskReport = (since: number): LongTaskReport => {
    const state = support[LONG_TASK] as SupportState;
    const note = describeSupport(state, LONG_TASK, detail[LONG_TASK]);
    if (state !== "supported") {
      return {
        support: state,
        count: null,
        totalDurationMs: null,
        totalBlockingMs: null,
        worst: null,
        recent: [],
        note,
      };
    }
    const samples = windowed(longTasks, since);
    let total = 0;
    let blocking = 0;
    let worst: TimedSample | null = null;
    for (const sample of samples) {
      total += sample.value;
      blocking += Math.max(0, sample.value - LONG_TASK_THRESHOLD_MS);
      if (worst === null || sample.value > worst.value) worst = sample;
    }
    const toSample = (sample: TimedSample): LongTaskSample => ({
      startTime: Math.round(sample.at),
      durationMs: Math.round(sample.value),
      attribution: sample.attribution ?? null,
    });
    return {
      support: state,
      count: samples.length,
      totalDurationMs: Math.round(total),
      totalBlockingMs: Math.round(blocking),
      worst: worst === null ? null : toSample(worst),
      recent: samples.slice(-recentSize).reverse().map(toSample),
      note:
        `${note} A long task is one over ${LONG_TASK_THRESHOLD_MS} ms; blocking time is the excess ` +
        "above that threshold. Entries buffered by the browser from before the " +
        "toolbar started are included where it retained them.",
    };
  };

  const interactionReport = (since: number): InteractionReport => {
    const state = support[EVENT] as SupportState;
    const note = describeSupport(state, EVENT, detail[EVENT]);
    if (state !== "supported") {
      return {
        support: state,
        count: null,
        slowCount: null,
        eventCount: null,
        worstDurationMs: null,
        worstType: null,
        note,
      };
    }
    // Ingest groups non-zero ids by their longest entry, matching INP. Id-0 samples stay in
    // `eventCount` but not interaction counts; missing ids remain one sample per entry.
    const samples = windowed(interactions, since);
    let count = 0;
    let entryCount = 0;
    let slow = 0;
    let worst: TimedSample | null = null;
    for (const sample of samples) {
      entryCount += sample.entries ?? 1;
      if (sample.interactionId === 0) continue;
      count += 1;
      if (sample.value >= slowInteractionMs) slow += 1;
      if (worst === null || sample.value > worst.value) worst = sample;
    }
    const grouping = groupingAvailable
      ? `Counted by interactionId, the way INP is measured: the several entries one click or key press emits ` +
        `(pointerdown, pointerup, click …) count as one interaction, at their longest duration. ` +
        `${entryCount} raw event ${entryCount === 1 ? "entry was" : "entries were"} reported in the window; ` +
        "entries the specification gives interactionId 0 — mousedown, mouseup, mouseover, pointermove, keypress " +
        "and composition events, which belong to no interaction — are in that total but not in the count."
      : `This engine reports no interactionId, so each of the ${entryCount} raw event ` +
        `${entryCount === 1 ? "entry" : "entries"} is counted separately — one click can appear as several interactions.`;
    return {
      support: state,
      count,
      slowCount: slow,
      eventCount: entryCount,
      worstDurationMs: worst === null ? null : Math.round(worst.value),
      worstType: worst?.label ?? null,
      note:
        `${note} ${grouping} Only events the browser considered worth reporting appear here — ` +
        `by default that is everything over 104 ms. "Slow" is ${slowInteractionMs} ms or more.`,
    };
  };

  const shiftReport = (since: number): LayoutShiftReport => {
    const state = support[LAYOUT_SHIFT] as SupportState;
    const note = describeSupport(state, LAYOUT_SHIFT, detail[LAYOUT_SHIFT]);
    if (state !== "supported") {
      return { support: state, count: null, total: null, worst: null, note };
    }
    const samples = windowed(shifts, since);
    let total = 0;
    let worst = 0;
    for (const sample of samples) {
      total += sample.value;
      if (sample.value > worst) worst = sample.value;
    }
    const round = (value: number) => Math.round(value * 10_000) / 10_000;
    return {
      support: state,
      count: samples.length,
      total: round(total),
      worst: samples.length === 0 ? null : round(worst),
      note: `${note} Shifts within 500 ms of user input are excluded, per the specification.`,
    };
  };

  return {
    get support() {
      return support;
    },

    start() {
      if (startedAt !== null) return;
      startedAt = now();
      observe(LONG_TASK);
      observe(EVENT);
      observe(LAYOUT_SHIFT);
    },

    stop() {
      for (const observer of observers) {
        try {
          observer.disconnect();
        } catch {
          /* a disconnect that throws must not block the rest of teardown */
        }
      }
      observers = [];
      startedAt = null;
      // A real restart constructs new buffered observers, so retained entries
      // can replay into a new cycle. Clearing does not address StrictMode's
      // double-invoke, and need not: buffered delivery is queued as a task, and
      // StrictMode disconnects the first observers before that task runs.
      longTasks.clear();
      interactions.clear();
      byInteractionId.clear();
      shifts.clear();
      // Restarting re-observes capability; `reset()` preserves it because one page's
      // `interactionId` support does not change between windows.
      groupingAvailable = true;
      // Leaving these at "supported" would make a post-teardown `report()`
      // claim live observation over counts that had stopped moving.
      for (const entryType of [LONG_TASK, EVENT, LAYOUT_SHIFT]) {
        if (support[entryType] === "supported") support[entryType] = "stopped";
      }
    },

    reset() {
      longTasks.clear();
      interactions.clear();
      byInteractionId.clear();
      shifts.clear();
    },

    ingest,

    report(): ResponsivenessReport {
      const at = now();
      const since = at - windowMs;
      return {
        windowMs,
        observedForMs: startedAt === null ? 0 : Math.round(at - startedAt),
        longTasks: longTaskReport(since),
        interactions: interactionReport(since),
        layoutShifts: shiftReport(since),
      };
    },
  };
}
