/**
 * Guards the CommonJS/Jest load path of `@nejcm/dev-toolbar/testing`.
 * See README.md in this directory for what has broken here before.
 *
 * Critical detail: this file NEVER calls `setTestingLibrary()`. If
 * `renderWithToolbar()` can't find Testing Library on its own under Jest,
 * these tests fail — that's the regression being guarded.
 */
const React = require("react");

// Required at module scope (not inside a test) so RTL's auto-cleanup can
// register its `afterAll` hook, which Jest forbids doing inside a test.
const rtl = require("@testing-library/react");

const {
  renderWithToolbar,
  makeExtension,
  createMockBus,
} = require("@nejcm/dev-toolbar/testing");

test("the DOM-free helpers work under Jest", () => {
  const bus = createMockBus();
  bus.clock.setTimeout(() => bus.emit("tick", 1), 10);
  bus.clock.advance(20);

  expect(bus.payloads("tick")).toEqual([1]);
  expect(bus.clock.now()).toBe(20);
  expect(makeExtension({ id: "x", label: "X" }).id).toBe("x");
});

test("renderWithToolbar renders with no setTestingLibrary() call", () => {
  const extension = makeExtension({
    id: "jest-ext",
    label: "Jest",
    compact: "42ms",
    panel: "detail",
  });

  const { toolbar, unmount } = renderWithToolbar(
    React.createElement("main", null, "app"),
    { extensions: [extension] },
  );

  expect(toolbar.root()).not.toBeNull();
  expect(toolbar.item("jest-ext").textContent).toBe("42ms");

  toolbar.openPanel("jest-ext");
  expect(toolbar.activePanelId()).toBe("jest-ext");
  expect(toolbar.panel("jest-ext").textContent).toContain("detail");

  unmount();
  expect(toolbar.root()).toBeNull();
});

test("the fallback returns Jest's registry copy, not a second instance", () => {
  const { toolbar } = renderWithToolbar(React.createElement("main", null, "app"), {
    extensions: [makeExtension({ id: "shared", label: "Shared" })],
  });
  expect(toolbar.root()).not.toBeNull();

  // `cleanup()` comes from this file's require; if renderWithToolbar had
  // loaded a second RTL copy, this cleanup wouldn't know about it.
  rtl.cleanup();
  expect(document.querySelector('[data-dtb-part="root"]')).toBeNull();
});
