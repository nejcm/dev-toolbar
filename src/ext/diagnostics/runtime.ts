/**
 * Everything `/ext/diagnostics` owns that is not React.
 * [dev-toolbar/ext/diagnostics]
 *
 * This extension's entire output is a document that leaves the machine, so the
 * §11.3 rules are not guidance here, they are the design:
 *
 * 1. **Redact on the way in.** Every foreign value — the consumer's `app`
 *    context, every `source`, every extension contribution, the page URL, a
 *    long task's container attribution, even another extension's error message
 *    — is redacted at the moment it enters the snapshot. The panel, the
 *    clipboard, the download and the four commands then all read *that one
 *    object*. There is no path from a raw value to any output.
 * 2. **Never serialise before redacting.** `redact()` finds sensitive keys by
 *    walking an object graph; a value that was stringified first is a string,
 *    and every key inside it is now just characters. The whole first cut of
 *    `/ext/environment` had this bug and its panel still displayed a "masked"
 *    badge over the leak. Here it would be worse, because the output goes
 *    straight into a ticket. `render()` therefore takes the *already redacted*
 *    snapshot and nothing else; the builder is the only thing that ever sees a
 *    raw value, and it hands `redact()` objects, never JSON.
 * 3. **Masking is visible.** `maskedCount` is derived from the rendered output
 *    and shown next to the copy buttons, because a redaction nobody can see is
 *    indistinguishable from a value that was never supplied.
 *
 * And one rule this extension adds, from §3J's purpose rather than from §6:
 *
 * 4. **Omission is visible.** Every present extension appears with a status,
 *    and everything that is not `"ok"` is repeated in a top-level `omissions`
 *    list and in a banner at the top of the Markdown. A snapshot that silently
 *    drops the one failing extension reads as complete, and the person holding
 *    the bug report has no way to know it is not.
 */
import {
  REDACTED,
  redact,
  redactUrl,
  writeClipboardText,
  writeClipboardTextOrThrow,
} from "../../runtime";
import type { RedactOptions, ThrottledStore } from "../../runtime";
import { createThrottledStore } from "../../runtime";
import type {
  ExtensionDiagnostics,
  ExtensionRuntimeApi,
  ToolbarStorage,
} from "../../core/contract";
import { createResponsivenessMonitor } from "./responsiveness";
import type { ResponsivenessOptions } from "./responsiveness";
import { NO_SNAPSHOT, SNAPSHOT_FORMATS } from "./types";
import type {
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
export const TARGET_CONTRACT_VERSION = 1;

export const FORMAT_KEY = "format";

export type AppContextInput = unknown | (() => unknown);

export interface DiagnosticsRuntimeOptions extends ResponsivenessOptions {
  /** This extension's id, so the snapshot can name what captured it. */
  id?: string;
  /**
   * §3J's `app` and `session` blocks. Core has no `ctx`, so whatever the
   * snapshot is to say about the release, the actor or the workspace, the
   * consumer says. An object, or a function read at capture time.
   *
   * Redacted like everything else, and the function form is called inside the
   * same `try` as the rest of the build — a getter that throws degrades to a
   * visible omission rather than an exception out of a click handler.
   */
  app?: AppContextInput;
  /**
   * Extra named sections — a router's state, a store's last actions, whatever
   * the consumer wants in the ticket. Treated exactly like an extension
   * contribution: fail-closed, status-tracked, and visible in `omissions` when
   * it cannot be read.
   */
  sources?: readonly DiagnosticSource[];
  /** Merged into every `redact()` call. `extraKeys` is the usual reason. */
  redactOptions?: RedactOptions;
  /** Long tasks listed per snapshot. Default `5`. */
  recentSize?: number;
}

export interface DiagnosticsRuntime {
  readonly store: ThrottledStore<DiagnosticsSnapshotState>;
  /** `null` until `start(api)` runs. */
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
 * A wall-clock timestamp that cannot throw.
 *
 * This matters only on the failure path, and it is exactly the bug a test
 * found: `failedSnapshot` — the thing that exists so a broken capture still
 * produces a usable snapshot — called `new Date().toISOString()` itself, so a
 * host that had monkey-patched `Date` (an instrumentation library, a clock mock
 * left on in a dev build) turned "the capture failed" into a throw out of a
 * click handler. An error path that can fail the same way as the happy path is
 * not an error path.
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
 * The browser's own answers. Every field is `null` when the browser did not
 * answer — never a zero or an empty string standing in for "unknown".
 *
 * `url` and `referrer` get `redactUrl` by name. That is not belt-and-braces
 * over the generic value pass: it is the primary defence, because the address
 * bar after an OAuth implicit callback is `?access_token=…` and this string is
 * going into a ticket.
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

  let api: ExtensionRuntimeApi | null = null;
  let storage: ToolbarStorage | null = null;
  let revocations: Revoker[] = [];

  /**
   * A foreign string on its way into a ticket.
   *
   * Worth being precise about what this can and cannot do, because it is easy
   * to mistake for a scanner. `redact()`'s value matching is **anchored**: it
   * masks a string that *is* a `Bearer …` header, *is* a bare JWT, or *is* a
   * URL carrying a credential-shaped parameter. It does not find one embedded
   * in a sentence, and nothing here pretends otherwise — an error message
   * reading "refresh failed for Bearer abc…" survives, and the panel showing
   * you the text before you send it is the mitigation, as always.
   *
   * The corollary is the one that mattered: **never assemble a sentence out of
   * foreign parts and then redact the sentence.** Anchoring means the parts
   * were findable and the sentence is not. See `describeAttribution` in
   * `responsiveness.ts`, which masks each field before joining them.
   */
  const redactText = (value: string): string => {
    try {
      return String(redact(value, redactOptions));
    } catch {
      // Only reachable through hostile `redactOptions`, but this runs on the
      // failure path, and the failure path may not fail.
      return "[unreadable]";
    }
  };

  /**
   * A thrown value rendered for the snapshot: **message redacted, then joined
   * to the name.** Never the other way round — see `describeParts`.
   *
   * The message itself may still hide a credential mid-sentence, which is the
   * documented anchored-matching limit and is pinned by its own test. What this
   * guarantees is only that *this package's own prefix* is not what defeated
   * the matcher.
   */
  const describeSafely = (error: unknown): string => {
    const { name, message } = describeParts(error);
    const masked = message === "" ? "" : redactText(message);
    if (name === undefined) {
      return masked === "" ? "an error with no message" : masked;
    }
    // The name is foreign too. `error.name` is a writable own property, not a
    // class identifier the runtime guarantees — `Object.assign(err, { name })`
    // is all it takes — so a name of `Bearer …` or a bare JWT reached the
    // report untouched while the message beside it was being masked. Both
    // halves of a join this package performs are foreign until proven
    // otherwise; masking one of them is not the rule, it is half the rule.
    const maskedName = redactText(name);
    return masked === "" ? maskedName : `${maskedName}: ${masked}`;
  };

  /**
   * The one place a raw foreign value is touched. Order is load-bearing:
   * `redact()` walks the **object**, and only then is the result serialised
   * anywhere. Reversing these two lines is the §11.3 leak.
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

  /** Redact, then prove it serialises. In that order, always. */
  const finish = (entry: { id: string; label: string }, raw: unknown): DiagnosticContribution => {
    let redacted: unknown;
    try {
      redacted = redact(raw, redactOptions);
    } catch (error) {
      // `redact()` walks with `Object.entries`, which invokes getters. A getter
      // that throws anywhere at any depth lands here.
      return {
        id: entry.id,
        label: entry.label,
        status: "failed",
        error: `redacting it threw — ${describeSafely(error)}`,
      };
    }
    if (redacted === undefined) {
      return {
        id: entry.id,
        label: entry.label,
        status: "absent",
      };
    }
    try {
      // Not the output — the *check*. A `BigInt` survives `redact()` and throws
      // here, and one extension must not cost the reader the whole snapshot.
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
        // Core contains the per-extension throws already, so this is
        // unreachable today — but a reader that lets a failure in what it reads
        // escape takes the toolbar down with it (§13.4).
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
      // This extension is the reader, not a contributor: listing itself would
      // be a line saying "the thing writing this said nothing", and declaring a
      // `diagnostics()` here would recurse.
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
        // Core hands over the message and the name separately, precisely so
        // this line can mask the message *before* prefixing it. Joining first
        // is what put `refresh_token=…` in a ticket.
        const message = redactText(entry.error ?? "diagnostics() threw.");
        // `errorName` gets the same pass, for the reason `describeSafely`
        // gives: it is `error.name`, which is writable, so it is foreign data
        // like everything else core hands over.
        const name = entry.errorName === undefined ? undefined : redactText(entry.errorName);
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

  /**
   * Responsiveness, with the attribution strings redacted. Those are the only
   * foreign data in the report — they come from the host page's own markup —
   * and everything else in it is a number this extension computed.
   */
  const readResponsiveness = (): ResponsivenessReport => {
    const report = monitor.report();
    const clean = (sample: LongTaskSample): LongTaskSample => ({
      ...sample,
      attribution: sample.attribution === null ? null : redactText(sample.attribution),
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
      app: appContribution?.status === "ok" ? appContribution.data : null,
      contributions,
      omissions,
    };
  };

  /**
   * Nothing in a capture may propagate. It runs from a click handler and from
   * an aggregated command, and it reads consumer-owned data through getters
   * `redact()` invokes — so a throw anywhere becomes a snapshot that says the
   * capture failed, which is still a usable bug report.
   */
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

  /** Same rule as `nowIso`: nothing on the failure path may itself fail. */
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
    app: null,
    contributions: [],
    omissions: [
      {
        id: "*",
        label: "The whole snapshot",
        // Redacted like every other foreign string. This one was not, and it
        // is the worst place to miss: the omissions banner of the very report
        // that says nothing below it is complete.
        reason: `building it threw — ${describeSafely(error)}. Nothing below is complete.`,
      },
    ],
  });

  const store = createThrottledStore<DiagnosticsSnapshotState>(NO_SNAPSHOT, {
    intervalMs: 100,
    // The store's own default clock is `performance.now()`, unguarded, and
    // `set()` reads it — so a host with a hostile `performance.now` would throw
    // from inside the publish that follows a *failed* capture. Handing it the
    // guarded clock keeps the whole path fail-closed rather than only the part
    // of it this file owns.
    now,
  });

  const capture = (): DiagnosticSnapshot => {
    const snapshot = build();
    const previous = store.peek();
    store.set({
      revision: previous.revision + 1,
      snapshot,
      capturedAt: now(),
    });
    store.flush();
    return snapshot;
  };

  const ensure = (): DiagnosticSnapshot => store.peek().snapshot ?? capture();

  const render = (format: SnapshotFormat): string =>
    format === "json" ? renderJson(ensure()) : renderMarkdown(ensure(), mask);

  const filename = (format: SnapshotFormat): string => {
    // `:` is illegal in a filename on Windows and awkward everywhere; `.` would
    // read as a second extension. `generatedAt` can also be the literal
    // "unknown" on the failure path, which is a perfectly good stamp.
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
      // Bounded, but never by revoking early: forcing the oldest revoker at a
      // fixed depth could cancel a download that was still in flight — a large
      // snapshot over a slow disk, or nine captures in quick succession. Each
      // revoker self-clears on its own timer, so the only thing that needs
      // bounding is the list of already-spent closures.
      revocations.push(revoke);
      revocations = revocations.filter((entry) => !entry.spent());
      return true;
    },

    readFormat() {
      const stored = storage?.getItem(FORMAT_KEY);
      return SNAPSHOT_FORMATS.includes(stored as SnapshotFormat)
        ? (stored as SnapshotFormat)
        : "markdown";
    },

    writeFormat(format) {
      storage?.setItem(FORMAT_KEY, format);
    },

    start(runtimeApi: ExtensionRuntimeApi) {
      api = runtimeApi;
      storage = runtimeApi.storage;

      // The monitor keeps observing while the bar is hidden. Core reports
      // visibility and never pauses anybody (§2), and this is the case where
      // that matters most: the long task you want in the bug report happened
      // while you were using the application, not while you were reading the
      // toolbar. `PerformanceObserver` costs nothing between entries.
      monitor.start();

      const dispose = () => {
        monitor.stop();
        // Object URLs outlive the extension unless something revokes them, and
        // a revoke that has not happened yet is a retained Blob.
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
    // Every contribution was proved serialisable on the way in, so this is
    // unreachable — and a copy button that throws is worse than one that
    // reports a problem.
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

const fence = (value: unknown): string => {
  let body: string;
  try {
    body = JSON.stringify(value, null, 2) ?? "null";
  } catch (error) {
    body = `"unserialisable — ${safeDescribe(error)}"`;
  }
  // A fenced block must be delimited by a longer run of backticks than anything
  // inside it. Hard-coding four was one better than the naive three and no
  // better than that: a contribution holding four — a README that itself
  // escapes a fence — would have ended the block early and spilled the rest of
  // the snapshot into the surrounding prose. Measure instead of guessing.
  let longest = 0;
  for (const run of body.match(/`+/g) ?? []) {
    if (run.length > longest) longest = run.length;
  }
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return `${ticks}json\n${body}\n${ticks}`;
};

/**
 * One row of the Page table.
 *
 * Cells are escaped, which is not cosmetic: every value in this table is
 * foreign (a user agent, a URL, a time zone), a raw `|` splits the row into
 * extra columns and a newline ends the table outright — so a hostile or merely
 * unusual value could push the rest of the snapshot out of the rendered table
 * and into whatever the ticket system does with loose text.
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

/**
 * Markdown, for pasting into a ticket. Built entirely from the already-redacted
 * snapshot: this function receives no raw value and has no access to one.
 */
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

  // The banner comes before the data, not after it. A completeness warning at
  // the bottom of a long paste is a warning nobody reads.
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
      // `worst null ms (null)` is what the naive version printed for a window
      // with nothing in it. A report is read by somebody who was not there, and
      // a stray `null` reads as a bug in the tool rather than as an empty window.
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
 * How many values the mask replaced, counted once, canonically.
 *
 * Two browser-found defects live in this function, and they are the same
 * defect twice: **the count and the thing it counts must be the same thing.**
 *
 * The first was that it counted occurrences in the rendered *Markdown*, whose
 * own footer says ``masked as `[redacted]` `` — so it counted its own sentence,
 * and the panel's toolbar disagreed with the footer of the very text it was
 * displaying: 6 against 5. Counting from the snapshot's JSON fixed that.
 *
 * The second is that counting the *literal* mask undercounts. A mask written
 * into a URL query goes in through `URLSearchParams.set`, which percent-encodes
 * it: `?access_token=%5Bredacted%5D`. That shape is invisible to a literal
 * search — and it is not an edge case, it is the OAuth-callback shape that
 * §11.3 and this file both call the most likely credential carrier in the whole
 * snapshot. A page whose *only* sensitive datum was a token in the address bar
 * therefore masked it correctly and then printed "No values were masked… none
 * matched here", which is a false statement in a document whose entire argument
 * is that masking is visible. Both encodings are counted, and the encoded form
 * is only searched for when it actually differs.
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
    // A lone surrogate in a custom mask. Nothing to add.
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
 * Splits a thrown value into name and message, **unjoined** — the same split
 * core's `describe` makes, and for the same reason.
 *
 * Joining before redacting is the leak. `redact()`'s value matching is anchored
 * to the whole string, so `"Error: https://api.test/refresh?refresh_token=…"`
 * defeats it while the bare message does not. Three sibling paths here had it:
 * a source that throws, an `app` getter that throws, and a getter that throws
 * while `redact()` walks a contribution. All three now redact the message first
 * and prefix afterwards, via `describeSafely` inside the factory — which is
 * where `redactOptions` lives.
 */
function describeParts(error: unknown): { name?: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: safeDescribe(error) };
}

/** `String(value)` on a hostile object can itself throw. */
function safeDescribe(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "a value that could not be described";
  }
}

/**
 * Starts a download and returns its revoker, or `null` when the environment
 * cannot do it.
 *
 * A download from a page is a real user action, so this is legitimate here in a
 * way it would not be on a timer. It is also the one place this extension
 * touches the host document, so the trade is worth stating: the anchor is
 * appended and removed synchronously in the same task, because Firefox has
 * historically ignored `click()` on a detached anchor, and appending it is
 * strictly less invasive than the alternative of asking the consumer to provide
 * a mount point.
 *
 * The object URL is *not* revoked synchronously — several browsers cancel the
 * download when it is — so revocation is deferred and the revoker is also
 * handed back so teardown can run it early rather than retaining the Blob.
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
    // A hostile or exhausted `setTimeout` must not throw out of the click that
    // started a download. Without a timer the URL is revoked on teardown
    // instead, which is later than intended and never never.
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
