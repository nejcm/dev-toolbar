/**
 * In-flight and recent HTTP requests. [dev-toolbar/ext/metrics]
 *
 * Two instrumentation routes: pass a `/runtime` bus and emit `network-start` /
 * `network-end` from your own HTTP client, or let `/runtime`'s shared
 * interceptor patch `fetch` and `XMLHttpRequest` for you. The patches live in
 * `src/runtime/network.ts` — one wrapper feeding every sink in the package,
 * restored on teardown by identity and never restored over somebody else's
 * later patch. This collector is one sink among possibly several.
 *
 * Every URL goes through `redactUrl()` before retention, as do the URL-shaped
 * substrings of an error message — that text is foreign, and a rejection
 * routinely names the request it failed on. Headers and bodies are never read.
 */
import { createRingBuffer, createTimeSeries, redactUrl } from "../../../runtime";
/**
 * The one stateful import in this file that goes through the **published**
 * specifier rather than `../../../runtime`. The interceptor's patch state is
 * module-level, and the CJS build does not code-split: a relative value import
 * would be inlined into `dist/ext/metrics.cjs`, so a consumer using both this
 * collector and `@nejcm/dev-toolbar/runtime`'s `instrumentFetch()` would install
 * two wrappers. `@nejcm/dev-toolbar` is `external` in `tsup.config.ts`, so this
 * resolves to the host's single copy in both formats — the same rule that keeps
 * `/kit` one instance. Everything else here is stateless and stays relative.
 */
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
 * The network collector's own surface, on top of `Collector`.
 *
 * `/ext/metrics` reaches for these when it builds the `network.*` commands;
 * a consumer holding the collector can call them directly. Recording is what
 * pauses — never the interceptor: unpatching and re-patching `fetch` on a
 * toggle would hand the wrapper back to whatever patched after us, and pausing
 * is not a reason to fight over a global.
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

/**
 * An absolute-URL substring inside free text. Same scheme shape `redact()`'s
 * `ABSOLUTE_URL` uses, but unanchored. Only whitespace, a quote and `<>` end it
 * mid-URL; the closing delimiters `)` and `]` and the sentence punctuation
 * `.,;:!?` are excluded from the **last character only**.
 *
 * That split is load-bearing in both directions. Excluding them from the last
 * character is what keeps `…?token=x. Then` from burying its full stop in the
 * mask, and what lets `(https://a.test/?token=x)` and `[https://a.test/]` stop
 * at their closing delimiter. Excluding them mid-URL instead would truncate the
 * match at the *first* `)` or `]` — so a bracketed array or filter parameter,
 * ordinary Rails / PHP / JSON:API query syntax, ended the match before the
 * credential that followed it and `?ids[]=1&access_token=abc` went to
 * `diagnostics()` verbatim. A legitimate trailing dot inside a path is still
 * consumed mid-URL for the same reason.
 *
 * The leading lookbehind is what keeps this linear. Without it, every position
 * inside a long alphanumeric run is a candidate start: `[A-Za-z][A-Za-z0-9+.-]*`
 * scans to the end of the run before failing on the missing `:`, which is
 * quadratic — the same shape Phase 1's R1 removed from `ACRONYM`, and reachable
 * here because the text is app-supplied (a stringified body or a base64 blob in
 * an error message, and `[A-Za-z0-9+.-]` covers most of base64). 200k letters
 * took 5.4s synchronously inside the host's rejection handler; the lookbehind
 * makes every interior position fail in O(1).
 *
 * The lookbehind has a deliberate cost: a URL glued directly to a preceding
 * digit, `.`, `-` or `+` with no separator (`code=1https://a.test/?token=x`) is
 * not seen at all. That is accepted, not overlooked — dropping the lookbehind
 * to catch it puts the quadratic blow-up straight back. Widen the *separator*
 * class if a real case turns up; do not remove the lookbehind.
 */
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

  /**
   * Error text is *foreign*: it comes from the host's `fetch` rejection, an
   * `XMLHttpRequest` event, or whatever an app put on a `network-end` payload.
   * A rejection routinely names the request it failed on
   * (`TypeError: Failed to fetch https://api.test/v1?token=abc`), so the string
   * kept for `diagnostics()` and the panel had a credential in it while the
   * sibling `url` field next to it was already redacted.
   *
   * Only the URL-shaped substrings are rewritten, not the whole message:
   * `redactUrl()` on a whole sentence resolves it against a base and comes back
   * percent-encoded, which would mangle the one piece of a failed request a
   * developer actually reads. Non-URL secrets in foreign prose are still not
   * covered — this pass only knows URLs.
   */
  const cleanErrorText = (text: string) => text.replace(URL_IN_TEXT, (url) => clean(url));

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
        /**
         * The chip says `paused` rather than a count that has stopped moving.
         * It is also what makes the pause *visible*: the metrics runtime's
         * publish signature is built from `status`, `severity` and `display`
         * for a built-in, so a state that changed none of those would leave
         * the panel showing "Recording: on" until the next request arrived.
         */
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
