import { describe, it } from "vitest";
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
  it.for(RUNTIME_API_CASES)("$name", (testCase, { skip }) =>
    runRuntimeApiCase(testCase, makeFakeHarness, () => skip()),
  );
});
