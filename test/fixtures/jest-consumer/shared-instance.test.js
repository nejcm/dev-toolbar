/**
 * Verifies one core instance across the main entry and `./testing`, in CommonJS.
 *
 * The rest of the suite couldn't catch this: `dist/testing.cjs` used to inline
 * its own copy of core (CJS has no code splitting, and `src/testing`
 * value-imported `../core/*`), so requiring both entries gave two modules, two
 * React contexts, and two `createMemoryStorage`s. Vitest aliases both
 * specifiers to `src/`, masking it there.
 *
 * Symptoms before the fix: `createMemoryStorage` differed, `useDevToolbar()`
 * threw "must be called inside <DevToolbar>", and `<DevToolbarInset>`
 * rendered `paddingBottom: 0px` instead of the variable.
 */
const React = require("react");

// The consumer's own copy, from module scope — same reason as render.test.js.
require("@testing-library/react");

const main = require("@nejcm/dev-toolbar");
const testing = require("@nejcm/dev-toolbar/testing");

test("both entries resolve to the same core module", () => {
  expect(testing.createMemoryStorage).toBe(main.createMemoryStorage);
  expect(testing.createNullStorage).toBe(main.createNullStorage);
});

test("useDevToolbar() from the main entry works inside renderWithToolbar()", () => {
  const seen = [];

  function Consumer() {
    // Main entry's hook, reading the context `./testing` provides. Throws if
    // there are two core instances.
    const toolbar = main.useDevToolbar();
    seen.push(toolbar.instanceId);
    return React.createElement("output", null, String(toolbar.visible));
  }

  const { toolbar, unmount } = testing.renderWithToolbar(
    React.createElement(Consumer),
    { extensions: [testing.makeExtension({ id: "shared", label: "Shared" })] },
  );

  expect(toolbar.root()).not.toBeNull();
  // Reaching here is the point: two core instances and the hook throws first.
  // React may render Consumer more than once, so assert value, not call count.
  expect(seen.length).toBeGreaterThan(0);
  expect(seen).toEqual(seen.map(() => toolbar.context().instanceId));
  expect(document.querySelector("output").textContent).toBe("true");

  unmount();
});

test("DevToolbarInset reads the height variable the rendered toolbar publishes", () => {
  const { toolbar, unmount } = testing.renderWithToolbar(
    React.createElement(
      main.DevToolbarInset,
      null,
      React.createElement("p", null, "content"),
    ),
    { extensions: [testing.makeExtension({ id: "inset", label: "Inset" })], layout: true },
  );

  const inset = document.querySelector('[data-dtb-part="inset"]');
  expect(inset).not.toBeNull();
  // Two instances make `useOptionalDevToolbar()` return null, giving a literal
  // `0px` instead of the `var(...)` expression.
  expect(inset.style.paddingBottom).toContain("--dev-toolbar-height");

  expect(toolbar.root()).not.toBeNull();
  unmount();
});
