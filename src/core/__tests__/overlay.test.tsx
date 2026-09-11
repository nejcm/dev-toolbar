/**
 * The `overlay` slot, added by P2's third extension.
 *
 * It exists because the bar is not a place to hang a modal: a compact item that
 * has collapsed into the `⋮` menu is not in the DOM at all, so an extension
 * whose whole surface is a dialog would lose it exactly when the window got
 * narrow. Everything below is that promise, plus the usual containment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { cleanupToolbar, makeExtension, mountToolbar } from "@nejcm/dev-toolbar/testing";
import { CORE_CSS, DevToolbar } from "@nejcm/dev-toolbar";
import type { OverlaySlotProps } from "../contract";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanupToolbar();
  vi.restoreAllMocks();
});

/** Tracked by `mountToolbar`, so the `afterEach` above tears every mount down. */
const mount = mountToolbar;

describe("overlay slot", () => {
  it("renders once, inside the toolbar root, without being asked to open", () => {
    const { toolbar } = mount(null, {
      extensions: [makeExtension({ id: "a", overlay: true })],
    });
    const overlay = toolbar.overlay("a");
    expect(overlay).not.toBeNull();
    expect(toolbar.root()?.contains(overlay)).toBe(true);
    expect(document.querySelectorAll('[data-dtb-part="overlay"]')).toHaveLength(1);
  });

  it("survives its own item collapsing into the ⋮ menu", () => {
    const { toolbar } = mount(null, {
      extensions: [
        makeExtension({ id: "wide", priority: 10 }),
        makeExtension({ id: "palette", priority: 5, overlay: true }),
      ],
      layout: { barWidth: 400, itemWidth: 150 },
    });
    toolbar.resize(120);
    expect(toolbar.isOverflowed("palette")).toBe(true);
    // The compact item is gone; the overlay is not.
    expect(toolbar.item("palette")).toBeNull();
    expect(toolbar.overlay("palette")).not.toBeNull();
  });

  it("is not rendered for a hidden extension, and goes away when one becomes hidden", () => {
    const build = (hidden: boolean) =>
      makeExtension({ id: "a", overlay: true, ...(hidden ? { hidden } : {}) });

    const { rerender, unmount } = render(<DevToolbar extensions={[build(false)]} storage={null} />);
    const overlay = () => document.querySelector('[data-dtb-part="overlay"][data-dtb-ext-id="a"]');
    expect(overlay()).not.toBeNull();
    rerender(<DevToolbar extensions={[build(true)]} storage={null} />);
    expect(overlay()).toBeNull();
    unmount();
  });

  it("disappears with the bar when the toolbar is hidden", () => {
    const { toolbar } = mount(null, {
      extensions: [makeExtension({ id: "a", overlay: true })],
    });
    toolbar.setVisible(false);
    expect(toolbar.overlay("a")).toBeNull();
    toolbar.setVisible(true);
    expect(toolbar.overlay("a")).not.toBeNull();
  });

  it("degrades a throwing overlay to an error chip and leaves the bar alone", () => {
    const { toolbar } = mount(null, {
      extensions: [
        makeExtension({ id: "boom", throwInOverlay: true }),
        makeExtension({ id: "fine" }),
      ],
    });
    expect(toolbar.bar()).not.toBeNull();
    expect(toolbar.item("fine")).not.toBeNull();
    const chip = toolbar.errorChip("boom");
    expect(chip).not.toBeNull();
    expect(chip?.dataset["dtbSlot"]).toBe("overlay");
  });

  it("hands the slot the density and position it renders under", () => {
    let props: OverlaySlotProps | null = null;
    const { toolbar } = mount(null, {
      density: "comfortable",
      extensions: [
        makeExtension({
          id: "a",
          overlay: (received) => {
            props = received;
            return null;
          },
        }),
      ],
    });
    expect(props).toEqual({ density: "comfortable", position: "bottom" });
    toolbar.setPosition("top");
    expect(props).toEqual({ density: "comfortable", position: "top" });
  });

  it("does not re-invoke the slot for state it does not render from", () => {
    let renders = 0;
    const { toolbar } = mount(null, {
      extensions: [
        makeExtension({
          id: "a",
          overlay: () => {
            renders += 1;
            return null;
          },
        }),
        makeExtension({ id: "b", panel: true }),
      ],
    });
    const before = renders;
    // A panel-height drag fires one of these per pointermove; without the memo
    // the overlay's whole dialog would re-render on each frame.
    toolbar.openPanel("b");
    toolbar.setPanelHeight(240);
    toolbar.setPanelHeight(260);
    expect(renders).toBe(before);
    // It does re-render for something it renders from.
    toolbar.setPosition("top");
    expect(renders).toBeGreaterThan(before);
  });

  it("is laid out with display: contents, so it adds no box of its own", () => {
    // This used to assert `--dev-toolbar-height` was unchanged with an overlay
    // present, but that passed regardless — `/testing`'s fake layout stubs a
    // fixed height. Under jsdom there's no real layout to measure, so the
    // honest assertion is on the CSS rule itself; the real-browser half is
    // checked by hand in the playground.
    for (const [name, css] of [
      ["CORE_CSS", CORE_CSS],
      ["styles.css", readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8")],
    ] as const) {
      const rule = css.match(/\[data-dtb-part="overlay"\]\s*\{([^}]*)\}/)?.[1];
      expect(rule, name).toBeDefined();
      expect(rule?.replace(/\s+/g, " "), name).toContain("display: contents;");
    }
  });

  it("puts a throwing overlay's chip in the root's own flex column", () => {
    // Documented rather than fixed: the error chip is a plain child of the
    // root (`flex-direction: column`), so it lands as a row between the bar
    // and the panel and does add to `--dev-toolbar-height`. Error path only —
    // a visible failure beats a hidden one — but it's the one case where "an
    // overlay adds no layout" isn't true.
    const { toolbar } = mount(null, {
      extensions: [makeExtension({ id: "boom", throwInOverlay: true })],
    });
    const chip = toolbar.errorChip("boom");
    expect(chip?.dataset["dtbSlot"]).toBe("overlay");
    // Its only ancestor below the root is the `display: contents` wrapper,
    // which is exactly what makes the chip a flex child of the root itself.
    expect(chip?.parentElement).toBe(toolbar.overlay("boom"));
    expect(chip?.parentElement?.parentElement).toBe(toolbar.root());
  });
});
