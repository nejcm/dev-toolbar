/**
 * §3E — long-task and responsiveness observation. [dev-toolbar/ext/diagnostics]
 *
 * §3E asks for a `PerformanceObserver` over `longtask`: how many, how much
 * total blocked time, the worst one, when. This adds `event` and `layout-shift`
 * to the same monitor, because a bug report that says "the page felt stuck"
 * is answered by whichever of the three happens to be the culprit.
 *
 * The design constraint that shapes the whole file is that **none of the three
 * entry types is universally available**. As of writing, `longtask` ships in
 * Chromium only; `layout-shift` in Chromium only; `event` in Chromium and
 * Firefox. And it is worse than a feature check, because
 * `PerformanceObserver.supportedEntryTypes` is itself not everywhere, and
 * `observe({ type })` throws on some engines and silently no-ops on others.
 *
 * So every count this module reports is `number | null`, and `null` is the only
 * thing it will say when it does not know. **Never report zero long tasks when
 * the truth is that this browser cannot count them.** A bug report is read by
 * somebody who was not there; "0 long tasks" closes a line of investigation
 * that "unknown — Firefox does not implement longtask" keeps open.
 *
 * Two smaller rules, both from §14.2: the observer callback runs where nothing
 * upstream can catch a throw, so it is wrapped; and `observe()` is attempted per
 * entry type in its own `try`, so one unsupported type does not cost the other
 * two.
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
  /** Samples retained per entry type. Default `120`. */
  historySize?: number;
  /** Long tasks listed in `recent`. Default `5`. */
  recentSize?: number;
  /** An `event` entry longer than this counts as slow, ms. Default `200`. */
  slowInteractionMs?: number;
  /**
   * Clock. Default `performance.now()`, falling back to `Date.now()`.
   *
   * Injectable for the same reason `createThrottledStore` injects one: so a
   * test can drive it without global fake timers. It is also the only seam
   * through which `report()` can be made to fail, which is what makes the
   * reader's guard around it a tested path rather than defensive decoration.
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
}

/**
 * Guarded, so a hostile `performance.now` costs the responsiveness section
 * rather than the whole snapshot. Unguarded it threw from `report()`, which the
 * reader catches — correctly, and by degrading the *entire* capture to
 * `failedSnapshot`. Fail-closed either way; this keeps the other sections.
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
}

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/**
 * One foreign field, masked before it is joined to anything. See below.
 *
 * A string in, a string out — `redact()`'s own overload says so, so nothing
 * here re-coerces the result. Every caller either narrows with `typeof` first
 * or runs the value through `safeString()`, so the parameter type is a fact.
 */
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
 * `containerName`, `containerId` and `containerSrc` come from the host page's
 * own markup, so they are foreign data on their way into a ticket.
 * `containerSrc` is a URL and gets `redactUrl` by name rather than by hoping the
 * generic value pass recognises it — the same explicit call `/ext/metrics`
 * makes about `location.href`, for the same reason.
 *
 * The other three are masked **individually, before the join**, and that order
 * is §11.3's rule one level down. `redact()`'s value matching is *anchored*: it
 * masks a string that **is** `Bearer …` or **is** a JWT, not one that contains
 * one. So masking the assembled `iframe #x [name=Bearer …] https://…` finds
 * nothing, while masking `Bearer …` on its own finds it. Redact the parts, then
 * build the sentence — never the other way round.
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
      interactions.push({
        at,
        value: numberOr(entry.duration, 0),
        label: typeof entry.name === "string" ? entry.name : "event",
      });
      return;
    }
    if (entryType === LAYOUT_SHIFT) {
      // A shift within 500 ms of a user input is the specification's own
      // definition of "expected", and counting those would make every dialog
      // open look like a layout bug.
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
    // `supportedEntryTypes` is the only non-throwing way to ask, and it is
    // itself absent on older engines — in which case the honest thing is to try
    // `observe()` and let the throw answer the question.
    const supported = (Ctor as unknown as { supportedEntryTypes?: readonly string[] })
      .supportedEntryTypes;
    if (Array.isArray(supported) && !supported.includes(entryType)) {
      support[entryType] = "unsupported";
      return;
    }
    try {
      const observer = new Ctor((list) => {
        // §14.2: this runs inside a browser callback where nothing upstream
        // catches a throw, and where a throw would recur on every entry.
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
      // This message reaches a `note` field and from there a ticket. It is
      // browser-generated, so the risk is negligible — but it is the same
      // pattern as the error paths in `runtime.ts`, and `part()` masks the
      // message on its own rather than behind a prefix, which is the whole
      // point of that fix. One line is cheaper than an exception.
      // `safeString` over both halves: `error.message` is declared `string`
      // and is nothing of the kind on a hostile subclass, and `part()` masks a
      // string.
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
        worstDurationMs: null,
        worstType: null,
        note,
      };
    }
    const samples = windowed(interactions, since);
    let slow = 0;
    let worst: TimedSample | null = null;
    for (const sample of samples) {
      if (sample.value >= slowInteractionMs) slow += 1;
      if (worst === null || sample.value > worst.value) worst = sample;
    }
    return {
      support: state,
      count: samples.length,
      slowCount: slow,
      worstDurationMs: worst === null ? null : Math.round(worst.value),
      worstType: worst?.label ?? null,
      note:
        `${note} Only events the browser considered worth reporting appear here — ` +
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
      // Not merely tidiness. Leaving these at "supported" meant a `report()`
      // taken after teardown said "Observed via PerformanceObserver" over
      // counts that had stopped moving — the same class of lie as a zero that
      // means "unknown". Nothing is being observed any more, so say so.
      for (const entryType of [LONG_TASK, EVENT, LAYOUT_SHIFT]) {
        if (support[entryType] === "supported") support[entryType] = "stopped";
      }
    },

    reset() {
      longTasks.clear();
      interactions.clear();
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
