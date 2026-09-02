/**
 * One core instance across the main entry and `./testing`, in CommonJS.
 *
 * This is the case the rest of the suite could not see. `dist/testing.cjs` used
 * to inline its own copy of core — CJS output has no code splitting, and
 * `src/testing` value-imported `../core/*` — so a consumer that required both
 * entries got two modules, two React contexts and two `createMemoryStorage`s.
 * Nothing caught it: vitest aliases both specifiers to `src/`, and the other
 * files here never require the main entry alongside `./testing`.
 *
 * Before the fix: `createMemoryStorage` differed, `useDevToolbar()` threw
 * "must be called inside <DevToolbar>" inside `renderWithToolbar()`, and
 * `<DevToolbarInset>` rendered `paddingBottom: 0px` instead of the variable.
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
    // The main entry's hook, reading the context the toolbar rendered by
    // `./testing` provides. Two instances and this throws.
    const toolbar = main.useDevToolbar();
    seen.push(toolbar.instanceId);
    return React.createElement("output", null, String(toolbar.visible));
  }

  const { toolbar, unmount } = testing.renderWithToolbar(
    React.createElement(Consumer),
    { extensions: [testing.makeExtension({ id: "shared", label: "Shared" })] },
  );

  expect(toolbar.root()).not.toBeNull();
  // Reached at all, which is the whole point: two core instances and the hook
  // throws before it can push anything. React may render the consumer more than
  // once, so assert on the value rather than the call count.
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
  // `useOptionalDevToolbar()` returning null — the two-instance symptom — gives
  // a literal `0px`. Sharing one instance gives the `var(...)` expression.
  expect(inset.style.paddingBottom).toContain("--dev-toolbar-height");

  expect(toolbar.root()).not.toBeNull();
  unmount();
});
