import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createEventBus } from "../../../runtime";
import { instrumentFetch } from "@nejcm/dev-toolbar/runtime";
import type { BusLike, ToolbarEventMap } from "../../../runtime";
import { createMockBus } from "../../../testing";
import { createNetworkCollector } from "../collectors/network";
import { REDACTED } from "../../../runtime";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const context = (controller: AbortController, clock: { t: number }) => ({
  signal: controller.signal,
  now: () => clock.t,
  invalidate: vi.fn(),
});

const response = (status = 200, length?: string) =>
  ({
    status,
    headers: { get: (name: string) => (name === "content-length" ? (length ?? null) : null) },
  }) as unknown as Response;

const detailOf = (view: { detail: readonly [string, string][] }) => Object.fromEntries(view.detail);

describe("network collector — fetch present", () => {
  it("counts in-flight requests and restores fetch on teardown", async () => {
    let settle: (value: Response) => void = () => {};
    const inner = vi.fn(() => new Promise<Response>((resolve) => (settle = resolve)));
    globalThis.fetch = inner as unknown as typeof fetch;

    const clock = { t: 0 };
    const collector = createNetworkCollector({ patchXhr: false });
    const controller = new AbortController();
    collector.start(context(controller, clock));
    expect(globalThis.fetch).not.toBe(inner);

    const pending = globalThis.fetch("/api/orders");
    expect(collector.read(clock.t).display).toBe("1");
    expect(collector.read(clock.t).value).toBe(1);

    clock.t = 50;
    settle(response(200, "2048"));
    await pending;

    const view = collector.read(clock.t);
    expect(view.display).toBe("0");
    expect(view.severity).toBe("ok");
    expect(detailOf(view)["Completed (session)"]).toBe("1");

    const [entry] = collector.entries?.(clock.t) ?? [];
    expect(entry).toMatchObject({
      method: "GET",
      url: "/api/orders",
      status: 200,
      state: "ok",
      bytes: 2048,
      duration: 50,
    });

    controller.abort();
    expect(globalThis.fetch).toBe(inner);
  });

  it("explains what the network time column measures", () => {
    const collector = createNetworkCollector({ patchXhr: false });
    expect(collector.read(0).hint).toContain(
      "Time is the span between bus events when a bus reports; patched fetch stops at response headers, patched XMLHttpRequest after the body.",
    );
  });

  it("redacts credentials out of the URL before retaining it", async () => {
    globalThis.fetch = vi.fn(async () => response(200)) as unknown as typeof fetch;
    const collector = createNetworkCollector({ patchXhr: false });
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));

    await globalThis.fetch("https://api.test/v1/me?access_token=super-secret&page=2");

    const [entry] = collector.entries?.(0) ?? [];
    expect(entry?.url).not.toContain("super-secret");
    expect(entry?.url).toContain(REDACTED);
    expect(entry?.url).toContain("page=2");
    controller.abort();
  });

  it("redacts a URL the rejection names in its message — foreign text, kept text", async () => {
    /**
     * The error string is whatever the host's HTTP stack wrote, and a rejection
     * routinely names the request it failed on. It was retained verbatim, so
     * `diagnostics()` and the panel carried a live token in the error column
     * while the `url` column beside it was already redacted.
     */
    globalThis.fetch = vi.fn(async () => {
      throw new Error("Failed to fetch https://api.test/v1?access_token=super-secret retrying");
    }) as unknown as typeof fetch;
    const collector = createNetworkCollector({ patchXhr: false });
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));

    await expect(globalThis.fetch("/api/x")).rejects.toThrow();

    const [entry] = collector.entries?.(0) ?? [];
    expect(entry?.error).not.toContain("super-secret");
    expect(entry?.error).toBe(
      `Failed to fetch https://api.test/v1?access_token=${REDACTED} retrying`,
    );
    controller.abort();
  });

  it("leaves an error message with no URL in it byte-for-byte", async () => {
    // Only the URL-shaped substrings are rewritten; running the whole sentence
    // through `redactUrl()` would percent-encode its spaces.
    globalThis.fetch = vi.fn(async () => {
      throw new Error("Load failed");
    }) as unknown as typeof fetch;
    const collector = createNetworkCollector({ patchXhr: false });
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));
    await expect(globalThis.fetch("/api/x")).rejects.toThrow();
    expect(collector.entries?.(0)[0]?.error).toBe("Load failed");
    controller.abort();
  });

  // The first `URL_IN_TEXT` was quadratic on a long alphanumeric run: without a
  // leading lookbehind, every interior position started a candidate scan that
  // ran to the end of the run before failing on the missing `:` (200k letters
  // took 5.4 s against the 2 s timeout; the lookbehind form is ~0.1 ms). The
  // text is app-supplied — a stringified body or a base64 blob in an error
  // message — and this runs synchronously inside the host's rejection handler.
  // The timeout is the regression guard; the expectation is that it still works.
  it("scans a long alphanumeric error message in one pass", async () => {
    const blob = "a".repeat(200_000);
    globalThis.fetch = vi.fn(async () => {
      throw new Error(`${blob} https://api.test/v1?access_token=super-secret`);
    }) as unknown as typeof fetch;
    const collector = createNetworkCollector({ patchXhr: false });
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));

    await expect(globalThis.fetch("/api/x")).rejects.toThrow();

    const [entry] = collector.entries?.(0) ?? [];
    expect(entry?.error).toBe(`${blob} https://api.test/v1?access_token=${REDACTED}`);
    controller.abort();
  }, 2000);

  it("redacts past a bracketed array parameter — `]` must not end the match", async () => {
    /**
     * `)` and `]` were in the mid-URL stop class as well as the final-character
     * one, so a URL containing either *before* its credential was truncated
     * there and the credential survived into `diagnostics()`. Bracketed array
     * and filter parameters are ordinary Rails / PHP / JSON:API query syntax,
     * and the existing suite passed against the leaking pattern purely because
     * no case had a `]` or `)` ahead of the token.
     */
    globalThis.fetch = vi.fn(async () => {
      throw new Error("Failed to fetch https://api.test/v1?ids[]=1&access_token=super-secret");
    }) as unknown as typeof fetch;
    const collector = createNetworkCollector({ patchXhr: false });
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));
    await expect(globalThis.fetch("/api/x")).rejects.toThrow();
    expect(collector.entries?.(0)[0]?.error).toBe(
      `Failed to fetch https://api.test/v1?ids%5B%5D=1&access_token=${REDACTED}`,
    );
    controller.abort();
  });

  it("still stops at a closing delimiter that wraps the whole URL", async () => {
    // The other half of the same split: `)` and `]` stay excluded from the
    // final character, so a parenthesised URL does not swallow its own bracket.
    globalThis.fetch = vi.fn(async () => {
      throw new Error("gave up (https://api.test/p/(x)?token=super-secret) after 3 tries");
    }) as unknown as typeof fetch;
    const collector = createNetworkCollector({ patchXhr: false });
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));
    await expect(globalThis.fetch("/api/x")).rejects.toThrow();
    expect(collector.entries?.(0)[0]?.error).toBe(
      `gave up (https://api.test/p/(x)?token=${REDACTED}) after 3 tries`,
    );
    controller.abort();
  });

  it("leaves sentence punctuation after a URL outside the mask", async () => {
    // `…?token=x. Then` used to match through the full stop, burying it inside
    // `[redacted]` and reading as though the URL itself ended in a dot.
    globalThis.fetch = vi.fn(async () => {
      throw new Error("Failed to fetch https://a.test/?access_token=x. Then gave up.");
    }) as unknown as typeof fetch;
    const collector = createNetworkCollector({ patchXhr: false });
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));
    await expect(globalThis.fetch("/api/x")).rejects.toThrow();
    expect(collector.entries?.(0)[0]?.error).toBe(
      `Failed to fetch https://a.test/?access_token=${REDACTED}. Then gave up.`,
    );
    controller.abort();
  });

  it("marks failures and aborts, and rethrows to the caller either way", async () => {
    const failure = Object.assign(new Error("nope"), { name: "TypeError" });
    globalThis.fetch = vi.fn(async () => {
      throw failure;
    }) as unknown as typeof fetch;

    const clock = { t: 0 };
    const collector = createNetworkCollector({ patchXhr: false, windowMs: 30_000 });
    const controller = new AbortController();
    collector.start(context(controller, clock));

    await expect(globalThis.fetch("/api/x")).rejects.toThrow("nope");
    const view = collector.read(clock.t);
    expect(view.severity).toBe("bad");
    expect(detailOf(view)["Failed (session)"]).toBe("1");
    expect(collector.entries?.(clock.t)[0]?.state).toBe("failed");

    controller.abort();
  });

  it("counts a 4xx response as a failure", async () => {
    globalThis.fetch = vi.fn(async () => response(503)) as unknown as typeof fetch;
    const collector = createNetworkCollector({ patchXhr: false });
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));
    await globalThis.fetch("/api/x");
    expect(collector.read(0).severity).toBe("bad");
    controller.abort();
  });

  it("goes warn, not bad, on a slow-but-successful request", async () => {
    let settle: (value: Response) => void = () => {};
    globalThis.fetch = vi.fn(
      () => new Promise<Response>((resolve) => (settle = resolve)),
    ) as unknown as typeof fetch;
    const clock = { t: 0 };
    const collector = createNetworkCollector({ patchXhr: false, slowMs: 100 });
    const controller = new AbortController();
    collector.start(context(controller, clock));
    const pending = globalThis.fetch("/api/slow");
    clock.t = 900;
    settle(response(200));
    await pending;
    expect(collector.read(clock.t).severity).toBe("warn");
    controller.abort();
  });

  it("honours the filter, so telemetry can exclude itself", async () => {
    globalThis.fetch = vi.fn(async () => response(200)) as unknown as typeof fetch;
    const collector = createNetworkCollector({
      patchXhr: false,
      filter: ({ url }) => !url.startsWith("/telemetry"),
    });
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));
    await globalThis.fetch("/telemetry/beacon");
    await globalThis.fetch("/api/real");
    expect((collector.entries?.(0) ?? []).map((entry) => entry.url)).toEqual(["/api/real"]);
    controller.abort();
  });

  it("shares one wrapper with a direct /runtime caller", async () => {
    /**
     * The `fetch` interceptor moved to `/runtime` in Phase 1A, and the
     * collector imports it through the **published** specifier so both callers
     * meet in one module instance rather than one per bundle. If that import
     * ever went relative again — or the patch state were duplicated — the two
     * `expect(globalThis.fetch).toBe(wrapper)` lines below would fail, because
     * each caller would install a wrapper of its own.
     */
    const base = vi.fn(async () => response(200)) as unknown as typeof fetch;
    globalThis.fetch = base;

    const seen: string[] = [];
    const detach = instrumentFetch({
      begin: (_method, url) => {
        seen.push(url);
        return url;
      },
      end: () => {},
    });
    const wrapper = globalThis.fetch;

    const collector = createNetworkCollector({ patchXhr: false });
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));
    expect(globalThis.fetch).toBe(wrapper);

    await globalThis.fetch("/api/both?api_key=secret");
    expect(seen).toEqual(["/api/both?api_key=secret"]);
    // The sink sees the raw URL; only what is *retained* is redacted.
    expect(collector.entries(0)[0]?.url).toBe(`/api/both?api_key=${REDACTED}`);

    controller.abort();
    expect(globalThis.fetch).toBe(wrapper);
    detach();
    expect(globalThis.fetch).toBe(base);
  });

  it("lets two live collectors both record through one shared patch", async () => {
    const base = vi.fn(async () => response(200)) as unknown as typeof fetch;
    globalThis.fetch = base;
    const first = createNetworkCollector({ patchXhr: false });
    const second = createNetworkCollector({ patchXhr: false });
    const a = new AbortController();
    const b = new AbortController();
    first.start(context(a, { t: 0 }));
    const patched = globalThis.fetch;
    second.start(context(b, { t: 0 }));
    // Installed once…
    expect(globalThis.fetch).toBe(patched);

    await globalThis.fetch("/api/shared");
    // …and feeding both. The earlier "skip when already patched" guard made the
    // second collector silently blind; a Vite HMR reload in the playground
    // proved it in a real browser.
    expect(first.entries?.(0).length).toBe(1);
    expect(second.entries?.(0).length).toBe(1);

    // The patch survives one collector leaving, and goes with the last.
    a.abort();
    expect(globalThis.fetch).toBe(patched);
    b.abort();
    expect(globalThis.fetch).toBe(base);
  });

  it("never lets a recorder bug break the host app's request", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    globalThis.fetch = vi.fn(async () => response(200)) as unknown as typeof fetch;
    const collector = createNetworkCollector({
      patchXhr: false,
      // Consumer-supplied, and therefore capable of anything.
      filter: () => {
        throw new Error("bad filter");
      },
    });
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));

    // Observing a request is not permission to fail it.
    await expect(globalThis.fetch("/api/x")).resolves.toMatchObject({
      status: 200,
    });
    expect(error).toHaveBeenCalled();
    controller.abort();
    error.mockRestore();
  });

  it("never throws out of fetch on a malformed URL", async () => {
    globalThis.fetch = vi.fn(async () => response(200)) as unknown as typeof fetch;
    const collector = createNetworkCollector({ patchXhr: false });
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));
    // A malformed percent-escape used to make redactUrl() throw URIError,
    // synchronously, inside the wrapper.
    await expect(globalThis.fetch("http://bad host/?%zz=1&api_key=abc")).resolves.toMatchObject({
      status: 200,
    });
    expect(collector.entries?.(0)[0]?.url).not.toContain("abc");
    controller.abort();
  });

  it("records nothing while paused, on either instrumentation route", async () => {
    globalThis.fetch = vi.fn(async () => response(200)) as unknown as typeof fetch;
    const bus = createEventBus<ToolbarEventMap>();
    const collector = createNetworkCollector({ bus, patchFetch: true, patchXhr: false });
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));

    expect(collector.isPaused()).toBe(false);
    expect(collector.setPaused(true)).toBe(true);

    await globalThis.fetch("/api/patched");
    bus.emit("network-start", { requestId: "b1", method: "GET", url: "/api/bus" });
    bus.emit("network-end", { requestId: "b1", ok: true, status: 200, duration: 10 });
    expect(collector.entries(0)).toEqual([]);
    // Pausing is a mode, and a mode that hides itself is a trap: the chip says
    // so, and so does the dump an agent reads.
    expect(collector.read(0).display).toBe("paused");
    expect(Object.fromEntries(collector.read(0).detail)["Recording"]).toBe("paused");
    expect(collector.diagnostics(0)).toMatchObject({ paused: true });

    collector.setPaused(false);
    await globalThis.fetch("/api/after");
    expect(collector.entries(0).map((entry) => entry.url)).toEqual(["/api/after"]);
    expect(collector.read(0).display).toBe("0");
    controller.abort();
  });

  it("clears everything on reset", async () => {
    globalThis.fetch = vi.fn(async () => response(200)) as unknown as typeof fetch;
    const collector = createNetworkCollector({ patchXhr: false });
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));
    await globalThis.fetch("/api/x");
    expect(collector.entries?.(0).length).toBe(1);
    collector.reset();
    expect(collector.entries?.(0).length).toBe(0);
    expect(collector.read(0).status).toBe("pending");
    controller.abort();
  });
});

describe("network collector — XMLHttpRequest", () => {
  class FakeXhr extends EventTarget {
    status = 0;
    open(_method: string, _url: string | URL): void {}
    send(_body?: unknown): void {}
    getResponseHeader(_name: string): string | null {
      return null;
    }
    finish(status: number) {
      this.status = status;
      this.dispatchEvent(new Event("load"));
    }
    fail() {
      this.dispatchEvent(new Event("error"));
    }
  }

  it("patches open/send, records the request and restores both", () => {
    const originalXhr = globalThis.XMLHttpRequest;
    globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
    const originalOpen = FakeXhr.prototype.open;
    const originalSend = FakeXhr.prototype.send;
    try {
      const clock = { t: 0 };
      const collector = createNetworkCollector({ patchFetch: false });
      const controller = new AbortController();
      collector.start(context(controller, clock));
      expect(FakeXhr.prototype.send).not.toBe(originalSend);

      const request = new FakeXhr();
      request.open("post", "/api/save?api_key=hunter2");
      request.send("{}");
      expect(collector.read(clock.t).display).toBe("1");

      clock.t = 40;
      request.finish(201);
      const [entry] = collector.entries?.(clock.t) ?? [];
      expect(entry).toMatchObject({ method: "POST", status: 201, state: "ok" });
      expect(entry?.url).not.toContain("hunter2");

      const failing = new FakeXhr();
      failing.open("GET", "/api/boom");
      failing.send();
      failing.fail();
      expect(collector.read(clock.t).severity).toBe("bad");

      controller.abort();
      expect(FakeXhr.prototype.send).toBe(originalSend);
      expect(FakeXhr.prototype.open).toBe(originalOpen);
    } finally {
      globalThis.XMLHttpRequest = originalXhr;
    }
  });
});

describe("network collector — instrumented client instead of a patch", () => {
  it("reads network-start / network-end off a /runtime bus", () => {
    const bus = createEventBus<ToolbarEventMap>();
    const clock = { t: 0 };
    const collector = createNetworkCollector({
      patchFetch: false,
      patchXhr: false,
      bus,
    });
    const controller = new AbortController();
    collector.start(context(controller, clock));

    bus.emit("network-start", {
      requestId: "abc",
      method: "POST",
      url: "/graphql?token=leak",
    });
    expect(collector.read(clock.t).display).toBe("1");

    clock.t = 120;
    bus.emit("network-end", {
      requestId: "abc",
      ok: true,
      status: 200,
      duration: 120,
      bytes: 512,
    });

    const [entry] = collector.entries?.(clock.t) ?? [];
    expect(entry).toMatchObject({ method: "POST", status: 200, state: "ok" });
    expect(entry?.url).not.toContain("leak");
    expect(collector.read(clock.t).display).toBe("0");

    // The signal unsubscribes both handlers.
    controller.abort();
    expect(bus.listenerCount()).toBe(0);
  });

  it("keeps an evicted request pending until its matching end arrives", () => {
    /**
     * Deleting the pending map looked like a bound, but it lost completions as
     * soon as the display ring evicted an in-flight start.
     */
    const bus = createEventBus<ToolbarEventMap>();
    const clock = { t: 0 };
    const collector = createNetworkCollector({
      patchFetch: false,
      patchXhr: false,
      bus,
      historySize: 1,
    });
    const controller = new AbortController();
    collector.start(context(controller, clock));
    bus.emit("network-start", { requestId: "old", method: "GET", url: "/old" });
    bus.emit("network-start", { requestId: "new", method: "GET", url: "/new" });

    clock.t = 50;
    bus.emit("network-end", { requestId: "old", ok: true, status: 204, duration: 50 });

    expect(
      (collector.diagnostics(clock.t) as { totals: { completed: number } }).totals.completed,
    ).toBe(1);
    expect(collector.entries?.(clock.t)[0]?.id).toBe("new");
    controller.abort();
  });

  it("clears pending bus starts on reset", () => {
    /**
     * The pending map lived inside start(), so reset could clear visible history
     * while a later end still incremented the reset session's completion total.
     */
    const bus = createEventBus<ToolbarEventMap>();
    const clock = { t: 0 };
    const collector = createNetworkCollector({ patchFetch: false, patchXhr: false, bus });
    const controller = new AbortController();
    collector.start(context(controller, clock));
    bus.emit("network-start", { requestId: "before-reset", method: "GET", url: "/slow" });

    collector.reset();
    clock.t = 20;
    bus.emit("network-end", {
      requestId: "before-reset",
      ok: true,
      status: 200,
      duration: 20,
    });

    const diagnostics = collector.diagnostics(clock.t) as {
      totals: { started: number; completed: number };
      pendingDropped: number;
    };
    expect(diagnostics.totals).toMatchObject({ started: 0, completed: 0 });
    expect(diagnostics.pendingDropped).toBe(0);
    controller.abort();
  });

  it("clears evicted pending bus starts when observation stops", () => {
    /**
     * An evicted in-flight request remained reachable only through `pending`.
     * Without abort cleanup, its late end completed in the next observation
     * cycle even though the first cycle had stopped.
     */
    const bus = createEventBus<ToolbarEventMap>();
    const clock = { t: 0 };
    const collector = createNetworkCollector({
      patchFetch: false,
      patchXhr: false,
      bus,
      historySize: 1,
    });
    const first = new AbortController();
    collector.start(context(first, clock));
    bus.emit("network-start", { requestId: "old", method: "GET", url: "/old" });
    bus.emit("network-start", { requestId: "new", method: "GET", url: "/new" });
    first.abort();

    const second = new AbortController();
    collector.start(context(second, clock));
    clock.t = 50;
    bus.emit("network-end", { requestId: "old", ok: true, status: 204, duration: 50 });

    expect(
      (collector.diagnostics(clock.t) as { totals: { completed: number } }).totals.completed,
    ).toBe(0);
    expect(collector.entries?.(clock.t)[0]).toMatchObject({ id: "new", state: "active" });
    second.abort();
  });

  it("drops old unmatched starts without inventing completions", () => {
    /**
     * Unmatched bus starts stayed strongly reachable forever. The age sweep must
     * release them, and a late end for an evicted start must remain an unmatched
     * end rather than creating a synthetic request.
     */
    const bus = createEventBus<ToolbarEventMap>();
    const clock = { t: 0 };
    const collector = createNetworkCollector({
      patchFetch: false,
      patchXhr: false,
      bus,
      historySize: 1,
      windowMs: 1000,
    });
    const controller = new AbortController();
    collector.start(context(controller, clock));
    bus.emit("network-start", { requestId: "old", method: "GET", url: "/old" });

    clock.t = 60_001;
    bus.emit("network-start", { requestId: "young", method: "GET", url: "/young" });
    bus.emit("network-end", { requestId: "old", ok: true, status: 200, duration: 60_001 });

    const diagnostics = collector.diagnostics(clock.t) as {
      totals: { completed: number };
      pendingDropped: number;
    };
    expect(diagnostics.pendingDropped).toBe(1);
    expect(diagnostics.totals.completed).toBe(0);
    expect(collector.entries?.(clock.t).map((item) => item.id)).toEqual(["young"]);
    controller.abort();
  });

  it("caps unmatched starts while preserving recent completions", () => {
    const bus = createEventBus<ToolbarEventMap>();
    const clock = { t: 0 };
    const collector = createNetworkCollector({
      patchFetch: false,
      patchXhr: false,
      bus,
      historySize: 1,
    });
    const controller = new AbortController();
    collector.start(context(controller, clock));
    for (let index = 0; index < 66; index += 1) {
      bus.emit("network-start", { requestId: `request-${index}`, method: "GET", url: "/wait" });
    }

    bus.emit("network-end", { requestId: "request-0", ok: true, status: 200, duration: 1 });
    bus.emit("network-end", { requestId: "request-65", ok: true, status: 200, duration: 1 });

    const diagnostics = collector.diagnostics(clock.t) as {
      totals: { completed: number };
      pendingDropped: number;
    };
    expect(diagnostics.pendingDropped).toBe(2);
    expect(diagnostics.totals.completed).toBe(1);
    expect(collector.entries?.(clock.t)[0]).toMatchObject({ id: "request-65", state: "ok" });
    controller.abort();
  });

  it("keeps the newest duplicate id indexed when the older entry is evicted", () => {
    /**
     * Evicting an older duplicate deleted the newer entry's by-id index. Once
     * its aged pending record was swept, the matching end could not finish it.
     */
    const bus = createEventBus<ToolbarEventMap>();
    const clock = { t: 0 };
    const collector = createNetworkCollector({
      patchFetch: false,
      patchXhr: false,
      bus,
      historySize: 2,
      windowMs: 1000,
    });
    const controller = new AbortController();
    collector.start(context(controller, clock));
    bus.emit("network-start", { requestId: "same", method: "GET", url: "/first" });
    bus.emit("network-start", { requestId: "same", method: "GET", url: "/second" });
    bus.emit("network-start", { requestId: "other", method: "GET", url: "/other" });

    clock.t = 60_001;
    bus.emit("network-end", { requestId: "same", ok: true, status: 201, duration: 60_001 });

    const duplicate = collector.entries?.(clock.t).find((item) => item.id === "same");
    expect(duplicate).toMatchObject({ url: "/second", state: "ok", status: 201 });
    expect((collector.diagnostics(clock.t) as { duplicateStarts: number }).duplicateStarts).toBe(1);
    controller.abort();
  });

  it("uses a supplied bus instead of patching by default", async () => {
    /**
     * The option doc said the bus replaced patching, but both patchers remained
     * enabled and one request could be counted twice under unrelated ids.
     */
    const original = vi.fn(async () => response(200)) as unknown as typeof fetch;
    globalThis.fetch = original;
    const bus = createEventBus<ToolbarEventMap>();
    const collector = createNetworkCollector({ bus });
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));

    expect(globalThis.fetch).toBe(original);
    await globalThis.fetch("/only-patched-if-requested");

    expect(collector.entries?.(0)).toEqual([]);
    expect(detailOf(collector.read(0))["Instrumentation"]).toBe("bus");
    controller.abort();
  });

  it("labels an explicitly combined bus and fetch patch", () => {
    const bus = createEventBus<ToolbarEventMap>();
    const collector = createNetworkCollector({ bus, patchFetch: true, patchXhr: false });
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));

    expect(detailOf(collector.read(0))["Instrumentation"]).toBe("bus + patched fetch");
    controller.abort();
  });

  // The point of shipping a bus double in `./testing` is that it can stand in
  // here. It could not: `./testing` may not import `./runtime` (AGENTS.md), so
  // `MockBus` restates the contract and had drifted out of assignability — no
  // `clear()`, no `options.signal`, an unkeyed `on`. The `bus` option now asks
  // for `BusLike`, the two methods a collector calls, and the mock matches it.
  // Assert that here rather than in `src/testing/__tests__`, which the core
  // boundary test forbids from naming `runtime` at all.
  //
  // The type assertion is necessary and not sufficient: a callee may declare
  // *fewer* parameters than its caller passes, so a mock whose `on` ignored
  // `options` entirely would still satisfy `BusLike` and then silently leak
  // every subscription past teardown. The `listenerCount()` assertion after
  // `controller.abort()` below is what actually holds the mock to the `signal`
  // half of the contract; `src/testing/__tests__/mockBus.test.ts` covers the
  // rest of that parity from the double's own side.
  it("takes the shipped createMockBus() double, which satisfies BusLike", () => {
    expectTypeOf(createMockBus()).toExtend<BusLike<ToolbarEventMap>>();

    const bus = createMockBus();
    const clock = { t: 0 };
    const collector = createNetworkCollector({ patchFetch: false, patchXhr: false, bus });
    const controller = new AbortController();
    collector.start(context(controller, clock));

    bus.emit("network-start", { requestId: "abc", method: "GET", url: "/api/me?token=leak" });
    expect(collector.read(clock.t).display).toBe("1");

    clock.t = 40;
    bus.emit("network-end", { requestId: "abc", ok: true, status: 200, duration: 40 });

    const [entry] = collector.entries?.(clock.t) ?? [];
    expect(entry).toMatchObject({ method: "GET", status: 200, state: "ok" });
    expect(entry?.url).not.toContain("leak");
    // The double honours `options.signal` too, or a collector's teardown would
    // silently leak in every test that used it.
    controller.abort();
    expect(bus.listenerCount()).toBe(0);
  });
});

describe("network collector — nothing to observe", () => {
  it("is unsupported with no fetch, no XHR and no bus", () => {
    const originalXhr = globalThis.XMLHttpRequest;
    // @ts-expect-error deliberately removing a global for the degradation path
    delete globalThis.fetch;
    // @ts-expect-error same
    delete globalThis.XMLHttpRequest;
    try {
      const collector = createNetworkCollector();
      expect(collector.supported).toBe(false);
      const view = collector.read(0);
      expect(view.status).toBe("unsupported");
      expect(view.display).toBe("NA");
      expect(collector.entries?.(0)).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.XMLHttpRequest = originalXhr;
    }
  });
});
