/**
 * The other half of the boundary check `presentation.types.ts` makes at the
 * type level: `presentation: "icon"` **renders**, in CommonJS, out of `dist/`.
 * `"icon"` because it is the one preset whose output is not a superset of the
 * default's, so a preset silently ignored shows up as a failure here.
 *
 * Belongs in this fixture rather than the vitest suite because vitest aliases
 * `@nejcm/dev-toolbar/kit` to `src/kit`, making module identity trivially
 * true. Here `ext/environment.cjs` and the consumer both reach kit through
 * the `require` condition of the real `exports` map, so this pins the built
 * artifact.
 *
 * The rendered assertions can't detect module identity — a second inlined
 * copy of `resolveCompactParts`/`renderCompactParts`/`Glyph` would emit the
 * same DOM. Duplication is caught by the spy instead, the same way
 * `shared-instance.test.js` catches it for `resolveStyleNonce`:
 * `dist/ext/environment.cjs` calls `renderCompactParts` through a live
 * `require` binding, so an inlined copy would never touch the spied export.
 */
const React = require("react");

// Module scope, so RTL can register its auto-cleanup — see render.test.js.
require("@testing-library/react");

// Module scope, and before the `require`s below: `jest.doMock` is not hoisted,
// so the extension has to be required *after* it — and doing that require
// inside a test body is what trips Testing Library's hook registration.
const actualKit = jest.requireActual("@nejcm/dev-toolbar/kit");
const renderCompactParts = jest.fn(actualKit.renderCompactParts);
jest.doMock("@nejcm/dev-toolbar/kit", () => ({ ...actualKit, renderCompactParts }));

const { renderWithToolbar } = require("@nejcm/dev-toolbar/testing");
const { environment } = require("@nejcm/dev-toolbar/ext/environment");

const context = () => ({ environment: "production", release: "1.2.3" });

const icon = React.createElement("svg", {
  viewBox: "0 0 16 16",
  "data-fixture-icon": "true",
});

test('presentation: "icon" paints the icon instead of the word', () => {
  const { toolbar, unmount } = renderWithToolbar(React.createElement("main", null, "app"), {
    extensions: [environment({ context, presentation: { preset: "icon", icon } })],
  });

  const item = toolbar.item("environment");
  expect(item).not.toBeNull();

  // The consumer's own node, inside the kit's `Glyph`, reached through
  // `@nejcm/dev-toolbar/kit`, not a relative import.
  const glyph = item.querySelector('[data-dtb-part="env-icon"]');
  expect(glyph).not.toBeNull();
  expect(glyph.getAttribute("data-dtb-kind")).toBe("glyph");
  expect(glyph.getAttribute("aria-hidden")).toBe("true");
  expect(glyph.querySelector("[data-fixture-icon]")).not.toBeNull();

  // "icon" is text-less and value-less in the bar: the assertion that fails if
  // the preset was resolved but not honoured.
  expect(item.querySelector('[data-dtb-part="env-label"]')).toBeNull();
  expect(item.querySelector('[data-dtb-part="env-value"]')).toBeNull();
  expect(item.textContent).toBe("");

  // A preset changes text, not state: the chip, its dot and its severity stay.
  const chip = item.querySelector('[data-dtb-part="env-chip"]');
  expect(chip).not.toBeNull();
  expect(chip.getAttribute("data-dtb-severity")).toBeTruthy();
  expect(item.querySelector('[data-dtb-part="env-dot"]')).not.toBeNull();

  // An icon-only button is still named — why accessible names landed before
  // presets did.
  const trigger = item.querySelector('[data-dtb-part="trigger"]');
  expect(trigger.tagName).toBe("BUTTON");
  expect(trigger.getAttribute("aria-label")).toContain("Environment");

  // The duplicate detector: the DOM above is reproducible by any copy of the
  // helpers, this spy is not — a second inlined `renderCompactParts` would
  // satisfy every assertion above and leave it at zero calls.
  expect(renderCompactParts).toHaveBeenCalled();
  const [call] = renderCompactParts.mock.calls;
  expect(call[0].parts).toEqual({ icon: true, text: "none", value: false });

  unmount();
});

test("the default presentation still paints the word and the value", () => {
  const { toolbar, unmount } = renderWithToolbar(React.createElement("main", null, "app"), {
    extensions: [environment({ context })],
  });

  const item = toolbar.item("environment");
  expect(item.querySelector('[data-dtb-part="env-label"]').textContent).toBe("env");
  expect(item.querySelector('[data-dtb-part="env-value"]')).not.toBeNull();
  expect(item.querySelector('[data-dtb-part="env-icon"]')).toBeNull();

  unmount();
});
