/**
 * Everything `/ext/diagnostics` owns that is not React.
 * [dev-toolbar/ext/diagnostics]
 *
 * This extension's entire output is a document that leaves the machine, so
 * §11.3's rules are the design here:
 *
 * 1. **Redact on the way in.** Every foreign value (consumer `app` context,
 *    each `source`, extension contributions, the page URL, error messages) is
 *    redacted the moment it enters the snapshot. Panel, clipboard, download
 *    and commands all read that one already-redacted object.
 * 2. **Never serialise before redacting.** `redact()` walks an object graph;
 *    a pre-stringified value's keys are just characters to it (the bug that
 *    hit `/ext/environment`'s first cut). `render()` only ever takes an
 *    *already redacted* snapshot — the builder is the sole place a raw value
 *    is touched, and it hands `redact()` objects, never JSON.
 * 3. **Masking is visible.** `maskedCount` is derived from the rendered output
 *    and shown next to the copy buttons — invisible redaction is
 *    indistinguishable from a value that was never supplied.
 * 4. **Omission is visible** (this extension's own addition, from §3J).
 *    Every present extension appears with a status; anything not `"ok"` is
 *    repeated in top-level `omissions` and in a Markdown banner, so a
 *    silently-dropped failure can't read as a complete report.
 */
import {
  REDACTED,
  formatError,
  redact,
  redactProse,
  redactUrl,
  writeClipboardText,
  writeClipboardTextOrThrow,
} from "../../runtime";
import type { RedactOptions, ThrottledStore } from "../../runtime";
import { createThrottledStore } from "../../runtime";
import { readPreference, writePreference } from "@nejcm/dev-toolbar/kit";
import type { Preference } from "@nejcm/dev-toolbar/kit";
import type {
  ExtensionDiagnostics,
  ExtensionRuntimeApi,
  ToolbarStorage,
} from "../../core/contract";
import { createConsoleTail } from "./console";
import type { ConsoleTailOptions } from "./console";
import { createResponsivenessMonitor } from "./responsiveness";
import type { ResponsivenessOptions } from "./responsiveness";
import { NO_SNAPSHOT, SNAPSHOT_FORMATS, describeTail } from "./types";
import type {
  ConsoleTailReport,
  DiagnosticContribution,
  DiagnosticOmission,
  DiagnosticSnapshot,
  DiagnosticSource,
  DiagnosticsSnapshotState,
  LongTaskSample,
  NavigationReport,
  PageReport,
  ResponsivenessReport,
  SnapshotFormat,
} from "./types";

/** Kept in sync with core by hand: this file imports no *value* from core. */
export const TARGET_CONTRACT_VERSION = 2;

export const FORMAT_KEY = "format";

export type AppContextInput = unknown | (() => unknown);

export interface DiagnosticsRuntimeOptions extends ResponsivenessOptions {
  /** This extension's id, so the snapshot can name what captured it. */
  id?: string;
  /**
   * §3J's `app`/`session` blocks. An object, or a function read at capture
   * time. Redacted like everything else; a throwing getter degrades to a
   * visible omission rather than an exception out of a click handler.
   */
  app?: AppContextInput;
  /**
   * Extra named sections for the ticket (router state, last actions, etc).
   * Treated like an extension contribution: fail-closed, status-tracked,
   * visible in `omissions` when unreadable.
   */
  sources?: readonly DiagnosticSource[];
  /** Merged into every `redact()` call. `extraKeys` is the usual reason. */
  redactOptions?: RedactOptions;
  /** Long tasks listed per snapshot. Default `5`. */
  recentSize?: number;
  /**
   * The console and error tail (`plans/ecosystem-extensions.md` § 1B). On by
   * default; `false` opts out entirely — see `src/ext/diagnostics/console.ts`.
   */
  console?: ConsoleTailOptions | false;
}

export interface DiagnosticsRuntime {
  readonly store: ThrottledStore<DiagnosticsSnapshotState>;
  /**
   * `null` until `start(api)` runs.
   *
   * @deprecated Nothing in the package reads it any more: every persisted
   * preference goes through `readPreference`/`writePreference` from
   * `@nejcm/dev-toolbar/kit`, which guard the adapter for you. Use those with
   * `api.storage` instead. Removal is a published-API change and waits for the
   * next major.
   */
  storage(): ToolbarStorage | null;
  start(api: ExtensionRuntimeApi): () => void;
  /** Builds a fresh snapshot, publishes it, and returns it. Never throws. */
  capture(): DiagnosticSnapshot;
  /** The last captured snapshot, or `null`. Does not capture. */
  latest(): DiagnosticSnapshot | null;
  /** Captures if nothing has been captured yet, then returns it. */
  ensure(): DiagnosticSnapshot;
  /** Renders an already-captured snapshot. Captures first if there is none. */
  render(format: SnapshotFormat): string;
  /**
   * How many values the mask replaced. One number for both formats — see
   * `countMasked`; it is deliberately not derived from the rendered text.
   */
  maskedCount(): number;
  /** Predictable and derived from `generatedAt`. */
  filename(format: SnapshotFormat): string;
  copy(format: SnapshotFormat): Promise<boolean>;
  /**
   * Copy for a *command* rather than for a button: throws when the write did
   * not happen, because a `ToolbarCommand` returns `void` and the palette
   * reports a throw while closing over a resolve (§13.4).
   */
  copyOrThrow(format: SnapshotFormat): Promise<void>;
  /** `true` only when a download was actually started. */
  download(format: SnapshotFormat): boolean;
  /**
   * A **summary** of the last capture, never the snapshot itself. Publishing
   * the snapshot would nest it in the roster because core builds that roster
   * from `api.getDiagnostics()` (`plans/agent-readable-toolbar.md` § Phase 1).
   * The full object remains available through this extension's commands.
   */
  summary(): unknown;
  /**
   * The console/error tail as it stands now, newest first — the same object
   * the snapshot carries, so a reader never gets a second, less-redacted view
   * of it. `limit` keeps the newest N grouped entries.
   */
  tail(limit?: number): ConsoleTailReport;
  /** Drops every captured entry and zeroes the counters. Keeps capturing. */
  clearTail(): void;
  /** Persisted panel format. */
  readFormat(): SnapshotFormat;
  writeFormat(format: SnapshotFormat): void;
}

/**
 * A monotonic-ish timestamp that cannot throw — same rule as `nowIso` below.
 *
 * `capture()` reads this *outside* the build's guard, to stamp the store, so a
 * host with a hostile `performance.now` (an instrumentation shim, a clock mock
 * left on in a dev build) would otherwise throw straight out of a click
 * handler on the one path whose whole job is to survive.
 */
/**
 * A monotonic-ish timestamp that cannot throw (same rule as `nowIso` below).
 * `capture()` reads this outside the build's guard to stamp the store, so a
 * hostile `performance.now` must not throw out of a click handler.
 */
const now = (): number => {
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

/**
 * A wall-clock timestamp that cannot throw. Matters on the failure path:
 * `failedSnapshot` exists so a broken capture still produces a usable
 * snapshot, and a monkey-patched `Date` must not turn that into a throw too.
 */
const nowIso = (): string => {
  try {
    return new Date().toISOString();
  } catch {
    return "unknown";
  }
};

/* -------------------------------------------------------------------------- */
/* The page                                                                    */
/* -------------------------------------------------------------------------- */

interface NavigatorLike {
  userAgent?: string;
  language?: string;
  onLine?: boolean;
  hardwareConcurrency?: number;
  deviceMemory?: number;
}

function readNavigation(): NavigationReport | null {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") {
    return null;
  }
  try {
    const entry = performance.getEntriesByType("navigation")[0] as
      | {
          type?: string;
          responseEnd?: number;
          domContentLoadedEventEnd?: number;
          loadEventEnd?: number;
        }
      | undefined;
    if (entry === undefined) return null;
    const ms = (value: unknown): number | null =>
      typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
    return {
      type: typeof entry.type === "string" ? entry.type : null,
      responseEndMs: ms(entry.responseEnd),
      domContentLoadedMs: ms(entry.domContentLoadedEventEnd),
      loadEventMs: ms(entry.loadEventEnd),
    };
  } catch {
    return null;
  }
}

/**
 * The browser's own answers. `null` means "not answered", never a stand-in
 * zero/empty-string. `url` and `referrer` get `redactUrl` explicitly, since
 * an OAuth implicit-callback address bar (`?access_token=…`) is going into a ticket.
 */
function readPage(options: RedactOptions | undefined): PageReport {
  const nav = (globalThis as { navigator?: NavigatorLike }).navigator;
  const win = (
    globalThis as {
      window?: { innerWidth?: number; innerHeight?: number; devicePixelRatio?: number };
    }
  ).window;
  const doc = (
    globalThis as {
      document?: {
        referrer?: string;
        visibilityState?: string;
        getElementsByTagName?: (name: string) => { length: number };
      };
    }
  ).document;

  const size =
    typeof win?.innerWidth === "number" && typeof win?.innerHeight === "number"
      ? `${Math.round(win.innerWidth)}×${Math.round(win.innerHeight)}`
      : null;

  let timeZone: string | null = null;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    timeZone = null;
  }

  let domElements: number | null = null;
  try {
    domElements = doc?.getElementsByTagName?.("*").length ?? null;
  } catch {
    domElements = null;
  }

  const href =
    typeof location === "undefined" || typeof location.href !== "string" ? null : location.href;

  return {
    url: href === null ? null : redactUrl(href, options),
    referrer:
      typeof doc?.referrer === "string" && doc.referrer !== ""
        ? redactUrl(doc.referrer, options)
        : null,
    userAgent: typeof nav?.userAgent === "string" ? nav.userAgent : null,
    language: typeof nav?.language === "string" ? nav.language : null,
    timeZone,
    viewport: size,
    devicePixelRatio: typeof win?.devicePixelRatio === "number" ? win.devicePixelRatio : null,
    online: typeof nav?.onLine === "boolean" ? nav.onLine : null,
    visibility: typeof doc?.visibilityState === "string" ? doc.visibilityState : null,
    hardwareConcurrency:
      typeof nav?.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null,
    deviceMemoryGb: typeof nav?.deviceMemory === "number" ? nav.deviceMemory : null,
    domElements,
    navigation: readNavigation(),
  };
}

/* -------------------------------------------------------------------------- */
/* Runtime                                                                     */
/* -------------------------------------------------------------------------- */

export function createDiagnosticsRuntime(
  options: DiagnosticsRuntimeOptions = {},
): DiagnosticsRuntime {
  const { id = "diagnostics", app, sources = [], redactOptions } = options;
  const mask = redactOptions?.mask ?? REDACTED;

  const monitor = createResponsivenessMonitor(options);
  // Built here, not in `start(api)`: `report()` must answer "pending" for a
  // snapshot captured before the extension was ever started.
  const tail = createConsoleTail(options.console, {
    redactOptions,
    now: options.now ?? now,
    onChange: () => publishCounts(),
  });

  let api: ExtensionRuntimeApi | null = null;
  let storage: ToolbarStorage | null = null;
  let revocations: Revoker[] = [];

  /**
   * A foreign string on its way into a ticket: `/runtime`'s `redactProse()` —
   * the whole-value pass plus every `scheme://…` run, never a throw, never a
   * non-string (callers pass a *declared* string that may be foreign data).
   * Corollary still holds: **never assemble a sentence from foreign parts and
   * then redact the sentence** — mask the parts first. See
   * `describeAttribution` in `responsiveness.ts`.
   */
  const maskProse = (value: string): string => redactProse(value, redactOptions);

  /** A thrown value for the snapshot: `formatError()` masks the halves, then joins. */
  const describeSafely = (error: unknown): string => formatError(error, redactOptions);

  /**
   * The one place a raw foreign value is touched. Order is load-bearing:
   * `redact()` walks the object, and only then is the result serialised.
   */
  const takeData = (
    entry: { id: string; label: string },
    read: () => unknown,
  ): DiagnosticContribution => {
    let raw: unknown;
    try {
      raw = read();
    } catch (error) {
      return {
        id: entry.id,
        label: entry.label,
        status: "failed",
        error: describeSafely(error),
      };
    }
    return finish(entry, raw);
  };

  /** Redact, then prove it serialises — in that order, always. `redact()` tags a throwing getter as `"[getter threw]"` rather than propagating. */
  const finish = (entry: { id: string; label: string }, raw: unknown): DiagnosticContribution => {
    const redacted = redact(raw, redactOptions);
    if (redacted === undefined) {
      return {
        id: entry.id,
        label: entry.label,
        status: "absent",
      };
    }
    try {
      // Check only — not the output. A BigInt survives redact() and throws
      // here; one extension must not cost the reader the whole snapshot.
      JSON.stringify(redacted);
    } catch (error) {
      return {
        id: entry.id,
        label: entry.label,
        status: "unserialisable",
        error: describeSafely(error),
      };
    }
    return { id: entry.id, label: entry.label, status: "ok", data: redacted };
  };

  /** Extension contributions, via core's roster. */
  const gather = (): {
    contributions: DiagnosticContribution[];
    gathered: boolean;
  } => {
    const contributions: DiagnosticContribution[] = [];
    let roster: readonly ExtensionDiagnostics[] | null = null;
    if (typeof api?.getDiagnostics === "function") {
      try {
        roster = api.getDiagnostics();
      } catch (error) {
        // Unreachable today (core already contains per-extension throws), but
        // a reader that lets this escape takes the toolbar down with it (§13.4).
        contributions.push({
          id: "*",
          label: "Extension roster",
          status: "failed",
          error: `core's getDiagnostics() threw — ${describeSafely(error)}`,
        });
      }
    }
    if (roster === null) {
      return { contributions, gathered: false };
    }
    for (const entry of roster) {
      // Reader, not a contributor: declaring diagnostics() here would recurse.
      if (entry.id === id) continue;
      if (entry.status === "absent") {
        contributions.push({
          id: entry.id,
          label: entry.label,
          status: "absent",
        });
        continue;
      }
      if (entry.status === "failed") {
        // Core hands message and name over separately so this can mask the
        // message *before* prefixing it — joining first is the leak.
        const message = maskProse(entry.error ?? "diagnostics() threw.");
        const name = entry.errorName === undefined ? undefined : maskProse(entry.errorName);
        contributions.push({
          id: entry.id,
          label: entry.label,
          status: "failed",
          error: name === undefined ? message : `${name}: ${message}`,
        });
        continue;
      }
      contributions.push(finish(entry, entry.data));
    }
    return { contributions, gathered: true };
  };

  const REASONS: Record<DiagnosticContribution["status"], string> = {
    ok: "",
    absent: "present, but declares no diagnostics() — nothing to include.",
    failed: "could not be read.",
    unserialisable: "returned something that will not serialise.",
  };

  const omissionsFor = (
    contributions: readonly DiagnosticContribution[],
    gathered: boolean,
  ): DiagnosticOmission[] => {
    const omissions: DiagnosticOmission[] = [];
    if (!gathered) {
      omissions.push({
        id: "*",
        label: "Every other extension",
        reason:
          "the toolbar had not started this extension when the snapshot was " +
          "taken, so no extension could be asked. Capture again with the panel " +
          "open, or check that this core implements getDiagnostics().",
      });
    }
    for (const entry of contributions) {
      if (entry.status === "ok") continue;
      omissions.push({
        id: entry.id,
        label: entry.label,
        reason:
          entry.error === undefined
            ? REASONS[entry.status]
            : `${REASONS[entry.status]} ${entry.error}`,
      });
    }
    return omissions;
  };

  /** Responsiveness, with attribution strings redacted — the only foreign data in the report; everything else is a number this extension computed. */
  const readResponsiveness = (): ResponsivenessReport => {
    const report = monitor.report();
    const clean = (sample: LongTaskSample): LongTaskSample => ({
      ...sample,
      attribution: sample.attribution === null ? null : maskProse(sample.attribution),
    });
    return {
      ...report,
      longTasks: {
        ...report.longTasks,
        worst: report.longTasks.worst === null ? null : clean(report.longTasks.worst),
        recent: report.longTasks.recent.map(clean),
      },
    };
  };

  const buildSnapshot = (): DiagnosticSnapshot => {
    const { contributions, gathered } = gather();

    for (const source of sources) {
      const label = source.label ?? source.id;
      contributions.push(takeData({ id: source.id, label }, () => source.read()));
    }

    const appContribution =
      app === undefined
        ? null
        : takeData({ id: "app", label: "App context" }, () =>
            typeof app === "function" ? (app as () => unknown)() : app,
          );

    const omissions = omissionsFor(contributions, gathered);
    if (appContribution !== null && appContribution.status !== "ok") {
      omissions.unshift({
        id: "app",
        label: "App context",
        reason:
          appContribution.error === undefined
            ? REASONS[appContribution.status]
            : `${REASONS[appContribution.status]} ${appContribution.error}`,
      });
    }

    return {
      generatedAt: nowIso(),
      toolbar: {
        contractVersion: TARGET_CONTRACT_VERSION,
        capturedBy: id,
        gathered,
      },
      page: readPage(redactOptions),
      responsiveness: readResponsiveness(),
      // Already redacted, entry by entry, on the way into the ring — it does
      // not go through `finish()` for the same reason `responsiveness` does
      // not: this extension built it, so there is no foreign value left in it.
      console: safeTail(),
      app: appContribution?.status === "ok" ? appContribution.data : null,
      contributions,
      omissions,
    };
  };

  /** Nothing in a capture may propagate — a throw anywhere becomes a snapshot that says the capture failed, still a usable bug report. */
  const build = (): DiagnosticSnapshot => {
    try {
      return buildSnapshot();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        "[dev-toolbar/ext/diagnostics] building the snapshot threw. Reporting " +
          "a snapshot that says so; a getter on the app context or in a " +
          "source is the usual cause.",
        error,
      );
      return failedSnapshot(error);
    }
  };

  /** Same rule as `nowIso`: the failure path may not itself fail. */
  const safeReport = (): ResponsivenessReport => {
    try {
      return monitor.report();
    } catch {
      return {
        windowMs: 0,
        observedForMs: 0,
        longTasks: {
          support: "failed",
          count: null,
          totalDurationMs: null,
          totalBlockingMs: null,
          worst: null,
          recent: [],
          note: "the responsiveness monitor could not be read.",
        },
        interactions: {
          support: "failed",
          count: null,
          slowCount: null,
          eventCount: null,
          worstDurationMs: null,
          worstType: null,
          note: "the responsiveness monitor could not be read.",
        },
        layoutShifts: {
          support: "failed",
          count: null,
          total: null,
          worst: null,
          note: "the responsiveness monitor could not be read.",
        },
      };
    }
  };

  /** Same rule as `safeReport`: the failure path may not itself fail. */
  const safeTail = (limit?: number): ConsoleTailReport => {
    try {
      return tail.report(limit);
    } catch {
      return {
        status: "unavailable",
        note: describeTail("unavailable"),
        watching: [],
        errors: null,
        warnings: null,
        dropped: null,
        truncated: false,
        entries: [],
      };
    }
  };

  const failedSnapshot = (error: unknown): DiagnosticSnapshot => ({
    generatedAt: nowIso(),
    toolbar: {
      contractVersion: TARGET_CONTRACT_VERSION,
      capturedBy: id,
      gathered: false,
    },
    page: {
      url: null,
      referrer: null,
      userAgent: null,
      language: null,
      timeZone: null,
      viewport: null,
      devicePixelRatio: null,
      online: null,
      visibility: null,
      hardwareConcurrency: null,
      deviceMemoryGb: null,
      domElements: null,
      navigation: null,
    },
    responsiveness: safeReport(),
    console: safeTail(),
    app: null,
    contributions: [],
    omissions: [
      {
        id: "*",
        label: "The whole snapshot",
        // Redacted like every other foreign string — this is the omissions
        // banner itself, the worst place to leak.
        reason: `building it threw — ${describeSafely(error)}. Nothing below is complete.`,
      },
    ],
  });

  /**
   * True while a publish — or the store's own report of a failed publish — is
   * running. See `publishCounts`.
   */
  let publishing = false;

  /** Raises the guard for one call, and puts it back where it was. */
  const whilePublishing = (body: () => void): void => {
    const outer = publishing;
    publishing = true;
    try {
      body();
    } finally {
      publishing = outer;
    }
  };

  const store = createThrottledStore<DiagnosticsSnapshotState>(NO_SNAPSHOT, {
    intervalMs: 100,
    // The store's default clock is unguarded performance.now(); handing it
    // the guarded `now` keeps a failed capture's publish step fail-closed too.
    now,
    // Regression: guarding `store.set()` alone missed the throttle's trailing
    // edge, which notifies from a timer after that guard is down — measured
    // at five notifications and seven captured errors from two logs.
    onError: (error) => {
      whilePublishing(() => {
        // eslint-disable-next-line no-console
        console.error("[dev-toolbar/diagnostics] a store listener threw.", error);
      });
    },
  });

  // Published off the current task: React reports its own dev warnings
  // through `console.error` during render, and a synchronous `store.set()`
  // here would trigger React's "update while rendering" warning right back.
  let countsPending = false;
  /** False before `start()` and after disposal — see the `write` guard. */
  let live = false;
  const publishCounts = (): void => {
    if (countsPending || publishing) return;
    countsPending = true;
    const write = () => {
      countsPending = false;
      // Scheduled while running, arriving after teardown: a disposed extension
      // may not publish. (Measured: `stop()` then a microtask still wrote one
      // notification.)
      if (!live) return;
      whilePublishing(() => {
        const { errors, warnings } = tail.counts();
        const previous = store.peek();
        if (previous.errors === errors && previous.warnings === warnings) return;
        store.set({ ...previous, errors, warnings });
      });
    };
    try {
      if (typeof queueMicrotask === "function") {
        queueMicrotask(write);
        return;
      }
      setTimeout(write, 0);
    } catch {
      // No scheduler at all: write now rather than lose the count. The
      // mid-render hazard above is a React warning, not a lost update.
      write();
    }
  };

  const capture = (): DiagnosticSnapshot => {
    const snapshot = build();
    const previous = store.peek();
    const { errors, warnings } = tail.counts();
    store.set({
      revision: previous.revision + 1,
      snapshot,
      capturedAt: now(),
      errors,
      warnings,
    });
    store.flush();
    return snapshot;
  };

  const ensure = (): DiagnosticSnapshot => store.peek().snapshot ?? capture();

  const render = (format: SnapshotFormat): string =>
    format === "json" ? renderJson(ensure()) : renderMarkdown(ensure(), mask);

  /**
   * The persisted panel format, fail-safe: `storage` may throw (a browser with
   * site data blocked), and neither the panel nor `summary()` may fail over a
   * preference. The kit's preference module owns that guard.
   */
  const formatPreference: Preference<SnapshotFormat> = {
    key: FORMAT_KEY,
    encoding: "string",
    fallback: "markdown",
    isValue: (value): value is SnapshotFormat => SNAPSHOT_FORMATS.includes(value as SnapshotFormat),
  };
  const readFormat = (): SnapshotFormat => readPreference(storage, formatPreference);

  const filename = (format: SnapshotFormat): string => {
    // `:`/`.` are illegal or awkward in a filename; the failure path's literal
    // "unknown" stamp works fine through the same replace.
    const stamp = ensure().generatedAt.replace(/[:.]/g, "-");
    return `dev-toolbar-diagnostics-${stamp}.${format === "json" ? "json" : "md"}`;
  };

  return {
    store,
    storage: () => storage,
    capture,
    latest: () => store.peek().snapshot,
    ensure,
    render,
    filename,

    maskedCount() {
      return countMasked(ensure(), mask);
    },

    summary() {
      const state = store.peek();
      const snapshot = state.snapshot;
      return {
        captured: snapshot !== null,
        revision: state.revision,
        // `performance.now()` at the capture, i.e. milliseconds since the
        // document loaded. `generatedAt` below is the wall clock.
        capturedAt: state.capturedAt,
        generatedAt: snapshot?.generatedAt ?? null,
        // False when the roster could not be read at all — the difference
        // between an empty snapshot and a complete one.
        gathered: snapshot?.toolbar.gathered ?? null,
        contributionCount: snapshot?.contributions.length ?? 0,
        omissionCount: snapshot?.omissions.length ?? 0,
        // The ids alone. `reason` is a sentence per omission and belongs in
        // the snapshot the commands hand over, not in every roster read.
        omissions: (snapshot?.omissions ?? []).map((omission) => omission.id),
        // Counts only, same as the chip — messages stay in the snapshot and
        // `<id>.console.export`; a roster read is not for redacted foreign text.
        console: (() => {
          const report = safeTail(0);
          return {
            status: report.status,
            errors: report.errors,
            warnings: report.warnings,
            dropped: report.dropped,
            watching: report.watching,
          };
        })(),
        format: readFormat(),
      };
    },

    async copy(format) {
      return writeClipboardText(render(format));
    },

    async copyOrThrow(format) {
      await writeClipboardTextOrThrow(
        render(format),
        "The snapshot is in the Diagnostics panel — copy it from there.",
      );
    },

    download(format) {
      const text = render(format);
      const mime =
        format === "json" ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8";
      const revoke = startDownload(text, filename(format), mime);
      if (revoke === null) return false;
      // Bounded, but never by revoking early — that could cancel an in-flight
      // download. Each revoker self-clears on its own timer; only the list of
      // already-spent closures needs trimming.
      revocations.push(revoke);
      revocations = revocations.filter((entry) => !entry.spent());
      return true;
    },

    tail: (limit) => safeTail(limit),

    clearTail() {
      tail.clear();
      // The chip must drop to zero without waiting for a capture.
      publishCounts();
    },

    readFormat,

    writeFormat(next) {
      writePreference(storage, formatPreference, next);
    },

    start(runtimeApi: ExtensionRuntimeApi) {
      api = runtimeApi;
      storage = runtimeApi.storage;

      // Keeps observing while the bar is hidden (§2: core never pauses
      // anybody) — the long task you want in the report happens while using
      // the app, not while reading the toolbar.
      monitor.start();
      // Same reason, and the same rule in reverse: `dispose` below restores
      // `console.error`/`console.warn` by identity.
      tail.start();
      live = true;

      const dispose = () => {
        live = false;
        // A queued counter write is now void: it would notify subscribers of
        // an extension that is gone.
        countsPending = false;
        monitor.stop();
        tail.stop();
        // An un-revoked object URL is a retained Blob.
        for (const revoke of revocations) revoke();
        revocations = [];
        api = null;
      };
      runtimeApi.signal.addEventListener("abort", dispose, { once: true });
      return dispose;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Rendering — reads the redacted snapshot and nothing else                     */
/* -------------------------------------------------------------------------- */

export function renderJson(snapshot: DiagnosticSnapshot): string {
  try {
    return JSON.stringify(snapshot, null, 2);
  } catch (error) {
    // Unreachable (every contribution was proved serialisable going in), but
    // a copy button that throws is worse than one that reports a problem.
    return JSON.stringify(
      {
        generatedAt: snapshot.generatedAt,
        error: `this snapshot could not be serialised — ${safeDescribe(error)}`,
      },
      null,
      2,
    );
  }
}

/**
 * A fenced block needs more backticks than any run inside it, or the block
 * ends early and spills the rest of the snapshot into the surrounding prose
 * (e.g. a README contribution that itself escapes a fence). Measure instead of
 * guessing a fixed count.
 */
const block = (body: string, language: string): string => {
  let longest = 0;
  for (const run of body.match(/`+/g) ?? []) {
    if (run.length > longest) longest = run.length;
  }
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return `${ticks}${language}\n${body}\n${ticks}`;
};

const fence = (value: unknown): string => {
  let body: string;
  try {
    body = JSON.stringify(value, null, 2) ?? "null";
  } catch (error) {
    body = `"unserialisable — ${safeDescribe(error)}"`;
  }
  return block(body, "json");
};

/**
 * One row of the Page table. Escaping cells isn't cosmetic — a raw `|` splits
 * the row and a newline ends the table, so an unusual value could push the
 * rest of the snapshot out of the table into loose text.
 */
const cell = (value: unknown): string => {
  if (value === null || value === undefined) return "_unknown_";
  let text: string;
  try {
    text = String(value);
  } catch {
    return "_unreadable_";
  }
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
};

const row = (label: string, value: unknown): string => `| ${label} | ${cell(value)} |`;

/** Markdown for pasting into a ticket. Built entirely from the already-redacted snapshot — no raw value ever reaches this function. */
export function renderMarkdown(snapshot: DiagnosticSnapshot, mask: string = REDACTED): string {
  const lines: string[] = [];
  const total = snapshot.contributions.length;
  const ok = snapshot.contributions.filter((entry) => entry.status === "ok").length;

  lines.push("# Diagnostic snapshot");
  lines.push("");
  lines.push(
    `Generated \`${snapshot.generatedAt}\` by \`${snapshot.toolbar.capturedBy}\` ` +
      `(dev-toolbar contract ${snapshot.toolbar.contractVersion}).`,
  );
  lines.push("");

  // Before the data, not after — a completeness warning at the bottom of a long paste goes unread.
  if (snapshot.omissions.length > 0) {
    lines.push(
      `## Incomplete — ${snapshot.omissions.length} thing${snapshot.omissions.length === 1 ? "" : "s"} could not be included`,
    );
    lines.push("");
    for (const omission of snapshot.omissions) {
      lines.push(`- \`${omission.id}\` (${omission.label}): ${omission.reason}`);
    }
    lines.push("");
  } else {
    lines.push(`Complete: ${ok} of ${total} contributions included.`);
    lines.push("");
  }

  lines.push("## Page");
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("| --- | --- |");
  const page = snapshot.page;
  lines.push(row("URL", page.url));
  lines.push(row("Referrer", page.referrer));
  lines.push(row("User agent", page.userAgent));
  lines.push(row("Language", page.language));
  lines.push(row("Time zone", page.timeZone));
  lines.push(
    row(
      "Viewport",
      page.viewport === null
        ? null
        : `${page.viewport}${page.devicePixelRatio === null ? "" : ` @${page.devicePixelRatio}x`}`,
    ),
  );
  lines.push(row("Online", page.online));
  lines.push(row("Visibility", page.visibility));
  lines.push(row("CPU cores", page.hardwareConcurrency));
  lines.push(
    row("Device memory", page.deviceMemoryGb === null ? null : `${page.deviceMemoryGb} GB`),
  );
  lines.push(row("DOM elements", page.domElements));
  if (page.navigation !== null) {
    lines.push(row("Navigation type", page.navigation.type));
    lines.push(
      row(
        "Response end",
        page.navigation.responseEndMs === null ? null : `${page.navigation.responseEndMs} ms`,
      ),
    );
    lines.push(
      row(
        "DOMContentLoaded",
        page.navigation.domContentLoadedMs === null
          ? null
          : `${page.navigation.domContentLoadedMs} ms`,
      ),
    );
    lines.push(
      row(
        "Load event",
        page.navigation.loadEventMs === null ? null : `${page.navigation.loadEventMs} ms`,
      ),
    );
  }
  lines.push("");

  const responsiveness = snapshot.responsiveness;
  lines.push(`## Responsiveness — last ${Math.round(responsiveness.windowMs / 1000)} s`);
  lines.push("");
  lines.push(`Observed for ${Math.round(responsiveness.observedForMs / 1000)} s.`);
  lines.push("");
  const tasks = responsiveness.longTasks;
  lines.push(
    `- **Long tasks:** ${tasks.count === null ? "_unknown_" : tasks.count}` +
      (tasks.count === null
        ? ""
        : `, ${tasks.totalBlockingMs} ms blocking (${tasks.totalDurationMs} ms total)`),
  );
  lines.push(`  - ${tasks.note}`);
  if (tasks.worst !== null) {
    lines.push(
      `  - Worst: ${tasks.worst.durationMs} ms at ${tasks.worst.startTime} ms` +
        (tasks.worst.attribution === null ? "" : ` — ${tasks.worst.attribution}`),
    );
  }
  if (tasks.recent.length > 0) lines.push("  - Most recent:");
  for (const sample of tasks.recent) {
    lines.push(
      `    - ${sample.durationMs} ms at ${sample.startTime} ms` +
        (sample.attribution === null ? "" : ` — ${sample.attribution}`),
    );
  }
  const events = responsiveness.interactions;
  lines.push(
    `- **Interactions:** ${events.count === null ? "_unknown_" : events.count}` +
      // Grouped by `interactionId`, so the raw entry count is printed beside
      // it: the two differing is the normal case, not a discrepancy.
      (events.eventCount === null
        ? ""
        : ` (${events.eventCount} event ${events.eventCount === 1 ? "entry" : "entries"})`) +
      // Avoids printing a stray `worst null ms (null)` for an empty window,
      // which would read as a tool bug rather than an empty window.
      (events.count === null || events.worstDurationMs === null
        ? ""
        : `, ${events.slowCount} slow, worst ${events.worstDurationMs} ms (${events.worstType})`),
  );
  lines.push(`  - ${events.note}`);
  const shifts = responsiveness.layoutShifts;
  lines.push(
    `- **Layout shifts:** ${shifts.count === null ? "_unknown_" : shifts.count}` +
      (shifts.count === null || shifts.worst === null
        ? ""
        : `, ${shifts.total} total, worst ${shifts.worst}`),
  );
  lines.push(`  - ${shifts.note}`);
  lines.push("");

  const tail = snapshot.console;
  lines.push(
    `## Console — ${tail.errors === null ? "_unknown_" : tail.errors} error${tail.errors === 1 ? "" : "s"}, ` +
      `${tail.warnings === null ? "_unknown_" : tail.warnings} warning${tail.warnings === 1 ? "" : "s"}`,
  );
  lines.push("");
  lines.push(tail.note);
  lines.push("");
  if (tail.dropped !== null && tail.dropped > 0) {
    lines.push(
      `${tail.dropped} older message${tail.dropped === 1 ? "" : "s"} fell out of the buffer before this was taken.`,
    );
    lines.push("");
  }
  for (const entry of tail.entries) {
    lines.push(
      `- **${entry.level}** \`${entry.source}\`${entry.count === 1 ? "" : ` ×${entry.count}`}: ` +
        // The message is already masked; the fence guard is for Markdown, not
        // for redaction — a message with a newline in it would otherwise end
        // the list and spill the rest of the snapshot into loose text.
        cell(entry.message),
    );
    if (entry.stack !== null) {
      lines.push("");
      lines.push(block(entry.stack, ""));
      lines.push("");
    }
  }
  if (tail.entries.length === 0 && (tail.errors === 0 || tail.errors === null)) {
    lines.push("_Nothing captured._");
  }
  lines.push("");

  if (snapshot.app !== null && snapshot.app !== undefined) {
    lines.push("## App context");
    lines.push("");
    lines.push(fence(snapshot.app));
    lines.push("");
  }

  for (const entry of snapshot.contributions) {
    lines.push(`## ${entry.label} — \`${entry.id}\``);
    lines.push("");
    if (entry.status === "ok") {
      lines.push(fence(entry.data));
    } else {
      lines.push(`_${entry.status}_ — ${entry.error ?? "this extension contributed nothing."}`);
    }
    lines.push("");
  }

  const masked = countMasked(snapshot, mask);
  lines.push("---");
  lines.push("");
  lines.push(
    masked === 0
      ? "No values were masked. Credential-shaped keys and values are masked " +
          "before anything is rendered, copied or downloaded — none matched here."
      : `${masked} value${masked === 1 ? "" : "s"} masked as \`${mask}\` before this was rendered.`,
  );
  lines.push("");
  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How many values the mask replaced, counted once, canonically, from the
 * snapshot's JSON (not the rendered Markdown, whose own footer mentions the
 * mask and would count itself).
 *
 * Also counts the URL-percent-encoded form of the mask: `redactUrl` writes a
 * URL-safe mask directly for the common case, but a custom mask with a URL
 * delimiter or non-ASCII character still gets percent-encoded there, so that
 * form is searched for too when it differs from the literal.
 */
export function countMasked(snapshot: DiagnosticSnapshot, mask: string = REDACTED): number {
  let serialised: string;
  try {
    serialised = JSON.stringify(snapshot) ?? "";
  } catch {
    return 0;
  }
  let total = countOccurrences(serialised, mask);
  let encoded: string;
  try {
    encoded = encodeURIComponent(mask);
  } catch {
    // Lone surrogate in a custom mask — nothing to add.
    return total;
  }
  if (encoded !== mask) total += countOccurrences(serialised, encoded);
  return total;
}

export function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * `String(value)` on a hostile object can itself throw. Only for the two
 * serialisation-failure notes below, which report the *engine's* own message
 * (`docs/architecture.md` §10) — a thrown value on its way into the snapshot
 * goes through `/runtime`'s `formatError()` instead.
 */
function safeDescribe(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "a value that could not be described";
  }
}

/**
 * Starts a download and returns its revoker, or `null` when the environment
 * can't do it. The anchor is appended and removed synchronously in the same
 * task, since Firefox has historically ignored `click()` on a detached
 * anchor. The object URL is *not* revoked synchronously — several browsers
 * cancel the download if it is — so revocation is deferred, with the revoker
 * handed back so teardown can run it early rather than retain the Blob.
 */
/** A revoker that can be asked whether it has already run. */
export interface Revoker {
  (): void;
  /** True once the object URL has been revoked, by teardown or by its timer. */
  spent(): boolean;
}

export function startDownload(text: string, name: string, mime: string): Revoker | null {
  if (typeof document === "undefined" || typeof Blob === "undefined") {
    return null;
  }
  const urls = (globalThis as { URL?: typeof URL }).URL;
  if (typeof urls?.createObjectURL !== "function") return null;

  let url: string;
  try {
    url = urls.createObjectURL(new Blob([text], { type: mime }));
  } catch {
    return null;
  }

  let revoked = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const revoke = (() => {
    if (revoked) return;
    revoked = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    try {
      urls.revokeObjectURL?.(url);
    } catch {
      /* nothing left to do about it */
    }
  }) as Revoker;
  revoke.spent = () => revoked;
  try {
    timer = setTimeout(revoke, 60_000);
  } catch {
    // Must not throw out of the click that started a download. Without a
    // timer the URL is revoked on teardown instead — later than intended.
    timer = null;
  }

  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return revoke;
  } catch {
    revoke();
    return null;
  }
}
