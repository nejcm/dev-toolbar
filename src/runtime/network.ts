/**
 * The shared HTTP interceptor. [dev-toolbar/runtime] One wrapper, many sinks —
 * `fetch`/`XMLHttpRequest` are global and shared with the host app, so who
 * patches them is a package-wide question. Method/URL reach a sink raw;
 * redaction is the sink's job. Full contract, including the dual-package
 * hazard and why `/ext/metrics` value-imports this module rather than
 * relatively, is in docs/runtime.md.
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
 * Swallows sink errors on purpose: this runs inside the host app's
 * `fetch`/`XMLHttpRequest`, and a bug here must never surface as a failed
 * request in the app being measured.
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
