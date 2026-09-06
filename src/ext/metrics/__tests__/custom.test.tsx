import { afterEach, expect, it, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import {
  cleanupToolbar,
  createMemoryStorage,
  fakeExtensionApi,
  mountToolbar,
} from "@nejcm/dev-toolbar/testing";
import { createTimeSeries } from "../../../runtime";
import { metrics, METRIC_IDS, createMetricsRuntime } from "../index";
import type { Collector } from "../index";
import { agentBridge } from "../../agent/index";
import type { AgentRegistry } from "../../agent/index";
import { diagnostics } from "../../diagnostics/index";
import type { DiagnosticSnapshot } from "../../diagnostics/index";
import { createReactProfilerCollector } from "../../../../examples/playground/src/collectors/reactProfiler";

function custom(id = "queue"): Collector {
  return {
    id,
    supported: true,
    estimatedCost: "minimal",
    series: createTimeSeries(10),
    start: vi.fn(),
    reset: vi.fn(),
    read: () => ({
      id,
      label: id,
      title: id,
      status: "ok",
      severity: "ok",
      display: "7",
      value: 7,
      unit: "jobs",
      hint: "Queued jobs",
      detail: [],
    }),
    diagnostics: () => ({ jobs: 7, authToken: "secret" }),
  };
}

afterEach(cleanupToolbar);

it.each(["", "a.b", "a/b", "a b", "café", "a\n"])(
  "rejects invalid id %j even when excluded by only",
  (id) => {
    expect(() => metrics({ collectors: [custom(id)], only: [] })).toThrow("Invalid collector id");
  },
);
it.each(METRIC_IDS)("rejects shadowing disabled built-in %s at factory time", (id) => {
  expect(() => metrics({ collectors: [custom(id)], [id]: false, only: [] })).toThrow(
    "shadows a built-in",
  );
});
it("rejects duplicate registrations and unknown only IDs at factory time", () => {
  expect(() => metrics({ collectors: [custom(), custom()], only: [] })).toThrow(
    "Duplicate collector id",
  );
  expect(() => metrics({ only: ["missing"] })).toThrow('Unknown collector "missing"');
});
it("appends custom collectors and retains all four built-in views", () => {
  const collector = custom();
  const extension = metrics({ collectors: [collector] });
  expect(extension.diagnostics?.()).toMatchObject({
    metrics: [...METRIC_IDS, "queue"].map((id) => ({ id })),
  });
  const runtime = createMetricsRuntime({ collectors: [collector] });
  expect(Object.keys(runtime.store.getSnapshot().views)).toEqual(METRIC_IDS);
  expect(runtime.store.getSnapshot().custom.queue?.value).toBe(7);
  expect(runtime.store.getSnapshot().views.network.status).toBe("unsupported");
});
it.each(["__proto__", "constructor", "toString", "metrics", "custom", "url", "tab", "A_1-x"])(
  "preserves namespace-safe custom id %s",
  (id) => {
    const extension = metrics({ collectors: [custom(id)], only: [id] });
    const data = extension.diagnostics?.() as {
      metrics: unknown[];
      custom: Record<string, unknown>;
      url: string;
    };
    expect(data.metrics).toEqual([expect.objectContaining({ id, value: 7 })]);
    expect(Object.hasOwn(data.custom, id)).toBe(true);
    expect(data.custom[id]).toMatchObject({ jobs: 7 });
    expect(JSON.stringify(data)).not.toContain("secret");
    expect(typeof data.url).toBe("string");
  },
);
it("only controls order and startup, and starts repeated IDs once", () => {
  const selected = custom();
  const excluded = custom("unused");
  const extension = metrics({
    collectors: [selected, excluded],
    only: ["queue", "memory", "queue"],
    memory: false,
  });
  const harness = fakeExtensionApi();
  const dispose = extension.start?.(harness.api);
  expect(selected.start).toHaveBeenCalledTimes(1);
  expect(excluded.start).not.toHaveBeenCalled();
  expect(extension.diagnostics?.()).toMatchObject({ metrics: [{ id: "queue" }] });
  harness.abort();
  dispose?.();
});
it("round-trips a custom panel tab through storage and overflow", () => {
  const storage = createMemoryStorage();
  const extension = metrics({ collectors: [custom("constructor")] });
  const first = mountToolbar(null, {
    extensions: [extension],
    storage,
    layout: { barWidth: 900, itemWidth: 100 },
  });
  first.toolbar.openPanel("metrics");
  fireEvent.click(
    first.toolbar.panel("metrics")!.querySelector('[data-dtb-metric="constructor"]')!,
  );
  expect(
    first.toolbar
      .panel("metrics")!
      .querySelector('[role="tabpanel"]')!
      .getAttribute("data-dtb-metric"),
  ).toBe("constructor");
  first.unmount();
  const second = mountToolbar(null, {
    extensions: [extension],
    storage,
    layout: { barWidth: 900, itemWidth: 100 },
  });
  second.toolbar.openPanel("metrics");
  expect(
    second.toolbar
      .panel("metrics")!
      .querySelector('[role="tabpanel"]')!
      .getAttribute("data-dtb-metric"),
  ).toBe("constructor");
  second.toolbar.closePanel();
  second.toolbar.resize(60);
  second.toolbar.openOverflow();
  expect(
    second.toolbar.item("metrics")!.querySelector('[data-dtb-metric="constructor"]'),
  ).not.toBeNull();
});
it("routes the playground's fifth metric through bar, panel, only, agent and diagnostics", async () => {
  const profiler = createReactProfilerCollector();
  profiler.onRender("app", "mount", 12, 20, 0, 1);
  const instanceId = "custom-proof";
  const { toolbar } = mountToolbar(null, {
    instanceId,
    extensions: [
      metrics({ collectors: [profiler.collector], only: [...METRIC_IDS, profiler.collector.id] }),
      agentBridge({ instanceId }),
      diagnostics(),
    ],
    layout: { barWidth: 1200, itemWidth: 200 },
  });
  expect(
    toolbar.item("metrics")!.querySelector('[data-dtb-metric="react-profiler"]')!.textContent,
  ).toContain("12");
  expect(toolbar.item("metrics")!.querySelectorAll("[data-dtb-metric]")).toHaveLength(5);
  toolbar.openPanel("metrics");
  fireEvent.click(toolbar.panel("metrics")!.querySelector('[data-dtb-metric="react-profiler"]')!);
  expect(toolbar.panel("metrics")!.querySelector('[role="tabpanel"]')!.textContent).toContain(
    "Base duration20 ms",
  );
  const registry = (globalThis as unknown as { __DEV_TOOLBAR__: AgentRegistry }).__DEV_TOOLBAR__;
  const data = registry.instances[instanceId]!.read().diagnostics.find(
    (entry) => entry.id === "metrics",
  )!.data;
  expect(data).toMatchObject({
    metrics: expect.arrayContaining([
      { id: "react-profiler", status: "ok", severity: "ok", value: 12, unit: "ms" },
    ]),
    custom: { "react-profiler": { commits: [{ at: 1, actualDuration: 12, baseDuration: 20 }] } },
  });
  const capture = await toolbar.invokeCommand<DiagnosticSnapshot>("diagnostics.capture");
  expect(capture.ok).toBe(true);
  if (capture.ok)
    expect(
      capture.result.contributions.find((entry) => entry.id === "metrics")?.data,
    ).toMatchObject({
      custom: { "react-profiler": { commits: [{ at: 1, actualDuration: 12, baseDuration: 20 }] } },
      metrics: expect.arrayContaining([
        expect.objectContaining({ id: "react-profiler", value: 12 }),
      ]),
    });
  await act(async () => {
    profiler.onRender("app", "update", 22, 30, 2, 3);
  });
  expect(profiler.collector.series.last()).toBe(22);
  await toolbar.runCommand("metrics.reset");
  expect(profiler.collector.series.size).toBe(0);
});

it("publishes custom detail changes even when the chip and series stay unchanged", () => {
  const collector = custom();
  let detail = "first";
  const read = collector.read;
  collector.read = (at) => ({ ...read(at), detail: [["State", detail]] });
  const runtime = createMetricsRuntime({ collectors: [collector] });
  const listener = vi.fn();
  runtime.store.subscribe(listener);
  detail = "second";
  runtime.flush();
  expect(listener).toHaveBeenCalledOnce();
  expect(runtime.store.getSnapshot().custom.queue?.detail).toEqual([["State", "second"]]);
});
