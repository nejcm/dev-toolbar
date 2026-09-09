/**
 * In-flight and recent HTTP requests. [dev-toolbar/ext/metrics]
 *
 * Two instrumentation routes: pass a `/runtime` bus and emit `network-start` /
 * `network-end` yourself, or let `/runtime`'s shared interceptor
 * (`src/runtime/network.ts`) patch `fetch`/`XMLHttpRequest` for you — this
 * collector is one sink among possibly several. Every URL, and the URL-shaped
 * substrings of an error message, goes through `redactUrl()` before retention;
 * headers and bodies are never read.
 */
import { UNREADABLE, createRingBuffer, createTimeSeries, redactUrl } from "../../../runtime";
// Through the published specifier, not `../../../runtime`: a relative value
// import would inline a second copy of the interceptor's patch state into
// dist/ext/metrics.cjs (docs/architecture.md § "external"). Everything else
// here is stateless and stays relative.
import { instrumentFetch, instrumentXhr } from "@nejcm/dev-toolbar/runtime";
import type { BusLike, RedactOptions, ToolbarEventMap } from "../../../runtime";
import type { NetworkSink } from "../../../runtime";
import { formatCount, formatMs } from "../format";
import type { Collector, CollectorContext, MetricView, NetworkEntryView } from "../types";

export interface NetworkEntry {
  id: string;
  method: string;
  /** Already redacted. */
  url: string;
  startedAt: number;
  completedAt: number | undefined;
  status: number | undefined;
  bytes: number | undefined;
  error: string | undefined;
  aborted: boolean;
}

export interface NetworkCollectorOptions {
  /** Wrap `globalThis.fetch`. Default `true` without `bus`, otherwise `false`. */
  patchFetch?: boolean;
  /** Wrap `XMLHttpRequest`. Default `true` without `bus`, otherwise `false`. */
  patchXhr?: boolean;
  /**
   * Consume `network-start` / `network-end` from a `/runtime` bus, so an app
   * can report its own client instead of being patched. Supplying a bus turns
   * both patchers off by default; set either patch option explicitly to combine
   * instrumentation routes. Typed as `BusLike` (only `emit`/`on`), not
   * `ToolbarBus`, so a mock bus or an adapter over an app's own emitter both
   * satisfy it.
   */
  bus?: BusLike<ToolbarEventMap>;
  /** Requests retained for the panel list. Default `100`. */
  historySize?: number;
  /** Longer than this counts as slow. Default `1000` ms. */
  slowMs?: number;
  /** Rolling window for the failure/slow read-out. Default `30000` ms. */
  windowMs?: number;
  /** Extra query-parameter names to mask. */
  redact?: RedactOptions;
  /** Return false to ignore a request entirely — your own telemetry endpoint, say. */
  filter?: (request: { method: string; url: string }) => boolean;
}

/**
 * The network collector's own surface, on top of `Collector`. Recording is
 * what pauses — never the interceptor itself, since unpatching on a toggle
 * would hand the wrapper back to whatever patched after us.
 */
export interface NetworkCollector extends Collector {
  /** Newest first, already redacted. Required here, optional on `Collector`. */
  entries(now: number): readonly NetworkEntryView[];
  /** Stop or resume *recording*. Returns the state after the change. */
  setPaused(paused: boolean): boolean;
  isPaused(): boolean;
  /**
   * The `redact` options this collector was built with. Exposed so anything
   * re-rendering a retained URL — `network.copyAsCurl`, say — masks exactly
   * what the panel masked, including a consumer's `extraKeys`.
   */
  readonly redactOptions: RedactOptions | undefined;
}

/**
 * Re-exported from `/runtime`, where the interceptor now lives (one wrapper for
 * every caller in the package). Kept exported here so
 * `@nejcm/dev-toolbar/ext/metrics` keeps the names it has always published.
 */
export { instrumentFetch, instrumentXhr } from "@nejcm/dev-toolbar/runtime";
export type { NetworkSink, NetworkSinkResult } from "../../../runtime";

// An absolute-URL substring inside free text (unanchored, unlike `redact()`'s
// `ABSOLUTE_URL`). Closing delimiters `)`/`]` and `.,;:!?` end the match only
// as its last character, so a URL wrapped in punctuation still stops cleanly
// without truncating a query like `?ids[]=1&access_token=abc` at the first `]`.
// The leading lookbehind keeps this linear: without it, a long app-supplied
// alphanumeric run (e.g. base64) is quadratic to fail on — measured at 5.4s
// for 200k letters. Cost: a URL glued to a preceding digit/`.`/`-`/`+` with no
// separator is not matched; do not remove the lookbehind to catch that case.
//
// Byte-identical to `TEXT_URL` in `src/runtime/redact.ts`; keep them in step.
// This is the one URL scanner outside `/runtime`, kept on purpose: the error
// column is the panel's own sentence about a request, and `redactProse()`'s
// whitespace-delimited sweep would (a) pull sentence punctuation into the mask
// and (b) read two URLs glued together by a `,` or `"` as one, leaving the
// second one's credential in place — both pinned in `network.test.ts`.
const URL_IN_TEXT =
  /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'`<>]*[^\s"'`<>)\].,;:!?]/g;

export function createNetworkCollector(options: NetworkCollectorOptions = {}): NetworkCollector {
  const { bus } = options;
  const {
    patchFetch = bus === undefined,
    patchXhr = bus === undefined,
    historySize = 100,
    slowMs = 1000,
    windowMs = 30_000,
    filter,
  } = options;

  const entries = createRingBuffer<NetworkEntry>(historySize);
  const byId = new Map<string, NetworkEntry>();
  const pending = new Map<string, { entry: NetworkEntry | null; startedAt: number }>();
  const series = createTimeSeries(120);
  const pendingMaxAge = Math.max(windowMs, 60_000);
  const pendingLimit = Math.max(64, entries.capacity);
  let sequence = 0;
  let totals = { started: 0, completed: 0, failed: 0, aborted: 0, slow: 0 };
  let pendingDropped = 0;
  let duplicateStarts = 0;
  let paused = false;

  const supported =
    (patchFetch && typeof globalThis.fetch === "function") ||
    (patchXhr && typeof XMLHttpRequest === "function") ||
    bus !== undefined;

  const clean = (url: string) => redactUrl(url, options.redact);

  // Error text is foreign (a rejection routinely names the failed request's
  // URL), so only URL-shaped substrings are rewritten — `redactUrl()` on the
  // whole sentence would resolve it against a base and mangle the message, and
  // `redactText()`'s JWT rule would mask a three-label hostname like
  // `frontend.production.internal`, the one thing this column is for. Nothing
  // else in the text is judged: a message that *is* a bare credential stays as
  // written (pinned). Each match is guarded, because `redactUrl()` throws on
  // its fallback path for an unparseable URL under a mask
  // `encodeURIComponent()` rejects; unguarded, that throw escaped `finish()`
  // after `completedAt` was set and before the totals moved, leaving the entry
  // `ok` with no error and nothing counted. A URL that could not be inspected
  // is replaced in place — never handed back raw — while the words around it
  // and any other URL in the sentence are kept and masked as usual. Only text
  // *outside* a match survives a failure, and that text is retained on the
  // non-throwing path too. The outer guard is for `replace` itself failing.
  const cleanErrorText = (text: string): string => {
    try {
      return text.replace(URL_IN_TEXT, (url) => {
        try {
          return clean(url);
        } catch {
          return UNREADABLE;
        }
      });
    } catch {
      return UNREADABLE;
    }
  };

  const begin = (now: number, method: string, rawUrl: string, id?: string): NetworkEntry | null => {
    // Paused records nothing new; what is already retained stays readable, and
    // an in-flight request whose `begin` was skipped simply has no entry to
    // finish. Redaction runs before the filter either way, so a `filter` never
    // sees a raw credential.
    if (paused) return null;
    const url = clean(rawUrl);
    if (filter && !filter({ method, url })) return null;
    sequence += 1;
    const entry: NetworkEntry = {
      id: id ?? `r${sequence}`,
      method,
      url,
      startedAt: now,
      completedAt: undefined,
      status: undefined,
      bytes: undefined,
      error: undefined,
      aborted: false,
    };
    // Ring may evict an old entry; drop its index entry too so the map can't outgrow the ring.
    if (entries.size === entries.capacity) {
      const evicted = entries.at(0);
      if (evicted && byId.get(evicted.id) === evicted) byId.delete(evicted.id);
    }
    entries.push(entry);
    byId.set(entry.id, entry);
    totals = { ...totals, started: totals.started + 1 };
    return entry;
  };

  const sweepPending = (now: number): void => {
    const oldestAllowed = now - pendingMaxAge;
    for (const [requestId, record] of pending) {
      if (record.startedAt >= oldestAllowed) break;
      pending.delete(requestId);
      pendingDropped += 1;
    }
  };

  const rememberPending = (requestId: string, entry: NetworkEntry | null, now: number): void => {
    sweepPending(now);
    if (pending.has(requestId)) {
      duplicateStarts += 1;
      pending.delete(requestId);
    }
    pending.set(requestId, { entry, startedAt: now });
    while (pending.size > pendingLimit) {
      const oldest = pending.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      pending.delete(oldest);
      pendingDropped += 1;
    }
  };

  const finish = (
    entry: NetworkEntry | null,
    now: number,
    result: {
      status?: number | undefined;
      bytes?: number | undefined;
      error?: string | undefined;
      aborted?: boolean;
    },
  ) => {
    if (!entry || entry.completedAt !== undefined) return;
    entry.completedAt = now;
    entry.status = result.status;
    entry.bytes = result.bytes;
    entry.error = result.error === undefined ? undefined : cleanErrorText(result.error);
    entry.aborted = result.aborted ?? false;
    const duration = now - entry.startedAt;
    const failed =
      result.error !== undefined || (result.status !== undefined && result.status >= 400);
    totals = {
      started: totals.started,
      completed: totals.completed + 1,
      failed: totals.failed + (failed && !entry.aborted ? 1 : 0),
      aborted: totals.aborted + (entry.aborted ? 1 : 0),
      slow: totals.slow + (duration > slowMs ? 1 : 0),
    };
    series.push(now, duration);
  };

  const stateOf = (entry: NetworkEntry): NetworkEntryView["state"] => {
    if (entry.completedAt === undefined) return "active";
    if (entry.aborted) return "aborted";
    if (entry.error !== undefined) return "failed";
    if (entry.status !== undefined && entry.status >= 400) return "failed";
    return "ok";
  };

  /** Newest first, for the panel table. */
  const list = (now: number): NetworkEntryView[] => {
    const output: NetworkEntryView[] = [];
    for (let index = entries.size - 1; index >= 0; index -= 1) {
      const entry = entries.at(index);
      if (entry === undefined) continue;
      output.push({
        id: entry.id,
        method: entry.method,
        url: entry.url,
        startedAt: entry.startedAt,
        duration: (entry.completedAt ?? now) - entry.startedAt,
        status: entry.status,
        state: stateOf(entry),
        bytes: entry.bytes,
        error: entry.error,
      });
    }
    return output;
  };

  const summarise = (now: number) => {
    const since = now - windowMs;
    let active = 0;
    let failed = 0;
    let slow = 0;
    let inWindow = 0;
    for (let index = 0; index < entries.size; index += 1) {
      const entry = entries.at(index);
      if (entry === undefined) continue;
      const state = stateOf(entry);
      if (state === "active") active += 1;
      if (entry.completedAt === undefined || entry.completedAt < since) continue;
      inWindow += 1;
      if (state === "failed") failed += 1;
      if (entry.completedAt - entry.startedAt > slowMs) slow += 1;
    }
    return { active, failed, slow, inWindow };
  };

  return {
    id: "network",
    estimatedCost: "minimal",
    supported,
    redactOptions: options.redact,
    setPaused(next: boolean) {
      paused = next;
      return paused;
    },
    isPaused: () => paused,
    ...(supported
      ? {}
      : {
          unsupportedReason:
            "Neither fetch nor XMLHttpRequest is available, and no bus was supplied.",
        }),
    series,

    start(context: CollectorContext) {
      if (bus) {
        bus.on(
          "network-start",
          (payload) => {
            const now = context.now();
            rememberPending(
              payload.requestId,
              begin(now, payload.method, payload.url, payload.requestId),
              now,
            );
            context.invalidate();
          },
          { signal: context.signal },
        );
        bus.on(
          "network-end",
          (payload) => {
            const now = context.now();
            sweepPending(now);
            const record = pending.get(payload.requestId);
            const entry =
              record === undefined ? (byId.get(payload.requestId) ?? null) : record.entry;
            pending.delete(payload.requestId);
            finish(entry, now, {
              status: payload.status,
              bytes: payload.bytes,
              error: payload.error,
              aborted: payload.aborted ?? false,
            });
            context.invalidate();
          },
          { signal: context.signal },
        );
        context.signal.addEventListener("abort", () => pending.clear(), { once: true });
      }

      // One sink, both transports.
      const sink: NetworkSink = {
        begin: (method, url) => {
          const entry = begin(context.now(), method, url);
          context.invalidate();
          return entry;
        },
        end: (token, result) => {
          finish(token as NetworkEntry | null, context.now(), result);
          context.invalidate();
        },
      };

      if (patchFetch) {
        const detach = instrumentFetch(sink);
        context.signal.addEventListener("abort", detach, { once: true });
      }
      if (patchXhr) {
        const detach = instrumentXhr(sink);
        context.signal.addEventListener("abort", detach, { once: true });
      }
    },

    read(now: number): MetricView {
      const detail: [string, string][] = [];
      if (!supported) {
        return {
          id: "network",
          label: "net",
          title: "Network",
          status: "unsupported",
          severity: "unknown",
          display: "NA",
          value: Number.NaN,
          unit: "requests",
          hint: "No fetch, no XMLHttpRequest and no bus: nothing to observe.",
          detail,
        };
      }

      const window = summarise(now);
      detail.push(
        ["Recording", paused ? "paused" : "on"],
        ["Active", String(window.active)],
        ["Completed (session)", formatCount(totals.completed)],
        ["Failed (session)", formatCount(totals.failed)],
        ["Aborted (session)", formatCount(totals.aborted)],
        [`Failed (last ${Math.round(windowMs / 1000)} s)`, String(window.failed)],
        [`Slow >${formatMs(slowMs)} (last ${Math.round(windowMs / 1000)} s)`, String(window.slow)],
        [
          "Instrumentation",
          [bus ? "bus" : "", patchFetch ? "patched fetch" : "", patchXhr ? "patched XHR" : ""]
            .filter(Boolean)
            .join(" + "),
        ],
      );

      return {
        id: "network",
        label: "net",
        title: "Network",
        status: totals.started === 0 ? "pending" : "ok",
        severity: window.failed > 0 ? "bad" : window.slow > 0 ? "warn" : "ok",
        // "paused" rather than a stalled count: the publish signature is built
        // from status/severity/display, so an unchanged count wouldn't notify.
        display: paused ? "paused" : String(window.active),
        value: window.active,
        unit: "requests",
        hint: "Requests in flight now. Time is the span between bus events when a bus reports; patched fetch stops at response headers, patched XMLHttpRequest after the body. The panel masks query credentials.",
        detail,
      };
    },

    reset() {
      entries.clear();
      byId.clear();
      pending.clear();
      series.clear();
      totals = { started: 0, completed: 0, failed: 0, aborted: 0, slow: 0 };
      pendingDropped = 0;
      duplicateStarts = 0;
    },

    entries(now: number) {
      return list(now);
    },

    diagnostics(now: number) {
      return {
        supported,
        paused,
        totals,
        pendingDropped,
        duplicateStarts,
        ...summarise(now),
        recent: list(now).slice(0, 20),
      };
    },
  };
}
