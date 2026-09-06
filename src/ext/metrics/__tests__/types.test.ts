import { expect, expectTypeOf, it } from "vitest";
import { METRIC_IDS } from "../index";
import type { CollectorId, MetricId, MetricsSnapshot, MetricView } from "../index";

it("keeps the built-in roster and snapshot views closed", () => {
  expectTypeOf<MetricId>().toEqualTypeOf<"memory" | "delay" | "jank" | "network">();
  expectTypeOf(METRIC_IDS).toEqualTypeOf<readonly MetricId[]>();
  expectTypeOf<keyof MetricsSnapshot["views"]>().toEqualTypeOf<MetricId>();
  expectTypeOf<MetricsSnapshot["order"]>().toEqualTypeOf<readonly CollectorId[]>();
  expect(METRIC_IDS).toEqual(["memory", "delay", "jank", "network"]);

  // @ts-expect-error Custom IDs must never become built-in IDs.
  const builtIn: MetricId = "react-profiler";
  // @ts-expect-error The built-in roster cannot contain a consumer ID.
  const roster: typeof METRIC_IDS = ["memory", "delay", "jank", "network", "react-profiler"];
  const view = {} as MetricView;
  // @ts-expect-error Dropping network must fail on the exact type the panel reads.
  const missingNetwork: MetricsSnapshot["views"] = { memory: view, delay: view, jank: view };
  void [builtIn, roster, missingNetwork];
});
