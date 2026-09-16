/**
 * `/ext/flags`' two `presentation` surfaces, against the real shell.
 *
 * 1. Two surfaces, because a control's presentation is configured next to
 *    that control: `FlagsOptions.presentation` is the chip,
 *    `PromotedFlag.presentation` is one promoted flag, invoked per flag —
 *    rather than one flags-level callback taking `FlagsSnapshot | FlagView`
 *    that every consumer would have to narrow.
 * 2. A `ReactNode` never enters the store. The store compares the whole
 *    snapshot, so a React element there is a plain object the comparator walks
 *    into — in development through `_owner` into a cyclic fiber — and would sit
 *    inside what `diagnostics()` serialises. `PromotedFlag.icon` therefore stays
 *    `string`; rich icons live on `PromotedFlag.presentation` and reach `ui.tsx`
 *    as props from the factory closure — proved below, in "the hard rule".
 * 3. The hand-written chip stays hand-written: it has no dot, so it isn't
 *    routed through `Chip`. It gained kit's `renderCompactParts` slotting
 *    into the span it already had; the default literals prove that slotted
 *    in byte-for-byte.
 *
 * Every literal here was captured from a mounted toolbar. Regenerate only by
 * capture, never by hand.
 *
 * [dev-toolbar/plans/bar-presentation-icons-v1 §5]
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import { act } from "@testing-library/react";
import { cleanupToolbar, mountToolbar } from "@nejcm/dev-toolbar/testing";
import type { CompactPreset, CompactRenderContext } from "@nejcm/dev-toolbar/kit";
import { flags } from "../index";
import type { FlagsOptions } from "../index";
import { createFlagsRuntime } from "../runtime";
import type { FlagView, FlagsSnapshot, PromotedFlag } from "../types";

/** Two flags, both promoted: a boolean switch and a string that paints a value. */
const CATALOGUE = [
  { key: "new-header", type: "boolean" as const, defaultValue: true },
  { key: "checkout.tier", type: "string" as const, defaultValue: "gold" },
];

const BASE: FlagsOptions = {
  flags: CATALOGUE,
  promoted: [{ flagKey: "new-header" }, { flagKey: "checkout.tier" }],
};

/** Tears down first: the testing helpers query the document, not one root. */
const mount = (options: FlagsOptions = {}) => {
  cleanupToolbar();
  return mountToolbar(null, {
    extensions: [flags({ ...BASE, ...options })],
    layout: { barWidth: 900, itemWidth: 200 },
  });
};

/** Everything `/ext/flags` puts in the bar: both promoted controls and the chip. */
const barItem = (options: FlagsOptions = {}): HTMLElement =>
  mount(options).toolbar.item("flags") as HTMLElement;

/** The `⋮` entry, with the bar collapsed to nothing. */
const overflow = (options: FlagsOptions = {}): HTMLElement => {
  const { toolbar } = mount(options);
  toolbar.resize(60);
  expect(toolbar.isOverflowed("flags")).toBe(true);
  toolbar.openOverflow();
  const wrapper = toolbar
    .overflowMenu()
    ?.querySelector<HTMLElement>('[data-dtb-part="flag-overflow"]');
  expect(wrapper).not.toBeNull();
  return wrapper as HTMLElement;
};

const chipOf = (root: HTMLElement): HTMLElement =>
  root.querySelector('[data-dtb-part="flag-chip"]') as HTMLElement;

const triggerOf = (root: HTMLElement): HTMLElement =>
  root.querySelector(
    '[data-dtb-part="trigger"], [data-dtb-part="flag-overflow-trigger"]',
  ) as HTMLElement;

const promotedOf = (root: HTMLElement, key: string): HTMLElement =>
  root.querySelector(`[data-dtb-part="flag-promoted"][data-dtb-flag="${key}"]`) as HTMLElement;

const textIn = (element: Element, selector: string): string | null =>
  element.querySelector(selector)?.textContent ?? null;

const countIn = (element: Element, selector: string): number =>
  element.querySelectorAll(selector).length;

/**
 * The promoted control's text span, located structurally rather than by
 * `data-dtb-part` — naming it would move the default bytes below.
 */
const promotedText = (button: Element): string | null => {
  const span = [...button.querySelectorAll(":scope > span")].find(
    (node) => !node.hasAttribute("data-dtb-part") && !node.hasAttribute("aria-hidden"),
  );
  return span?.textContent ?? null;
};

/** A consumer's own inline `<svg>` — the proof that nothing was bundled. */
const ICON = (
  <svg viewBox="0 0 16 16" data-icon="flag">
    <path d="M2 2h12v6H2z" />
  </svg>
);

/** `presentation` on one promoted flag, leaving the other alone. */
const promotedWith = (
  key: string,
  presentation: PromotedFlag["presentation"],
  extra: Omit<PromotedFlag, "flagKey" | "presentation"> = {},
): FlagsOptions => ({
  promoted:
    BASE.promoted === undefined
      ? []
      : [
          ...(BASE.promoted as readonly PromotedFlag[]).filter((entry) => entry.flagKey !== key),
          { flagKey: key, ...extra, ...(presentation === undefined ? {} : { presentation }) },
        ].sort((a, b) => (a.flagKey === "new-header" ? -1 : b.flagKey === "new-header" ? 1 : 0)),
});

afterEach(cleanupToolbar);

describe("the default presentation", () => {
  // Both promoted controls and the chip, in one string, because the promoted
  // siblings are part of what this item paints.
  const DEFAULT_BAR =
    '<button type="button" data-dtb-part="flag-promoted" data-dtb-flag="new-header" data-dtb-overridden="false" aria-label="new-header" title="new-header = true · from default · click to open the flags panel">' +
    '<span data-dtb-part="flag-promoted-dot" data-dtb-kind="dot" aria-hidden="true"></span>' +
    "<span>new-header</span></button>" +
    '<button type="button" data-dtb-part="flag-promoted" data-dtb-flag="checkout.tier" data-dtb-overridden="false" aria-label="checkout.tier, gold" title="checkout.tier = gold · from default · click to open the flags panel">' +
    '<span data-dtb-part="flag-promoted-dot" data-dtb-kind="dot" aria-hidden="true"></span>' +
    "<span>checkout.tier</span>" +
    '<span data-dtb-part="flag-promoted-value" data-dtb-kind="value">gold</span></button>' +
    '<button type="button" data-dtb-part="trigger" aria-expanded="false" aria-label="Flags" title="Feature flags: 2 · 0 locally overridden · read-only">' +
    '<span data-dtb-part="flag-chip" data-dtb-kind="chip" data-dtb-overridden="false">' +
    '<span data-dtb-part="flag-label" data-dtb-kind="label">flags</span>' +
    '<span data-dtb-part="flag-count">2</span></span></button>';

  // The `⋮` entry. The chip still says "flags", not "Flags": unlike Group A,
  // this one never swung to its full label when overflowed, so
  // `CompactDefaults.overflow` is `"short"` here. A preset still forces the full word.
  const DEFAULT_OVERFLOW =
    '<div data-dtb-part="flag-overflow">' +
    '<button type="button" data-dtb-part="flag-promoted" data-dtb-flag="new-header" data-dtb-overridden="false" aria-label="new-header" title="new-header = true · from default · click to open the flags panel">' +
    '<span data-dtb-part="flag-promoted-dot" data-dtb-kind="dot" aria-hidden="true"></span>' +
    "<span>new-header</span></button>" +
    '<button type="button" data-dtb-part="flag-promoted" data-dtb-flag="checkout.tier" data-dtb-overridden="false" aria-label="checkout.tier, gold" title="checkout.tier = gold · from default · click to open the flags panel">' +
    '<span data-dtb-part="flag-promoted-dot" data-dtb-kind="dot" aria-hidden="true"></span>' +
    "<span>checkout.tier</span>" +
    '<span data-dtb-part="flag-promoted-value" data-dtb-kind="value">gold</span></button>' +
    '<button type="button" data-dtb-part="flag-overflow-trigger" aria-expanded="false" aria-label="Flags" title="Feature flags: 2 · 0 locally overridden · read-only">' +
    '<span data-dtb-part="flag-chip" data-dtb-kind="chip" data-dtb-overridden="false">' +
    '<span data-dtb-part="flag-label" data-dtb-kind="label">flags</span>' +
    '<span data-dtb-part="flag-count">2</span></span></button></div>';

  // A non-default state: one flag locally overridden, a writable adapter so
  // the boolean is a `role="switch"`, a back-compat string `icon`, and a
  // promoted `label`.
  const EDITED_BAR =
    '<button type="button" data-dtb-part="flag-promoted" data-dtb-flag="new-header" data-dtb-overridden="false" aria-label="new-header" role="switch" aria-checked="true" title="new-header = true · from default · click to toggle">' +
    '<span data-dtb-part="flag-promoted-dot" data-dtb-kind="dot" aria-hidden="true"></span>' +
    '<span aria-hidden="true">A</span><span>new-header</span></button>' +
    '<button type="button" data-dtb-part="flag-promoted" data-dtb-flag="checkout.tier" data-dtb-overridden="true" aria-label="Tier, silver" title="checkout.tier = silver · locally overridden — the app\'s own value is gold · click to open the flags panel">' +
    '<span data-dtb-part="flag-promoted-dot" data-dtb-kind="dot" aria-hidden="true"></span>' +
    "<span>Tier</span>" +
    '<span data-dtb-part="flag-promoted-value" data-dtb-kind="value">silver</span></button>' +
    '<button type="button" data-dtb-part="trigger" aria-expanded="false" aria-label="Flags" title="Feature flags: 2 · 1 locally overridden">' +
    '<span data-dtb-part="flag-chip" data-dtb-kind="chip" data-dtb-overridden="true">' +
    '<span data-dtb-part="flag-label" data-dtb-kind="label">flags</span>' +
    '<span data-dtb-part="flag-count">1 overridden</span></span></button>';

  it("paints the bar byte-identically with no option at all", () => {
    expect(barItem().innerHTML).toBe(DEFAULT_BAR);
  });

  it("paints the ⋮ entry byte-identically with no option at all", () => {
    expect(overflow().outerHTML).toBe(DEFAULT_OVERFLOW);
  });

  it("paints an edited, overridden bar byte-identically", async () => {
    const { toolbar } = mount({
      onOverride: () => {},
      promoted: [
        { flagKey: "new-header", icon: "A" },
        { flagKey: "checkout.tier", label: "Tier" },
      ],
    });
    await act(async () => {
      await toolbar.invokeCommand("flags.set", { key: "checkout.tier", value: "silver" });
    });
    expect((toolbar.item("flags") as HTMLElement).innerHTML).toBe(EDITED_BAR);
  });

  it('is unmoved by icon: "" — an empty string is not an icon', () => {
    // `PromotedFlag.icon` is painted on truthiness, so `""` paints nothing —
    // pinned on both surfaces because it is a one-character regression.
    const empty = { promoted: [{ flagKey: "new-header", icon: "" }, { flagKey: "checkout.tier" }] };
    expect(barItem(empty).innerHTML).toBe(DEFAULT_BAR);
    expect(overflow(empty).outerHTML).toBe(DEFAULT_OVERFLOW);
  });

  it('is what an explicit "default" resolves to', () => {
    expect(barItem({ presentation: "default" }).innerHTML).toBe(DEFAULT_BAR);
    expect(overflow({ presentation: "default" }).outerHTML).toBe(DEFAULT_OVERFLOW);
  });

  it("is unchanged by an icon the chip's default paints no slot for", () => {
    // The chip has never painted an icon, so its `CompactDefaults` name no icon slot.
    expect(barItem({ presentation: { preset: "default", icon: ICON } }).innerHTML).toBe(
      DEFAULT_BAR,
    );
  });

  it("lets a promoted flag's default tree take a rich icon, because it has a slot", () => {
    // The one place `"default"` plus a bare `icon` is not a no-op: a promoted
    // control has always had an icon slot (`PromotedFlag.icon`, the string
    // glyph), and `presentation.icon` fills it — the upgrade path off that
    // field, which stays `string` because widening it would put an element in
    // the store. Group A has no such slot, hence the difference.
    const button = promotedOf(
      barItem(promotedWith("checkout.tier", { preset: "default", icon: ICON })),
      "checkout.tier",
    );
    expect(countIn(button, '[data-dtb-part="flag-promoted-icon"] svg')).toBe(1);
    // Everything else about the default tree is untouched.
    expect(promotedText(button)).toBe("checkout.tier");
    expect(textIn(button, '[data-dtb-part="flag-promoted-value"]')).toBe("gold");
    expect(button.getAttribute("aria-label")).toBe("checkout.tier, gold");
  });
});

interface Painted {
  icon: number;
  text: string | null;
  value: string | null;
}

interface PresetRow {
  preset: CompactPreset;
  /** The chip, in the bar / in the `⋮` menu / in the bar with no icon supplied. */
  chipBar: Painted;
  chipMenu: Painted;
  chipBare: Painted;
  /** The `checkout.tier` promoted control, same three places. */
  flagBar: Painted;
  flagMenu: Painted;
  flagBare: Painted;
  /**
   * The `new-header` promoted boolean, in the bar, with and without an icon.
   * Its own columns because a boolean has no value slot — a switch announces
   * its own state — so `"value"` and an iconless `"icon-value"` would
   * otherwise resolve to nothing at all.
   */
  boolBar: Painted;
  boolBare: Painted;
}

/**
 * Every member of the preset union, on both surfaces. The completeness check
 * below fails if a member goes missing.
 *
 * The promoted control has one text — its label is its identity — so `short`
 * and `full` are the same word and the `⋮` rule is a no-op for it.
 */
const PRESETS: readonly PresetRow[] = [
  {
    preset: "default",
    chipBar: { icon: 0, text: "flags", value: "2" },
    chipMenu: { icon: 0, text: "flags", value: "2" },
    chipBare: { icon: 0, text: "flags", value: "2" },
    flagBar: { icon: 1, text: "checkout.tier", value: "gold" },
    flagMenu: { icon: 1, text: "checkout.tier", value: "gold" },
    flagBare: { icon: 0, text: "checkout.tier", value: "gold" },
    boolBar: { icon: 1, text: "new-header", value: null },
    boolBare: { icon: 0, text: "new-header", value: null },
  },
  {
    preset: "icon",
    chipBar: { icon: 1, text: null, value: null },
    // Guarantee 2 forces text-only in the menu, so the row loses the count.
    chipMenu: { icon: 1, text: "Flags", value: null },
    // Guarantee 1: an icon-only preset with no icon paints text, never nothing.
    chipBare: { icon: 0, text: "flags", value: null },
    flagBar: { icon: 1, text: null, value: null },
    flagMenu: { icon: 1, text: "checkout.tier", value: null },
    flagBare: { icon: 0, text: "checkout.tier", value: null },
    boolBar: { icon: 1, text: null, value: null },
    boolBare: { icon: 0, text: "new-header", value: null },
  },
  {
    preset: "icon-value",
    chipBar: { icon: 1, text: null, value: "2" },
    chipMenu: { icon: 1, text: "Flags", value: "2" },
    chipBare: { icon: 0, text: null, value: "2" },
    flagBar: { icon: 1, text: null, value: "gold" },
    flagMenu: { icon: 1, text: "checkout.tier", value: "gold" },
    flagBare: { icon: 0, text: null, value: "gold" },
    // A boolean paints no value, so with an icon this is icon-only — and with
    // none it would be the bare dot, which the text fallback closes.
    boolBar: { icon: 1, text: null, value: null },
    boolBare: { icon: 0, text: "new-header", value: null },
  },
  {
    preset: "icon-label",
    chipBar: { icon: 1, text: "flags", value: null },
    chipMenu: { icon: 1, text: "Flags", value: null },
    chipBare: { icon: 0, text: "flags", value: null },
    flagBar: { icon: 1, text: "checkout.tier", value: null },
    flagMenu: { icon: 1, text: "checkout.tier", value: null },
    flagBare: { icon: 0, text: "checkout.tier", value: null },
    boolBar: { icon: 1, text: "new-header", value: null },
    boolBare: { icon: 0, text: "new-header", value: null },
  },
  {
    preset: "label",
    // "label" names no icon, so a supplied one is not painted.
    chipBar: { icon: 0, text: "flags", value: null },
    chipMenu: { icon: 0, text: "Flags", value: null },
    chipBare: { icon: 0, text: "flags", value: null },
    flagBar: { icon: 0, text: "checkout.tier", value: null },
    flagMenu: { icon: 0, text: "checkout.tier", value: null },
    flagBare: { icon: 0, text: "checkout.tier", value: null },
    boolBar: { icon: 0, text: "new-header", value: null },
    boolBare: { icon: 0, text: "new-header", value: null },
  },
  {
    preset: "value",
    chipBar: { icon: 0, text: null, value: "2" },
    chipMenu: { icon: 0, text: "Flags", value: "2" },
    chipBare: { icon: 0, text: null, value: "2" },
    flagBar: { icon: 0, text: null, value: "gold" },
    flagMenu: { icon: 0, text: "checkout.tier", value: "gold" },
    flagBare: { icon: 0, text: null, value: "gold" },
    // `"value"` on a boolean names the one part it cannot paint. Rather than a
    // switch that is a bare dot, it falls back to text: a blank control is
    // worse than an unstyled one.
    boolBar: { icon: 0, text: "new-header", value: null },
    boolBare: { icon: 0, text: "new-header", value: null },
  },
];

const paintedChip = (root: HTMLElement): Painted => {
  const chip = chipOf(root);
  return {
    icon: countIn(chip, '[data-dtb-part="flag-icon"]'),
    text: textIn(chip, '[data-dtb-part="flag-label"]'),
    value: textIn(chip, '[data-dtb-part="flag-count"]'),
  };
};

const paintedFlag = (root: HTMLElement, key = "checkout.tier"): Painted => {
  const button = promotedOf(root, key);
  return {
    icon: countIn(button, '[data-dtb-part="flag-promoted-icon"]'),
    text: promotedText(button),
    value: textIn(button, '[data-dtb-part="flag-promoted-value"]'),
  };
};

describe("presets", () => {
  it("covers every member of the preset union", () => {
    const members: Record<CompactPreset, true> = {
      default: true,
      icon: true,
      "icon-value": true,
      "icon-label": true,
      label: true,
      value: true,
    };
    expect(PRESETS.map((row) => row.preset).sort()).toEqual(Object.keys(members).sort());
  });

  it.each(PRESETS)("$preset paints the chip in the bar", ({ preset, chipBar }) => {
    expect(paintedChip(barItem({ presentation: { preset, icon: ICON } }))).toEqual(chipBar);
  });

  it.each(PRESETS)("$preset paints the chip in the ⋮ menu", ({ preset, chipMenu }) => {
    expect(paintedChip(overflow({ presentation: { preset, icon: ICON } }))).toEqual(chipMenu);
  });

  it.each(PRESETS)("$preset paints the chip with no icon supplied", ({ preset, chipBare }) => {
    expect(paintedChip(barItem({ presentation: preset }))).toEqual(chipBare);
  });

  it.each(PRESETS)("$preset paints a promoted flag in the bar", ({ preset, flagBar }) => {
    expect(paintedFlag(barItem(promotedWith("checkout.tier", { preset, icon: ICON })))).toEqual(
      flagBar,
    );
  });

  it.each(PRESETS)("$preset paints a promoted flag in the ⋮ menu", ({ preset, flagMenu }) => {
    expect(paintedFlag(overflow(promotedWith("checkout.tier", { preset, icon: ICON })))).toEqual(
      flagMenu,
    );
  });

  it.each(PRESETS)("$preset paints a promoted flag with no icon", ({ preset, flagBare }) => {
    expect(paintedFlag(barItem(promotedWith("checkout.tier", preset)))).toEqual(flagBare);
  });

  it.each(PRESETS)("$preset paints a promoted boolean in the bar", ({ preset, boolBar }) => {
    expect(
      paintedFlag(barItem(promotedWith("new-header", { preset, icon: ICON })), "new-header"),
    ).toEqual(boolBar);
  });

  it.each(PRESETS)("$preset never leaves a promoted boolean blank", ({ preset, boolBare }) => {
    // Guarantee 1 covers "icon" alone; this is the same principle where the
    // "other part" a preset relies on doesn't exist.
    const button = promotedOf(barItem(promotedWith("new-header", preset)), "new-header");
    expect(paintedFlag(barItem(promotedWith("new-header", preset)), "new-header")).toEqual(
      boolBare,
    );
    expect(button.textContent).not.toBe("");
  });

  it.each(PRESETS)("$preset is one control's business, not the extension's", ({ preset }) => {
    const item = barItem(promotedWith("checkout.tier", { preset, icon: ICON }));
    expect(promotedText(promotedOf(item, "new-header"))).toBe("new-header");
    expect(countIn(promotedOf(item, "new-header"), '[data-dtb-part="flag-promoted-icon"]')).toBe(0);
    expect(paintedChip(item)).toEqual({ icon: 0, text: "flags", value: "2" });
  });

  it.each(PRESETS)("$preset changes text, never state", ({ preset }) => {
    const item = barItem({
      onOverride: () => {},
      presentation: { preset, icon: ICON },
      ...promotedWith("new-header", { preset, icon: ICON }),
    });
    const trigger = triggerOf(item);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-label")).toBe("Flags");
    expect(trigger.getAttribute("title")).toBe("Feature flags: 2 · 0 locally overridden");
    expect(chipOf(item).getAttribute("data-dtb-overridden")).toBe("false");

    const promoted = promotedOf(item, "new-header");
    expect(promoted.getAttribute("role")).toBe("switch");
    expect(promoted.getAttribute("aria-checked")).toBe("true");
    expect(promoted.getAttribute("data-dtb-flag")).toBe("new-header");
    expect(promoted.getAttribute("data-dtb-overridden")).toBe("false");
    expect(promoted.getAttribute("aria-label")).toBe("new-header");
    expect(promoted.querySelector('[data-dtb-part="flag-promoted-dot"]')).not.toBeNull();
  });

  it.each(PRESETS)("$preset changes text, never state, in the ⋮ menu too", ({ preset }) => {
    const menu = overflow({
      onOverride: () => {},
      presentation: { preset, icon: ICON },
      ...promotedWith("new-header", { preset, icon: ICON }),
    });
    const trigger = triggerOf(menu);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-label")).toBe("Flags");
    expect(trigger.getAttribute("title")).toBe("Feature flags: 2 · 0 locally overridden");
    expect(chipOf(menu).getAttribute("data-dtb-overridden")).toBe("false");

    const promoted = promotedOf(menu, "new-header");
    expect(promoted.getAttribute("role")).toBe("switch");
    expect(promoted.getAttribute("aria-checked")).toBe("true");
    expect(promoted.getAttribute("data-dtb-flag")).toBe("new-header");
    expect(promoted.getAttribute("data-dtb-overridden")).toBe("false");
    expect(promoted.getAttribute("aria-label")).toBe("new-header");
    expect(promoted.querySelector('[data-dtb-part="flag-promoted-dot"]')).not.toBeNull();
  });

  it("hides the icon from assistive technology and clamps it, on both surfaces", () => {
    const item = barItem({
      presentation: { preset: "icon", icon: ICON },
      ...promotedWith("checkout.tier", { preset: "icon", icon: ICON }),
    });
    for (const part of ["flag-icon", "flag-promoted-icon"]) {
      const glyph = item.querySelector(`[data-dtb-part="${part}"]`);
      expect(glyph?.getAttribute("aria-hidden")).toBe("true");
      expect(glyph?.getAttribute("data-dtb-kind")).toBe("glyph");
      expect(glyph?.querySelector("svg")).not.toBeNull();
    }
  });
});

describe("the back-compat string icon", () => {
  /**
   * `PromotedFlag.icon` stays `string` — widening it to `ReactNode` would put
   * an element in the snapshot. It keeps its bare `aria-hidden` span rather
   * than moving into `Glyph` (that would change the default bytes), but now
   * has a place in the icon slot, so it survives a preset instead of vanishing.
   */
  it("fills the icon slot when no presentation icon was supplied", () => {
    const item = barItem(promotedWith("checkout.tier", "icon", { icon: "A" }));
    const button = promotedOf(item, "checkout.tier");
    // Guarantee 1 does not fire: there is an icon, just a string one.
    expect(promotedText(button)).toBeNull();
    expect(countIn(button, '[data-dtb-part="flag-promoted-icon"]')).toBe(0);
    expect(
      button.querySelector(":scope > span[aria-hidden]:not([data-dtb-part])")?.textContent,
    ).toBe("A");
  });

  it("yields to a presentation icon rather than painting both", () => {
    const item = barItem(
      promotedWith("checkout.tier", { preset: "icon", icon: ICON }, { icon: "A" }),
    );
    const button = promotedOf(item, "checkout.tier");
    expect(countIn(button, '[data-dtb-part="flag-promoted-icon"]')).toBe(1);
    expect(button.textContent).toBe("");
  });

  it.each([
    ["false, from a && guard", false],
    ["true", true],
    ["an empty string", ""],
  ])("fills the slot when a rich icon declines with %s", (_name, value) => {
    // "Declines" is `hasPaintableIcon`, so `false` falls back to the legacy
    // glyph exactly as `undefined` does, rather than counting as an icon and
    // painting an empty span.
    const button = promotedOf(
      barItem(
        promotedWith(
          "checkout.tier",
          { preset: "icon", icon: () => value as never },
          { icon: "A" },
        ),
      ),
      "checkout.tier",
    );
    expect(promotedText(button)).toBeNull();
    expect(countIn(button, '[data-dtb-part="flag-promoted-icon"]')).toBe(0);
    expect(
      button.querySelector(":scope > span[aria-hidden]:not([data-dtb-part])")?.textContent,
    ).toBe("A");
  });

  it('does not fill the icon slot with "", which would leave the control blank', () => {
    // `""` is not an icon, so `hasIcon` is false and guarantee 1 fires.
    // Treated as present, `"icon"` would leave a bare, empty control.
    const button = promotedOf(
      barItem(promotedWith("checkout.tier", "icon", { icon: "" })),
      "checkout.tier",
    );
    expect(button.querySelector(":scope > span[aria-hidden]:not([data-dtb-part])")).toBeNull();
    expect(countIn(button, '[data-dtb-part="flag-promoted-icon"]')).toBe(0);
    expect(promotedText(button)).toBe("checkout.tier");
    expect(button.textContent).not.toBe("");
  });

  it("is dropped by a preset that names no icon", () => {
    const button = promotedOf(
      barItem(promotedWith("checkout.tier", "label", { icon: "A" })),
      "checkout.tier",
    );
    expect(button.querySelector(":scope > span[aria-hidden]:not([data-dtb-part])")).toBeNull();
    expect(promotedText(button)).toBe("checkout.tier");
  });
});

describe("a function icon", () => {
  it("is invoked with the snapshot on the chip and the view on a promoted flag", () => {
    const snapshots: FlagsSnapshot[] = [];
    const views: FlagView[] = [];
    const item = barItem({
      presentation: {
        preset: "icon",
        icon: (snapshot: FlagsSnapshot) => {
          snapshots.push(snapshot);
          return <svg data-icon={`chip-${snapshot.flags.length}`} />;
        },
      },
      ...promotedWith("checkout.tier", {
        preset: "icon",
        icon: (view: FlagView) => {
          views.push(view);
          return <svg data-icon={view.key} />;
        },
      }),
    });
    expect(snapshots[0]?.flags.length).toBe(2);
    expect(views[0]?.key).toBe("checkout.tier");
    expect(item.querySelector('[data-dtb-part="flag-icon"] svg')?.getAttribute("data-icon")).toBe(
      "chip-2",
    );
    expect(
      item.querySelector('[data-dtb-part="flag-promoted-icon"] svg')?.getAttribute("data-icon"),
    ).toBe("checkout.tier");
  });

  it("paints text when it returns nothing", () => {
    // Guarantee 1 applies per control, after the function has been resolved.
    const item = barItem({
      presentation: { preset: "icon", icon: () => undefined },
      ...promotedWith("checkout.tier", { preset: "icon", icon: () => undefined }),
    });
    expect(paintedChip(item)).toEqual({ icon: 0, text: "flags", value: null });
    expect(paintedFlag(item)).toEqual({ icon: 0, text: "checkout.tier", value: null });
  });
});

describe("which promotion is in force", () => {
  /**
   * A `presentation` belongs to one entry of `promoted`, not to a flag key —
   * two entries may name the same key under different `startAt`/`expiresAt`/
   * `audience` windows, and only the runtime knows which is eligible now. It
   * publishes that as `FlagView.promotedIndex`, a number so it stays plain data.
   */
  const LIVE = { preset: "icon", icon: ICON } as const;

  /**
   * The same config, read headless. "Which entry won" is only half the claim
   * — the loser must not also be in `snapshot.promoted`, or the bar paints
   * two identical switches and React logs a key collision. The
   * `console.error` guard on this whole `describe` catches that.
   */
  const promotedIn = (options: FlagsOptions): readonly FlagView[] => {
    const runtime = createFlagsRuntime({ flags: CATALOGUE, ...options });
    const promoted = runtime.store.peek().promoted;
    runtime.store.destroy();
    return promoted;
  };

  const countPromoted = (item: HTMLElement, key: string): number =>
    countIn(item, `[data-dtb-part="flag-promoted"][data-dtb-flag="${key}"]`);

  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    // A duplicate in `snapshot.promoted` is a React key collision, and React
    // reports that on `console.error` rather than by throwing.
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("uses the eligible entry's presentation when an earlier one has expired", () => {
    const options: FlagsOptions = {
      promoted: [
        {
          flagKey: "checkout.tier",
          label: "Expired",
          expiresAt: "2000-01-01T00:00:00.000Z",
          presentation: "label",
        },
        { flagKey: "checkout.tier", label: "Live", presentation: LIVE },
      ],
    };
    const item = barItem(options);
    const button = promotedOf(item, "checkout.tier");
    expect(countIn(button, '[data-dtb-part="flag-promoted-icon"]')).toBe(1);
    expect(promotedText(button)).toBeNull();
    expect(button.getAttribute("aria-label")).toBe("Live, gold");
    // The expired entry contributes nothing — not even a second copy of the view it names.
    expect(promotedIn(options)).toHaveLength(1);
    expect(countPromoted(item, "checkout.tier")).toBe(1);
  });

  it("uses the eligible entry's presentation when an earlier one is for another audience", () => {
    const options: FlagsOptions = {
      audience: ["dev"],
      promoted: [
        { flagKey: "checkout.tier", audience: ["qa"], label: "QA", presentation: LIVE },
        { flagKey: "checkout.tier", label: "Everyone", presentation: "label" },
      ],
    };
    const item = barItem(options);
    const button = promotedOf(item, "checkout.tier");
    expect(countIn(button, '[data-dtb-part="flag-promoted-icon"]')).toBe(0);
    expect(promotedText(button)).toBe("Everyone");
    expect(promotedIn(options)).toHaveLength(1);
    expect(countPromoted(item, "checkout.tier")).toBe(1);
  });

  it("takes the first eligible entry when two name the same key", () => {
    const options: FlagsOptions = {
      promoted: [
        { flagKey: "checkout.tier", label: "First", presentation: LIVE },
        { flagKey: "checkout.tier", label: "Second", presentation: "label" },
      ],
    };
    const item = barItem(options);
    const button = promotedOf(item, "checkout.tier");
    expect(countIn(button, '[data-dtb-part="flag-promoted-icon"]')).toBe(1);
    expect(button.getAttribute("aria-label")).toBe("First, gold");
    expect(promotedIn(options)).toHaveLength(1);
    expect(countPromoted(item, "checkout.tier")).toBe(1);
  });

  it("publishes the chosen entry's position, and only for promoted flags", () => {
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      promoted: [
        { flagKey: "checkout.tier", expiresAt: "2000-01-01T00:00:00.000Z" },
        { flagKey: "checkout.tier" },
      ],
    });
    const snapshot = runtime.store.peek();
    expect(snapshot.promoted).toHaveLength(1);
    const tier = snapshot.flags.find((view) => view.key === "checkout.tier") as FlagView;
    const header = snapshot.flags.find((view) => view.key === "new-header") as FlagView;
    expect(tier.promotedIndex).toBe(1);
    expect(header.promoted).toBe(false);
    expect(header.promotedIndex).toBeUndefined();
    // A number: plain data the comparator walks and `diagnostics()` serialises.
    expect(JSON.parse(JSON.stringify(tier))).toEqual(tier);
    runtime.store.destroy();
  });
});

describe("the render callback", () => {
  it("supplies the children and is told where it is painting", () => {
    const chipContexts: CompactRenderContext[] = [];
    const flagContexts: CompactRenderContext[] = [];
    const options: FlagsOptions = {
      presentation: {
        preset: "icon-value",
        icon: ICON,
        render: (snapshot: FlagsSnapshot, ctx: CompactRenderContext) => {
          chipContexts.push(ctx);
          return <b data-dtb-part="flag-custom">{snapshot.flags.length} flags</b>;
        },
      },
      ...promotedWith("checkout.tier", {
        render: (view: FlagView, ctx: CompactRenderContext) => {
          flagContexts.push(ctx);
          return <b data-dtb-part="flag-promoted-custom">{view.effectiveText}</b>;
        },
      }),
    };

    const item = barItem(options);
    expect(textIn(item, '[data-dtb-part="flag-custom"]')).toBe("2 flags");
    expect(textIn(item, '[data-dtb-part="flag-promoted-custom"]')).toBe("gold");
    // Replaces the parts, not the control — state attributes and names aren't theirs to lose.
    expect(chipOf(item).getAttribute("data-dtb-overridden")).toBe("false");
    expect(triggerOf(item).getAttribute("aria-label")).toBe("Flags");
    const button = promotedOf(item, "checkout.tier");
    expect(button.querySelector('[data-dtb-part="flag-promoted-dot"]')).not.toBeNull();
    expect(button.getAttribute("aria-label")).toBe("checkout.tier, gold");
    expect(button.getAttribute("data-dtb-flag")).toBe("checkout.tier");
    expect(chipContexts[0]?.preset).toBe("icon-value");
    expect(chipContexts[0]?.icon).toBe(ICON);
    expect(chipContexts[0]?.isOverflowed).toBe(false);
    expect(chipContexts[0]?.isPanelOpen).toBe(false);
    expect(flagContexts[0]?.preset).toBe("default");

    // Honoured in the ⋮ menu too — ADR-004's deliberate deviation from "always paint text".
    const menu = overflow(options);
    expect(textIn(menu, '[data-dtb-part="flag-custom"]')).toBe("2 flags");
    expect(chipContexts.at(-1)?.isOverflowed).toBe(true);
    expect(flagContexts.at(-1)?.isOverflowed).toBe(true);
  });

  it("falls through to the preset when it returns undefined", () => {
    const chipRender = vi.fn(() => undefined);
    const flagRender = vi.fn(() => undefined);
    const item = barItem({
      presentation: { preset: "icon-label", icon: ICON, render: chipRender },
      ...promotedWith("checkout.tier", { preset: "icon-label", icon: ICON, render: flagRender }),
    });
    expect(chipRender).toHaveBeenCalledTimes(1);
    expect(flagRender).toHaveBeenCalledTimes(1);
    expect(paintedChip(item)).toEqual({ icon: 1, text: "flags", value: null });
    expect(paintedFlag(item)).toEqual({ icon: 1, text: "checkout.tier", value: null });
  });

  it("returning ctx.fallback paints exactly what the preset would have", () => {
    const presetOnly = barItem({
      presentation: { preset: "icon-value", icon: ICON },
      ...promotedWith("checkout.tier", { preset: "icon-value", icon: ICON }),
    }).innerHTML;
    const deferred = barItem({
      presentation: {
        preset: "icon-value",
        icon: ICON,
        render: (_snapshot: FlagsSnapshot, ctx: CompactRenderContext) => ctx.fallback,
      },
      ...promotedWith("checkout.tier", {
        preset: "icon-value",
        icon: ICON,
        render: (_view: FlagView, ctx: CompactRenderContext) => ctx.fallback,
      }),
    }).innerHTML;
    expect(deferred).toBe(presetOnly);
  });
});

describe("the accessible-name override", () => {
  it("replaces each control's aria-label, and leaves title alone", () => {
    const item = barItem({
      presentation: {
        preset: "icon",
        icon: ICON,
        name: (s: FlagsSnapshot) => `${s.flags.length} flags`,
      },
      ...promotedWith("checkout.tier", {
        preset: "icon",
        icon: ICON,
        name: (view: FlagView) => `Tier is ${view.effectiveText}`,
      }),
    });
    expect(triggerOf(item).getAttribute("aria-label")).toBe("2 flags");
    expect(promotedOf(item, "checkout.tier").getAttribute("aria-label")).toBe("Tier is gold");
    // `title` explains; it does not name, so it is not overridable.
    expect(triggerOf(item).getAttribute("title")).toBe(
      "Feature flags: 2 · 0 locally overridden · read-only",
    );
    expect(promotedOf(item, "checkout.tier").getAttribute("title")).toBe(
      "checkout.tier = gold · from default · click to open the flags panel",
    );
  });

  it("ignores a whitespace-only override rather than leaving a control unnamed", () => {
    const item = barItem({
      presentation: { preset: "icon", icon: ICON, name: () => "   " },
      ...promotedWith("checkout.tier", { preset: "icon", icon: ICON, name: () => "" }),
    });
    expect(triggerOf(item).getAttribute("aria-label")).toBe("Flags");
    expect(promotedOf(item, "checkout.tier").getAttribute("aria-label")).toBe(
      "checkout.tier, gold",
    );
  });
});

describe("the hard rule: a ReactNode never enters the store", () => {
  /**
   * Why `PromotedFlag.icon` was not widened to `ReactNode`: it is copied into
   * every snapshot as `FlagView.promotedIcon`, and the store compares the whole
   * snapshot, so a React element there is a plain object the comparator walks
   * into — in development through `_owner` into a cyclic fiber — and would sit
   * inside what `diagnostics()` serialises, one refactor from a
   * circular-structure throw in a click handler. `presentation` is config in the
   * factory closure instead.
   */
  const RICH: PromotedFlag = {
    flagKey: "checkout.tier",
    icon: "A",
    presentation: { preset: "icon", icon: ICON, render: () => ICON, name: () => "Tier" },
  };

  const richRuntime = () =>
    createFlagsRuntime({
      flags: CATALOGUE,
      promoted: [RICH],
      onOverride: () => {},
      now: () => 0,
    });

  /**
   * Asserts structurally rather than by searching the JSON for `"$$typeof"`:
   * `JSON.stringify` silently drops a Symbol-valued property (a React
   * element's `$$typeof` is one), so a marker search would pass even with an
   * element sitting in the snapshot. A round-trip equality check and an
   * `isValidElement` walk can both actually fail.
   */
  const expectNoElements = (value: unknown): void => {
    expect(isValidElement(value)).toBe(false);
    if (value !== null && typeof value === "object") {
      Object.values(value).forEach(expectNoElements);
    }
  };

  it("keeps the snapshot serialisable with a JSX icon promoted", () => {
    const runtime = richRuntime();
    const snapshot = runtime.store.peek();
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expectNoElements(snapshot);
    expect(JSON.stringify(snapshot)).not.toContain("presentation");
    // The string glyph is still there, and still a string; the rich one never arrived.
    const view = snapshot.promoted.find((entry) => entry.key === "checkout.tier") as FlagView;
    expect(typeof view.promotedIcon).toBe("string");
    expect(view.promotedIcon).toBe("A");
    runtime.store.destroy();
  });

  it("keeps diagnostics() serialisable with a JSX icon promoted", () => {
    const runtime = richRuntime();
    runtime.applyOverride("checkout.tier", "silver");
    const diagnostics = runtime.diagnostics();
    expect(JSON.parse(JSON.stringify(diagnostics))).toEqual(diagnostics);
    expectNoElements(diagnostics);
    // The marker search is the wrong tool for a raw snapshot (above) but the
    // right one here: `diagnostics()` ends in `redact()`, which stringifies a
    // Symbol to `"[symbol]"` instead of dropping it, so a leaked element would
    // arrive as a plain object whose field names — `$$typeof`, `_owner` — are
    // what the structural walk above can no longer catch.
    expect(JSON.stringify(diagnostics)).not.toMatch(/\$\$typeof|"_owner"|"_store"/);
    expect(JSON.stringify(diagnostics)).toContain("checkout.tier");
    runtime.store.destroy();
  });

  it("keeps the copy-recipe path serialisable with a JSX icon promoted", () => {
    const runtime = richRuntime();
    runtime.applyOverride("checkout.tier", "silver");
    const recipe = runtime.recipeText();
    expect(recipe).toBe("checkout.tier = silver (was gold)");
    runtime.store.destroy();
  });

  it("does not republish when only the presentation changes", () => {
    // Not compared because it's not in the snapshot at all — the design, not a
    // gap. Changing it after the factory ran is unsupported.
    const promoted: PromotedFlag = { flagKey: "checkout.tier", presentation: "icon" };
    const runtime = createFlagsRuntime({ flags: CATALOGUE, promoted: [promoted], now: () => 0 });
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    promoted.presentation = { preset: "icon-value", icon: ICON };
    runtime.refresh();
    runtime.store.flush();
    expect(listener).not.toHaveBeenCalled();
    expect(runtime.store.getSnapshot()).toBe(before);
    expectNoElements(runtime.store.peek());
    runtime.store.destroy();
  });
});
