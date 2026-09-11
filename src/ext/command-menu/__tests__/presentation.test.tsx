/**
 * `/ext/command-menu`'s `presentation` option, against the real shell.
 *
 * Group C: the trigger paints a hardcoded `⌘` then either the hotkey hint or
 * the label, so the option is two knobs (`icon`, `name`), and `icon` has one
 * job — replace the `⌘`, nothing else. The hint still follows it in the bar,
 * the label still follows it in the `⋮` menu, so the trigger is never
 * wordless.
 *
 * The replacement lands in a `data-dtb-part="cmd-icon"` span carrying kit's
 * `data-dtb-kind="glyph"` clamp (stops a 24px `<svg>` setting the bar's
 * height). `cmd-glyph` deliberately doesn't gain that kind: it's every Apple
 * modifier symbol this extension paints, type-set as *text* at 1.18em, not a
 * foreign element to clamp.
 *
 * The default strings below were captured from the commit before this option
 * existed. Regenerate only against a deliberate, documented change to the bar
 * DOM.
 *
 * [dev-toolbar/plans/bar-presentation-icons-v1 §5 group C]
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { cleanupToolbar, mountToolbar } from "@nejcm/dev-toolbar/testing";
import { commandMenu } from "../index";
import type { CommandMenuOptions } from "../index";
import type { CommandMenuSnapshot } from "../runtime";
import { accessibleName } from "../../overlays";

/** A consumer's own inline `<svg>` — the proof that nothing was bundled. */
const ICON = (
  <svg viewBox="0 0 16 16" data-icon="palette">
    <circle cx="8" cy="8" r="7" />
  </svg>
);

const ICON_HTML =
  '<span data-dtb-part="cmd-icon" aria-hidden="true" data-dtb-kind="glyph">' +
  '<svg viewBox="0 0 16 16" data-icon="palette">' +
  '<circle cx="8" cy="8" r="7"></circle></svg></span>';

const CMD_HTML = '<span aria-hidden="true" data-dtb-part="cmd-glyph">⌘</span>';

/** Everything up to the first child. `apple: false` throughout, for a stable hint. */
const OPEN =
  '<button type="button" data-dtb-part="trigger" aria-haspopup="dialog" aria-expanded="false"' +
  ' aria-label="Commands (Ctrl+K)" aria-keyshortcuts="Control+K" title="Commands — Ctrl+K">';

const HINT = '<span data-dtb-part="cmd-trigger">Ctrl+K</span>';
const LABEL = "<span>Commands</span>";

const mount = (options: CommandMenuOptions = {}) => {
  cleanupToolbar();
  return mountToolbar(null, {
    extensions: [commandMenu({ apple: false, ...options })],
    layout: { barWidth: 900, itemWidth: 200 },
  });
};

const barTrigger = (options: CommandMenuOptions = {}): HTMLElement => {
  const { toolbar } = mount(options);
  const trigger = toolbar
    .item("command-menu")
    ?.querySelector<HTMLElement>('[data-dtb-part="trigger"]');
  expect(trigger).not.toBeNull();
  return trigger as HTMLElement;
};

/** The `⋮` row, with the bar collapsed to nothing. */
const overflowTrigger = (options: CommandMenuOptions = {}): HTMLElement => {
  const { toolbar } = mount(options);
  toolbar.resize(60);
  expect(toolbar.isOverflowed("command-menu")).toBe(true);
  toolbar.openOverflow();
  const trigger = toolbar.overflowMenu()?.querySelector<HTMLElement>('[data-dtb-part="trigger"]');
  expect(trigger).not.toBeNull();
  return trigger as HTMLElement;
};

afterEach(cleanupToolbar);

describe("the default presentation", () => {
  it("is byte-identical in the bar", () => {
    expect(barTrigger().outerHTML).toBe(`${OPEN}${CMD_HTML}${HINT}</button>`);
  });

  it("is byte-identical in the ⋮ menu", () => {
    expect(overflowTrigger().outerHTML).toBe(`${OPEN}${CMD_HTML}${LABEL}</button>`);
  });

  it("is byte-identical with no shortcut bound, where the bar paints the label", () => {
    expect(barTrigger({ shortcut: null }).outerHTML).toBe(
      '<button type="button" data-dtb-part="trigger" aria-haspopup="dialog"' +
        ' aria-expanded="false" aria-label="Commands"' +
        ' title="Commands — search and run every registered command">' +
        `${CMD_HTML}${LABEL}</button>`,
    );
  });

  it("is byte-identical on an Apple platform, modifier spans and all", () => {
    expect(barTrigger({ apple: true }).outerHTML).toBe(
      '<button type="button" data-dtb-part="trigger" aria-haspopup="dialog"' +
        ' aria-expanded="false" aria-label="Commands (⌘K)" aria-keyshortcuts="Meta+K"' +
        ' title="Commands — ⌘K">' +
        `${CMD_HTML}<span data-dtb-part="cmd-trigger">` +
        '<span data-dtb-part="cmd-glyph">⌘</span>K</span></button>',
    );
  });
});

describe("an icon", () => {
  it("replaces the ⌘ in the bar and leaves the hint alone", () => {
    expect(barTrigger({ presentation: { icon: ICON } }).outerHTML).toBe(
      `${OPEN}${ICON_HTML}${HINT}</button>`,
    );
  });

  it("replaces the ⌘ in the ⋮ menu and leaves the label alone", () => {
    expect(overflowTrigger({ presentation: { icon: ICON } }).outerHTML).toBe(
      `${OPEN}${ICON_HTML}${LABEL}</button>`,
    );
  });

  it("carries the glyph kind, and leaves cmd-glyph without one", () => {
    const withIcon = barTrigger({ presentation: { icon: ICON } });
    expect(withIcon.querySelector('[data-dtb-part="cmd-glyph"]')).toBeNull();
    expect(
      withIcon.querySelector('[data-dtb-part="cmd-icon"]')?.getAttribute("data-dtb-kind"),
    ).toBe("glyph");
    expect(
      barTrigger().querySelector('[data-dtb-part="cmd-glyph"]')?.getAttribute("data-dtb-kind"),
    ).toBeNull();
  });

  it("keeps the trigger's own state, name and hotkey attributes", () => {
    const trigger = barTrigger({ presentation: { icon: ICON } });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-keyshortcuts")).toBe("Control+K");
    expect(accessibleName(trigger)).toBe("Commands (Ctrl+K)");
    act(() => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("is hidden from assistive technology, since the button carries the name", () => {
    expect(
      barTrigger({ presentation: { icon: ICON } })
        .querySelector('[data-dtb-part="cmd-icon"]')
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
  });
});

describe("a function icon", () => {
  it("is handed the snapshot the trigger renders from, and can follow it", () => {
    const icon = vi.fn((snapshot: CommandMenuSnapshot) =>
      snapshot.open ? <span data-icon="open" /> : ICON,
    );
    const trigger = barTrigger({ presentation: { icon } });
    expect(icon.mock.calls[0]?.[0].open).toBe(false);
    expect(trigger.querySelector("svg")).not.toBeNull();

    act(() => trigger.click());
    expect(trigger.querySelector('[data-icon="open"]')).not.toBeNull();
  });

  it("returning nothing leaves the ⌘ in place", () => {
    expect(barTrigger({ presentation: { icon: () => undefined } }).outerHTML).toBe(
      `${OPEN}${CMD_HTML}${HINT}</button>`,
    );
  });

  it("returning null leaves the ⌘ in place", () => {
    expect(barTrigger({ presentation: { icon: () => null } }).outerHTML).toBe(
      `${OPEN}${CMD_HTML}${HINT}</button>`,
    );
  });

  // Kit's emptiness rule, not a presence test: `icon: (s) => s.open && <X />`
  // returns `false` when it declines, which must not replace the `⌘` with an
  // empty glyph.
  it.each([
    ["false, from a && guard", false],
    ["true", true],
    ["an empty string", ""],
  ])("returning %s leaves the ⌘ in place", (_name, value) => {
    expect(barTrigger({ presentation: { icon: () => value as never } }).outerHTML).toBe(
      `${OPEN}${CMD_HTML}${HINT}</button>`,
    );
  });
});

describe("a name override", () => {
  it("replaces the aria-label, and is handed the snapshot", () => {
    const trigger = barTrigger({
      presentation: {
        icon: ICON,
        name: (snapshot) => (snapshot.open ? "Close the palette" : "Open the palette"),
      },
    });
    expect(accessibleName(trigger)).toBe("Open the palette");
    act(() => trigger.click());
    expect(accessibleName(trigger)).toBe("Close the palette");
  });

  it("is ignored when it is whitespace, so the trigger cannot end up unnamed", () => {
    expect(barTrigger({ presentation: { name: () => "  " } }).getAttribute("aria-label")).toBe(
      "Commands (Ctrl+K)",
    );
  });

  it("does not touch the title, which still spells out the hotkey", () => {
    expect(
      barTrigger({ presentation: { icon: ICON, name: () => "Palette" } }).getAttribute("title"),
    ).toBe("Commands — Ctrl+K");
  });
});
