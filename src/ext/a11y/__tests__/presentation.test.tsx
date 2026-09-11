/**
 * `/ext/a11y`' `presentation` option, against the real shell.
 *
 * a11y is the first of Group A — the five extensions that route their bar
 * control through the kit `Chip` — so this is where two things are settled that
 * the other four copy.
 *
 * 1. **The parts go in as `Chip`'s children, not its `icon`/`label`/`value`
 *    slots.** `ctx.fallback` has to be a children tree, so `render` replaces
 *    the control's children and never the `Chip` itself, which is what keeps
 *    the dot and `data-dtb-status` out of the consumer's hands. The slot path
 *    would need a second tree just for `fallback`. `/ext/metrics` made the same
 *    call for the same reason; both directions are pinned below.
 * 2. **A preset operates on the short bar word.** a11y used to write the
 *    `isOverflowed ? label : "a11y"` swing by hand; the text axis
 *    `"none" | "short" | "full"` is that swing, so `label` stays the overflow
 *    and accessible-name identity under every preset.
 *
 * The default output is pinned as two literal strings, in the bar and in the
 * `⋮` menu. `resolveCompactParts` answering `null` for `"default"` is what
 * makes byte-identity structural; a string is what makes it evidence.
 *
 * `loadOn: "scan"` throughout so nothing imports axe-core: these tests are
 * about the chip's markup, and the report stays in its `pending` state — the
 * same state `src/ext/__tests__/presentation.test.tsx` pins a11y's accessible
 * name in.
 *
 * [dev-toolbar/plans/bar-presentation-icons-v1 §4]
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { cleanupToolbar, mountToolbar } from "@nejcm/dev-toolbar/testing";
import type { CompactPreset, CompactRenderContext } from "@nejcm/dev-toolbar/kit";
import { a11y } from "../index";
import type { A11yOptions } from "../index";
import type { A11yReport, AxeLike } from "../types";

/**
 * Tears down whatever is already mounted first: several tests here compare two
 * presentations of the same extension, and the testing helpers query the
 * document rather than one root, so a leftover toolbar answers for the new one.
 */
const mount = (options: A11yOptions = {}) => {
  cleanupToolbar();
  const extension = a11y({ loadOn: "scan", ...options });
  return mountToolbar(null, {
    extensions: [extension],
    layout: { barWidth: 900, itemWidth: 200 },
  });
};

/** The bar chip. */
const barChip = (options: A11yOptions = {}): HTMLElement => {
  const { toolbar } = mount(options);
  const chip = toolbar.item("a11y")?.querySelector<HTMLElement>('[data-dtb-part="a11y-chip"]');
  expect(chip).not.toBeNull();
  return chip as HTMLElement;
};

const barTrigger = (options: A11yOptions = {}): HTMLElement => {
  const { toolbar } = mount(options);
  const trigger = toolbar.item("a11y")?.querySelector<HTMLElement>('[data-dtb-part="trigger"]');
  expect(trigger).not.toBeNull();
  return trigger as HTMLElement;
};

/** The `⋮` row, with the bar collapsed to nothing. */
const overflowTrigger = (options: A11yOptions = {}): HTMLElement => {
  const { toolbar } = mount(options);
  toolbar.resize(60);
  expect(toolbar.isOverflowed("a11y")).toBe(true);
  toolbar.openOverflow();
  const trigger = toolbar.overflowMenu()?.querySelector<HTMLElement>('[data-dtb-part="trigger"]');
  expect(trigger).not.toBeNull();
  return trigger as HTMLElement;
};

const overflowChip = (options: A11yOptions = {}): HTMLElement =>
  overflowTrigger(options).querySelector('[data-dtb-part="a11y-chip"]') as HTMLElement;

/**
 * The chip's text span, selected by the `data-dtb-part` it now carries.
 *
 * It used to be a bare `<span>` located structurally — the one child span with
 * no kind and no part of its own — because naming it would have changed the
 * bytes below. Naming it *is* the deliberate change this commit makes, so the
 * structural stand-in is gone and the selector says what it always meant.
 * There is deliberately no `data-dtb-kind="label"`: that is what the kit sheet
 * tints with `--dtb-muted`, and recolouring this chip is a separate decision.
 */
const text = (chip: Element): string | null =>
  chip.querySelector('[data-dtb-part="a11y-label"]')?.textContent ?? null;

const value = (chip: Element): string | null =>
  chip.querySelector('[data-dtb-part="a11y-value"]')?.textContent ?? null;

const icons = (element: Element): number =>
  element.querySelectorAll('[data-dtb-part="a11y-icon"]').length;

/** A consumer's own inline `<svg>` — the proof that nothing was bundled. */
const ICON = (
  <svg viewBox="0 0 16 16" data-icon="wheelchair">
    <circle cx="8" cy="8" r="7" />
  </svg>
);

afterEach(cleanupToolbar);

describe("the default presentation", () => {
  // The exact markup that shipped before `presentation` existed. Regenerate it
  // only against a deliberate, documented change to a11y's bar DOM: every
  // consumer's CSS and every Playwright selector reads these attributes.
  const DEFAULT_TRIGGER =
    '<button type="button" data-dtb-part="trigger" aria-expanded="false"' +
    ' aria-label="Accessibility (a11y), pending" title="Accessibility: click to scan this page">' +
    '<span data-dtb-part="a11y-chip" data-dtb-status="pending" data-dtb-kind="chip">' +
    '<span data-dtb-kind="dot" data-dtb-severity="unknown" aria-hidden="true"' +
    ' data-dtb-part="a11y-dot"></span>' +
    '<span data-dtb-part="a11y-label">a11y</span>' +
    '<span data-dtb-kind="value" data-dtb-severity="unknown" data-dtb-part="a11y-value">' +
    "scan</span></span></button>";

  // The same tree with the full label — the only thing the `⋮` menu changes,
  // which is the swing this chip used to write by hand.
  const DEFAULT_OVERFLOW_TRIGGER = DEFAULT_TRIGGER.replace(
    '<span data-dtb-part="a11y-label">a11y</span>',
    '<span data-dtb-part="a11y-label">Accessibility</span>',
  );

  it("paints the bar byte-identically with no option at all", () => {
    expect(barTrigger().outerHTML).toBe(DEFAULT_TRIGGER);
  });

  it("paints the ⋮ row byte-identically with no option at all", () => {
    expect(overflowTrigger().outerHTML).toBe(DEFAULT_OVERFLOW_TRIGGER);
  });

  it('is what an explicit "default" and a bare icon both resolve to', () => {
    // An icon with no preset that paints it does nothing — the four knobs are
    // meaningless apart, which is why they are one option.
    expect(barTrigger({ presentation: { preset: "default", icon: ICON } }).outerHTML).toBe(
      DEFAULT_TRIGGER,
    );
    expect(overflowTrigger({ presentation: "default" }).outerHTML).toBe(DEFAULT_OVERFLOW_TRIGGER);
  });
});

interface PresetRow {
  preset: CompactPreset;
  /** In the bar, with an icon supplied. */
  bar: { icon: boolean; text: string | null; value: string | null };
  /** In the `⋮` menu, with an icon supplied. */
  menu: { icon: boolean; text: string | null; value: string | null };
  /** In the bar, with no icon supplied. */
  bareBar: { text: string | null; value: string | null };
}

// Every member of the preset union, in both places. The completeness check
// below fails if a member goes missing.
const PRESETS: readonly PresetRow[] = [
  {
    preset: "default",
    bar: { icon: false, text: "a11y", value: "scan" },
    menu: { icon: false, text: "Accessibility", value: "scan" },
    bareBar: { text: "a11y", value: "scan" },
  },
  {
    preset: "icon",
    bar: { icon: true, text: null, value: null },
    // Guarantee 2 forces text in the menu — and only text, so the row loses
    // the readout today's default row paints. Intended, and pinned so it reads
    // as a decision rather than surfacing later as a regression.
    menu: { icon: true, text: "Accessibility", value: null },
    // Guarantee 1: an icon-only preset with no icon paints text, never nothing.
    bareBar: { text: "a11y", value: null },
  },
  {
    preset: "icon-value",
    bar: { icon: true, text: null, value: "scan" },
    menu: { icon: true, text: "Accessibility", value: "scan" },
    bareBar: { text: null, value: "scan" },
  },
  {
    // The short bar word, the full label in the menu: the "which text" rule,
    // asserted rather than described.
    preset: "icon-label",
    bar: { icon: true, text: "a11y", value: null },
    menu: { icon: true, text: "Accessibility", value: null },
    bareBar: { text: "a11y", value: null },
  },
  {
    preset: "label",
    // "label" names no icon, so a supplied one is not painted.
    bar: { icon: false, text: "a11y", value: null },
    menu: { icon: false, text: "Accessibility", value: null },
    bareBar: { text: "a11y", value: null },
  },
  {
    preset: "value",
    bar: { icon: false, text: null, value: "scan" },
    menu: { icon: false, text: "Accessibility", value: "scan" },
    bareBar: { text: null, value: "scan" },
  },
];

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

  it.each(PRESETS)("$preset in the bar, with an icon", ({ bar, preset }) => {
    const chip = barChip({ presentation: { preset, icon: ICON } });
    expect(icons(chip)).toBe(bar.icon ? 1 : 0);
    expect(text(chip)).toBe(bar.text);
    expect(value(chip)).toBe(bar.value);
  });

  it.each(PRESETS)("$preset in the ⋮ menu, with an icon", ({ menu, preset }) => {
    const chip = overflowChip({ presentation: { preset, icon: ICON } });
    expect(icons(chip)).toBe(menu.icon ? 1 : 0);
    expect(text(chip)).toBe(menu.text);
    expect(value(chip)).toBe(menu.value);
  });

  it.each(PRESETS)("$preset in the bar, with no icon supplied", ({ bareBar, preset }) => {
    // The bare-preset shorthand, which is the 90% call: `presentation: "icon"`.
    const chip = barChip({ presentation: preset });
    expect(icons(chip)).toBe(0);
    expect(text(chip)).toBe(bareBar.text);
    expect(value(chip)).toBe(bareBar.value);
  });

  it.each(PRESETS)("$preset keeps the state attributes, the dot and the name", ({ preset }) => {
    for (const trigger of [
      barTrigger({ presentation: { preset, icon: ICON } }),
      overflowTrigger({ presentation: { preset, icon: ICON } }),
    ]) {
      const chip = trigger.querySelector('[data-dtb-part="a11y-chip"]') as HTMLElement;
      expect(chip.getAttribute("data-dtb-status")).toBe("pending");
      expect(
        chip.querySelector('[data-dtb-part="a11y-dot"]')?.getAttribute("data-dtb-severity"),
      ).toBe("unknown");
      // A preset changes text, not state — and never the trigger's identity.
      expect(trigger.getAttribute("aria-label")).toBe("Accessibility (a11y), pending");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(trigger.getAttribute("title")).toBe("Accessibility: click to scan this page");
    }
  });

  it("hides the icon from assistive technology and clamps it", () => {
    const glyph = barChip({ presentation: { preset: "icon", icon: ICON } }).querySelector(
      '[data-dtb-part="a11y-icon"]',
    );
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
    expect(glyph?.getAttribute("data-dtb-kind")).toBe("glyph");
    expect(glyph?.querySelector("svg")).not.toBeNull();
  });
});

describe("a scanned state", () => {
  /**
   * Everything above runs in `pending`, where the dot and the value are both
   * `"unknown"` and the value reads `"scan"` — so a wrong severity *source*
   * would pass all of it. The value span's `data-dtb-severity` is written here
   * rather than by `Chip`'s own value slot, which is the price of putting the
   * parts in the chip's children; this scans once and asserts that the written
   * attribute is still `chipSeverity(report)` and not a constant or a stale
   * variable. The dot comes from `Chip severity`, so pinning both says the two
   * sources agree.
   */
  const CRITICAL = {
    violations: [
      {
        id: "label",
        impact: "critical",
        help: "Form elements must have labels",
        helpUrl: null,
        tags: ["wcag2a"],
        nodes: [{ target: ["#one"], html: '<input id="one">', failureSummary: null }],
      },
    ],
    passes: [],
    incomplete: [],
    testEngine: { version: "4.10.0" },
  };

  const load = (): Promise<AxeLike> =>
    Promise.resolve({ version: "4.10.0", run: () => Promise.resolve(CRITICAL) });

  it("takes the value's severity from the report, not from the pending default", async () => {
    const { toolbar } = mount({ load, presentation: { preset: "icon-value", icon: ICON } });
    await act(async () => {
      await toolbar.invokeCommand("a11y.scan");
    });

    const trigger = toolbar
      .item("a11y")
      ?.querySelector<HTMLElement>('[data-dtb-part="trigger"]') as HTMLElement;
    const chip = trigger.querySelector('[data-dtb-part="a11y-chip"]') as HTMLElement;

    expect(value(chip)).toBe("1");
    expect(
      chip.querySelector('[data-dtb-part="a11y-value"]')?.getAttribute("data-dtb-severity"),
    ).toBe("bad");
    expect(
      chip.querySelector('[data-dtb-part="a11y-dot"]')?.getAttribute("data-dtb-severity"),
    ).toBe("bad");
    // Invariant 1 in a state that is not `pending`: the preset changed the
    // text, and the trigger's name still counts the violations.
    expect(chip.getAttribute("data-dtb-status")).toBe("ok");
    expect(trigger.getAttribute("aria-label")).toBe("Accessibility (a11y), 1 violation");
    expect(text(chip)).toBeNull();
    expect(icons(chip)).toBe(1);
  });
});

describe("a function icon", () => {
  it("is invoked with the report, so one option shape serves every extension", () => {
    const seen: A11yReport[] = [];
    const chip = barChip({
      presentation: {
        preset: "icon",
        icon: (report: A11yReport) => {
          seen.push(report);
          return <svg data-icon={report.status} />;
        },
      },
    });
    expect(seen[0]?.status).toBe("pending");
    expect(chip.querySelector('[data-dtb-part="a11y-icon"] svg')?.getAttribute("data-icon")).toBe(
      "pending",
    );
  });

  it("paints text when it returns nothing", () => {
    // Guarantee 1 applies per control, after the function has been resolved.
    const chip = barChip({ presentation: { preset: "icon", icon: () => undefined } });
    expect(icons(chip)).toBe(0);
    expect(text(chip)).toBe("a11y");
  });
});

describe("the render callback", () => {
  it("supplies the chip's children and is told where it is painting", () => {
    const contexts: CompactRenderContext[] = [];
    const render = (report: A11yReport, ctx: CompactRenderContext) => {
      contexts.push(ctx);
      return <b data-dtb-part="a11y-custom">{report.status} scan</b>;
    };

    const trigger = barTrigger({ presentation: { preset: "icon-value", icon: ICON, render } });
    const chip = trigger.querySelector('[data-dtb-part="a11y-chip"]') as HTMLElement;
    expect(chip.querySelector('[data-dtb-part="a11y-custom"]')?.textContent).toBe("pending scan");
    // The consumer's node replaces the parts, not the chip: the dot, the state
    // attribute and the trigger's name are not theirs to lose. This is the
    // whole reason the parts are `Chip`'s children rather than its slots.
    expect(chip.querySelector('[data-dtb-part="a11y-dot"]')).not.toBeNull();
    expect(chip.getAttribute("data-dtb-status")).toBe("pending");
    expect(trigger.getAttribute("aria-label")).toBe("Accessibility (a11y), pending");
    expect(value(chip)).toBeNull();
    expect(contexts[0]?.preset).toBe("icon-value");
    expect(contexts[0]?.isOverflowed).toBe(false);
    expect(contexts[0]?.isPanelOpen).toBe(false);
    expect(contexts[0]?.icon).toBe(ICON);

    // Honoured in the ⋮ menu too — ADR-004's deliberate deviation from the
    // "always paint text" guarantee, with `isOverflowed` as the hook. Unlike
    // metrics' `⋮` rows, this one keeps its own `aria-label`, so a callback
    // painting an icon alone still leaves a named button.
    const menu = overflowTrigger({ presentation: { render } });
    expect(menu.querySelector('[data-dtb-part="a11y-custom"]')?.textContent).toBe("pending scan");
    expect(menu.querySelector('[data-dtb-part="a11y-dot"]')).not.toBeNull();
    expect(menu.getAttribute("aria-label")).toBe("Accessibility (a11y), pending");
    expect(contexts.at(-1)?.isOverflowed).toBe(true);
  });

  it("falls through to the preset when it returns undefined", () => {
    const render = vi.fn(() => undefined);
    const chip = barChip({ presentation: { preset: "icon-label", icon: ICON, render } });
    expect(render).toHaveBeenCalledTimes(1);
    expect(icons(chip)).toBe(1);
    expect(text(chip)).toBe("a11y");
  });

  it("returning ctx.fallback paints exactly what the preset would have", () => {
    // One construction, handed out as `fallback` and rendered as the preset —
    // so deferring is exact by construction rather than by careful mimicry,
    // which is the property the slot-based alternative could not have.
    const presetOnly = barTrigger({ presentation: { preset: "icon-value", icon: ICON } });
    const deferred = barTrigger({
      presentation: {
        preset: "icon-value",
        icon: ICON,
        render: (_report: A11yReport, ctx: CompactRenderContext) => ctx.fallback,
      },
    });
    expect(deferred.outerHTML).toBe(presetOnly.outerHTML);

    const menuPresetOnly = overflowTrigger({ presentation: { preset: "icon", icon: ICON } });
    const menuDeferred = overflowTrigger({
      presentation: {
        preset: "icon",
        icon: ICON,
        render: (_report: A11yReport, ctx: CompactRenderContext) => ctx.fallback,
      },
    });
    expect(menuDeferred.outerHTML).toBe(menuPresetOnly.outerHTML);
  });
});

describe("the accessible-name override", () => {
  it("replaces the trigger's aria-label, and leaves title alone", () => {
    const trigger = barTrigger({
      presentation: {
        preset: "icon",
        icon: ICON,
        name: (report: A11yReport) => `Axe: ${report.status}`,
      },
    });
    expect(trigger.getAttribute("aria-label")).toBe("Axe: pending");
    // `title` explains; it does not name, so it is not overridable.
    expect(trigger.getAttribute("title")).toBe("Accessibility: click to scan this page");
  });

  it("ignores a whitespace-only override rather than leaving the control unnamed", () => {
    // An icon-only control with no name is exactly what this extension would
    // flag on the toolbar's own bar.
    const trigger = barTrigger({ presentation: { preset: "icon", icon: ICON, name: () => "   " } });
    expect(trigger.getAttribute("aria-label")).toBe("Accessibility (a11y), pending");
  });
});

/**
 * The accessible name, after the Label-in-Name fix.
 *
 * The trigger used to be named `"Accessibility, pending"` while the bar painted
 * `a11y scan`. A speech-input user saying "a11y" matched nothing (WCAG 2.5.3).
 * The name is now `${label} (a11y)`.
 *
 * `label` leads: a screen reader reads "a11y" as "a eleven y", while
 * speech-input matching only needs containment. The parenthesised form also
 * contains the `⋮` row's visible text, which is the full `label`.
 *
 * No `aria-describedby` came with it. The visible `scan` is not in the name,
 * but the *status* it stands for is (`, pending`), and with no
 * `aria-describedby` a browser reads `title` as the description — which states
 * the state with more context than the span does. `docs/styling.md` states the
 * rule; `/ext/metrics` is the one chip that overrides it.
 */
describe("the accessible name", () => {
  it("contains the short word the bar paints, led by the label", () => {
    const trigger = barTrigger();
    expect(trigger.textContent).toContain("a11y");
    expect(trigger.getAttribute("aria-label")).toBe("Accessibility (a11y), pending");
  });

  it("still contains the full word the ⋮ menu paints", () => {
    const trigger = overflowTrigger();
    expect(trigger.textContent).toContain("Accessibility");
    expect(trigger.getAttribute("aria-label")).toContain("Accessibility");
  });

  it("keeps a consumer's own label", () => {
    expect(barTrigger({ label: "Axe" }).getAttribute("aria-label")).toBe("Axe (a11y), pending");
  });

  it("leaves the description to title rather than adding an aria-describedby", () => {
    const trigger = barTrigger();
    // The name carries the status the span abbreviates, and `title` carries it
    // again with more context — a browser uses `title` as the description when
    // nothing else supplies one.
    expect(trigger.getAttribute("aria-label")).toContain("pending");
    expect(trigger.getAttribute("title")).toBe("Accessibility: click to scan this page");
    expect(trigger.getAttribute("aria-describedby")).toBeNull();
    expect(trigger.querySelector('[data-dtb-part="a11y-value"]')?.getAttribute("id")).toBeNull();
  });
});
