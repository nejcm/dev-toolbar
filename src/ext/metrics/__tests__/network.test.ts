import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventBus } from "../../../runtime";
import type { ToolbarEventMap } from "../../../runtime";
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

const detailOf = (view: { detail: readonly [string, string][] }) =>
  Object.fromEntries(view.detail);

describe("network collector — fetch present", () => {
  it("counts in-flight requests and restores fetch on teardown", async () => {
    let settle: (value: Response) => void = () => {};
    const inner = vi.fn(
      () => new Promise<Response>((resolve) => (settle = resolve)),
    );
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

  it("redacts credentials out of the URL before retaining it", async () => {
    globalThis.fetch = vi.fn(async () => response(200)) as unknown as typeof fetch;
    const collector = createNetworkCollector({ patchXhr: false });
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));

    await globalThis.fetch("https://api.test/v1/me?access_token=super-secret&page=2");

    const [entry] = collector.entries?.(0) ?? [];
    expect(entry?.url).not.toContain("super-secret");
    expect(entry?.url).toContain(encodeURIComponent(REDACTED));
    expect(entry?.url).toContain("page=2");
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
    expect((collector.entries?.(0) ?? []).map((entry) => entry.url)).toEqual([
      "/api/real",
    ]);
    controller.abort();
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
    await expect(
      globalThis.fetch("http://bad host/?%zz=1&api_key=abc"),
    ).resolves.toMatchObject({ status: 200 });
    expect(collector.entries?.(0)[0]?.url).not.toContain("abc");
    controller.abort();
  });

  it("never unpatches over a stranger's later wrapper", () => {
    globalThis.fetch = vi.fn(async () => response(200)) as unknown as typeof fetch;
    const collector = createNetworkCollector({ patchXhr: false });
    const controller = new AbortController();
    collector.start(context(controller, { t: 0 }));

    const stranger = vi.fn(async () => response(200)) as unknown as typeof fetch;
    globalThis.fetch = stranger;
    controller.abort();
    expect(globalThis.fetch).toBe(stranger);
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
