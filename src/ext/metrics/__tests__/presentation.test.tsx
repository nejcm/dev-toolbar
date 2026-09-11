/**
 * `/ext/metrics`' `presentation` option, against the real shell.
 *
 * Metrics is the hardest of the nine — N controls inside one trigger, a
 * different tree in the `⋮` menu, and a function `icon` needing no icon map.
 *
 * Pinned here specifically: default output is byte-identical in both the bar
 * and the menu; a preset changes text, not state (asserted under every
 * preset, icon-only included); a `⋮` row under `"icon"`/`"icon-label"`/
 * `"label"` loses its value since the overflow rule only forces text; the dot
 * survives `render` in both places (it once held only in the bar); and a
 * `name` override reaches each `⋮` row individually, not just the trigger.
 *
 * [dev-toolbar/plans/bar-presentation-icons-v1 §3]
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { cleanupToolbar, makeExtension, mountToolbar } from "@nejcm/dev-toolbar/testing";
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
 * One metric, so the trees below are short enough to read as literals. Tears
 * down first: the testing helpers query the document, not one root.
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
  // The exact markup that shipped before `presentation` existed. Regenerate
  // only by capture, never by hand.
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
    // An icon with no preset that paints it does nothing.
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

// Every member of the preset union, in both places. The completeness check
// below fails if a member goes missing.
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
    // Guarantee 2 forces text in the menu, so the row loses the value.
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
    // Replaces the parts, not the chip — the dot and state attributes aren't theirs to lose.
    expect(chip.querySelector('[data-dtb-part="metrics-dot"]')).not.toBeNull();
    expect(chip.getAttribute("data-dtb-metric")).toBe("memory");
    expect(text(chip, "metrics-value")).toBeNull();
    expect(contexts[0]?.preset).toBe("icon-value");
    expect(contexts[0]?.isOverflowed).toBe(false);
    expect(contexts[0]?.isPanelOpen).toBe(false);
    expect(contexts[0]?.icon).toBe(ICON);

    // Honoured in the ⋮ menu too — ADR-004's deliberate deviation from "always paint text".
    const row = overflowRow({ presentation: { render } });
    expect(text(row, "metrics-custom")).toBe("48 MB used");
    // No asymmetry: the dot stays outside the callback's reach here too — a
    // preset changes text, not state, and neither does a callback. This once
    // read `toBeNull()` when metrics was the only converted extension; the
    // other eight are built this way, so the inconsistency was the defect.
    expect(row.querySelector('[data-dtb-part="metrics-dot"]')).not.toBeNull();
    expect(row.getAttribute("data-dtb-severity")).toBe("ok");
    // The value span sits outside the chip but `render` still owns it, as in
    // the bar — painting it too would duplicate the readout ("48 MB used48 MB").
    expect(text(row, "metrics-value")).toBeNull();
    expect(row.textContent).toBe("48 MB used");
    // With no `name` override, a `⋮` row carries no `aria-label` of its own —
    // it's named by its content (naming rows by default is a separate, open
    // decision — ADR-004). A consumer's own `name` is honoured — see below.
    expect(row.getAttribute("aria-label")).toBeNull();
    expect(contexts.at(-1)?.isOverflowed).toBe(true);
  });

  it("falls through to the preset when it returns undefined", () => {
    const render = vi.fn(() => undefined);
    const chip = barChip({ presentation: { preset: "icon-label", icon: ICON, render } });
    // Once per metric per render pass, not once per mount.
    expect(render).toHaveBeenCalledTimes(1);
    expect(icons(chip)).toBe(1);
    expect(text(chip, "metrics-label")).toBe("mem");

    // In the `⋮` menu, falling through restores the value span the row would
    // otherwise drop for a callback that painted.
    const row = overflowRow({ presentation: { render } });
    expect(text(row, "metrics-value")).toBe("48 MB");
    expect(row.textContent).toBe("Memory48 MB");
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

  it("reaches every ⋮ row, one override per control", () => {
    const seen: string[] = [];
    const { toolbar } = mount({
      only: ["memory", "jank"],
      presentation: {
        name: (view: MetricView) => {
          seen.push(view.id);
          return `Perf: ${view.id}`;
        },
      },
    });
    toolbar.resize(60);
    toolbar.openOverflow();
    const rows = [...(toolbar.overflowMenu()?.querySelectorAll("[data-dtb-metric]") ?? [])];
    // The bar button resolves the override against the first metric; a row against its own.
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "Perf: memory",
      "Perf: jank",
    ]);
    expect(seen).toContain("jank");
  });

  it("leaves a ⋮ row unnamed when the override says nothing", () => {
    expect(
      overflowRow({ presentation: { name: () => "  " } }).getAttribute("aria-label"),
    ).toBeNull();
    expect(overflowRow().getAttribute("aria-label")).toBeNull();
  });

  it("keeps the configured label when there is no metric to name from", () => {
    // No collectors, so no `MetricView` to invoke the override with.
    const name = vi.fn(() => "never");
    const { toolbar } = mount({ only: [], label: "Perf", presentation: { name } });
    const trigger = toolbar.item("metrics")?.querySelector('[data-dtb-part="trigger"]');
    expect(trigger?.getAttribute("aria-label")).toBe("Perf");
    expect(name).not.toHaveBeenCalled();
  });
});

describe("an icon that paints nothing", () => {
  // A `&&` guard returns `false`, not `undefined`; React paints nothing for
  // `false`, so a naive presence check would leave an empty glyph and no text
  // — the blank chip guarantee 1 exists to close.
  it.each([
    ["false, from a && guard", false],
    ["true", true],
    ["an empty string", ""],
    ["null", null],
    ["undefined", undefined],
  ])('%s falls back to text under "icon", painting no glyph', (_name, value) => {
    const chip = barChip({
      presentation: { preset: "icon", icon: () => value as never },
    });
    expect(icons(chip)).toBe(0);
    expect(text(chip, "metrics-label")).toBe("mem");
  });

  it("is emptiness, not falsiness: 0 is a node that paints", () => {
    // `<Glyph>0</Glyph>` renders the character `0`. A numeric badge is a
    // legitimate icon, so the rule cannot be a truthiness test.
    const chip = barChip({ presentation: { preset: "icon", icon: () => 0 } });
    expect(icons(chip)).toBe(1);
    expect(chip.querySelector('[data-dtb-part="metrics-icon"]')?.textContent).toBe("0");
    expect(text(chip, "metrics-label")).toBeNull();
  });

  it("paints no empty glyph under a preset that keeps its other part", () => {
    const chip = barChip({ presentation: { preset: "icon-value", icon: () => false as never } });
    expect(icons(chip)).toBe(0);
    expect(text(chip, "metrics-value")).toBe("48 MB");
  });
});

describe("a callback that throws", () => {
  /** Every consumer callback runs inside this extension's own `ExtensionBoundary`. */
  const other = () =>
    makeExtension({
      id: "bystander",
      label: "Bystander",
      compact: () => <span data-dtb-part="trigger">bystander</span>,
    });

  const mountWith = (options: MetricsOptions) => {
    cleanupToolbar();
    // React logs the boundary's caught error; the throw is the assertion.
    vi.spyOn(console, "error").mockImplementation(() => {});
    return mountToolbar(null, {
      extensions: [
        metrics({ only: ["memory"], memory: { read: memoryRead, sampleMs: 50 }, ...options }),
        other(),
      ],
      layout: { barWidth: 900, itemWidth: 200 },
    });
  };

  const boom = () => {
    throw new Error("consumer callback blew up");
  };

  it.each([
    ["render", { render: boom }],
    ["icon", { preset: "icon" as const, icon: boom }],
    ["name", { name: boom }],
  ])("degrades only this extension's slot when %s throws", (_which, presentation) => {
    const { toolbar } = mountWith({ presentation });
    expect(toolbar.bar()).not.toBeNull();
    expect(toolbar.item("bystander")?.textContent).toBe("bystander");
    // Metrics' slot is replaced by the shell's error chip, not a hole.
    const chip = toolbar.errorChip("metrics");
    expect(chip?.getAttribute("title")).toBe("consumer callback blew up");
    expect(chip?.querySelector('[data-dtb-part="error-retry"]')?.getAttribute("aria-label")).toBe(
      "Metrics: error. Retry",
    );
    expect(toolbar.item("metrics")?.querySelector('[data-dtb-part="trigger"]')).toBeNull();

    // The retry is operable: clicking it re-renders, throws again, and the
    // chip comes back rather than the bar going down.
    const retry = chip?.querySelector('[data-dtb-part="error-retry"]') as HTMLElement;
    fireEvent.click(retry);
    expect(toolbar.bar()).not.toBeNull();
    expect(toolbar.errorChip("metrics")?.getAttribute("title")).toBe("consumer callback blew up");
    expect(toolbar.item("metrics")?.querySelector('[data-dtb-part="trigger"]')).toBeNull();
    expect(toolbar.item("bystander")?.textContent).toBe("bystander");
  });
});
