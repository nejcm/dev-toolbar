import { describe, expect, it, vi } from "vitest";
import { createMetricsRuntime } from "../runtime";
import { createMemoryCollector } from "../collectors/memory";
import { createNetworkCollector } from "../collectors/network";
import { REDACTED } from "../../../runtime";
import type { ExtensionRuntimeApi } from "../../../core/contract";

function api(): {
  api: ExtensionRuntimeApi;
  controller: AbortController;
  setVisible: (visible: boolean) => void;
  store: Map<string, string>;
} {
  const controller = new AbortController();
  const store = new Map<string, string>();
  let visible = true;
  const listeners = new Set<(value: boolean) => void>();
  return {
    controller,
    store,
    setVisible(next) {
      visible = next;
      for (const listener of listeners) listener(next);
    },
    api: {
      signal: controller.signal,
      isVisible: () => visible,
      subscribeVisibility(callback) {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
      getCommands: () => [],
      runCommand: async () => false,
      storage: {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => void store.set(key, value),
        removeItem: (key) => void store.delete(key),
      },
    },
  };
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
        Array.from({ length: 25 }, (_, index) =>
          globalThis.fetch(`/api/${index}`),
        ),
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
    window.history.replaceState(
      {},
      "",
      "/callback?access_token=hunter2&state=xyz",
    );
    try {
      const runtime = createMetricsRuntime({ collectors: [memory()] });
      const dump = JSON.stringify(runtime.diagnostics());
      expect(dump).toContain("/callback");
      expect(dump).toContain("state=xyz");
      expect(dump).not.toContain("hunter2");
      expect(dump).toContain(encodeURIComponent(REDACTED));
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
      // URL-encoded, because it was masked inside a query parameter.
      expect(dump).toContain(encodeURIComponent(REDACTED));
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
