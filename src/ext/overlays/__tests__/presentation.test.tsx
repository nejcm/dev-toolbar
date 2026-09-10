/**
 * `/ext/overlays`' `presentation` option, against the real shell.
 *
 * Overlays is the second of the two Group A members carrying an extra severity
 * child, so what this file exists to settle alongside `/ext/diagnostics` is
 * **invariant 2**: the error `Tag` is state, not presentation. A measurement
 * that threw switched every overlay off, and it sits outside both the preset
 * and `render`, after the contents, under every preset including `"icon"` — a
 * consumer restyling the chip cannot hide it. Every preset row and the
 * `render` case below assert it in both places.
 *
 * The other two decisions are `/ext/a11y`'s, copied rather than re-litigated:
 * the parts go in as `Chip`'s *children* rather than its `icon`/`label`/`value`
 * slots (so `ctx.fallback` is a children tree and `render` can never replace
 * the `Chip` itself), and a preset operates on the short bar word while `label`
 * stays the overflow and accessible-name identity.
 *
 * Byte-identity is pinned as literal strings in **two** states: the `"off"` one
 * every other assertion runs in, and one overlay on — because
 * `data-dtb-active` has only one value in a test that never turns anything on.
 *
 * `persist: false` throughout, so nothing here reads or writes storage and the
 * order of these tests cannot matter.
 *
 * [dev-toolbar/plans/bar-presentation-icons-v1 §4]
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { cleanupToolbar, mountToolbar } from "@nejcm/dev-toolbar/testing";
import type { CompactPreset, CompactRenderContext } from "@nejcm/dev-toolbar/kit";
import { overlays } from "../index";
import type { OverlaysOptions } from "../index";
import type { OverlaysSnapshot } from "../types";

/** The application under the toolbar. Deliberately has focusable content. */
const app = (
  <main data-testid="app">
    <h1>Page</h1>
    <button data-testid="named" type="button" aria-label="Save the document">
      <span>S</span>
    </button>
  </main>
);

/**
 * Tears down whatever is already mounted first: several tests here compare two
 * presentations of the same extension, and the testing helpers query the
 * document rather than one root, so a leftover toolbar answers for the new one.
 */
const mount = (options: OverlaysOptions = {}) => {
  cleanupToolbar();
  return mountToolbar(app, {
    extensions: [overlays({ persist: false, ...options })],
    instanceId: "test",
    layout: { barWidth: 900, itemWidth: 200 },
  });
};

const barTrigger = (options: OverlaysOptions = {}): HTMLElement => {
  const { toolbar } = mount(options);
  const trigger = toolbar.item("overlays")?.querySelector<HTMLElement>('[data-dtb-part="trigger"]');
  expect(trigger).not.toBeNull();
  return trigger as HTMLElement;
};

const barChip = (options: OverlaysOptions = {}): HTMLElement =>
  barTrigger(options).querySelector('[data-dtb-part="ovl-chip"]') as HTMLElement;

/** The `⋮` row, with the bar collapsed to nothing. */
const overflowTrigger = (options: OverlaysOptions = {}): HTMLElement => {
  const { toolbar } = mount(options);
  toolbar.resize(60);
  expect(toolbar.isOverflowed("overlays")).toBe(true);
  toolbar.openOverflow();
  const trigger = toolbar.overflowMenu()?.querySelector<HTMLElement>('[data-dtb-part="trigger"]');
  expect(trigger).not.toBeNull();
  return trigger as HTMLElement;
};

const overflowChip = (options: OverlaysOptions = {}): HTMLElement =>
  overflowTrigger(options).querySelector('[data-dtb-part="ovl-chip"]') as HTMLElement;

/**
 * The chip's text span, selected by the `data-dtb-part` it now carries.
 *
 * `ovl-chip-label` rather than `ovl-label`: that name was already this
 * extension's floating inspector label, and `css.ts` positions it absolutely.
 *
 * It used to be a bare `<span>` located structurally — the one child span with
 * no kind and no part of its own — because naming it would have changed the
 * bytes below. Naming it *is* the deliberate change this commit makes, so the
 * structural stand-in is gone and the selector says what it always meant.
 * There is deliberately no `data-dtb-kind="label"`: that is what the kit sheet
 * tints with `--dtb-muted`, and recolouring this chip is a separate decision.
 */
const text = (chip: Element): string | null =>
  chip.querySelector('[data-dtb-part="ovl-chip-label"]')?.textContent ?? null;

const value = (chip: Element): string | null =>
  chip.querySelector('[data-dtb-part="ovl-value"]')?.textContent ?? null;

const tag = (element: Element): Element | null =>
  element.querySelector('[data-dtb-part="ovl-tag"]');

const icons = (element: Element): number =>
  element.querySelectorAll('[data-dtb-part="ovl-icon"]').length;

/** A consumer's own inline `<svg>` — the proof that nothing was bundled. */
const ICON = (
  <svg viewBox="0 0 16 16" data-icon="layers">
    <circle cx="8" cy="8" r="7" />
  </svg>
);

beforeEach(() => {
  // Absent in jsdom entirely; the runtime tolerates that, so a test that wants
  // the inspector has to supply it.
  (document as Partial<Document>).elementFromPoint = undefined;
});

afterEach(() => {
  cleanupToolbar();
  vi.restoreAllMocks();
});

/**
 * The failed-measurement state, and the only state in this file where the
 * error `Tag` exists: the inspector is on, the element it measures throws, and
 * every overlay is switched off in response. Adapted from `overlays.test.tsx`'
 * `failWith`, which is the proven recipe.
 */
const withError = async (options: OverlaysOptions = {}) => {
  const { toolbar } = mount({ defaults: { inspect: true }, ...options });
  const target = document.querySelector('[data-testid="named"]') as Element;
  target.getBoundingClientRect = () => {
    throw new Error("measurement failed");
  };
  (document as Document & { elementFromPoint: () => Element | null }).elementFromPoint = () =>
    target;
  vi.spyOn(console, "error").mockImplementation(() => {});
  fireEvent.pointerMove(window, { clientX: 20, clientY: 50 });
  // jsdom drives `requestAnimationFrame` off a real timer.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 32));
  });
  return toolbar;
};

describe("the default presentation", () => {
  // The exact markup that shipped before `presentation` existed. Regenerated
  // only against a deliberate, documented change to overlays' bar DOM: every
  // consumer's CSS and every Playwright selector reads these attributes.
  const DEFAULT_TRIGGER =
    '<button type="button" data-dtb-part="trigger" aria-expanded="false"' +
    ' aria-label="Overlays, off" title="Overlays: off — click to choose overlays">' +
    '<span data-dtb-part="ovl-chip" data-dtb-active="false" data-dtb-kind="chip">' +
    '<span data-dtb-kind="dot" aria-hidden="true" data-dtb-part="ovl-dot"></span>' +
    '<span data-dtb-part="ovl-chip-label">overlays</span>' +
    '<span data-dtb-kind="value" data-dtb-part="ovl-value">off</span>' +
    "</span></button>";

  // The same tree with the full label — the only thing the `⋮` menu changes,
  // which is the swing this chip used to write by hand.
  const DEFAULT_OVERFLOW_TRIGGER = DEFAULT_TRIGGER.replace(
    '<span data-dtb-part="ovl-chip-label">overlays</span>',
    '<span data-dtb-part="ovl-chip-label">Overlays</span>',
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

  /**
   * The state every other assertion in this file cannot see: `data-dtb-active`
   * has one value, the count reaches the value word and the name, and the
   * title names the layer instead of the state.
   */
  it("paints an active overlay byte-identically", () => {
    const ON_TRIGGER =
      '<button type="button" data-dtb-part="trigger" aria-expanded="false"' +
      ' aria-label="Overlays, 1 on" title="Overlays: Column grid — click to choose overlays">' +
      '<span data-dtb-part="ovl-chip" data-dtb-active="true" data-dtb-kind="chip">' +
      '<span data-dtb-kind="dot" aria-hidden="true" data-dtb-part="ovl-dot"></span>' +
      '<span data-dtb-part="ovl-chip-label">overlays</span>' +
      '<span data-dtb-kind="value" data-dtb-part="ovl-value">1 on</span>' +
      "</span></button>";

    expect(barTrigger({ defaults: { grid: true } }).outerHTML).toBe(ON_TRIGGER);
    expect(overflowTrigger({ defaults: { grid: true } }).outerHTML).toBe(
      ON_TRIGGER.replace(
        '<span data-dtb-part="ovl-chip-label">overlays</span>',
        '<span data-dtb-part="ovl-chip-label">Overlays</span>',
      ),
    );
  });

  it("paints the failed-measurement state byte-identically, error tag included", async () => {
    const ERROR_TRIGGER =
      '<button type="button" data-dtb-part="trigger" aria-expanded="false"' +
      ' aria-label="Overlays, off, error" title="Overlays: off — click to choose overlays">' +
      '<span data-dtb-part="ovl-chip" data-dtb-active="false" data-dtb-kind="chip">' +
      '<span data-dtb-kind="dot" aria-hidden="true" data-dtb-part="ovl-dot"></span>' +
      '<span data-dtb-part="ovl-chip-label">overlays</span>' +
      '<span data-dtb-kind="value" data-dtb-part="ovl-value">off</span>' +
      '<span data-dtb-part="ovl-tag" data-dtb-kind="tag">error</span>' +
      "</span></button>";

    const toolbar = await withError();
    expect(
      toolbar.item("overlays")?.querySelector<HTMLElement>('[data-dtb-part="trigger"]')?.outerHTML,
    ).toBe(ERROR_TRIGGER);

    toolbar.resize(60);
    toolbar.openOverflow();
    expect(
      toolbar.overflowMenu()?.querySelector<HTMLElement>('[data-dtb-part="trigger"]')?.outerHTML,
    ).toBe(
      ERROR_TRIGGER.replace(
        '<span data-dtb-part="ovl-chip-label">overlays</span>',
        '<span data-dtb-part="ovl-chip-label">Overlays</span>',
      ),
    );
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
    bar: { icon: false, text: "overlays", value: "off" },
    menu: { icon: false, text: "Overlays", value: "off" },
    bareBar: { text: "overlays", value: "off" },
  },
  {
    preset: "icon",
    bar: { icon: true, text: null, value: null },
    // Guarantee 2 forces text in the menu — and only text, so the row loses
    // the readout today's default row paints. Intended, and pinned so it reads
    // as a decision rather than surfacing later as a regression.
    menu: { icon: true, text: "Overlays", value: null },
    // Guarantee 1: an icon-only preset with no icon paints text, never nothing.
    bareBar: { text: "overlays", value: null },
  },
  {
    preset: "icon-value",
    bar: { icon: true, text: null, value: "off" },
    menu: { icon: true, text: "Overlays", value: "off" },
    bareBar: { text: null, value: "off" },
  },
  {
    // The short bar word, the full label in the menu: the "which text" rule,
    // asserted rather than described.
    preset: "icon-label",
    bar: { icon: true, text: "overlays", value: null },
    menu: { icon: true, text: "Overlays", value: null },
    bareBar: { text: "overlays", value: null },
  },
  {
    preset: "label",
    // "label" names no icon, so a supplied one is not painted.
    bar: { icon: false, text: "overlays", value: null },
    menu: { icon: false, text: "Overlays", value: null },
    bareBar: { text: "overlays", value: null },
  },
  {
    preset: "value",
    bar: { icon: false, text: null, value: "off" },
    menu: { icon: false, text: "Overlays", value: "off" },
    bareBar: { text: null, value: "off" },
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
      const chip = trigger.querySelector('[data-dtb-part="ovl-chip"]') as HTMLElement;
      expect(chip.getAttribute("data-dtb-active")).toBe("false");
      expect(chip.querySelector('[data-dtb-part="ovl-dot"]')).not.toBeNull();
      // A preset changes text, not state — and never the trigger's identity.
      expect(trigger.getAttribute("aria-label")).toBe("Overlays, off");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(trigger.getAttribute("title")).toBe("Overlays: off — click to choose overlays");
    }
  });

  /**
   * A state that is not the empty one, under every preset: `data-dtb-active`
   * follows the store and not the preset, and the count still reaches the name.
   */
  it.each(PRESETS)("$preset leaves an active overlay's state alone", ({ preset }) => {
    const trigger = barTrigger({ defaults: { grid: true }, presentation: { preset, icon: ICON } });
    const chip = trigger.querySelector('[data-dtb-part="ovl-chip"]') as HTMLElement;
    expect(chip.getAttribute("data-dtb-active")).toBe("true");
    expect(trigger.getAttribute("aria-label")).toBe("Overlays, 1 on");
    expect(trigger.getAttribute("title")).toBe("Overlays: Column grid — click to choose overlays");
  });

  /**
   * Invariant 2, the point of this phase. The error tag is state rendered after
   * the contents, so it survives every preset — `"icon"` included, where the
   * chip has no text and no value left.
   */
  it.each(PRESETS)("$preset keeps the error tag, which is state", async ({ preset }) => {
    const toolbar = await withError({ presentation: { preset, icon: ICON } });
    const bar = toolbar
      .item("overlays")
      ?.querySelector<HTMLElement>('[data-dtb-part="trigger"]') as HTMLElement;
    const marker = tag(bar);
    expect(marker?.textContent).toBe("error");
    expect(marker?.getAttribute("data-dtb-kind")).toBe("tag");
    // The tag is the chip's last child under every preset: it is appended after
    // the contents, never interleaved with them.
    const chip = bar.querySelector('[data-dtb-part="ovl-chip"]') as HTMLElement;
    expect(chip.lastElementChild).toBe(marker);
    // And the error still reaches the name, which the preset does not touch.
    expect(bar.getAttribute("aria-label")).toBe("Overlays, off, error");

    toolbar.resize(60);
    toolbar.openOverflow();
    const row = toolbar
      .overflowMenu()
      ?.querySelector<HTMLElement>('[data-dtb-part="trigger"]') as HTMLElement;
    expect(tag(row)?.textContent).toBe("error");
  });

  it("hides the icon from assistive technology and clamps it", () => {
    const glyph = barChip({ presentation: { preset: "icon", icon: ICON } }).querySelector(
      '[data-dtb-part="ovl-icon"]',
    );
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
    expect(glyph?.getAttribute("data-dtb-kind")).toBe("glyph");
    expect(glyph?.querySelector("svg")).not.toBeNull();
  });
});

describe("a function icon", () => {
  it("is invoked with the snapshot the panel and the surface read", () => {
    const seen: OverlaysSnapshot[] = [];
    const chip = barChip({
      defaults: { grid: true },
      presentation: {
        preset: "icon",
        icon: (snapshot: OverlaysSnapshot) => {
          seen.push(snapshot);
          return <svg data-icon={snapshot.enabled.grid ? "grid" : "none"} />;
        },
      },
    });
    expect(seen[0]?.activeCount).toBe(1);
    expect(seen[0]?.enabled.grid).toBe(true);
    expect(chip.querySelector('[data-dtb-part="ovl-icon"] svg')?.getAttribute("data-icon")).toBe(
      "grid",
    );
  });

  it("paints text when it returns nothing", () => {
    // Guarantee 1 applies per control, after the function has been resolved.
    const chip = barChip({ presentation: { preset: "icon", icon: () => undefined } });
    expect(icons(chip)).toBe(0);
    expect(text(chip)).toBe("overlays");
  });

  it("sees the live count, so an icon can react to it", async () => {
    const seen: OverlaysSnapshot[] = [];
    const { toolbar } = mount({
      presentation: {
        preset: "icon",
        icon: (snapshot: OverlaysSnapshot) => {
          seen.push(snapshot);
          return <svg data-icon={snapshot.activeCount > 0 ? "on" : "off"} />;
        },
      },
    });
    expect(seen.at(-1)?.activeCount).toBe(0);

    // Toggled through the command the extension contributes, so the store
    // moves the way it does for a user rather than by a test writing to it.
    await toolbar.runCommand("overlays.toggle.grid");
    expect(seen.at(-1)?.activeCount).toBe(1);
    expect(seen.at(-1)?.enabled.grid).toBe(true);
    expect(
      toolbar
        .item("overlays")
        ?.querySelector('[data-dtb-part="ovl-icon"] svg')
        ?.getAttribute("data-icon"),
    ).toBe("on");
  });
});

describe("the render callback", () => {
  it("supplies the chip's children and is told where it is painting", () => {
    const contexts: CompactRenderContext[] = [];
    const render = (snapshot: OverlaysSnapshot, ctx: CompactRenderContext) => {
      contexts.push(ctx);
      return <b data-dtb-part="ovl-custom">{snapshot.activeCount} layers</b>;
    };

    const trigger = barTrigger({ presentation: { preset: "icon-value", icon: ICON, render } });
    const chip = trigger.querySelector('[data-dtb-part="ovl-chip"]') as HTMLElement;
    expect(chip.querySelector('[data-dtb-part="ovl-custom"]')?.textContent).toBe("0 layers");
    // The consumer's node replaces the parts, not the chip: the dot, the state
    // attribute and the trigger's name are not theirs to lose. This is the
    // whole reason the parts are `Chip`'s children rather than its slots.
    expect(chip.querySelector('[data-dtb-part="ovl-dot"]')).not.toBeNull();
    expect(chip.getAttribute("data-dtb-active")).toBe("false");
    expect(trigger.getAttribute("aria-label")).toBe("Overlays, off");
    expect(value(chip)).toBeNull();
    expect(contexts[0]?.preset).toBe("icon-value");
    expect(contexts[0]?.isOverflowed).toBe(false);
    expect(contexts[0]?.isPanelOpen).toBe(false);
    expect(contexts[0]?.icon).toBe(ICON);

    // Honoured in the ⋮ menu too — ADR-004's deliberate deviation from the
    // "always paint text" guarantee, with `isOverflowed` as the hook. The row
    // keeps its own `aria-label`, so a callback painting an icon alone still
    // leaves a named button.
    const menu = overflowTrigger({ presentation: { render } });
    expect(menu.querySelector('[data-dtb-part="ovl-custom"]')?.textContent).toBe("0 layers");
    expect(menu.querySelector('[data-dtb-part="ovl-dot"]')).not.toBeNull();
    expect(menu.getAttribute("aria-label")).toBe("Overlays, off");
    expect(contexts.at(-1)?.isOverflowed).toBe(true);
  });

  /** Invariant 2 again, against the knob that takes the most away. */
  it("cannot take the error tag with it", async () => {
    const toolbar = await withError({
      presentation: { render: () => <b data-dtb-part="ovl-custom">mine</b> },
    });
    const trigger = toolbar
      .item("overlays")
      ?.querySelector<HTMLElement>('[data-dtb-part="trigger"]') as HTMLElement;
    const chip = trigger.querySelector('[data-dtb-part="ovl-chip"]') as HTMLElement;
    expect(chip.querySelector('[data-dtb-part="ovl-custom"]')?.textContent).toBe("mine");
    expect(tag(chip)?.textContent).toBe("error");
    expect(chip.lastElementChild).toBe(tag(chip));
    expect(trigger.getAttribute("aria-label")).toBe("Overlays, off, error");
  });

  /**
   * `data-dtb-active` follows the store, not the callback: `render` replaces
   * the chip's contents, but the state attribute is on the chip and the count
   * is in the trigger's name, neither of which `render` reaches. Asserted in a
   * state that is not the empty one, so `"true"` is actually observed here and
   * not only in the preset rows above.
   */
  it("cannot take an active overlay's state with it", () => {
    const trigger = barTrigger({
      defaults: { grid: true },
      presentation: {
        render: (snapshot: OverlaysSnapshot) => (
          <b data-dtb-part="ovl-custom">{snapshot.activeCount} layers</b>
        ),
      },
    });
    const chip = trigger.querySelector('[data-dtb-part="ovl-chip"]') as HTMLElement;
    expect(chip.querySelector('[data-dtb-part="ovl-custom"]')?.textContent).toBe("1 layers");
    expect(chip.getAttribute("data-dtb-active")).toBe("true");
    expect(chip.querySelector('[data-dtb-part="ovl-dot"]')).not.toBeNull();
    expect(trigger.getAttribute("aria-label")).toBe("Overlays, 1 on");
  });

  it("falls through to the preset when it returns undefined", () => {
    const render = vi.fn(() => undefined);
    const chip = barChip({ presentation: { preset: "icon-label", icon: ICON, render } });
    expect(render).toHaveBeenCalledTimes(1);
    expect(icons(chip)).toBe(1);
    expect(text(chip)).toBe("overlays");
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
        render: (_snapshot: OverlaysSnapshot, ctx: CompactRenderContext) => ctx.fallback,
      },
    });
    expect(deferred.outerHTML).toBe(presetOnly.outerHTML);

    const menuPresetOnly = overflowTrigger({ presentation: { preset: "icon", icon: ICON } });
    const menuDeferred = overflowTrigger({
      presentation: {
        preset: "icon",
        icon: ICON,
        render: (_snapshot: OverlaysSnapshot, ctx: CompactRenderContext) => ctx.fallback,
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
        name: (snapshot: OverlaysSnapshot) =>
          snapshot.activeCount > 0 ? "Overlays on" : "Choose overlays",
      },
    });
    expect(trigger.getAttribute("aria-label")).toBe("Choose overlays");
    // `title` explains; it does not name, so it is not overridable.
    expect(trigger.getAttribute("title")).toBe("Overlays: off — click to choose overlays");
  });

  it("ignores a whitespace-only override rather than leaving the control unnamed", () => {
    // An icon-only control with no name is exactly what `/ext/a11y` would flag
    // on the toolbar's own bar.
    const trigger = barTrigger({ presentation: { preset: "icon", icon: ICON, name: () => "   " } });
    expect(trigger.getAttribute("aria-label")).toBe("Overlays, off");
  });
});
