/**
 * Guards the CommonJS/Jest load path of `@nejcm/dev-toolbar/testing`.
 * See README.md in this directory for what has broken here before.
 *
 * The critical detail: this file NEVER calls `setTestingLibrary()`. If
 * `renderWithToolbar()` cannot find Testing Library on its own under Jest, these
 * tests fail — which is exactly the regression being guarded.
 */
const React = require("react");

// A real Jest consumer's RTL is in the module registry from module scope: its
// auto-cleanup registers an `afterAll`, and Jest forbids defining hooks inside a
// test. This require is the consumer's, not the toolbar's.
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

  // `cleanup()` comes from THIS file's require. Had renderWithToolbar loaded a
  // second, unrelated copy of Testing Library, this would know nothing about
  // what that copy mounted and the toolbar would still be in the document.
  rtl.cleanup();
  expect(document.querySelector('[data-dtb-part="root"]')).toBeNull();
});
