/**
 * The other half of the boundary check `presentation.types.ts` makes at the
 * type level: `presentation: "icon"` **renders**, in CommonJS, out of `dist/`.
 *
 * Why it belongs in this fixture rather than the vitest suite: the vitest
 * suite aliases `@nejcm/dev-toolbar/kit` to `src/kit`, so its extensions and
 * its `Glyph` are the same module by construction. Here `ext/environment.cjs`
 * and the consumer both reach kit through the `require` condition of the real
 * `exports` map, so what is pinned is the built artifact — the preset renders
 * out of `dist/*.cjs`, the kit `Glyph`'s attributes survive the build, and a
 * preset changes text without disturbing the chip's state.
 *
 * What the *rendered* assertions cannot see is module identity. A second
 * inlined copy of `resolveCompactParts`/`renderCompactParts`/`Glyph` would be
 * the same pure functions and would emit byte-identical DOM: no `env-label`,
 * empty `textContent`, `data-dtb-kind="glyph"` present. What they do detect is
 * the preset being *ignored* — `"icon"` is the one preset whose output is not
 * a superset of the default's, so an unhonoured preset shows up as a chip that
 * still paints its word rather than as a crash.
 *
 * Duplication is caught by the spy instead, the same way
 * `shared-instance.test.js` catches it for `resolveStyleNonce`:
 * `dist/ext/environment.cjs` calls `renderCompactParts` through a live
 * `require` binding on `@nejcm/dev-toolbar/kit`, so an extension carrying its
 * own inlined copy would render the same DOM and never touch the consumer's
 * spied export.
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

  // The consumer's own node, inside the kit's `Glyph` — which the extension
  // reached through `@nejcm/dev-toolbar/kit`, not a relative import.
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

  // An icon-only button is still a named button — the whole reason the
  // accessible names landed before the presets did.
  const trigger = item.querySelector('[data-dtb-part="trigger"]');
  expect(trigger.tagName).toBe("BUTTON");
  expect(trigger.getAttribute("aria-label")).toContain("Environment");

  // The duplicate detector. The DOM above is reproducible by any copy of the
  // helpers; this is not. `dist/ext/environment.cjs` reads
  // `renderCompactParts` off the live `require` binding at call time, so a
  // second inlined copy would satisfy every assertion above and leave this spy
  // at zero calls.
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
