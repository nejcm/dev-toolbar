/**
 * `/ext/metrics`' `presentation` option, against the real shell.
 *
 * Metrics is the hardest of the nine — N controls inside one trigger, a wholly
 * different tree in the `⋮` menu, and a function `icon` so no icon map is
 * needed — so this is where the vocabulary is proved before the other eight
 * consume it.
 *
 * Four things are pinned here that nothing else pins:
 *
 * 1. **The default output is byte-identical** to what shipped before the
 *    option existed, in the bar *and* in the menu, as two literal strings.
 *    `resolveCompactParts` answering `null` for `"default"` is what makes that
 *    structural, but a string is what makes it evidence.
 * 2. **A preset changes text, not state.** `data-dtb-part`,
 *    `data-dtb-metric`, `data-dtb-severity` and the dot are asserted under
 *    every preset, including the icon-only one that paints no text at all.
 * 3. **A `⋮` row under `"icon"`, `"icon-label"` or `"label"` has no value.**
 *    The overflow rule forces *text*, not the value, so those rows lose the
 *    readout today's default row paints. That is intended — pinned so it reads
 *    as a decision rather than surfacing later as a regression.
 * 4. **Where the dot lives under `render`.** It is `Chip`'s in the bar and so
 *    survives a callback; in a `⋮` row it is inside the content the callback
 *    replaces and so is the callback's to paint. Both directions are asserted,
 *    because the asymmetry is a consequence of the two DOM shapes rather than
 *    a decision, and a refactor could flip either half silently.
 *
 * [dev-toolbar/plans/bar-presentation-icons-v1 §3]
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupToolbar, mountToolbar } from "@nejcm/dev-toolbar/testing";
import type { CompactPreset, CompactRenderContext } from "@nejcm/dev-toolbar/kit";
import { metrics } from "../index";
import type { MetricsOptions } from "../index";
import type { MetricView } from "../types";

const memoryRead = () => ({
  usedJSHeapSize: 48 * 1024 * 1024,
  totalJSHeapSize: 64 * 1024 * 1024,
  jsHeapSizeLimit: 128 * 1024 * 1024,
});

/**
 * One metric, so the trees below are short enough to read as literals.
 *
 * It tears down whatever is already mounted first: several tests here compare
 * two presentations of the same extension, and the testing helpers query the
 * document rather than one root, so a leftover toolbar answers for the new one
 * and `resize()` appears not to collapse anything.
 */
const mount = (options: MetricsOptions = {}) => {
  cleanupToolbar();
  const extension = metrics({
    only: ["memory"],
    memory: { read: memoryRead, sampleMs: 50 },
    ...options,
  });
  return mountToolbar(null, {
    extensions: [extension],
    layout: { barWidth: 900, itemWidth: 200 },
  });
};

/** The bar chip for one metric. */
const barChip = (options: MetricsOptions = {}, id = "memory"): HTMLElement => {
  const { toolbar } = mount(options);
  const chip = toolbar
    .item("metrics")
    ?.querySelector<HTMLElement>(`[data-dtb-part="metrics-chip"][data-dtb-metric="${id}"]`);
  expect(chip).not.toBeNull();
  return chip as HTMLElement;
};

/** The `⋮` row for one metric, with the bar collapsed to nothing. */
const overflowRow = (options: MetricsOptions = {}, id = "memory"): HTMLElement => {
  const { toolbar } = mount(options);
  toolbar.resize(60);
  expect(toolbar.isOverflowed("metrics")).toBe(true);
  toolbar.openOverflow();
  const row = toolbar
    .overflowMenu()
    ?.querySelector<HTMLElement>(`[data-dtb-part="metrics-overflow-row"][data-dtb-metric="${id}"]`);
  expect(row).not.toBeNull();
  return row as HTMLElement;
};

const text = (element: Element, part: string): string | null =>
  element.querySelector(`[data-dtb-part="${part}"]`)?.textContent ?? null;

const icons = (element: Element): number =>
  element.querySelectorAll('[data-dtb-part="metrics-icon"]').length;

/** A consumer's own inline `<svg>` — the proof that nothing was bundled. */
const ICON = (
  <svg viewBox="0 0 16 16" data-icon="ram">
    <circle cx="8" cy="8" r="7" />
  </svg>
);

afterEach(cleanupToolbar);

describe("the default presentation", () => {
  // The exact markup that shipped before `presentation` existed. Regenerate it
  // only against a deliberate, documented change to metrics' bar DOM: every
  // consumer's CSS and every Playwright selector reads these attributes.
  const DEFAULT_TRIGGER =
    '<button type="button" data-dtb-part="trigger" aria-expanded="false" aria-label="Metrics"' +
    ' title="Runtime performance — click for details">' +
    '<span data-dtb-part="metrics-chips">' +
    '<span data-dtb-part="metrics-chip" data-dtb-metric="memory" data-dtb-severity="ok"' +
    ' data-dtb-kind="chip">' +
    '<span data-dtb-kind="dot" data-dtb-severity="ok" aria-hidden="true"' +
    ' data-dtb-part="metrics-dot"></span>' +
    '<span data-dtb-part="metrics-label" data-dtb-kind="label">mem</span>' +
    '<span data-dtb-kind="value" data-dtb-severity="ok" data-dtb-part="metrics-value">' +
    "48 MB</span></span></span></button>";

  const DEFAULT_OVERFLOW_ROW =
    '<button type="button" data-dtb-part="metrics-overflow-row" data-dtb-metric="memory"' +
    ' data-dtb-severity="ok" title="Used JS heap, as a share of the browser\'s heap limit.' +
    ' Not process memory.">' +
    '<span data-dtb-part="metrics-chip" data-dtb-kind="chip">' +
    '<span data-dtb-kind="dot" data-dtb-severity="ok" aria-hidden="true"' +
    ' data-dtb-part="metrics-dot"></span>' +
    '<span data-dtb-part="metrics-label" data-dtb-kind="label">Memory</span></span>' +
    '<span data-dtb-part="metrics-value" data-dtb-kind="value" data-dtb-severity="ok">' +
    "48 MB</span></button>";

  it("paints the bar byte-identically with no option at all", () => {
    const { toolbar } = mount();
    const trigger = toolbar.item("metrics")?.querySelector('[data-dtb-part="trigger"]');
    expect(trigger?.outerHTML).toBe(DEFAULT_TRIGGER);
  });

  it("paints the ⋮ row byte-identically with no option at all", () => {
    expect(overflowRow().outerHTML).toBe(DEFAULT_OVERFLOW_ROW);
  });

  it('is what an explicit "default" and a bare icon both resolve to', () => {
    const { toolbar } = mount({ presentation: { preset: "default", icon: ICON } });
    const trigger = toolbar.item("metrics")?.querySelector('[data-dtb-part="trigger"]');
    // An icon with no preset that paints it does nothing — the four knobs are
    // meaningless apart, which is why they are one option.
    expect(trigger?.outerHTML).toBe(DEFAULT_TRIGGER);
    expect(overflowRow({ presentation: "default" }).outerHTML).toBe(DEFAULT_OVERFLOW_ROW);
  });
});

interface PresetRow {
  preset: CompactPreset;
  /** In the bar, with an icon supplied. */
  bar: { icon: boolean; label: string | null; value: string | null };
  /** In the `⋮` menu, with an icon supplied. */
  menu: { icon: boolean; label: string | null; value: string | null };
  /** In the bar, with no icon supplied. */
  bareBar: { label: string | null; value: string | null };
}

// Every member of the preset union, in both places. Listing them as rows keyed
// by preset is what keeps the "add a test, don't lower the floor" rule honest:
// the completeness check below fails if a member goes missing.
const PRESETS: readonly PresetRow[] = [
  {
    preset: "default",
    bar: { icon: false, label: "mem", value: "48 MB" },
    menu: { icon: false, label: "Memory", value: "48 MB" },
    bareBar: { label: "mem", value: "48 MB" },
  },
  {
    preset: "icon",
    bar: { icon: true, label: null, value: null },
    // Guarantee 2 forces text in the menu — and only text, so the row loses
    // the value the default row paints. See (3) in the docblock.
    menu: { icon: true, label: "Memory", value: null },
    // Guarantee 1: an icon-only preset with no icon paints text, never nothing.
    bareBar: { label: "mem", value: null },
  },
  {
    preset: "icon-value",
    bar: { icon: true, label: null, value: "48 MB" },
    menu: { icon: true, label: "Memory", value: "48 MB" },
    bareBar: { label: null, value: "48 MB" },
  },
  {
    preset: "icon-label",
    bar: { icon: true, label: "mem", value: null },
    menu: { icon: true, label: "Memory", value: null },
    bareBar: { label: "mem", value: null },
  },
  {
    preset: "label",
    // "label" names no icon, so a supplied one is not painted.
    bar: { icon: false, label: "mem", value: null },
    menu: { icon: false, label: "Memory", value: null },
    bareBar: { label: "mem", value: null },
  },
  {
    preset: "value",
    bar: { icon: false, label: null, value: "48 MB" },
    menu: { icon: false, label: "Memory", value: "48 MB" },
    bareBar: { label: null, value: "48 MB" },
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
    expect(text(chip, "metrics-label")).toBe(bar.label);
    expect(text(chip, "metrics-value")).toBe(bar.value);
  });

  it.each(PRESETS)("$preset in the ⋮ menu, with an icon", ({ menu, preset }) => {
    const row = overflowRow({ presentation: { preset, icon: ICON } });
    expect(icons(row)).toBe(menu.icon ? 1 : 0);
    expect(text(row, "metrics-label")).toBe(menu.label);
    expect(text(row, "metrics-value")).toBe(menu.value);
  });

  it.each(PRESETS)("$preset in the bar, with no icon supplied", ({ bareBar, preset }) => {
    // The bare-preset shorthand, which is the 90% call: `presentation: "icon"`.
    const chip = barChip({ presentation: preset });
    expect(icons(chip)).toBe(0);
    expect(text(chip, "metrics-label")).toBe(bareBar.label);
    expect(text(chip, "metrics-value")).toBe(bareBar.value);
  });

  it.each(PRESETS)("$preset keeps the state attributes and the dot", ({ preset }) => {
    const chip = barChip({ presentation: { preset, icon: ICON } });
    expect(chip.getAttribute("data-dtb-metric")).toBe("memory");
    expect(chip.getAttribute("data-dtb-severity")).toBe("ok");
    expect(chip.querySelector('[data-dtb-part="metrics-dot"]')).not.toBeNull();

    const row = overflowRow({ presentation: { preset, icon: ICON } });
    expect(row.getAttribute("data-dtb-metric")).toBe("memory");
    expect(row.getAttribute("data-dtb-severity")).toBe("ok");
    expect(row.querySelector('[data-dtb-part="metrics-dot"]')).not.toBeNull();
    // The extension keeps the row's own explanation, under every preset.
    expect(row.getAttribute("title")).toContain("Used JS heap");
  });

  it("hides the icon from assistive technology and clamps it", () => {
    const glyph = barChip({ presentation: { preset: "icon", icon: ICON } }).querySelector(
      '[data-dtb-part="metrics-icon"]',
    );
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
    expect(glyph?.getAttribute("data-dtb-kind")).toBe("glyph");
    expect(glyph?.querySelector("svg")).not.toBeNull();
  });
});

describe("a function icon", () => {
  it("is invoked once per metric per render, in bar order, and needs no icon map", () => {
    const seen: string[] = [];
    const { toolbar } = mount({
      only: ["memory", "jank"],
      presentation: {
        preset: "icon",
        icon: (view: MetricView) => {
          seen.push(view.id);
          return <svg data-icon={view.id} />;
        },
      },
    });
    const item = toolbar.item("metrics");
    expect(seen).toEqual(["memory", "jank"]);
    expect(
      [...(item?.querySelectorAll('[data-dtb-part="metrics-icon"] svg') ?? [])].map((node) =>
        node.getAttribute("data-icon"),
      ),
    ).toEqual(["memory", "jank"]);
  });

  it("paints text for the metrics it returns nothing for", () => {
    const { toolbar } = mount({
      only: ["memory", "jank"],
      presentation: {
        preset: "icon",
        icon: (view: MetricView) => (view.id === "memory" ? ICON : undefined),
      },
    });
    const item = toolbar.item("metrics");
    const chip = (id: string) =>
      item?.querySelector(`[data-dtb-part="metrics-chip"][data-dtb-metric="${id}"]`) as HTMLElement;
    expect(icons(chip("memory"))).toBe(1);
    expect(text(chip("memory"), "metrics-label")).toBeNull();
    // Same preset, no icon for this one: guarantee 1 applies per control.
    expect(icons(chip("jank"))).toBe(0);
    expect(text(chip("jank"), "metrics-label")).toBe("jank");
  });
});

describe("the render callback", () => {
  it("supplies the chip's children and is told where it is painting", () => {
    const contexts: CompactRenderContext[] = [];
    const render = (view: MetricView, ctx: CompactRenderContext) => {
      contexts.push(ctx);
      return <b data-dtb-part="metrics-custom">{view.display} used</b>;
    };

    const chip = barChip({ presentation: { preset: "icon-value", icon: ICON, render } });
    expect(text(chip, "metrics-custom")).toBe("48 MB used");
    // The consumer's node replaces the parts, not the chip: the dot and the
    // state attributes are not theirs to lose.
    expect(chip.querySelector('[data-dtb-part="metrics-dot"]')).not.toBeNull();
    expect(chip.getAttribute("data-dtb-metric")).toBe("memory");
    expect(text(chip, "metrics-value")).toBeNull();
    expect(contexts[0]?.preset).toBe("icon-value");
    expect(contexts[0]?.isOverflowed).toBe(false);
    expect(contexts[0]?.isPanelOpen).toBe(false);
    expect(contexts[0]?.icon).toBe(ICON);

    // Honoured in the ⋮ menu too — ADR-004's deliberate deviation from the
    // "always paint text" guarantee, with `isOverflowed` as the hook.
    const row = overflowRow({ presentation: { render } });
    expect(text(row, "metrics-custom")).toBe("48 MB used");
    // The asymmetry with the bar, pinned in both directions so a refactor
    // cannot flip it silently. In the bar the dot is `Chip`'s and survives a
    // callback (asserted above); in a `⋮` row the dot lives inside the content
    // `render` replaces, so it is the callback's to paint — it is in
    // `ctx.fallback`, and this callback ignored it. The preset table above
    // asserts the other direction: every preset keeps the row's dot.
    expect(row.querySelector('[data-dtb-part="metrics-dot"]')).toBeNull();
    // Recording, not endorsing: metrics' `⋮` rows carry no `aria-label` of
    // their own — they are named by their content, with `title` as the
    // fallback, because naming a row "Memory" would replace the announced
    // "Memory 48 MB". So this row, whose callback painted `<b>` text, is named
    // by that text; a callback painting an icon alone would leave it named by
    // `title` only. That is the sharp edge ADR-004's deviation section records;
    // whether these rows should be named outright is a separate decision.
    expect(row.getAttribute("aria-label")).toBeNull();
    expect(contexts.at(-1)?.isOverflowed).toBe(true);
  });

  it("falls through to the preset when it returns undefined", () => {
    const render = vi.fn(() => undefined);
    const chip = barChip({ presentation: { preset: "icon-label", icon: ICON, render } });
    // Once per metric *per render pass*: one metric, and no publish lands
    // between mount and this line. It is not a once-per-mount guarantee.
    expect(render).toHaveBeenCalledTimes(1);
    expect(icons(chip)).toBe(1);
    expect(text(chip, "metrics-label")).toBe("mem");
  });

  it("returning ctx.fallback paints exactly what the preset would have", () => {
    const presetOnly = barChip({ presentation: { preset: "icon-value", icon: ICON } });
    const deferred = barChip({
      presentation: {
        preset: "icon-value",
        icon: ICON,
        render: (_view: MetricView, ctx: CompactRenderContext) => ctx.fallback,
      },
    });
    // One construction, handed out as `fallback` and rendered as the preset —
    // so deferring is exact by construction rather than by careful mimicry.
    expect(deferred.outerHTML).toBe(presetOnly.outerHTML);

    const menuPresetOnly = overflowRow({ presentation: { preset: "icon", icon: ICON } });
    const menuDeferred = overflowRow({
      presentation: {
        preset: "icon",
        icon: ICON,
        render: (_view: MetricView, ctx: CompactRenderContext) => ctx.fallback,
      },
    });
    expect(menuDeferred.outerHTML).toBe(menuPresetOnly.outerHTML);
  });

  it("can paint one metric its own way and defer on the rest", () => {
    const { toolbar } = mount({
      only: ["memory", "jank"],
      presentation: {
        render: (view: MetricView, ctx: CompactRenderContext) =>
          view.id === "jank" ? <b data-dtb-part="metrics-custom">stalled</b> : ctx.fallback,
      },
    });
    const item = toolbar.item("metrics");
    expect(item?.querySelectorAll('[data-dtb-part="metrics-custom"]').length).toBe(1);
    expect(
      item?.querySelector('[data-dtb-metric="memory"] [data-dtb-part="metrics-value"]')
        ?.textContent,
    ).toBe("48 MB");
  });
});

describe("the accessible-name override", () => {
  it("replaces the trigger's aria-label, and leaves title alone", () => {
    const { toolbar } = mount({
      presentation: { preset: "icon", icon: ICON, name: (view: MetricView) => `Perf: ${view.id}` },
    });
    const trigger = toolbar.item("metrics")?.querySelector('[data-dtb-part="trigger"]');
    expect(trigger?.getAttribute("aria-label")).toBe("Perf: memory");
    // `title` explains; it does not name, so it is not overridable.
    expect(trigger?.getAttribute("title")).toBe("Runtime performance — click for details");
  });

  it("ignores a whitespace-only override rather than leaving the control unnamed", () => {
    const { toolbar } = mount({
      presentation: { preset: "icon", icon: ICON, name: () => "   " },
    });
    const trigger = toolbar.item("metrics")?.querySelector('[data-dtb-part="trigger"]');
    expect(trigger?.getAttribute("aria-label")).toBe("Metrics");
  });

  it("keeps the configured label when there is no metric to name from", () => {
    // No collectors at all, so no `MetricView` exists to invoke the override
    // with. The trigger is still a button, and still has to have a name.
    const name = vi.fn(() => "never");
    const { toolbar } = mount({ only: [], label: "Perf", presentation: { name } });
    const trigger = toolbar.item("metrics")?.querySelector('[data-dtb-part="trigger"]');
    expect(trigger?.getAttribute("aria-label")).toBe("Perf");
    expect(name).not.toHaveBeenCalled();
  });
});
