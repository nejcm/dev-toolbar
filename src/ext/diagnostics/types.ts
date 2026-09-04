/**
 * Shared vocabulary for `/ext/diagnostics`. [dev-toolbar/ext/diagnostics]
 *
 * §3J: capture a diagnostic snapshot for a bug report. All output here is
 * outbound (ticket, chat, email), so two rules shape every type below:
 *
 * **Redaction happens on the way in** (§11.3) — the snapshot is redacted as
 * it's built, and every consumer (panel, clipboard, download, commands) reads
 * that one already-redacted object.
 *
 * **Omission is first-class.** A silently-dropped failing extension is worse
 * than an explicit "could not be read" — the reader wasn't there and can't
 * tell absence from failure. So every extension appears in `contributions`
 * with a `status`, and anything not `"ok"` is *also* summarised at the top
 * level in `omissions`, where it can't be missed.
 */

/** How the snapshot is rendered for copying and downloading. */
export type SnapshotFormat = "markdown" | "json";

export const SNAPSHOT_FORMATS: readonly SnapshotFormat[] = ["markdown", "json"];

/* -------------------------------------------------------------------------- */
/* §3E — long-task and responsiveness                                          */
/* -------------------------------------------------------------------------- */

/**
 * Whether one `PerformanceObserver` entry type is observed — and if not, why,
 * since the reasons aren't interchangeable. This is why counts below are
 * `number | null`: "no long tasks occurred" and "can't tell" are opposite
 * claims, and a zero standing for the latter is a lie someone acts on.
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
  /** Was being observed, no longer is — the extension was torn down. Distinct from `"unavailable"`: the browser can do this, we stopped asking. */
  | "stopped";

export interface LongTaskReport {
  support: SupportState;
  /** Tasks in the rolling window. `null` unless `support` is `"supported"`. */
  count: number | null;
  /** Sum of every task's duration, ms. `null` unless observed. */
  totalDurationMs: number | null;
  /** Sum of `duration - 50` over the window, ms — time beyond the 50ms long-task threshold. `null` unless observed. */
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
  /** `TaskAttributionTiming` boiled down to one line, or `null`. Container names are redacted; `containerSrc` goes through `redactUrl` specifically. */
  attribution: string | null;
}

export interface InteractionReport {
  support: SupportState;
  /**
   * Interactions in the window, grouped by non-zero `interactionId` like INP. Each group counts
   * once at its longest entry; id-0 entries stay in `eventCount` but not interaction counts.
   * Engines without the field count one entry as one interaction. `null` unless `support` is
   * `"supported"`.
   *
   * Per the Event Timing specification's *computing interactionId* algorithm, non-zero ids go to
   * `keydown`/`keyup`, `pointerdown`/`pointerup`, `click`, `contextmenu`, and IME-composition
   * `input`; `keydown`/`pointerdown` inherit the completing `keyup`/`pointerup` id. All
   * other events get 0, including `mousedown`/`mouseup`, `mouseover`/`pointerover`/`pointermove`,
   * `keypress`, `compositionstart`/`update`/`end`, non-composition `input`, and `pointercancel`,
   * which leaves `pointerdown` at 0.
   */
  count: number | null;
  /** Interactions whose longest entry reaches `slowInteractionMs`; `null` unless observed. */
  slowCount: number | null;
  /** Raw `event` entries in the window, before grouping; `null` unless observed. */
  eventCount: number | null;
  /** Longest entry in the worst interaction, ms, INP's per-interaction duration. */
  worstDurationMs: number | null;
  /** The event type of that entry, e.g. `"pointerdown"`. */
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
 * What the browser can answer about itself. `null` means "not told", never
 * "zero". `url` and `referrer` go through `redactUrl` explicitly, since an
 * OAuth implicit-flow callback can put `access_token=…` in the address bar —
 * the likeliest credential carrier in the snapshot (same call `/ext/metrics` makes).
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
 * Core's three statuses plus one only the reader can detect: `redact()` turns
 * most unserialisable shapes into tags, but passes `BigInt` through, and
 * `JSON.stringify(1n)` throws. So each contribution is serialised on its own,
 * and a failure is recorded against just the id that caused it.
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

/** One line per thing the snapshot could not say. Duplicated from `contributions` deliberately — a summary buried only in the detail goes unread. */
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
