/**
 * `/ext/environment`'s `presentation` option, against the real shell.
 *
 * Environment has two button wrappers — the bar trigger (`aria-expanded`) and
 * the `⋮` row (`data-dtb-part="env-overflow"`, no `aria-expanded`, since that
 * row isn't the disclosure the bar trigger is) — so everything here runs
 * twice, checking both are driven by the same option and that the `⋮` row
 * never gains `aria-expanded`.
 *
 * Two deviations from the rest of Group A, both forced by byte-identity: the
 * text span already carried `data-dtb-part="env-label"` and
 * `data-dtb-kind="label"` (tinted by the kit sheet), and `"default"` paints
 * the short word `"env"` in the `⋮` row too, where the others swing to their
 * full label (an explicit preset still forces the full label there).
 *
 * Default output is pinned as literal strings, captured off the tree before
 * this option existed — regenerate only by capture, never by hand.
 *
 * [dev-toolbar/plans/bar-presentation-icons-v1 §4]
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupToolbar, mountToolbar } from "@nejcm/dev-toolbar/testing";
import type { CompactPreset, CompactRenderContext } from "@nejcm/dev-toolbar/kit";
import { environment, kindLabel } from "../index";
import type { EnvironmentOptions } from "../index";
import type { EnvironmentSnapshot } from "../types";

/** Tears down first: the testing helpers query the document, not one root. */
const mount = (options: EnvironmentOptions = {}) => {
  cleanupToolbar();
  return mountToolbar(null, {
    extensions: [environment(options)],
    layout: { barWidth: 900, itemWidth: 200 },
  });
};

const barTrigger = (options: EnvironmentOptions = {}): HTMLElement => {
  const { toolbar } = mount(options);
  const trigger = toolbar
    .item("environment")
    ?.querySelector<HTMLElement>('[data-dtb-part="trigger"]');
  expect(trigger).not.toBeNull();
  return trigger as HTMLElement;
};

/** The `⋮` row, with the bar collapsed to nothing. A *different element*. */
const overflowTrigger = (options: EnvironmentOptions = {}): HTMLElement => {
  const { toolbar } = mount(options);
  toolbar.resize(60);
  expect(toolbar.isOverflowed("environment")).toBe(true);
  toolbar.openOverflow();
  const trigger = toolbar
    .overflowMenu()
    ?.querySelector<HTMLElement>('[data-dtb-part="env-overflow"]');
  expect(trigger).not.toBeNull();
  return trigger as HTMLElement;
};

const barChip = (options: EnvironmentOptions = {}): HTMLElement =>
  barTrigger(options).querySelector('[data-dtb-part="env-chip"]') as HTMLElement;

const overflowChip = (options: EnvironmentOptions = {}): HTMLElement =>
  overflowTrigger(options).querySelector('[data-dtb-part="env-chip"]') as HTMLElement;

const text = (chip: Element): string | null =>
  chip.querySelector('[data-dtb-part="env-label"]')?.textContent ?? null;

const value = (chip: Element): string | null =>
  chip.querySelector('[data-dtb-part="env-value"]')?.textContent ?? null;

const icons = (element: Element): number =>
  element.querySelectorAll('[data-dtb-part="env-icon"]').length;

/** A consumer's own inline `<svg>` — the proof that nothing was bundled. */
const ICON = (
  <svg viewBox="0 0 16 16" data-icon="globe">
    <circle cx="8" cy="8" r="7" />
  </svg>
);

const IMPERSONATING: EnvironmentOptions = {
  context: { environment: "production", impersonating: true },
};

afterEach(cleanupToolbar);

describe("the default presentation", () => {
  const DEFAULT_TRIGGER =
    '<button type="button" data-dtb-part="trigger" aria-expanded="false"' +
    ' aria-label="Environment, unknown"' +
    ' title="Environment: unknown — no context supplied to environment()">' +
    '<span data-dtb-part="env-chip" data-dtb-severity="unknown" data-dtb-kind="chip">' +
    '<span data-dtb-kind="dot" data-dtb-severity="unknown" aria-hidden="true"' +
    ' data-dtb-part="env-dot"></span>' +
    '<span data-dtb-part="env-label" data-dtb-kind="label">env</span>' +
    '<span data-dtb-kind="value" data-dtb-severity="unknown" data-dtb-part="env-value"' +
    ' data-dtb-env="unknown">unknown</span></span></button>';

  // A different element (no `aria-expanded`) but the same tree, short word included.
  const DEFAULT_OVERFLOW_TRIGGER = DEFAULT_TRIGGER.replace(
    ' data-dtb-part="trigger" aria-expanded="false"',
    ' data-dtb-part="env-overflow"',
  );

  const IMPERSONATING_TRIGGER =
    '<button type="button" data-dtb-part="trigger" aria-expanded="false"' +
    ' aria-label="Environment, production, impersonating"' +
    ' title="Environment: production — click for the full context">' +
    '<span data-dtb-part="env-chip" data-dtb-severity="bad" data-dtb-kind="chip">' +
    '<span data-dtb-kind="dot" data-dtb-severity="bad" aria-hidden="true"' +
    ' data-dtb-part="env-dot"></span>' +
    '<span data-dtb-part="env-label" data-dtb-kind="label">env</span>' +
    '<span data-dtb-kind="value" data-dtb-severity="bad" data-dtb-part="env-value"' +
    ' data-dtb-env="production">production</span>' +
    '<span data-dtb-part="env-alert">impersonating</span></span></button>';

  const IMPERSONATING_OVERFLOW_TRIGGER = IMPERSONATING_TRIGGER.replace(
    ' data-dtb-part="trigger" aria-expanded="false"',
    ' data-dtb-part="env-overflow"',
  );

  it("paints the bar byte-identically with no option at all", () => {
    expect(barTrigger().outerHTML).toBe(DEFAULT_TRIGGER);
  });

  it("paints the ⋮ row byte-identically with no option at all", () => {
    expect(overflowTrigger().outerHTML).toBe(DEFAULT_OVERFLOW_TRIGGER);
  });

  it("paints an impersonating production chip byte-identically, in both wrappers", () => {
    expect(barTrigger(IMPERSONATING).outerHTML).toBe(IMPERSONATING_TRIGGER);
    expect(overflowTrigger(IMPERSONATING).outerHTML).toBe(IMPERSONATING_OVERFLOW_TRIGGER);
  });

  it('is what an explicit "default" and a bare icon both resolve to', () => {
    // An icon with no preset that paints it does nothing.
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
    // The only row where the menu keeps the short word — this extension shipped "env" in both.
    preset: "default",
    bar: { icon: false, text: "env", value: "unknown" },
    menu: { icon: false, text: "env", value: "unknown" },
    bareBar: { text: "env", value: "unknown" },
  },
  {
    preset: "icon",
    bar: { icon: true, text: null, value: null },
    // Guarantee 2 forces the full label in the menu, which this chip has never painted anywhere.
    menu: { icon: true, text: "Environment", value: null },
    // Guarantee 1: an icon-only preset with no icon paints text, never nothing.
    bareBar: { text: "env", value: null },
  },
  {
    preset: "icon-value",
    bar: { icon: true, text: null, value: "unknown" },
    menu: { icon: true, text: "Environment", value: "unknown" },
    bareBar: { text: null, value: "unknown" },
  },
  {
    preset: "icon-label",
    bar: { icon: true, text: "env", value: null },
    menu: { icon: true, text: "Environment", value: null },
    bareBar: { text: "env", value: null },
  },
  {
    preset: "label",
    // "label" names no icon, so a supplied one is not painted.
    bar: { icon: false, text: "env", value: null },
    menu: { icon: false, text: "Environment", value: null },
    bareBar: { text: "env", value: null },
  },
  {
    preset: "value",
    bar: { icon: false, text: null, value: "unknown" },
    menu: { icon: false, text: "Environment", value: "unknown" },
    bareBar: { text: null, value: "unknown" },
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

  it.each(PRESETS)("$preset in the ⋮ row, with an icon", ({ menu, preset }) => {
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

  it.each(PRESETS)("$preset keeps the state, the dot and both wrappers' names", ({ preset }) => {
    const presentation = { preset, icon: ICON };
    const bar = barTrigger({ ...IMPERSONATING, presentation });
    const menu = overflowTrigger({ ...IMPERSONATING, presentation });

    for (const trigger of [bar, menu]) {
      const chip = trigger.querySelector('[data-dtb-part="env-chip"]') as HTMLElement;
      expect(chip.getAttribute("data-dtb-severity")).toBe("bad");
      expect(
        chip.querySelector('[data-dtb-part="env-dot"]')?.getAttribute("data-dtb-severity"),
      ).toBe("bad");
      // Invariant 2: `impersonating` is state, painted under every preset.
      expect(chip.querySelector('[data-dtb-part="env-alert"]')?.textContent).toBe("impersonating");
      expect(trigger.getAttribute("aria-label")).toBe("Environment, production, impersonating");
      expect(trigger.getAttribute("title")).toBe(
        "Environment: production — click for the full context",
      );
    }

    // The fork itself: the bar discloses a panel, the `⋮` row does not.
    expect(bar.getAttribute("aria-expanded")).toBe("false");
    expect(menu.hasAttribute("aria-expanded")).toBe(false);
  });

  it("hides the icon from assistive technology and clamps it", () => {
    const glyph = barChip({ presentation: { preset: "icon", icon: ICON } }).querySelector(
      '[data-dtb-part="env-icon"]',
    );
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
    expect(glyph?.getAttribute("data-dtb-kind")).toBe("glyph");
    expect(glyph?.querySelector("svg")).not.toBeNull();
  });
});

describe("a function icon", () => {
  it("is invoked with the snapshot, so one option shape serves every extension", () => {
    const seen: EnvironmentSnapshot[] = [];
    const chip = barChip({
      ...IMPERSONATING,
      presentation: {
        preset: "icon",
        icon: (snapshot: EnvironmentSnapshot) => {
          seen.push(snapshot);
          return <svg data-icon={kindLabel(snapshot)} />;
        },
      },
    });
    expect(seen[0]?.impersonating).toBe(true);
    expect(chip.querySelector('[data-dtb-part="env-icon"] svg')?.getAttribute("data-icon")).toBe(
      "production",
    );
  });

  it("paints text when it returns nothing", () => {
    // Guarantee 1 applies per control, after the function has been resolved.
    const chip = barChip({ presentation: { preset: "icon", icon: () => undefined } });
    expect(icons(chip)).toBe(0);
    expect(text(chip)).toBe("env");
  });
});

describe("the render callback", () => {
  it("supplies the chip's children in both wrappers, and is told where it is", () => {
    const contexts: CompactRenderContext[] = [];
    const render = (snapshot: EnvironmentSnapshot, ctx: CompactRenderContext) => {
      contexts.push(ctx);
      return <b data-dtb-part="env-custom">{kindLabel(snapshot)}!</b>;
    };
    const presentation = { preset: "icon-value" as const, icon: ICON, render };

    const bar = barTrigger({ ...IMPERSONATING, presentation });
    const barChipEl = bar.querySelector('[data-dtb-part="env-chip"]') as HTMLElement;
    expect(barChipEl.querySelector('[data-dtb-part="env-custom"]')?.textContent).toBe(
      "production!",
    );
    // Replaces the parts, not the chip — the dot, state, `impersonating` marker and name aren't theirs to lose.
    expect(barChipEl.querySelector('[data-dtb-part="env-dot"]')).not.toBeNull();
    expect(barChipEl.querySelector('[data-dtb-part="env-alert"]')).not.toBeNull();
    expect(barChipEl.getAttribute("data-dtb-severity")).toBe("bad");
    expect(bar.getAttribute("aria-label")).toBe("Environment, production, impersonating");
    expect(value(barChipEl)).toBeNull();
    expect(contexts[0]?.preset).toBe("icon-value");
    expect(contexts[0]?.isOverflowed).toBe(false);
    expect(contexts[0]?.isPanelOpen).toBe(false);
    expect(contexts[0]?.icon).toBe(ICON);

    // Honoured in the ⋮ row too — ADR-004's deliberate deviation from "always paint text".
    const menu = overflowTrigger({ ...IMPERSONATING, presentation });
    expect(menu.querySelector('[data-dtb-part="env-custom"]')?.textContent).toBe("production!");
    expect(menu.querySelector('[data-dtb-part="env-alert"]')).not.toBeNull();
    expect(menu.getAttribute("aria-label")).toBe("Environment, production, impersonating");
    expect(menu.hasAttribute("aria-expanded")).toBe(false);
    expect(contexts.at(-1)?.isOverflowed).toBe(true);
  });

  it("falls through to the preset when it returns undefined", () => {
    const render = vi.fn(() => undefined);
    const chip = barChip({ presentation: { preset: "icon-label", icon: ICON, render } });
    expect(render).toHaveBeenCalledTimes(1);
    expect(icons(chip)).toBe(1);
    expect(text(chip)).toBe("env");
  });

  it("returning ctx.fallback paints exactly what the preset would have", () => {
    const defer = (_snapshot: EnvironmentSnapshot, ctx: CompactRenderContext) => ctx.fallback;

    const presetOnly = barTrigger({ presentation: { preset: "icon-value", icon: ICON } });
    const deferred = barTrigger({
      presentation: { preset: "icon-value", icon: ICON, render: defer },
    });
    expect(deferred.outerHTML).toBe(presetOnly.outerHTML);

    const menuPresetOnly = overflowTrigger({ presentation: { preset: "icon", icon: ICON } });
    const menuDeferred = overflowTrigger({
      presentation: { preset: "icon", icon: ICON, render: defer },
    });
    expect(menuDeferred.outerHTML).toBe(menuPresetOnly.outerHTML);
  });
});

describe("the accessible-name override", () => {
  it("replaces the aria-label on both wrappers, and leaves title alone", () => {
    const presentation = {
      preset: "icon" as const,
      icon: ICON,
      name: (snapshot: EnvironmentSnapshot) => `Env: ${kindLabel(snapshot)}`,
    };
    for (const trigger of [
      barTrigger({ ...IMPERSONATING, presentation }),
      overflowTrigger({ ...IMPERSONATING, presentation }),
    ]) {
      expect(trigger.getAttribute("aria-label")).toBe("Env: production");
      // `title` explains; it does not name, so it is not overridable.
      expect(trigger.getAttribute("title")).toBe(
        "Environment: production — click for the full context",
      );
    }
  });

  it("ignores a whitespace-only override rather than leaving a wrapper unnamed", () => {
    const presentation = { preset: "icon" as const, icon: ICON, name: () => "   " };
    expect(barTrigger({ presentation }).getAttribute("aria-label")).toBe("Environment, unknown");
    expect(overflowTrigger({ presentation }).getAttribute("aria-label")).toBe(
      "Environment, unknown",
    );
  });
});
