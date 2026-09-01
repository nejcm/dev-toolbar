/**
 * The other half of the contract: when Testing Library genuinely cannot be
 * resolved, the failure must be an actionable message rather than a raw
 * `ERR_MODULE_NOT_FOUND` — and it must name the remedy that works *here*.
 *
 * `setTestingLibrary(await import(...))` is useless advice under Jest, because
 * the dynamic import is precisely what does not settle in its sandbox.
 *
 * Its own file so the mock cannot affect render.test.js: each test file gets a
 * fresh module registry.
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
