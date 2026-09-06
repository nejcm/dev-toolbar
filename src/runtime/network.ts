/**
 * The shared HTTP interceptor. [dev-toolbar/runtime]
 *
 * `fetch` and `XMLHttpRequest` are global, singular and shared with the host
 * app, so *who* patches them is a package-wide question rather than one
 * extension's business. This is the one wrapper, and everything that wants to
 * observe requests attaches a `NetworkSink` to it — `/ext/metrics`' network
 * collector is simply the first caller.
 *
 * Method and URL are handed to the sink **raw**. Redaction is the sink's job
 * (`/ext/metrics` runs every URL through `redactUrl()` on the way into its ring
 * buffer): a sink that filters on the real URL cannot do so against a masked
 * one. Request headers and bodies are never read; the one response header read
 * is `content-length`, for the byte count a sink reports, and it is read on
 * both paths (`response.headers.get` for `fetch`, `getResponseHeader` for XHR).
 * No body is read, cloned or buffered anywhere.
 *
 * One patch, many recorders.
 *
 * Patch state is module-level, so the usual dual-package hazard applies: a
 * page loading both `dist/runtime.js` and `dist/runtime.cjs` gets two
 * `fetchPatch` copies, each installing its own wrapper. Both still record
 * correctly (they stack rather than conflict), but the app pays for two
 * wrappers, and detaching them inner-first strands the inner one on
 * `globalThis.fetch`: sink-less, so it records nothing, but still forwarding
 * every call, chaining a `.then()` and reading `content-length`. One is
 * stranded per attach/detach cycle, so the chain deepens as long as the page
 * cycles recorders, and deep enough overflows the stack. Resolve the package
 * to one format to avoid all of it. This is also why
 * `/ext/metrics` value-imports this module through `@nejcm/dev-toolbar/runtime`
 * rather than relatively: the CJS build does not code-split, so a relative
 * import would inline a second copy of this state into `dist/ext/metrics.cjs`
 * and a consumer holding both would have two wrappers by construction.
 *
 * The wrapper is installed once, globally, and feeds a set of sinks. It's
 * removed when the last sink leaves, and never removed if something has
 * patched on top of it since (refusing to patch when it saw its own flag on
 * `fetch` would instead make the first of two live collectors own the
 * wrapper while every later one silently records nothing).
 */

/** How a completed request is reported back to a sink. */
export interface NetworkSinkResult {
  status?: number | undefined;
  bytes?: number | undefined;
  error?: string | undefined;
  aborted?: boolean;
}

export interface NetworkSink {
  /** Returns an opaque token that comes back to `end`. `method`/`url` are unredacted. */
  begin(method: string, url: string): unknown;
  end(token: unknown, result: NetworkSinkResult): void;
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
 * app's `fetch`/`XMLHttpRequest`, and a bug here (or in a consumer's own
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

function fanOut(tokens: [NetworkSink, unknown][], result: NetworkSinkResult): void {
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
    "[dev-toolbar/runtime] a network recorder threw; the request itself is unaffected.",
    error,
  );
}

const parseBytes = (raw: string | null | undefined): number | undefined => {
  if (raw === null || raw === undefined) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
};

/**
 * Wraps `globalThis.fetch`. Returns an unsubscribe for this sink; the wrapper
 * itself goes away with the last one, and only if nothing patched over it.
 *
 * A no-op returning a no-op unsubscribe where there is no `fetch` — SSR, or a
 * runtime without one — rather than throwing at import time.
 */
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
          const settle = (result: NetworkSinkResult) => {
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
