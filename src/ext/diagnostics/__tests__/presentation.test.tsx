/**
 * `/ext/diagnostics`' `presentation` option, against the real shell.
 *
 * Diagnostics is the third Group A member and the first of the two that carry
 * an extra severity child, so what this file exists to settle is **invariant
 * 2**: the error/warning badge is state, not presentation. It sits outside both
 * the preset and `render`, after the contents, under every preset including
 * `"icon"` — a consumer restyling the chip cannot silence the one thing on it
 * that says something is wrong. Every preset row and the `render` case below
 * assert it in both places.
 *
 * The other two decisions are `/ext/a11y`'s, copied rather than re-litigated:
 * the parts go in as `Chip`'s *children* rather than its `icon`/`label`/`value`
 * slots (so `ctx.fallback` is a children tree and `render` can never replace
 * the `Chip` itself), and a preset operates on the short bar word while `label`
 * stays the overflow and accessible-name identity.
 *
 * Byte-identity is pinned as literal strings in **three** states: the empty one
 * every other assertion runs in, a caught error plus a caught warning — because
 * the badge's four hand-written `data-dtb-*` attributes are invisible to a test
 * that only ever runs with no badge at all — and a captured snapshot with
 * something missing, which is the only state where `data-dtb-incomplete` is
 * `"true"`.
 *
 * [dev-toolbar/plans/bar-presentation-icons-v1 §4]
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { cleanupToolbar, mountToolbar } from "@nejcm/dev-toolbar/testing";
import type { CompactPreset, CompactRenderContext } from "@nejcm/dev-toolbar/kit";
import { diagnostics } from "../index";
// Both through `../index`: that is the subpath export the README advertises,
// so the test exercises the entry point a consumer actually imports from.
import type { DiagnosticsBarView, DiagnosticsOptions } from "../index";
import type { DevToolbarExtension } from "../../../core/contract";

const app = <main data-testid="app">app</main>;

/**
 * Tears down whatever is already mounted first: several tests here compare two
 * presentations of the same extension, and the testing helpers query the
 * document rather than one root, so a leftover toolbar answers for the new one.
 */
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
 * The chip's text span. It carries no `data-dtb-part`, deliberately: it is a
 * bare `<span>` because that is what `Chip`'s `label` slot wrote before the
 * parts moved into the chip's children, and naming it would have changed
 * today's bytes. So it is identified structurally — the one child span with no
 * kind and no part of its own.
 */
const text = (chip: Element): string | null => {
  const spans = [...chip.children].filter(
    (node) =>
      node.tagName === "SPAN" &&
      !node.hasAttribute("data-dtb-kind") &&
      !node.hasAttribute("data-dtb-part"),
  );
  expect(spans.length).toBeLessThanOrEqual(1);
  return spans[0]?.textContent ?? null;
};

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
 * One caught error and one caught warning, which is the only state in this
 * file where the badge exists. `console.error`/`console.warn` are silenced
 * first: the extension's patch always calls through, and this test writes on
 * purpose.
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
 * extension with no `diagnostics()` of its own, which is exactly one omission;
 * opening the panel is what takes the snapshot, and closing it again puts the
 * trigger back in its resting state so `aria-expanded` stays `"false"`.
 *
 * This is the only state in this file where `data-dtb-incomplete` is `"true"`
 * — every other assertion runs with nothing missing, so the attribute the plan
 * names as diagnostics' state hook would pass with its condition inverted.
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
 * The diagnostics row inside the `⋮` menu, in the states that mount a
 * neighbour. Scoped by `data-dtb-ext-id`, never by `[data-dtb-part="trigger"]`
 * alone: the menu holds a row per overflowed extension, so an unscoped query
 * answers with `QUIET`'s placeholder instead — AGENTS.md's discriminator rule.
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
  // The exact markup that shipped before `presentation` existed. Regenerated
  // only against a deliberate, documented change to diagnostics' bar DOM:
  // every consumer's CSS and every Playwright selector reads these attributes.
  const DEFAULT_TRIGGER =
    '<button type="button" data-dtb-part="trigger" aria-expanded="false"' +
    ' aria-label="Diagnostics"' +
    ' title="Diagnostics: click to capture a snapshot for a bug report">' +
    '<span data-dtb-part="diag-chip" data-dtb-incomplete="false" data-dtb-kind="chip">' +
    '<span data-dtb-kind="dot" aria-hidden="true" data-dtb-part="diag-dot"></span>' +
    "<span>diagnostics</span>" +
    '<span data-dtb-kind="value" data-dtb-part="diag-value">capture</span>' +
    "</span></button>";

  // The same tree with the full label — the only thing the `⋮` menu changes,
  // which is the swing this chip used to write by hand.
  const DEFAULT_OVERFLOW_TRIGGER = DEFAULT_TRIGGER.replace(
    "<span>diagnostics</span>",
    "<span>Diagnostics</span>",
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
   * The state every other assertion in this file cannot see. The badge's four
   * attributes and its `aria-hidden` are hand-written next to the parts rather
   * than by `Chip`, so a test that only ever runs with no badge would pass with
   * them mangled — and the badge is the reason this extension is in this phase.
   */
  /**
   * The other state the empty one hides: a snapshot was taken and something is
   * missing from it, so `data-dtb-incomplete` flips to `"true"`, the value word
   * becomes the count, and both the name and the title carry it. Captured from
   * the DOM like every literal here, never hand-written.
   */
  it("paints the captured-with-omission state byte-identically", () => {
    const OMISSION_BAR =
      '<button type="button" data-dtb-part="trigger" aria-expanded="false"' +
      ' aria-label="Diagnostics, 1 missing"' +
      ' title="Diagnostics: snapshot taken, 1 omission — click to review, copy or download it">' +
      '<span data-dtb-part="diag-chip" data-dtb-incomplete="true" data-dtb-kind="chip">' +
      '<span data-dtb-kind="dot" aria-hidden="true" data-dtb-part="diag-dot"></span>' +
      "<span>diagnostics</span>" +
      '<span data-dtb-kind="value" data-dtb-part="diag-value">1 missing</span>' +
      "</span></button>";

    const toolbar = withOmission();
    expect(omissionTrigger(toolbar).outerHTML).toBe(OMISSION_BAR);
    expect(omissionMenuRow(toolbar).outerHTML).toBe(
      OMISSION_BAR.replace("<span>diagnostics</span>", "<span>Diagnostics</span>"),
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
      "<span>diagnostics</span>" +
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
    ).toBe(CAUGHT_BAR.replace("<span>diagnostics</span>", "<span>Diagnostics</span>"));
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
    // Guarantee 2 forces text in the menu — and only text, so the row loses
    // the readout today's default row paints. Intended, and pinned so it reads
    // as a decision rather than surfacing later as a regression.
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
    // The short bar word, the full label in the menu: the "which text" rule,
    // asserted rather than described.
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
   * A state that is not the empty one, under every preset: `data-dtb-incomplete`
   * follows the snapshot and not the preset, and the missing count still
   * reaches the name and the title. The preset chooses *whether* a value is
   * painted; the state chooses the word inside it.
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

  /**
   * Invariant 2, the point of this phase. The badge is live state rendered
   * after the contents, so it survives every preset — `"icon"` included, where
   * the chip has no text and no value left.
   */
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
    // The four fields, and nothing else: `revision`, `capturedAt` and the
    // whole `DiagnosticSnapshot` are implementation detail this callback
    // parameter deliberately does not weld in.
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
    // The consumer's node replaces the parts, not the chip: the dot, the state
    // attribute and the trigger's name are not theirs to lose. This is the
    // whole reason the parts are `Chip`'s children rather than its slots.
    expect(chip.querySelector('[data-dtb-part="diag-dot"]')).not.toBeNull();
    expect(chip.getAttribute("data-dtb-incomplete")).toBe("false");
    expect(trigger.getAttribute("aria-label")).toBe("Diagnostics");
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

  /**
   * Invariant 2's other half for this chip: `render` replaces the parts, so the
   * value span (and its `"1 missing"`) is the consumer's to lose — but
   * `data-dtb-incomplete` and the name are on the chip and the trigger, which
   * `render` never reaches.
   */
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
    // One construction, handed out as `fallback` and rendered as the preset —
    // so deferring is exact by construction rather than by careful mimicry,
    // which is the property the slot-based alternative could not have.
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
    // An icon-only control with no name is exactly what `/ext/a11y` would flag
    // on the toolbar's own bar.
    const trigger = barTrigger({ presentation: { preset: "icon", icon: ICON, name: () => "   " } });
    expect(trigger.getAttribute("aria-label")).toBe("Diagnostics");
  });
});
