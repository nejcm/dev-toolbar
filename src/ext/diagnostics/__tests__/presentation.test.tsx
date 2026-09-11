/**
 * `/ext/diagnostics`' `presentation` option, against the real shell.
 *
 * The point of this file is invariant 2: the error/warning badge is state, not
 * presentation. It sits outside both the preset and `render`, after the
 * contents, under every preset including `"icon"`. Every preset row and the
 * `render` case below assert it in both places.
 *
 * Byte-identity is pinned in three states: empty, a caught error plus warning
 * (the badge's attributes are otherwise invisible), and a captured snapshot
 * with something missing (the only state where `data-dtb-incomplete` is
 * `"true"`).
 *
 * [dev-toolbar/plans/bar-presentation-icons-v1 §4]
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { cleanupToolbar, mountToolbar } from "@nejcm/dev-toolbar/testing";
import type { CompactPreset, CompactRenderContext } from "@nejcm/dev-toolbar/kit";
import { diagnostics } from "../index";
// Through `../index`, the entry point a consumer actually imports from.
import type { DiagnosticsBarView, DiagnosticsOptions } from "../index";
import type { DevToolbarExtension } from "../../../core/contract";

const app = <main data-testid="app">app</main>;

/** Tears down first: the testing helpers query the document, not one root. */
const mount = (options: DiagnosticsOptions = {}) => {
  cleanupToolbar();
  return mountToolbar(app, {
    extensions: [diagnostics(options)],
    instanceId: "test",
    layout: { barWidth: 900, itemWidth: 200 },
  });
};

const barTrigger = (options: DiagnosticsOptions = {}): HTMLElement => {
  const { toolbar } = mount(options);
  const trigger = toolbar
    .item("diagnostics")
    ?.querySelector<HTMLElement>('[data-dtb-part="trigger"]');
  expect(trigger).not.toBeNull();
  return trigger as HTMLElement;
};

const barChip = (options: DiagnosticsOptions = {}): HTMLElement =>
  barTrigger(options).querySelector('[data-dtb-part="diag-chip"]') as HTMLElement;

/** The `⋮` row, with the bar collapsed to nothing. */
const overflowTrigger = (options: DiagnosticsOptions = {}): HTMLElement => {
  const { toolbar } = mount(options);
  toolbar.resize(60);
  expect(toolbar.isOverflowed("diagnostics")).toBe(true);
  toolbar.openOverflow();
  const trigger = toolbar.overflowMenu()?.querySelector<HTMLElement>('[data-dtb-part="trigger"]');
  expect(trigger).not.toBeNull();
  return trigger as HTMLElement;
};

const overflowChip = (options: DiagnosticsOptions = {}): HTMLElement =>
  overflowTrigger(options).querySelector('[data-dtb-part="diag-chip"]') as HTMLElement;

/**
 * The chip's text span. Deliberately no `data-dtb-kind="label"` — that's what
 * the kit sheet tints, and recolouring this chip is a separate decision.
 */
const text = (chip: Element): string | null =>
  chip.querySelector('[data-dtb-part="diag-label"]')?.textContent ?? null;

const value = (chip: Element): string | null =>
  chip.querySelector('[data-dtb-part="diag-value"]')?.textContent ?? null;

const badge = (element: Element): Element | null =>
  element.querySelector('[data-dtb-part="diag-errors"]');

const icons = (element: Element): number =>
  element.querySelectorAll('[data-dtb-part="diag-icon"]').length;

/** A consumer's own inline `<svg>` — the proof that nothing was bundled. */
const ICON = (
  <svg viewBox="0 0 16 16" data-icon="stethoscope">
    <circle cx="8" cy="8" r="7" />
  </svg>
);

const REAL = { error: console.error, warn: console.warn };
afterEach(() => {
  cleanupToolbar();
  console.error = REAL.error;
  console.warn = REAL.warn;
  vi.restoreAllMocks();
});

/**
 * One caught error and one caught warning — the only state here where the
 * badge exists. `console.error`/`.warn` are silenced first since the
 * extension's patch always calls through.
 */
const withCaught = async (options: DiagnosticsOptions = {}) => {
  console.error = () => {};
  console.warn = () => {};
  const { toolbar } = mount(options);
  await act(async () => {
    console.error("something broke");
    console.warn("and something is odd");
    await Promise.resolve();
  });
  return toolbar;
};

const CAUGHT_TITLE =
  "Diagnostics: click to capture a snapshot for a bug report\n" +
  "1 error, 1 warning captured since load; the snapshot lists them.";

/**
 * A captured snapshot that could not say everything. `QUIET` is a neighbour
 * extension with no `diagnostics()` of its own — exactly one omission. Opening
 * then closing the panel takes the snapshot and returns the trigger to its
 * resting state. The only state here where `data-dtb-incomplete` is `"true"`.
 */
const QUIET: DevToolbarExtension = { id: "quiet", label: "Quiet" };

const withOmission = (options: DiagnosticsOptions = {}) => {
  cleanupToolbar();
  const { toolbar } = mountToolbar(app, {
    extensions: [QUIET, diagnostics(options)],
    instanceId: "test",
    layout: { barWidth: 900, itemWidth: 200 },
  });
  act(() => toolbar.openPanel("diagnostics"));
  act(() => toolbar.closePanel("diagnostics"));
  return toolbar;
};

type Mounted = ReturnType<typeof withOmission>;

const omissionTrigger = (toolbar: Mounted): HTMLElement =>
  toolbar
    .item("diagnostics")
    ?.querySelector<HTMLElement>('[data-dtb-part="trigger"]') as HTMLElement;

/**
 * The diagnostics row inside the `⋮` menu, scoped by `data-dtb-ext-id`: the
 * menu holds a row per overflowed extension, so an unscoped query could
 * answer with `QUIET`'s row instead.
 */
const omissionMenuRow = (toolbar: Mounted): HTMLElement => {
  toolbar.resize(60);
  toolbar.openOverflow();
  const row = toolbar
    .overflowMenu()
    ?.querySelector<HTMLElement>(
      '[data-dtb-part="overflow-menu-item"][data-dtb-ext-id="diagnostics"] [data-dtb-part="trigger"]',
    );
  expect(row).not.toBeNull();
  return row as HTMLElement;
};

describe("the default presentation", () => {
  // The exact markup that shipped before `presentation` existed. Regenerate
  // only by capture, never by hand.
  const DEFAULT_TRIGGER =
    '<button type="button" data-dtb-part="trigger" aria-expanded="false"' +
    ' aria-label="Diagnostics"' +
    ' title="Diagnostics: click to capture a snapshot for a bug report">' +
    '<span data-dtb-part="diag-chip" data-dtb-incomplete="false" data-dtb-kind="chip">' +
    '<span data-dtb-kind="dot" aria-hidden="true" data-dtb-part="diag-dot"></span>' +
    '<span data-dtb-part="diag-label">diagnostics</span>' +
    '<span data-dtb-kind="value" data-dtb-part="diag-value">capture</span>' +
    "</span></button>";

  // The same tree with the full label — the only thing the `⋮` menu changes.
  const DEFAULT_OVERFLOW_TRIGGER = DEFAULT_TRIGGER.replace(
    '<span data-dtb-part="diag-label">diagnostics</span>',
    '<span data-dtb-part="diag-label">Diagnostics</span>',
  );

  it("paints the bar byte-identically with no option at all", () => {
    expect(barTrigger().outerHTML).toBe(DEFAULT_TRIGGER);
  });

  it("paints the ⋮ row byte-identically with no option at all", () => {
    expect(overflowTrigger().outerHTML).toBe(DEFAULT_OVERFLOW_TRIGGER);
  });

  it('is what an explicit "default" and a bare icon both resolve to', () => {
    // An icon with no preset that paints it does nothing.
    expect(barTrigger({ presentation: { preset: "default", icon: ICON } }).outerHTML).toBe(
      DEFAULT_TRIGGER,
    );
    expect(overflowTrigger({ presentation: "default" }).outerHTML).toBe(DEFAULT_OVERFLOW_TRIGGER);
  });

  it("paints the captured-with-omission state byte-identically", () => {
    const OMISSION_BAR =
      '<button type="button" data-dtb-part="trigger" aria-expanded="false"' +
      ' aria-label="Diagnostics, 1 missing"' +
      ' title="Diagnostics: snapshot taken, 1 omission — click to review, copy or download it">' +
      '<span data-dtb-part="diag-chip" data-dtb-incomplete="true" data-dtb-kind="chip">' +
      '<span data-dtb-kind="dot" aria-hidden="true" data-dtb-part="diag-dot"></span>' +
      '<span data-dtb-part="diag-label">diagnostics</span>' +
      '<span data-dtb-kind="value" data-dtb-part="diag-value">1 missing</span>' +
      "</span></button>";

    const toolbar = withOmission();
    expect(omissionTrigger(toolbar).outerHTML).toBe(OMISSION_BAR);
    expect(omissionMenuRow(toolbar).outerHTML).toBe(
      OMISSION_BAR.replace(
        '<span data-dtb-part="diag-label">diagnostics</span>',
        '<span data-dtb-part="diag-label">Diagnostics</span>',
      ),
    );
  });

  it("paints the caught-error state byte-identically, badge included", async () => {
    const CAUGHT_BAR =
      '<button type="button" data-dtb-part="trigger" aria-expanded="false"' +
      ' aria-label="Diagnostics, 1 error, 1 warning"' +
      ` title="Diagnostics: click to capture a snapshot for a bug report\n` +
      `1 error, 1 warning captured since load; the snapshot lists them.">` +
      '<span data-dtb-part="diag-chip" data-dtb-incomplete="false" data-dtb-kind="chip">' +
      '<span data-dtb-kind="dot" aria-hidden="true" data-dtb-part="diag-dot"></span>' +
      '<span data-dtb-part="diag-label">diagnostics</span>' +
      '<span data-dtb-kind="value" data-dtb-part="diag-value">capture</span>' +
      '<span data-dtb-part="diag-errors" data-dtb-tone="error" data-dtb-errors="1"' +
      ' data-dtb-warnings="1" aria-hidden="true">2</span>' +
      "</span></button>";

    const toolbar = await withCaught();
    const trigger = toolbar
      .item("diagnostics")
      ?.querySelector<HTMLElement>('[data-dtb-part="trigger"]') as HTMLElement;
    expect(trigger.outerHTML).toBe(CAUGHT_BAR);

    toolbar.resize(60);
    toolbar.openOverflow();
    expect(
      toolbar.overflowMenu()?.querySelector<HTMLElement>('[data-dtb-part="trigger"]')?.outerHTML,
    ).toBe(
      CAUGHT_BAR.replace(
        '<span data-dtb-part="diag-label">diagnostics</span>',
        '<span data-dtb-part="diag-label">Diagnostics</span>',
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
    bar: { icon: false, text: "diagnostics", value: "capture" },
    menu: { icon: false, text: "Diagnostics", value: "capture" },
    bareBar: { text: "diagnostics", value: "capture" },
  },
  {
    preset: "icon",
    bar: { icon: true, text: null, value: null },
    // Guarantee 2 forces text-only in the menu, so the row loses the value.
    menu: { icon: true, text: "Diagnostics", value: null },
    // Guarantee 1: an icon-only preset with no icon paints text, never nothing.
    bareBar: { text: "diagnostics", value: null },
  },
  {
    preset: "icon-value",
    bar: { icon: true, text: null, value: "capture" },
    menu: { icon: true, text: "Diagnostics", value: "capture" },
    bareBar: { text: null, value: "capture" },
  },
  {
    preset: "icon-label",
    bar: { icon: true, text: "diagnostics", value: null },
    menu: { icon: true, text: "Diagnostics", value: null },
    bareBar: { text: "diagnostics", value: null },
  },
  {
    preset: "label",
    // "label" names no icon, so a supplied one is not painted.
    bar: { icon: false, text: "diagnostics", value: null },
    menu: { icon: false, text: "Diagnostics", value: null },
    bareBar: { text: "diagnostics", value: null },
  },
  {
    preset: "value",
    bar: { icon: false, text: null, value: "capture" },
    menu: { icon: false, text: "Diagnostics", value: "capture" },
    bareBar: { text: null, value: "capture" },
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
      const chip = trigger.querySelector('[data-dtb-part="diag-chip"]') as HTMLElement;
      expect(chip.getAttribute("data-dtb-incomplete")).toBe("false");
      expect(chip.querySelector('[data-dtb-part="diag-dot"]')).not.toBeNull();
      // A preset changes text, not state — and never the trigger's identity.
      expect(trigger.getAttribute("aria-label")).toBe("Diagnostics");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(trigger.getAttribute("title")).toBe(
        "Diagnostics: click to capture a snapshot for a bug report",
      );
    }
  });

  /**
   * `data-dtb-incomplete` follows the snapshot, not the preset — the preset
   * chooses whether a value is painted, the state chooses the word inside it.
   */
  it.each(PRESETS)("$preset leaves a captured omission's state alone", ({ bar, preset }) => {
    const toolbar = withOmission({ presentation: { preset, icon: ICON } });
    const trigger = omissionTrigger(toolbar);
    const chip = trigger.querySelector('[data-dtb-part="diag-chip"]') as HTMLElement;
    expect(chip.getAttribute("data-dtb-incomplete")).toBe("true");
    expect(value(chip)).toBe(bar.value === null ? null : "1 missing");
    expect(trigger.getAttribute("aria-label")).toBe("Diagnostics, 1 missing");
    expect(trigger.getAttribute("title")).toBe(
      "Diagnostics: snapshot taken, 1 omission — click to review, copy or download it",
    );

    // And in the ⋮ row, where guarantee 2 forces the value back on under
    // `"icon"` — the state word travels with it.
    const row = omissionMenuRow(toolbar);
    expect(
      (row.querySelector('[data-dtb-part="diag-chip"]') as HTMLElement).getAttribute(
        "data-dtb-incomplete",
      ),
    ).toBe("true");
    expect(row.getAttribute("aria-label")).toBe("Diagnostics, 1 missing");
  });

  /** Invariant 2: the badge survives every preset, `"icon"` included. */
  it.each(PRESETS)("$preset keeps the error badge, which is state", async ({ preset }) => {
    const toolbar = await withCaught({ presentation: { preset, icon: ICON } });
    const bar = toolbar
      .item("diagnostics")
      ?.querySelector<HTMLElement>('[data-dtb-part="trigger"]') as HTMLElement;
    const marker = badge(bar);
    expect(marker?.textContent).toBe("2");
    expect(marker?.getAttribute("data-dtb-tone")).toBe("error");
    expect(marker?.getAttribute("data-dtb-errors")).toBe("1");
    expect(marker?.getAttribute("data-dtb-warnings")).toBe("1");
    expect(marker?.getAttribute("aria-hidden")).toBe("true");
    // The badge is the chip's last child under every preset: it is appended
    // after the contents, never interleaved with them.
    const chip = bar.querySelector('[data-dtb-part="diag-chip"]') as HTMLElement;
    expect(chip.lastElementChild).toBe(marker);
    // And the counts still reach the name, which the preset does not touch.
    expect(bar.getAttribute("aria-label")).toBe("Diagnostics, 1 error, 1 warning");
    expect(bar.getAttribute("title")).toBe(CAUGHT_TITLE);

    toolbar.resize(60);
    toolbar.openOverflow();
    const row = toolbar
      .overflowMenu()
      ?.querySelector<HTMLElement>('[data-dtb-part="trigger"]') as HTMLElement;
    expect(badge(row)?.textContent).toBe("2");
  });

  it("hides the icon from assistive technology and clamps it", () => {
    const glyph = barChip({ presentation: { preset: "icon", icon: ICON } }).querySelector(
      '[data-dtb-part="diag-icon"]',
    );
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
    expect(glyph?.getAttribute("data-dtb-kind")).toBe("glyph");
    expect(glyph?.querySelector("svg")).not.toBeNull();
  });
});

describe("a function icon", () => {
  it("is invoked with the narrow bar view, not the store state", () => {
    const seen: DiagnosticsBarView[] = [];
    const chip = barChip({
      presentation: {
        preset: "icon",
        icon: (view: DiagnosticsBarView) => {
          seen.push(view);
          return <svg data-icon={view.captured ? "ready" : "empty"} />;
        },
      },
    });
    // The four fields, and nothing else — not `revision`, `capturedAt` or the snapshot.
    expect(seen[0]).toEqual({ captured: false, omissions: 0, errors: 0, warnings: 0 });
    expect(Object.keys(seen[0] as DiagnosticsBarView).sort()).toEqual([
      "captured",
      "errors",
      "omissions",
      "warnings",
    ]);
    expect(chip.querySelector('[data-dtb-part="diag-icon"] svg')?.getAttribute("data-icon")).toBe(
      "empty",
    );
  });

  it("paints text when it returns nothing", () => {
    // Guarantee 1 applies per control, after the function has been resolved.
    const chip = barChip({ presentation: { preset: "icon", icon: () => undefined } });
    expect(icons(chip)).toBe(0);
    expect(text(chip)).toBe("diagnostics");
  });

  it("sees the live counts, so an icon can react to them", async () => {
    const seen: DiagnosticsBarView[] = [];
    await withCaught({
      presentation: {
        preset: "icon",
        icon: (view: DiagnosticsBarView) => {
          seen.push(view);
          return <svg />;
        },
      },
    });
    expect(seen.at(-1)).toEqual({ captured: false, omissions: 0, errors: 1, warnings: 1 });
  });
});

describe("the render callback", () => {
  it("supplies the chip's children and is told where it is painting", () => {
    const contexts: CompactRenderContext[] = [];
    const render = (view: DiagnosticsBarView, ctx: CompactRenderContext) => {
      contexts.push(ctx);
      return <b data-dtb-part="diag-custom">{view.captured ? "ready" : "nothing yet"}</b>;
    };

    const trigger = barTrigger({ presentation: { preset: "icon-value", icon: ICON, render } });
    const chip = trigger.querySelector('[data-dtb-part="diag-chip"]') as HTMLElement;
    expect(chip.querySelector('[data-dtb-part="diag-custom"]')?.textContent).toBe("nothing yet");
    // Replaces the parts, not the chip — the dot, state attribute and name aren't theirs to lose.
    expect(chip.querySelector('[data-dtb-part="diag-dot"]')).not.toBeNull();
    expect(chip.getAttribute("data-dtb-incomplete")).toBe("false");
    expect(trigger.getAttribute("aria-label")).toBe("Diagnostics");
    expect(value(chip)).toBeNull();
    expect(contexts[0]?.preset).toBe("icon-value");
    expect(contexts[0]?.isOverflowed).toBe(false);
    expect(contexts[0]?.isPanelOpen).toBe(false);
    expect(contexts[0]?.icon).toBe(ICON);

    // Honoured in the ⋮ menu too — ADR-004's deliberate deviation from "always paint text".
    const menu = overflowTrigger({ presentation: { render } });
    expect(menu.querySelector('[data-dtb-part="diag-custom"]')?.textContent).toBe("nothing yet");
    expect(menu.querySelector('[data-dtb-part="diag-dot"]')).not.toBeNull();
    expect(menu.getAttribute("aria-label")).toBe("Diagnostics");
    expect(contexts.at(-1)?.isOverflowed).toBe(true);
  });

  /** Invariant 2 again, against the knob that takes the most away. */
  it("cannot take the error badge with it", async () => {
    const toolbar = await withCaught({
      presentation: { render: () => <b data-dtb-part="diag-custom">mine</b> },
    });
    const trigger = toolbar
      .item("diagnostics")
      ?.querySelector<HTMLElement>('[data-dtb-part="trigger"]') as HTMLElement;
    const chip = trigger.querySelector('[data-dtb-part="diag-chip"]') as HTMLElement;
    expect(chip.querySelector('[data-dtb-part="diag-custom"]')?.textContent).toBe("mine");
    expect(badge(chip)?.textContent).toBe("2");
    expect(chip.lastElementChild).toBe(badge(chip));
    expect(trigger.getAttribute("aria-label")).toBe("Diagnostics, 1 error, 1 warning");
  });

  /** `render` can lose the value span, but not `data-dtb-incomplete` or the name. */
  it("cannot take the incomplete state with it", () => {
    const toolbar = withOmission({
      presentation: { render: () => <b data-dtb-part="diag-custom">mine</b> },
    });
    const trigger = omissionTrigger(toolbar);
    const chip = trigger.querySelector('[data-dtb-part="diag-chip"]') as HTMLElement;
    expect(chip.querySelector('[data-dtb-part="diag-custom"]')?.textContent).toBe("mine");
    expect(chip.getAttribute("data-dtb-incomplete")).toBe("true");
    expect(chip.querySelector('[data-dtb-part="diag-dot"]')).not.toBeNull();
    expect(value(chip)).toBeNull();
    expect(trigger.getAttribute("aria-label")).toBe("Diagnostics, 1 missing");
  });

  it("falls through to the preset when it returns undefined", () => {
    const render = vi.fn(() => undefined);
    const chip = barChip({ presentation: { preset: "icon-label", icon: ICON, render } });
    expect(render).toHaveBeenCalledTimes(1);
    expect(icons(chip)).toBe(1);
    expect(text(chip)).toBe("diagnostics");
  });

  it("returning ctx.fallback paints exactly what the preset would have", () => {
    const presetOnly = barTrigger({ presentation: { preset: "icon-value", icon: ICON } });
    const deferred = barTrigger({
      presentation: {
        preset: "icon-value",
        icon: ICON,
        render: (_view: DiagnosticsBarView, ctx: CompactRenderContext) => ctx.fallback,
      },
    });
    expect(deferred.outerHTML).toBe(presetOnly.outerHTML);

    const menuPresetOnly = overflowTrigger({ presentation: { preset: "icon", icon: ICON } });
    const menuDeferred = overflowTrigger({
      presentation: {
        preset: "icon",
        icon: ICON,
        render: (_view: DiagnosticsBarView, ctx: CompactRenderContext) => ctx.fallback,
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
        name: (view: DiagnosticsBarView) => (view.captured ? "Snapshot ready" : "Take a snapshot"),
      },
    });
    expect(trigger.getAttribute("aria-label")).toBe("Take a snapshot");
    // `title` explains; it does not name, so it is not overridable.
    expect(trigger.getAttribute("title")).toBe(
      "Diagnostics: click to capture a snapshot for a bug report",
    );
  });

  it("ignores a whitespace-only override rather than leaving the control unnamed", () => {
    const trigger = barTrigger({ presentation: { preset: "icon", icon: ICON, name: () => "   " } });
    expect(trigger.getAttribute("aria-label")).toBe("Diagnostics");
  });
});
