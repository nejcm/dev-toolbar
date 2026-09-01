/**
 * Shared vocabulary for `/ext/diagnostics`. [dev-toolbar/ext/diagnostics]
 *
 * `plans/dev-bar.md` §3J is one sentence with a large consequence: *capture a
 * diagnostic snapshot for a bug report*. Everything this extension produces is
 * **data that leaves the machine** — into a ticket, a chat message, an email —
 * which makes it the one extension in this package whose entire output is
 * outbound. Two rules follow, and they shape every type below.
 *
 * **Redaction happens on the way in.** §11.3 records the trap and predicts this
 * extension has the same shape, so: the snapshot object is redacted as it is
 * built, and the panel, the clipboard, the download and the commands all read
 * that one object. Nothing here holds a raw value that a later rendering pass
 * could reach.
 *
 * **Omission is a first-class outcome.** A snapshot that silently drops a
 * failing extension is worse than one that says "this could not be read": the
 * reader of a bug report was not there, cannot tell absence from failure, and
 * will conclude from a missing section that there was nothing to see. So every
 * present extension appears in `contributions` with a `status`, and everything
 * that is not `"ok"` is *also* summarised in `omissions`, at the top level,
 * where neither a skim of the Markdown nor a `jq` over the JSON can miss it.
 */

/** How the snapshot is rendered for copying and downloading. */
export type SnapshotFormat = "markdown" | "json";

export const SNAPSHOT_FORMATS: readonly SnapshotFormat[] = ["markdown", "json"];

/* -------------------------------------------------------------------------- */
/* §3E — long-task and responsiveness                                          */
/* -------------------------------------------------------------------------- */

/**
 * Whether one `PerformanceObserver` entry type is being observed — and, when it
 * is not, *why*, because the four reasons are not interchangeable.
 *
 * This is the whole reason the numbers below are `number | null` rather than
 * `number`. "No long tasks occurred" and "this browser cannot tell me about
 * long tasks" are opposite claims, and a zero that means the second one is a
 * lie in a document somebody will make a decision from. Firefox ships no
 * `longtask` at all; Safari ships neither `longtask` nor `layout-shift`.
 */
export type SupportState =
  /** Being observed. The counts mean what they say. */
  | "supported"
  /** The browser has `PerformanceObserver` and does not offer this entry type. */
  | "unsupported"
  /** There is no `PerformanceObserver` here at all (old browser, jsdom, Node). */
  | "unavailable"
  /** `observe()` threw for this type. The message is in the note. */
  | "failed"
  /**
   * It *was* being observed and no longer is, because the extension was torn
   * down. Distinct from `"unavailable"`: the browser can do this, we stopped
   * asking. A report taken after teardown that still said `"supported"` would
   * claim live observation over counts that had stopped moving.
   */
  | "stopped";

export interface LongTaskReport {
  support: SupportState;
  /** Tasks in the rolling window. `null` unless `support` is `"supported"`. */
  count: number | null;
  /** Sum of every task's duration, ms. `null` unless observed. */
  totalDurationMs: number | null;
  /**
   * Sum of `duration - 50` over the window, ms — the Long Tasks API's own
   * measure of time the main thread was unavailable beyond the 50 ms threshold
   * that defines a long task. `null` unless observed.
   */
  totalBlockingMs: number | null;
  worst: LongTaskSample | null;
  /** Most recent first, capped. Empty when nothing was observed. */
  recent: LongTaskSample[];
  /** Always populated. Says what the numbers mean, or why there are none. */
  note: string;
}

export interface LongTaskSample {
  /** `performance.now()` origin, ms. */
  startTime: number;
  durationMs: number;
  /**
   * `TaskAttributionTiming` boiled down to one line, or `null`. Container names
   * come from the host page's own markup, so this is redacted like everything
   * else; `containerSrc` is a URL and goes through `redactUrl` specifically.
   */
  attribution: string | null;
}

export interface InteractionReport {
  support: SupportState;
  /** Observed `event` entries in the window. `null` unless observed. */
  count: number | null;
  /** Entries over `slowMs`. `null` unless observed. */
  slowCount: number | null;
  worstDurationMs: number | null;
  /** The event type of the worst entry, e.g. `"pointerdown"`. */
  worstType: string | null;
  note: string;
}

export interface LayoutShiftReport {
  support: SupportState;
  /** Shifts not attributed to recent input. `null` unless observed. */
  count: number | null;
  /** Sum of shift scores over the window. `null` unless observed. */
  total: number | null;
  worst: number | null;
  note: string;
}

export interface ResponsivenessReport {
  /** The rolling window every count above is measured over, ms. */
  windowMs: number;
  /** How long this extension has been observing, ms. */
  observedForMs: number;
  longTasks: LongTaskReport;
  interactions: InteractionReport;
  layoutShifts: LayoutShiftReport;
}

/* -------------------------------------------------------------------------- */
/* The page itself                                                             */
/* -------------------------------------------------------------------------- */

/**
 * What the browser can answer about itself. Every field is nullable and `null`
 * means "this browser did not tell us", never "zero" — same rule as above.
 *
 * `url` and `referrer` go through `redactUrl` **explicitly**, not by hoping the
 * generic value pass recognises them. An OAuth implicit-flow callback puts
 * `access_token=…` in the address bar, and this is the single most likely
 * credential carrier in the whole snapshot. `/ext/metrics` makes the same call
 * for the same reason.
 */
export interface PageReport {
  url: string | null;
  referrer: string | null;
  userAgent: string | null;
  language: string | null;
  timeZone: string | null;
  viewport: string | null;
  devicePixelRatio: number | null;
  online: boolean | null;
  visibility: string | null;
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
  /** §3J's `domElements`. */
  domElements: number | null;
  navigation: NavigationReport | null;
}

export interface NavigationReport {
  type: string | null;
  responseEndMs: number | null;
  domContentLoadedMs: number | null;
  loadEventMs: number | null;
}

/* -------------------------------------------------------------------------- */
/* Contributions and omissions                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Core's three statuses plus the one only the reader can detect.
 *
 * `redact()` already turns cycles, `Map`s, `Set`s, functions and class
 * instances into short tags, so most unserialisable shapes never reach
 * `JSON.stringify`. `BigInt` does: `redact()` passes it through as a number-like
 * primitive and `JSON.stringify(1n)` throws `TypeError`. One extension
 * returning one `BigInt` must not cost the reader the entire snapshot, so each
 * contribution is serialised on its own and a failure is recorded next to the
 * id that caused it.
 */
export type ContributionStatus = "ok" | "absent" | "failed" | "unserialisable";

export interface DiagnosticContribution {
  id: string;
  label: string;
  status: ContributionStatus;
  /** Redacted, and known to survive `JSON.stringify`. Only when `status` is `"ok"`. */
  data?: unknown;
  /** Only when `status` is `"failed"` or `"unserialisable"`. */
  error?: string;
}

/**
 * One line per thing the snapshot could not say. Duplicated deliberately from
 * `contributions` — a summary that lives only inside the detail is a summary
 * nobody reads.
 */
export interface DiagnosticOmission {
  id: string;
  label: string;
  reason: string;
}

/* -------------------------------------------------------------------------- */
/* The snapshot                                                                */
/* -------------------------------------------------------------------------- */

export interface DiagnosticSnapshot {
  /** ISO 8601, wall clock. */
  generatedAt: string;
  toolbar: {
    contractVersion: number;
    /** This extension's own id, so a second instance is identifiable. */
    capturedBy: string;
    /**
     * Whether the cross-extension roster could be read at all. `false` before
     * `start(api)` has run, or against a core older than this contract.
     */
    gathered: boolean;
  };
  page: PageReport;
  responsiveness: ResponsivenessReport;
  /** Consumer-supplied `app` / `session` context, redacted. `null` when none. */
  app: unknown;
  /** One per present, non-hidden extension, plus one per consumer `source`. */
  contributions: DiagnosticContribution[];
  /** Everything above whose status is not `"ok"`. Never elided. */
  omissions: DiagnosticOmission[];
}

/** What the chip and the panel read. */
export interface DiagnosticsSnapshotState {
  /** Increments on every capture. The store's change signal. */
  revision: number;
  /** `null` until the first capture. */
  snapshot: DiagnosticSnapshot | null;
  /** `performance.now()` of the last capture. */
  capturedAt: number | null;
}

/** A consumer-supplied section, treated exactly like an extension contribution. */
export interface DiagnosticSource {
  id: string;
  label?: string;
  read(): unknown;
}

export const NO_SNAPSHOT: DiagnosticsSnapshotState = {
  revision: 0,
  snapshot: null,
  capturedAt: null,
};

/** Human wording for a `SupportState`, used in every `note` and in the panel. */
export function describeSupport(state: SupportState, entryType: string, detail?: string): string {
  switch (state) {
    case "supported":
      return `Observed via PerformanceObserver ("${entryType}").`;
    case "unsupported":
      return `This browser does not report "${entryType}" entries, so this is unknown — not zero.`;
    case "unavailable":
      return "There is no PerformanceObserver here, so this is unknown — not zero.";
    case "failed":
      return `Observing "${entryType}" failed${detail === undefined ? "" : `: ${detail}`}. This is unknown — not zero.`;
    case "stopped":
      return `Observation of "${entryType}" has stopped — the toolbar tore this extension down. Anything after that point is unknown — not zero.`;
  }
}
