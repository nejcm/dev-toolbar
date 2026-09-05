import { describe, expect, it, vi } from "vitest";
import { fakeExtensionApi } from "@nejcm/dev-toolbar/testing";
import { createMetricsRuntime } from "../runtime";
import { createMemoryCollector } from "../collectors/memory";
import { createNetworkCollector } from "../collectors/network";
import type { Collector, CollectorContext, MetricView, NetworkEntryView } from "../types";
import { createEventBus, createTimeSeries, REDACTED } from "../../../runtime";
import type { ToolbarEventMap } from "../../../runtime";
import type { ExtensionRuntimeApi } from "../../../core/contract";

function api(): {
  api: ExtensionRuntimeApi;
  controller: AbortController;
  setVisible: (visible: boolean) => void;
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  const fake = fakeExtensionApi({
    storage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => void store.set(key, value),
      removeItem: (key) => void store.delete(key),
    },
  });
  return { controller: fake.controller, store, setVisible: fake.setVisible, api: fake.api };
}

const memory = () =>
  createMemoryCollector({
    sampleMs: 10,
    read: () => ({
      usedJSHeapSize: 1_000_000,
      totalJSHeapSize: 2_000_000,
      jsHeapSizeLimit: 8_000_000,
    }),
  });

describe("metrics runtime", () => {
  it("exists before start(api), because slots render before effects do", () => {
    const runtime = createMetricsRuntime({ collectors: [memory()] });
    // No start() yet — and the store still has a renderable snapshot.
    const snapshot = runtime.store.getSnapshot();
    expect(snapshot.order).toEqual(["memory"]);
    expect(snapshot.views.memory.status).toBe("pending");
    expect(runtime.storage()).toBeNull();
  });

  it("does not publish while nothing that is painted has changed", () => {
    vi.useFakeTimers();
    try {
      const runtime = createMetricsRuntime({
        collectors: [createMemoryCollector({ read: () => null })],
        updateHz: 4,
      });
      const harness = api();
      const listener = vi.fn();
      runtime.store.subscribe(listener);
      runtime.start(harness.api);
      listener.mockClear();
      // Four seconds of ticks over an unsupported metric: nothing to say.
      vi.advanceTimersByTime(4000);
      expect(listener).not.toHaveBeenCalled();
      harness.controller.abort();
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces a burst of collector invalidations into one notification", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () => ({ status: 200, headers: { get: () => null } }) as unknown as Response,
    ) as unknown as typeof fetch;
    try {
      const runtime = createMetricsRuntime({
        collectors: [createNetworkCollector({ patchXhr: false })],
        updateHz: 2,
      });
      const harness = api();
      runtime.start(harness.api);
      const listener = vi.fn();
      runtime.store.subscribe(listener);

      await Promise.all(
        Array.from({ length: 25 }, (_, index) => globalThis.fetch(`/api/${index}`)),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      // 50 lifecycle events (25 starts, 25 ends) behind a 500 ms throttle.
      expect(listener.mock.calls.length).toBeLessThanOrEqual(2);
      expect(runtime.store.peek().requests.length).toBe(25);
      harness.controller.abort();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps its storage handle from start(api)", () => {
    const runtime = createMetricsRuntime({ collectors: [memory()] });
    const harness = api();
    runtime.start(harness.api);
    runtime.storage()?.setItem("tab", "memory");
    expect(harness.store.get("tab")).toBe("memory");
    harness.controller.abort();
  });

  it("republishes when the bar's visibility changes, and keeps collecting", () => {
    vi.useFakeTimers();
    try {
      const runtime = createMetricsRuntime({ collectors: [memory()] });
      const harness = api();
      runtime.start(harness.api);
      vi.advanceTimersByTime(100);
      const before = runtime.store.getSnapshot().seriesWritten;
      harness.setVisible(false);
      vi.advanceTimersByTime(500);
      runtime.flush();
      expect(runtime.store.getSnapshot().seriesWritten).toBeGreaterThan(before);
      harness.controller.abort();
    } finally {
      vi.useRealTimers();
    }
  });

  it("tears everything down on abort, without a returned dispose", () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn(() => ({
        usedJSHeapSize: 1,
        totalJSHeapSize: 2,
        jsHeapSizeLimit: 4,
      }));
      const runtime = createMetricsRuntime({
        collectors: [createMemoryCollector({ sampleMs: 10, read })],
      });
      const harness = api();
      runtime.start(harness.api);
      vi.advanceTimersByTime(50);
      harness.controller.abort();
      const after = read.mock.calls.length;
      vi.advanceTimersByTime(500);
      expect(read.mock.calls.length).toBe(after);
    } finally {
      vi.useRealTimers();
    }
  });

  it("survives a mount / cleanup / mount cycle — React StrictMode's shape", () => {
    vi.useFakeTimers();
    try {
      const runtime = createMetricsRuntime({ collectors: [memory()] });
      const listener = vi.fn();
      runtime.store.subscribe(listener);

      const first = api();
      const dispose = runtime.start(first.api);
      dispose();
      first.controller.abort();

      // React remounts with a fresh api. Everything must work again — an
      // earlier version destroyed the store on that first cleanup and froze
      // the chips for the rest of the page's life.
      const second = api();
      runtime.start(second.api);
      listener.mockClear();
      vi.advanceTimersByTime(2000);
      runtime.flush();

      expect(listener).toHaveBeenCalled();
      expect(runtime.store.getSnapshot().views.memory.status).toBe("ok");
      second.controller.abort();
    } finally {
      vi.useRealTimers();
    }
  });

  it("contains a collector that throws from start()", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      ...memory(),
      start() {
        throw new Error("boom");
      },
    };
    const runtime = createMetricsRuntime({ collectors: [broken, memory()] });
    const harness = api();
    expect(() => runtime.start(harness.api)).not.toThrow();
    expect(error).toHaveBeenCalled();
    harness.controller.abort();
    error.mockRestore();
  });

  it("keeps page-URL credentials out of the diagnostics dump", () => {
    // jsdom is configured at http://localhost:3000/; give it the OAuth
    // implicit-flow shape, which is a credential sitting in the address bar.
    const original = window.location.href;
    window.history.replaceState({}, "", "/callback?access_token=hunter2&state=xyz");
    try {
      const runtime = createMetricsRuntime({ collectors: [memory()] });
      const dump = JSON.stringify(runtime.diagnostics());
      expect(dump).toContain("/callback");
      expect(dump).toContain("state=xyz");
      expect(dump).not.toContain("hunter2");
      expect(dump).toContain(REDACTED);
    } finally {
      window.history.replaceState({}, "", original);
    }
  });

  it("redacts the diagnostics dump", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () => ({ status: 200, headers: { get: () => null } }) as unknown as Response,
    ) as unknown as typeof fetch;
    try {
      const runtime = createMetricsRuntime({
        collectors: [createNetworkCollector({ patchXhr: false })],
      });
      const harness = api();
      runtime.start(harness.api);
      await globalThis.fetch("https://api.test/me?access_token=hunter2");

      const dump = JSON.stringify(runtime.diagnostics());
      expect(dump).not.toContain("hunter2");
      // Literal, even though it was masked inside a query parameter: a
      // URL-safe mask goes into a URL unencoded.
      expect(dump).toContain(REDACTED);
      harness.controller.abort();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("resets every collector at once", () => {
    vi.useFakeTimers();
    try {
      const runtime = createMetricsRuntime({ collectors: [memory()] });
      const harness = api();
      runtime.start(harness.api);
      vi.advanceTimersByTime(100);
      runtime.flush();
      expect(runtime.store.getSnapshot().views.memory.status).toBe("ok");
      runtime.reset();
      expect(runtime.store.getSnapshot().views.memory.status).toBe("pending");
      harness.controller.abort();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("publication guarantees", () => {
  const initialView: MetricView = {
    id: "network",
    label: "net",
    title: "Network",
    status: "ok",
    severity: "ok",
    display: "1 req",
    value: 1,
    unit: "req",
    hint: "Requests",
    detail: [["Active", "1"]],
  };
  const initialRequest: NetworkEntryView = {
    id: "first",
    method: "GET",
    url: "/first",
    startedAt: 0,
    duration: 10,
    status: undefined,
    state: "active",
    bytes: undefined,
    error: undefined,
  };
  const setup = () => {
    let view = { ...initialView };
    let requests = [{ ...initialRequest }, { ...initialRequest, id: "second" }];
    let context: CollectorContext | undefined;
    const collector: Collector = {
      id: "network",
      estimatedCost: "minimal",
      supported: true,
      series: createTimeSeries(8),
      start: (next) => {
        context = next;
      },
      read: () => view,
      entries: () => requests,
      reset: () => {},
      diagnostics: () => ({}),
    };
    const runtime = createMetricsRuntime({ collectors: [collector] });
    return {
      runtime,
      collector,
      appendRequest: () => {
        requests = [...requests, { ...initialRequest, id: "third" }];
      },
      changeView: (patch: Partial<MetricView>) => {
        view = { ...view, ...patch };
      },
      changeRequest: (index: number, patch: Partial<NetworkEntryView>) => {
        requests = requests.map((request, at) =>
          at === index ? { ...request, ...patch } : request,
        );
      },
      invalidate: () => {
        expect(context).toBeDefined();
        context?.invalidate();
      },
    };
  };

  const assertViewPublication = (field: string, value: unknown, count: 0 | 1) => {
    const { runtime, changeView } = setup();
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    changeView({ [field]: value });
    runtime.flush();
    expect(runtime.store.peek().views.network).toEqual({ ...before.views.network, [field]: value });
    expect(listener).toHaveBeenCalledTimes(count);
    expect(runtime.store.getSnapshot()).toBe(count === 0 ? before : runtime.store.peek());
    runtime.store.destroy();
  };

  it.each([
    ["status", "pending", 1],
    ["severity", "warn", 1],
    ["display", "2 req", 1],
  ] as const)("view.%s publishes once", assertViewPublication);

  // Pins omissions in signature() (runtime.ts:60): id/label/title/unit/hint/detail.
  // UI reads them at ui.tsx:64/67/101/149/226/243; built-in identity metadata is fixed.
  // When covered, change the affected zero count to 1 and getSnapshot() toBe(peek()).
  it.each([
    ["id", "memory", 0],
    ["label", "requests", 0],
    ["title", "Traffic", 0],
    ["unit", "requests", 0],
    ["hint", "Requests in the last minute", 0],
    ["detail", [["Active", "2"]], 0],
  ] as const)("BUG: view.%s changes without publishing", assertViewPublication);

  const assertRequestPublication = (
    field: keyof NetworkEntryView,
    index: number,
    value: string | number,
    count: 0 | 1,
  ) => {
    const { runtime, changeRequest } = setup();
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    changeRequest(index, { [field]: value });
    runtime.flush();
    expect(runtime.store.peek().requests).toEqual(
      before.requests.map((request, at) =>
        at === index ? { ...request, [field]: value } : request,
      ),
    );
    expect(listener, `${index}.${field}`).toHaveBeenCalledTimes(count);
    expect(runtime.store.getSnapshot()).toBe(count === 0 ? before : runtime.store.peek());
    runtime.store.destroy();
  };

  it.each([
    ["id", 0, "replacement", 1],
    ["state", 0, "failed", 1],
  ] as const)("request.%s at index %i publishes once", assertRequestPublication);

  // Pins omissions in signature() (runtime.ts:60): method/status/duration/bytes/url
  // at either index, and non-first id/state; ui.tsx:301-306 keeps stale request rows.
  // When covered, change each affected count to 1 and getSnapshot() toBe(peek()).
  it.each([
    ["method", 0, "POST", 0],
    ["status", 0, 201, 0],
    ["duration", 0, 20, 0],
    ["bytes", 0, 1024, 0],
    ["url", 0, "/changed", 0],
    ["id", 1, "replacement", 0],
    ["state", 1, "failed", 0],
    ["method", 1, "POST", 0],
    ["status", 1, 201, 0],
    ["duration", 1, 20, 0],
    ["bytes", 1, 1024, 0],
    ["url", 1, "/changed", 0],
  ] as const)("BUG: request.%s at index %i changes without publishing", assertRequestPublication);

  it("publishes request count alone without changing existing rows", () => {
    const { runtime, appendRequest } = setup();
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    appendRequest();
    runtime.flush();
    expect(runtime.store.getSnapshot().requests).toEqual([
      ...before.requests,
      { ...initialRequest, id: "third" },
    ]);
    expect(runtime.store.getSnapshot().views).toEqual(before.views);
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.store.destroy();
  });

  it("series writes publish unchanged views for sparklines; idle rebuilds only advance pending revision", () => {
    const { runtime, collector } = setup();
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    runtime.flush();
    expect(runtime.store.getSnapshot()).toBe(before);
    expect(runtime.store.peek().revision).toBe(before.revision + 1);
    expect(listener).not.toHaveBeenCalled();
    collector.series.push(1, 1);
    runtime.flush();
    expect(runtime.store.getSnapshot().views).toEqual(before.views);
    expect(runtime.store.getSnapshot().seriesWritten).toBe(1);
    expect(runtime.store.getSnapshot().revision).toBe(before.revision + 2);
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.store.destroy();
  });

  it("folds invalidations before peek, then throttles publication; store.flush does not rebuild", async () => {
    vi.useFakeTimers();
    const { runtime, changeView, invalidate } = setup();
    const harness = api();
    try {
      runtime.start(harness.api);
      const before = runtime.store.getSnapshot();
      const pending = runtime.store.peek();
      const listener = vi.fn();
      runtime.store.subscribe(listener);
      changeView({ display: "2 req" });
      invalidate();
      invalidate();
      runtime.store.flush();
      expect(runtime.store.peek()).toBe(pending);
      expect(runtime.store.getSnapshot()).toBe(before);
      await Promise.resolve();
      expect(runtime.store.peek().views.network.display).toBe("2 req");
      expect(runtime.store.peek().revision).toBe(pending.revision + 1);
      expect(runtime.store.getSnapshot()).toBe(before);
      vi.advanceTimersByTime(499);
      expect(listener).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(runtime.store.getSnapshot().views.network.display).toBe("2 req");
      changeView({ display: "3 req" });
      runtime.flush();
      expect(runtime.store.getSnapshot()).toBe(runtime.store.peek());
      expect(runtime.store.getSnapshot().views.network.display).toBe("3 req");
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      harness.controller.abort();
      runtime.store.destroy();
      vi.useRealTimers();
    }
  });
});

describe("built-in network publication omissions", () => {
  // Pins missing request.duration in signature() (runtime.ts:60); ui.tsx:304 stays stale.
  // When covered, invert to toHaveBeenCalledTimes(1) and getSnapshot() toBe(peek()).
  it("BUG: an active request duration grows without publishing", async () => {
    vi.useFakeTimers();
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const bus = createEventBus<ToolbarEventMap>();
    const runtime = createMetricsRuntime({ collectors: [createNetworkCollector({ bus })] });
    const harness = api();
    try {
      runtime.start(harness.api);
      bus.emit("network-start", { requestId: "request", method: "GET", url: "/wait" });
      await Promise.resolve();
      runtime.flush();
      const before = runtime.store.getSnapshot();
      expect(before.requests[0]?.state).toBe("active");
      const listener = vi.fn();
      runtime.store.subscribe(listener);
      now = 100;
      runtime.flush();
      expect(runtime.store.peek().requests).toEqual([{ ...before.requests[0], duration: 100 }]);
      expect(runtime.store.peek().views).toEqual(before.views);
      expect(runtime.store.peek().seriesWritten).toBe(before.seriesWritten);
      expect(listener).not.toHaveBeenCalled();
      expect(runtime.store.getSnapshot()).toBe(before);
    } finally {
      harness.controller.abort();
      runtime.store.destroy();
      clock.mockRestore();
      vi.useRealTimers();
    }
  });

  // Pins missing view.detail in signature() (runtime.ts:60); ui.tsx:243 keeps old window counts.
  // When covered, invert to toHaveBeenCalledTimes(1) and getSnapshot() toBe(peek()).
  it("BUG: rolling failure detail changes without a new sample or severity change", async () => {
    vi.useFakeTimers();
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const bus = createEventBus<ToolbarEventMap>();
    const runtime = createMetricsRuntime({
      collectors: [createNetworkCollector({ bus, windowMs: 1000 })],
    });
    const harness = api();
    try {
      runtime.start(harness.api);
      for (const at of [100, 200]) {
        now = at;
        bus.emit("network-start", { requestId: String(at), method: "GET", url: "/failed" });
        bus.emit("network-end", { requestId: String(at), ok: false, status: 500, duration: 0 });
      }
      await Promise.resolve();
      runtime.flush();
      const before = runtime.store.getSnapshot();
      expect(before.views.network.detail).toContainEqual(["Failed (last 1 s)", "2"]);
      const listener = vi.fn();
      runtime.store.subscribe(listener);
      now = 1150;
      runtime.flush();
      expect(runtime.store.peek().views.network).toEqual({
        ...before.views.network,
        detail: before.views.network.detail.map(([label, value]) => [
          label,
          label === "Failed (last 1 s)" ? "1" : value,
        ]),
      });
      expect(runtime.store.peek().requests).toEqual(before.requests);
      expect(runtime.store.peek().seriesWritten).toBe(before.seriesWritten);
      expect(listener).not.toHaveBeenCalled();
      expect(runtime.store.getSnapshot()).toBe(before);
    } finally {
      harness.controller.abort();
      runtime.store.destroy();
      clock.mockRestore();
      vi.useRealTimers();
    }
  });
});
