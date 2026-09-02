/**
 * The other half of the contract: when Testing Library can't be resolved,
 * the failure must be an actionable message naming a remedy that works under
 * Jest — `setTestingLibrary(await import(...))` is useless advice here since
 * dynamic import doesn't settle in Jest's sandbox.
 *
 * Own file so the mock doesn't leak into render.test.js (separate module registries).
 */
const React = require("react");

jest.mock("@testing-library/react", () => {
  throw new Error("Cannot find module '@testing-library/react'");
});

const {
  renderWithToolbar,
  makeExtension,
  createMockBus,
  installToolbarLayout,
} = require("@nejcm/dev-toolbar/testing");

test("the subpath still imports when Testing Library is unresolvable", () => {
  expect(typeof createMockBus).toBe("function");
  expect(typeof makeExtension).toBe("function");
  expect(typeof installToolbarLayout).toBe("function");

  const bus = createMockBus();
  bus.emit("ready", true);
  expect(bus.payloads("ready")).toEqual([true]);
});

test("renderWithToolbar explains itself, in the form Jest can act on", () => {
  let message = "no-throw";
  try {
    renderWithToolbar(React.createElement("main", null, "app"));
  } catch (error) {
    message = error.message;
  }

  expect(message).toContain("@testing-library/react");
  expect(message).toContain("npm install --save-dev");
  expect(message).toContain(
    "CommonJS / Jest:  setTestingLibrary(require('@testing-library/react'))",
  );
  expect(message).toContain("setupFilesAfterEnv");
});
