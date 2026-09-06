/**
 * The shared interceptor's own tests.
 *
 * Most of these arrived with the code from
 * `src/ext/metrics/__tests__/network.test.ts` (Phase 1A moved the interceptor
 * into `/runtime`): the "one wrapper, many sinks" idempotency and the
 * refuse-to-restore-over-a-later-patch behaviour are properties of the patch,
 * not of the collector that happened to own it first, so they are asserted
 * here against `instrumentFetch`/`instrumentXhr` directly. The collector keeps
 * the tests that are about *recording* — including the one proving two live
 * collectors share this wrapper.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { instrumentFetch, instrumentXhr } from "../network";
import type { NetworkSink, NetworkSinkResult } from "../network";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const response = (status = 200, length?: string) =>
  ({
    status,
    headers: { get: (name: string) => (name === "content-length" ? (length ?? null) : null) },
  }) as unknown as Response;

/** Records what the interceptor hands it, in order. */
function recorder(name = "sink") {
  const calls: { method: string; url: string; result?: NetworkSinkResult }[] = [];
  let sequence = 0;
  const sink: NetworkSink = {
    begin(method, url) {
      sequence += 1;
      const call = { method, url };
      calls.push(call);
      return `${name}:${sequence}`;
    },
    end(token, result) {
      calls.push({ method: "end", url: String(token), result });
    },
  };
  return { sink, calls };
}

describe("instrumentFetch", () => {
  it("installs one wrapper for many sinks and restores by identity with the last", async () => {
    const base = vi.fn(async () => response(200, "12")) as unknown as typeof fetch;
    globalThis.fetch = base;

    const first = recorder("a");
    const detachFirst = instrumentFetch(first.sink);
    const wrapper = globalThis.fetch;
    expect(wrapper).not.toBe(base);

    const second = recorder("b");
    const detachSecond = instrumentFetch(second.sink);
    // Installed once — not a wrapper per sink.
    expect(globalThis.fetch).toBe(wrapper);

    await globalThis.fetch("/api/shared");
    expect(first.calls).toEqual([
      { method: "GET", url: "/api/shared" },
      { method: "end", url: "a:1", result: { status: 200, bytes: 12 } },
    ]);
    expect(second.calls).toEqual([
      { method: "GET", url: "/api/shared" },
      { method: "end", url: "b:1", result: { status: 200, bytes: 12 } },
    ]);

    detachFirst();
    // Still installed while a sink remains…
    expect(globalThis.fetch).toBe(wrapper);
    await globalThis.fetch("/api/after");
    expect(first.calls).toHaveLength(2);
    expect(second.calls).toHaveLength(4);

    detachSecond();
    // …and restored *by identity*, not by shape.
    expect(globalThis.fetch).toBe(base);
  });

  it("re-installs after the last sink left, so a later attach still records", async () => {
    const base = vi.fn(async () => response(204)) as unknown as typeof fetch;
    globalThis.fetch = base;
    instrumentFetch(recorder().sink)();
    expect(globalThis.fetch).toBe(base);

    const again = recorder();
    const detach = instrumentFetch(again.sink);
    expect(globalThis.fetch).not.toBe(base);
    await globalThis.fetch("/api/again");
    expect(again.calls[0]).toEqual({ method: "GET", url: "/api/again" });
    detach();
    expect(globalThis.fetch).toBe(base);
  });

  it("never unpatches over a stranger's later wrapper", () => {
    const base = vi.fn(async () => response(200)) as unknown as typeof fetch;
    globalThis.fetch = base;
    const detach = instrumentFetch(recorder().sink);

    const stranger = vi.fn(async () => response(200)) as unknown as typeof fetch;
    globalThis.fetch = stranger;
    detach();
    expect(globalThis.fetch).toBe(stranger);
  });

  it("reads the method and URL off every input shape fetch accepts", async () => {
    globalThis.fetch = vi.fn(async () => response(200)) as unknown as typeof fetch;
    const { sink, calls } = recorder();
    const detach = instrumentFetch(sink);

    await globalThis.fetch("/plain");
    await globalThis.fetch("/init", { method: "post" });
    await globalThis.fetch(new URL("https://api.test/absolute"));
    await globalThis.fetch({ method: "put", url: "/request-like" } as unknown as Request);
    await globalThis.fetch(undefined as unknown as string);

    expect(calls.filter((call) => call.method !== "end")).toEqual([
      { method: "GET", url: "/plain" },
      { method: "POST", url: "/init" },
      { method: "GET", url: "https://api.test/absolute" },
      { method: "PUT", url: "/request-like" },
      { method: "GET", url: "unknown" },
    ]);
    detach();
  });

  it("reports rejections, aborts and synchronous throws, and rethrows every one", async () => {
    const { sink, calls } = recorder();

    globalThis.fetch = vi.fn(async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }) as unknown as typeof fetch;
    let detach = instrumentFetch(sink);
    await expect(globalThis.fetch("/abort")).rejects.toThrow("aborted");
    expect(calls.at(-1)).toEqual({
      method: "end",
      url: "sink:1",
      result: { error: "aborted", aborted: true },
    });
    detach();

    globalThis.fetch = (() => {
      throw new Error("synchronous");
    }) as unknown as typeof fetch;
    detach = instrumentFetch(sink);
    expect(() => globalThis.fetch("/sync")).toThrow("synchronous");
    expect(calls.at(-1)).toEqual({
      method: "end",
      url: "sink:2",
      result: { error: "Error: synchronous" },
    });
    detach();
  });

  it("never lets a throwing sink break the host app's request", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    globalThis.fetch = vi.fn(async () => response(200)) as unknown as typeof fetch;
    const good = recorder();
    const detachBad = instrumentFetch({
      begin() {
        throw new Error("bad begin");
      },
      end() {
        throw new Error("bad end");
      },
    });
    const detachAlsoBad = instrumentFetch({
      begin: () => "token",
      end() {
        throw new Error("bad end");
      },
    });
    const detachGood = instrumentFetch(good.sink);

    // Observing a request is not permission to fail it, and one broken
    // recorder must not blind the others.
    await expect(globalThis.fetch("/api/x")).resolves.toMatchObject({ status: 200 });
    expect(good.calls).toHaveLength(2);
    expect(error.mock.calls.map(([message]) => message)).toEqual([
      "[dev-toolbar/runtime] a network recorder threw; the request itself is unaffected.",
      "[dev-toolbar/runtime] a network recorder threw; the request itself is unaffected.",
    ]);

    detachBad();
    detachAlsoBad();
    detachGood();
  });

  it("is a no-op where there is no fetch at all", () => {
    // SSR, or a runtime old enough to lack it. Attaching must not throw, and
    // detaching must not resurrect anything.
    const saved = globalThis.fetch;
    // @ts-expect-error — deleting a global the type system says is always there.
    delete globalThis.fetch;
    try {
      const detach = instrumentFetch(recorder().sink);
      expect(globalThis.fetch).toBeUndefined();
      detach();
      expect(globalThis.fetch).toBeUndefined();
    } finally {
      globalThis.fetch = saved;
    }
  });
});

describe("instrumentXhr", () => {
  class FakeXhr extends EventTarget {
    status = 0;
    open(_method: string, _url: string | URL): void {}
    send(_body?: unknown): void {}
    getResponseHeader(_name: string): string | null {
      return null;
    }
    emit(type: string) {
      this.dispatchEvent(new Event(type));
    }
  }

  const withFakeXhr = (body: () => void) => {
    const original = globalThis.XMLHttpRequest;
    globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
    try {
      body();
    } finally {
      globalThis.XMLHttpRequest = original;
    }
  };

  it("installs one pair of patches for many sinks and restores both by identity", () => {
    withFakeXhr(() => {
      const originalOpen = FakeXhr.prototype.open;
      const originalSend = FakeXhr.prototype.send;
      const first = recorder("a");
      const second = recorder("b");
      const detachFirst = instrumentXhr(first.sink);
      const patchedSend = FakeXhr.prototype.send;
      const detachSecond = instrumentXhr(second.sink);
      expect(FakeXhr.prototype.send).toBe(patchedSend);

      const request = new FakeXhr();
      request.open("post", "/api/save");
      request.send("{}");
      request.status = 201;
      request.emit("load");
      // A settled request settles once, whatever else the transport fires.
      request.emit("error");

      expect(first.calls).toEqual([
        { method: "POST", url: "/api/save" },
        { method: "end", url: "a:1", result: { status: 201, bytes: undefined } },
      ]);
      expect(second.calls).toHaveLength(2);

      detachFirst();
      expect(FakeXhr.prototype.send).toBe(patchedSend);
      detachSecond();
      expect(FakeXhr.prototype.send).toBe(originalSend);
      expect(FakeXhr.prototype.open).toBe(originalOpen);
    });
  });

  it("maps error, timeout and abort onto the sink's result", () => {
    withFakeXhr(() => {
      const { sink, calls } = recorder();
      const detach = instrumentXhr(sink);
      for (const type of ["error", "timeout", "abort"]) {
        const request = new FakeXhr();
        request.open("get", `/api/${type}`);
        request.send();
        request.emit(type);
      }
      expect(calls.filter((call) => call.method === "end").map((call) => call.result)).toEqual([
        { error: "network error", bytes: undefined },
        { error: "timeout", bytes: undefined },
        { error: "aborted", aborted: true, bytes: undefined },
      ]);
      detach();
    });
  });

  it("never unpatches over a stranger's later wrapper", () => {
    withFakeXhr(() => {
      const originalOpen = FakeXhr.prototype.open;
      const originalSend = FakeXhr.prototype.send;
      const detach = instrumentXhr(recorder().sink);
      const stranger = function strangerSend() {} as typeof FakeXhr.prototype.send;
      FakeXhr.prototype.send = stranger;
      detach();
      // The stranger's `send` survives; our own `open` still goes back, since
      // that one is still ours to restore.
      expect(FakeXhr.prototype.send).toBe(stranger);
      expect(FakeXhr.prototype.open).toBe(originalOpen);
      FakeXhr.prototype.send = originalSend;
    });
  });

  it("is a no-op where there is no XMLHttpRequest", () => {
    const original = globalThis.XMLHttpRequest;
    // @ts-expect-error — deleting a global the type system says is always there.
    delete globalThis.XMLHttpRequest;
    try {
      const detach = instrumentXhr(recorder().sink);
      expect(globalThis.XMLHttpRequest).toBeUndefined();
      detach();
    } finally {
      globalThis.XMLHttpRequest = original;
    }
  });
});

describe("the dual-package hazard, as documented", () => {
  it("stacks rather than conflicts when two copies of this module are loaded", async () => {
    /**
     * Patch state is module-level, so a page resolving both `dist/runtime.js`
     * and `dist/runtime.cjs` holds two of it. The docblock claims they *stack*
     * — both record, the app pays for two wrappers — rather than one blinding
     * the other. This asserts that claim instead of restating it, and pins the
     * one artefact it leaves behind: detaching inner-first strands the first
     * wrapper on `globalThis.fetch`, sink-less and inert. It forwards every
     * call and records nothing, which is why the fix is "resolve the package
     * to one format", not a second mechanism here.
     */
    globalThis.fetch = vi.fn(async () => response(200)) as unknown as typeof fetch;
    vi.resetModules();
    const first = await import("../network");
    vi.resetModules();
    const second = await import("../network");
    expect(first.instrumentFetch).not.toBe(second.instrumentFetch);

    const a = recorder("a");
    const b = recorder("b");
    const detachFirst = first.instrumentFetch(a.sink);
    const outer = globalThis.fetch;
    const detachSecond = second.instrumentFetch(b.sink);
    await globalThis.fetch("/api/x");
    expect(a.calls[0]).toEqual({ method: "GET", url: "/api/x" });
    expect(b.calls[0]).toEqual({ method: "GET", url: "/api/x" });

    detachFirst();
    detachSecond();
    // Stranded, not stuck recording: the leftover wrapper has no sinks left.
    expect(globalThis.fetch).toBe(outer);
    const before = a.calls.length + b.calls.length;
    await globalThis.fetch("/api/y");
    expect(a.calls.length + b.calls.length).toBe(before);
  });
});
