import { describe, expect, it } from "vitest";
import {
  RUNTIME_API_CASES,
  runRuntimeApiCase,
  type RuntimeApiHarness,
} from "../../test-utils/runtimeApiConformance";
import { fakeExtensionApi } from "../fakeExtensionApi";

function makeFakeHarness(): RuntimeApiHarness {
  const fake = fakeExtensionApi();
  return {
    api: fake.api,
    setVisible: fake.setVisible,
    abort: fake.abort,
    dispose() {},
    delivery: "synchronous",
  };
}

describe("fakeExtensionApi conformance", () => {
  const expectedPhase2Failures = new Set([
    // Phase 2 suppresses notifications when visibility did not change.
    "the callback runs only when effective visibility changes",
    // Phase 2 contains callback failures so later subscribers still run.
    "a throwing callback is contained, and later ones still run",
    // Phase 2 snapshots listeners before delivering.
    "a subscriber added during delivery does not hear that delivery",
  ]);

  it("names only existing cases as expected failures", () => {
    const names = RUNTIME_API_CASES.map(({ name }) => name);
    expect(names).toEqual(expect.arrayContaining([...expectedPhase2Failures]));
  });

  for (const testCase of RUNTIME_API_CASES) {
    const test = expectedPhase2Failures.has(testCase.name) ? it.fails : it;
    test(testCase.name, ({ skip }) => runRuntimeApiCase(testCase, makeFakeHarness, () => skip()));
  }
});
