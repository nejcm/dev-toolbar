/**
 * Coverage for `ToolbarHandle` methods lightly or unevenly covered elsewhere:
 * `part()`, `parts()`, the null path of `overlay()`, `errorChip()` with no
 * argument, `toggleVisible()`, `register()`, and the two documented error
 * paths — `openOverflow()` with nothing collapsed, and `resize()` without
 * `layout: true`.
 *
 * Deliberately does not touch `runCommand()`, `rerender()`, `panel()` on a
 * keepMounted panel, or post-unmount `context()` — those are owned by
 * concurrent work on `renderWithToolbar.tsx` and `consumer.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupToolbar, mountToolbar } from "../lifecycle";
import { makeExtension } from "../makeExtension";

afterEach(() => {
  cleanupToolbar();
  vi.restoreAllMocks();
});

describe("ToolbarHandle", () => {
  it("part() finds the first element with a given data-dtb-part", () => {
    const { toolbar } = mountToolbar(null, {
      extensions: [makeExtension({ id: "a" })],
    });

    expect(toolbar.part("bar")).not.toBeNull();
    expect(toolbar.part("does-not-exist")).toBeNull();
  });

  it("parts() finds every element with a given data-dtb-part", () => {
    const { toolbar } = mountToolbar(null, {
      extensions: [makeExtension({ id: "a" })],
    });

    // The bar renders a start region and an end region.
    const regions = toolbar.parts("region");
    expect(regions.length).toBe(2);
    for (const region of regions) {
      expect(region.getAttribute("data-dtb-part")).toBe("region");
    }

    expect(toolbar.parts("does-not-exist")).toEqual([]);
  });

  it("overlay() is null for an extension with no overlay slot, and for an unknown id", () => {
    // `src/core/__tests__/overlay.test.tsx` covers the found, hidden and
    // collapsed cases; what it does not cover is an extension that simply
    // never declared an `overlay` slot in the first place.
    const { toolbar } = mountToolbar(null, {
      extensions: [makeExtension({ id: "without-overlay" })],
    });

    expect(toolbar.overlay("without-overlay")).toBeNull();
    expect(toolbar.overlay("nonexistent")).toBeNull();
  });

  it("errorChip() with no id finds any error chip, in document order", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { toolbar } = mountToolbar(null, {
      extensions: [
        makeExtension({ id: "first-broken", throwInOverlay: true }),
        makeExtension({ id: "second-broken", throwInOverlay: true }),
      ],
    });

    // Two extensions have degraded, so this proves the no-argument form
    // matches whichever comes first in the document, not just "the one".
    const chip = toolbar.errorChip();
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute("data-dtb-ext-id")).toBe("first-broken");
    expect(chip).toBe(toolbar.errorChip("first-broken"));
  });

  it("toggleVisible() flips visibility on each call", () => {
    const { toolbar } = mountToolbar(null, { extensions: [makeExtension({ id: "a" })] });

    expect(toolbar.visible()).toBe(true);
    expect(toolbar.root()).not.toBeNull();

    toolbar.toggleVisible();
    expect(toolbar.visible()).toBe(false);
    expect(toolbar.root()).toBeNull();

    toolbar.toggleVisible();
    expect(toolbar.visible()).toBe(true);
    expect(toolbar.root()).not.toBeNull();
  });

  it("register() adds an extension dynamically and returns an unregister function", () => {
    const { toolbar } = mountToolbar(null, { extensions: [makeExtension({ id: "a" })] });

    expect(toolbar.item("dynamic")).toBeNull();

    const unregister = toolbar.register(makeExtension({ id: "dynamic", label: "Dynamic" }));
    expect(toolbar.item("dynamic")).not.toBeNull();
    expect(toolbar.barIds()).toContain("dynamic");

    unregister();
    expect(toolbar.item("dynamic")).toBeNull();
    expect(toolbar.barIds()).not.toContain("dynamic");
  });

  it("openOverflow() throws when nothing is collapsed", () => {
    const { toolbar } = mountToolbar(null, {
      extensions: [makeExtension({ id: "a" })],
      layout: { barWidth: 800 },
    });

    expect(toolbar.overflowButton()).toBeNull();
    expect(() => toolbar.openOverflow()).toThrow(
      "[dev-toolbar/testing] nothing has collapsed — there is no ⋮ button to open.",
    );
  });

  it("resize() throws when renderWithToolbar was not given layout: true", () => {
    const { toolbar } = mountToolbar(null, { extensions: [makeExtension({ id: "a" })] });

    expect(toolbar.layout).toBeNull();
    expect(() => toolbar.resize(500)).toThrow(
      "[dev-toolbar/testing] resize() needs renderWithToolbar({ layout: true }).",
    );
  });
});
