import { act } from "@testing-library/react";
import { renderWithToolbar } from "@nejcm/dev-toolbar/testing";
import { describe, it } from "vitest";
import type { DevToolbarExtension, ExtensionRuntimeApi } from "../contract";
import {
  RUNTIME_API_CASES,
  runRuntimeApiCase,
  type RuntimeApiHarness,
} from "../../test-utils/runtimeApiConformance";

function makeCoreHarness(): RuntimeApiHarness {
  let api: ExtensionRuntimeApi | undefined;
  const extension: DevToolbarExtension = {
    id: "runtime-api-conformance",
    label: "Runtime API conformance",
    start: (runtimeApi) => {
      api = runtimeApi;
    },
  };
  const rendered = renderWithToolbar(null, { extensions: [], storage: null });
  const unregister = rendered.toolbar.register(extension);
  if (!api) {
    rendered.unmount();
    throw new Error("the conformance extension did not start");
  }

  let batching = false;
  return {
    api,
    setVisible(next) {
      if (batching) {
        rendered.toolbar.context().setVisible(next);
      } else {
        rendered.toolbar.setVisible(next);
      }
    },
    batch(flips) {
      act(() => {
        batching = true;
        try {
          flips();
        } finally {
          batching = false;
        }
      });
    },
    abort: unregister,
    dispose: rendered.unmount,
    delivery: "post-commit",
  };
}

describe("core ExtensionRuntimeApi conformance", () => {
  it.for(RUNTIME_API_CASES)("$name", (testCase, { skip }) =>
    runRuntimeApiCase(testCase, makeCoreHarness, () => skip()),
  );
});
