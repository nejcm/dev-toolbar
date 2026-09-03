/**
 * In-flight and recent HTTP requests. [dev-toolbar/ext/metrics]
 *
 * Two instrumentation routes: pass a `/runtime` bus and emit `network-start` /
 * `network-end` from your own HTTP client, or let this patch `fetch` and
 * `XMLHttpRequest` for you. Patches restore the originals on teardown, refuse
 * to patch over another copy of themselves, and refuse to restore over
 * somebody else's later patch.
 *
 * Every URL goes through `redactUrl()` before retention, as do the URL-shaped
 * substrings of an error message — that text is foreign, and a rejection
 * routinely names the request it failed on. Headers and bodies are never read.
 */
import { createRingBuffer, createTimeSeries, redactUrl } from "../../../runtime";
import type { BusLike, RedactOptions, ToolbarEventMap } from "../../../runtime";
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
  /** Wrap `globalThis.fetch`. Default `true`. */
  patchFetch?: boolean;
  /** Wrap `XMLHttpRequest`. Default `true`. */
  patchXhr?: boolean;
  /**
   * Consume `network-start` / `network-end` from a `/runtime` bus, so an app
   * can report its own client instead of being patched. Typed as `BusLike`
   * (only `emit`/`on`), not `ToolbarBus`, so a mock bus or an adapter over an
   * app's own emitter both satisfy it.
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
 * One patch, many recorders.
 *
 * Patch state is module-level, so the usual dual-package hazard applies: a
 * page loading both `dist/ext/metrics.js` and `.cjs` gets two `fetchPatch`
 * copies, each installing its own wrapper. Both still record correctly (they
 * stack rather than conflict), but the app pays for two wrappers — resolve
 * the package to one format to avoid it.
 *
 * The wrapper is installed once, globally, and feeds a set of sinks. It's
 * removed when the last sink leaves, and never removed if something has
 * patched on top of it since (refusing to patch when it saw its own flag on
 * `fetch` would instead make the first of two live collectors own the
 * wrapper while every later one silently records nothing).
 */
export interface NetworkSink {
  /** Returns an opaque token that comes back to `end`. */
  begin(method: string, url: string): unknown;
  end(
    token: unknown,
    result: {
      status?: number | undefined;
      bytes?: number | undefined;
      error?: string | undefined;
      aborted?: boolean;
    },
  ): void;
}

function methodOf(input: unknown, init: RequestInit | undefined): string {
  const fromInit = init?.method;
  if (typeof fromInit === "string") return fromInit.toUpperCase();
  const request = input as { method?: unknown } | undefined;
  if (typeof request?.method === "string") return request.method.toUpperCase();
  return "GET";
}

function urlOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (typeof URL !== "undefined" && input instanceof URL) return input.href;
  const request = input as { url?: unknown } | undefined;
  if (typeof request?.url === "string") return request.url;
  return "unknown";
}

interface Installed {
  sinks: Set<NetworkSink>;
  uninstall(): void;
}

let fetchPatch: Installed | null = null;
let xhrPatch: Installed | null = null;

function attach(
  slot: () => Installed | null,
  set: (value: Installed | null) => void,
  install: (sinks: Set<NetworkSink>) => (() => void) | null,
  sink: NetworkSink,
): () => void {
  let current = slot();
  if (!current) {
    const sinks = new Set<NetworkSink>();
    const uninstall = install(sinks);
    if (!uninstall) return () => {};
    current = { sinks, uninstall };
    set(current);
  }
  const installed = current;
  installed.sinks.add(sink);
  return () => {
    installed.sinks.delete(sink);
    if (installed.sinks.size > 0) return;
    installed.uninstall();
    if (slot() === installed) set(null);
  };
}

/**
 * Both fan-outs swallow sink errors on purpose: these run inside the host
 * app's `fetch`/`XMLHttpRequest`, and a bug here (or in the consumer's own
 * `filter`) must never surface as a failed request in the app being measured.
 */
function fanIn(sinks: Set<NetworkSink>, method: string, url: string): [NetworkSink, unknown][] {
  const tokens: [NetworkSink, unknown][] = [];
  for (const sink of sinks) {
    try {
      tokens.push([sink, sink.begin(method, url)]);
    } catch (error) {
      reportSinkError(error);
    }
  }
  return tokens;
}

function fanOut(tokens: [NetworkSink, unknown][], result: Parameters<NetworkSink["end"]>[1]): void {
  for (const [sink, token] of tokens) {
    try {
      sink.end(token, result);
    } catch (error) {
      reportSinkError(error);
    }
  }
}

function reportSinkError(error: unknown): void {
  // eslint-disable-next-line no-console
  console.error(
    "[dev-toolbar/ext/metrics] a network recorder threw; the request itself is unaffected.",
    error,
  );
}

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

const parseBytes = (raw: string | null | undefined): number | undefined => {
  if (raw === null || raw === undefined) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
};

/** Wraps `globalThis.fetch`. Returns an unsubscribe for this sink. */
export function instrumentFetch(sink: NetworkSink): () => void {
  return attach(
    () => fetchPatch,
    (value) => {
      fetchPatch = value;
    },
    (sinks) => {
      if (typeof globalThis.fetch !== "function") return null;
      const original = globalThis.fetch;
      const wrapper = function patchedFetch(
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> {
        const tokens = fanIn(sinks, methodOf(input, init), urlOf(input));
        let promise: Promise<Response>;
        try {
          promise = original.call(globalThis, input, init);
        } catch (error) {
          fanOut(tokens, { error: String(error) });
          throw error;
        }
        return promise.then(
          (response) => {
            fanOut(tokens, {
              status: response.status,
              bytes: parseBytes(response.headers?.get?.("content-length")),
            });
            return response;
          },
          (error: unknown) => {
            fanOut(tokens, {
              error: String((error as { message?: string } | undefined)?.message ?? error),
              aborted: (error as { name?: string } | undefined)?.name === "AbortError",
            });
            throw error;
          },
        );
      } as typeof globalThis.fetch;

      globalThis.fetch = wrapper;
      return () => {
        // If something patched on top of us, leave their wrapper in place.
        if (globalThis.fetch === wrapper) globalThis.fetch = original;
      };
    },
    sink,
  );
}

/** Wraps `XMLHttpRequest.prototype.open`/`send`. Returns an unsubscribe. */
export function instrumentXhr(sink: NetworkSink): () => void {
  return attach(
    () => xhrPatch,
    (value) => {
      xhrPatch = value;
    },
    (sinks) => {
      if (typeof XMLHttpRequest !== "function") return null;
      const proto = XMLHttpRequest.prototype;
      const originalOpen = proto.open;
      const originalSend = proto.send;
      const meta = new WeakMap<XMLHttpRequest, { method: string; url: string }>();

      const open = function patchedOpen(
        this: XMLHttpRequest,
        method: string,
        url: string | URL,
        ...rest: unknown[]
      ) {
        meta.set(this, {
          method: String(method).toUpperCase(),
          url: String(url),
        });
        return (originalOpen as unknown as (this: XMLHttpRequest, ...args: unknown[]) => void).call(
          this,
          method,
          url,
          ...rest,
        );
      } as typeof proto.open;

      const send = function patchedSend(
        this: XMLHttpRequest,
        body?: Document | XMLHttpRequestBodyInit | null,
      ) {
        const state = meta.get(this);
        if (state) {
          const tokens = fanIn(sinks, state.method, state.url);
          let done = false;
          const settle = (result: Parameters<NetworkSink["end"]>[1]) => {
            if (done) return;
            done = true;
            fanOut(tokens, {
              ...result,
              bytes: parseBytes(this.getResponseHeader?.("content-length")),
            });
          };
          this.addEventListener("load", () => settle({ status: this.status }));
          this.addEventListener("error", () => settle({ error: "network error" }));
          this.addEventListener("timeout", () => settle({ error: "timeout" }));
          this.addEventListener("abort", () => settle({ error: "aborted", aborted: true }));
        }
        return originalSend.call(this, body ?? null);
      } as typeof proto.send;

      proto.open = open;
      proto.send = send;
      return () => {
        if (proto.send === send) proto.send = originalSend;
        if (proto.open === open) proto.open = originalOpen;
      };
    },
    sink,
  );
}

export function createNetworkCollector(options: NetworkCollectorOptions = {}): Collector {
  const {
    patchFetch = true,
    patchXhr = true,
    bus,
    historySize = 100,
    slowMs = 1000,
    windowMs = 30_000,
    filter,
  } = options;

  const entries = createRingBuffer<NetworkEntry>(historySize);
  const byId = new Map<string, NetworkEntry>();
  const series = createTimeSeries(120);
  let sequence = 0;
  let totals = { started: 0, completed: 0, failed: 0, aborted: 0, slow: 0 };

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
      if (evicted) byId.delete(evicted.id);
    }
    entries.push(entry);
    byId.set(entry.id, entry);
    totals = { ...totals, started: totals.started + 1 };
    return entry;
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
    ...(supported
      ? {}
      : {
          unsupportedReason:
            "Neither fetch nor XMLHttpRequest is available, and no bus was supplied.",
        }),
    series,

    start(context: CollectorContext) {
      if (bus) {
        const pending = new Map<string, NetworkEntry | null>();
        bus.on(
          "network-start",
          (payload) => {
            pending.set(
              payload.requestId,
              begin(context.now(), payload.method, payload.url, payload.requestId),
            );
            context.invalidate();
          },
          { signal: context.signal },
        );
        bus.on(
          "network-end",
          (payload) => {
            const entry = pending.get(payload.requestId) ?? byId.get(payload.requestId) ?? null;
            pending.delete(payload.requestId);
            finish(entry, context.now(), {
              status: payload.status,
              bytes: payload.bytes,
              error: payload.error,
              aborted: payload.aborted ?? false,
            });
            context.invalidate();
          },
          { signal: context.signal },
        );
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
        ["Active", String(window.active)],
        ["Completed (session)", formatCount(totals.completed)],
        ["Failed (session)", formatCount(totals.failed)],
        ["Aborted (session)", formatCount(totals.aborted)],
        [`Failed (last ${Math.round(windowMs / 1000)} s)`, String(window.failed)],
        [`Slow >${formatMs(slowMs)} (last ${Math.round(windowMs / 1000)} s)`, String(window.slow)],
        ["Instrumentation", bus ? "bus + patched" : "patched fetch/XHR"],
      );

      return {
        id: "network",
        label: "net",
        title: "Network",
        status: totals.started === 0 ? "pending" : "ok",
        severity: window.failed > 0 ? "bad" : window.slow > 0 ? "warn" : "ok",
        display: String(window.active),
        value: window.active,
        unit: "requests",
        hint: "Requests in flight now. The panel lists recent ones, with query credentials masked.",
        detail,
      };
    },

    reset() {
      entries.clear();
      byId.clear();
      series.clear();
      totals = { started: 0, completed: 0, failed: 0, aborted: 0, slow: 0 };
    },

    entries(now: number) {
      return list(now);
    },

    diagnostics(now: number) {
      return {
        supported,
        totals,
        ...summarise(now),
        recent: list(now).slice(0, 20),
      };
    },
  };
}
