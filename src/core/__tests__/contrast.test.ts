import { describe, expect, it } from "vitest";
import {
  FLOOR,
  type Tokens,
  THEMES,
  composite,
  contrastRatio,
  darkExplicit,
  darkPreferred,
  light,
  parseColor,
  ratioOn,
} from "../../test-utils/contrast";

/**
 * WCAG 1.4.3 / 1.4.11 over the shipped design tokens.
 *
 * The toolbar is invisible to its own scanner — `/ext/a11y` defaults to
 * `TOOLBAR_EXCLUDE`, so an axe run inside a consumer's app never measures the
 * bar — and a consumer running axe over their page does not measure it either.
 * That is how `--dtb-warn` shipped at 3.79:1 against the bar. So the ratios are
 * computed here, from the declarations themselves: this file is the only thing
 * standing between a token edit and a contrast regression.
 *
 * Both densities are covered by one assertion: the bar is 11px compact and
 * 12px comfortable, and WCAG's large-text exemption starts at 18.66px (14pt
 * bold / 18pt regular), so every string the toolbar paints is small text and
 * owes 4.5:1. Non-text — the severity dot, a sparkline stroke — owes 3:1.
 *
 * Scope, stated so the gaps are known rather than assumed:
 *
 * - **Core's own surfaces only.** An extension sheet that stacks a token's
 *   tint on another one is its own problem and needs its own guard; see
 *   `src/ext/theme-editor/__tests__/contrast.test.ts`, which exists because a
 *   tag inside a tinted row restacked that row's tint and shipped at 4.36:1.
 * - **`--dtb-border` and `--dtb-bar-border` are unguarded.** They are the only
 *   colour tokens no pair below names. 1.4.11 asks 3:1 of a border that is the
 *   *only* thing identifying a control; the toolbar's borders separate
 *   surfaces that are already distinguishable by ground, so they are decorative
 *   under that reading — but that is a judgement, not a measurement, and it is
 *   not what this file proves. Out of scope deliberately.
 * - **`:active` / pressed is AA non-conformant by design.** It is not measured
 *   below and it does not pass: no value of `--dtb-item-pressed-bg` both clears
 *   4.5:1 under every foreground and stays a visible third step past hover and
 *   selected. It lasts only while the pointer is held and axe never evaluates
 *   it. That is a trade, not a pass.
 */

// --- the pairs -----------------------------------------------------------

interface Pair {
  readonly kind: "text" | "nontext";
  readonly fg: string;
  readonly ground: readonly string[];
  readonly where: string;
}

const BAR = ["--dtb-bg"];
const PANEL = ["--dtb-panel-bg"];
const MENU = ["--dtb-menu-bg"];
const FIELD = ["--dtb-panel-bg", "--dtb-field-bg"];
/**
 * A trigger whose panel is open, and a selected row in the overflow menu. Not
 * an interaction state that passes under the pointer: `aria-expanded="true"`
 * persists for as long as the panel does, so every string inside that chip is
 * read on this ground. Leaving it out is what let a selected chip ship with
 * --dtb-muted at 3.47:1 and --dtb-warn at 2.82:1 while the untinted bar was
 * being measured and declared clean.
 */
const SELECTED_BAR = ["--dtb-bg", "--dtb-item-active-bg"];
const SELECTED_PANEL = ["--dtb-panel-bg", "--dtb-item-active-bg"];
/** The one banner with no tint of its own; see the note on --dtb-accent. */
const OVERRIDE_BANNER = SELECTED_PANEL;
/**
 * Hover. Transient under the pointer and axe evaluates it too — but
 * `/ext/flags` paints `--dtb-item-hover-bg` *persistently* on a promoted flag
 * that carries an override, with `--dtb-accent` as its label, so this ground
 * is not only a pointer state. Measured for its own sake as well: without
 * these pairs, taking --dtb-item-hover-bg from 4% to 40% passed this suite in
 * silence.
 */
const HOVER_BAR = ["--dtb-bg", "--dtb-item-hover-bg"];
const HOVER_PANEL = ["--dtb-panel-bg", "--dtb-item-hover-bg"];
const HOVER_MENU = ["--dtb-menu-bg", "--dtb-item-hover-bg"];

const text = (fg: string, ground: readonly string[], where: string): Pair => ({
  kind: "text",
  fg,
  ground,
  where,
});
const nontext = (fg: string, ground: readonly string[], where: string): Pair => ({
  kind: "nontext",
  fg,
  ground,
  where,
});

const PAIRS: readonly Pair[] = [
  // Body text.
  text("--dtb-fg", BAR, "a chip label in the bar"),
  text("--dtb-fg", PANEL, "panel body text"),
  text("--dtb-fg", MENU, "a row in the overflow menu"),
  text("--dtb-fg", FIELD, "text typed into a field"),
  text("--dtb-muted", BAR, "a muted chip label in the bar"),
  text("--dtb-muted", PANEL, "a panel's secondary text and empty state"),
  text("--dtb-muted", MENU, "a muted row in the overflow menu"),
  text("--dtb-muted", FIELD, "a field's placeholder"),

  // The severity family as text, on the untinted surfaces.
  text("--dtb-ok", BAR, 'a kit value at "ok" in the bar'),
  text("--dtb-ok", PANEL, 'a kit value at "ok" in a panel'),
  text("--dtb-warn", BAR, 'a kit value at "warn" in the bar — env-value, the reported defect'),
  text("--dtb-warn", PANEL, "metrics and diagnostics warn text in a panel"),
  text("--dtb-danger", BAR, 'a kit value at "bad" in the bar'),
  text("--dtb-danger", PANEL, "danger text in a panel"),
  text("--dtb-accent", BAR, 'a kit value at "override" in the bar'),
  text("--dtb-accent", PANEL, "accent text in a panel"),

  // The severity family as text on its own tint: badges, banners, the error chip.
  text("--dtb-ok", [...BAR, "@tint"], 'an "ok" badge in the bar'),
  text("--dtb-ok", [...PANEL, "@tint"], 'an "ok" banner in a panel'),
  text("--dtb-warn", [...BAR, "@tint"], 'a "warn" badge in the bar'),
  text("--dtb-warn", [...PANEL, "@tint"], 'a "warn" banner in a panel'),
  text("--dtb-danger", [...BAR, "@tint"], "the error chip and its retry button in the bar"),
  text("--dtb-danger", [...PANEL, "@tint"], "the error chip and a danger banner in a panel"),
  text("--dtb-accent", OVERRIDE_BANNER, 'the "override" banner, which has no tint of its own'),

  // Every foreground again, on a trigger whose panel is open. This is the set
  // an axe run with the bar in its context reports the moment a panel opens.
  text("--dtb-fg", SELECTED_BAR, "a chip label in a trigger whose panel is open"),
  text("--dtb-muted", SELECTED_BAR, "a muted chip label in a trigger whose panel is open"),
  text("--dtb-ok", SELECTED_BAR, 'a kit value at "ok" in a trigger whose panel is open'),
  text("--dtb-warn", SELECTED_BAR, 'a kit value at "warn" in a trigger whose panel is open'),
  text("--dtb-danger", SELECTED_BAR, 'a kit value at "bad" in a trigger whose panel is open'),
  text("--dtb-accent", SELECTED_BAR, 'a kit value at "override" in a trigger whose panel is open'),
  text("--dtb-fg", SELECTED_PANEL, "a selected row in the overflow menu"),
  text("--dtb-muted", SELECTED_PANEL, "a muted selected row in the overflow menu"),

  // And on a hovered one. --dtb-accent on HOVER_BAR is the promoted flag that
  // carries an override, where the ground is not a pointer state at all.
  text("--dtb-fg", HOVER_BAR, "a chip label in a hovered trigger"),
  text("--dtb-muted", HOVER_BAR, "a muted chip label in a hovered trigger"),
  text("--dtb-ok", HOVER_BAR, 'a kit value at "ok" in a hovered trigger'),
  text("--dtb-warn", HOVER_BAR, 'a kit value at "warn" in a hovered trigger'),
  text("--dtb-danger", HOVER_BAR, 'a kit value at "bad" in a hovered trigger'),
  text("--dtb-accent", HOVER_BAR, "the promoted flag's label while it carries an override"),
  text("--dtb-fg", HOVER_MENU, "a hovered row in the overflow menu"),
  text("--dtb-muted", HOVER_MENU, "a muted hovered row in the overflow menu"),
  text("--dtb-fg", HOVER_PANEL, "a hovered row inside a panel"),
  text("--dtb-muted", HOVER_PANEL, "a muted hovered row inside a panel"),

  // Non-text: 1.4.11, 3:1. The kit dot is the whole indicator for a severity
  // in a collapsed chip, and metrics strokes a sparkline in these colours.
  // These are strictly weaker than the text pairs above on the same fg and
  // ground; they are kept because they are what the *dot* and the *stroke* owe
  // and would be the surviving floor if a colour ever stopped being text.
  nontext("--dtb-muted", BAR, 'a kit dot at "unknown" in the bar'),
  nontext("--dtb-muted", PANEL, 'a kit dot at "unknown" in a panel'),
  nontext("--dtb-ok", BAR, 'a kit dot at "ok" in the bar'),
  nontext("--dtb-ok", PANEL, 'a kit dot at "ok" in a panel'),
  nontext("--dtb-warn", BAR, 'a kit dot at "warn" in the bar; the metrics sparkline'),
  nontext("--dtb-warn", PANEL, 'a kit dot at "warn" in a panel; the metrics sparkline'),
  nontext("--dtb-danger", BAR, 'a kit dot at "bad" in the bar; the metrics sparkline'),
  nontext("--dtb-danger", PANEL, 'a kit dot at "bad" in a panel; the metrics sparkline'),
  nontext("--dtb-accent", BAR, 'a kit dot at "override"; the focus ring against the bar'),
  nontext("--dtb-accent", PANEL, 'a kit dot at "override"; the focus ring in a panel'),
];

function measure(tokens: Tokens, pair: Pair): { ratio: number; floor: number; label: string } {
  return {
    ratio: ratioOn(tokens, pair.fg, pair.ground),
    floor: FLOOR[pair.kind],
    label: `${pair.fg} on ${pair.ground.join(" over ")} (${pair.where})`,
  };
}

/** Every pair that falls short, as readable lines. */
function shortfalls(tokens: Tokens): string[] {
  return PAIRS.map((pair) => measure(tokens, pair))
    .filter((m) => m.ratio < m.floor)
    .map((m) => `${m.label}: ${m.ratio.toFixed(2)}:1, needs ${m.floor}:1`);
}

/**
 * Every token the dark blocks restate. Written out rather than derived, so
 * that renaming or dropping one in *both* blocks fails here: the blocks are
 * copies of each other, and comparing them to each other cannot catch an edit
 * applied to both. A token missing from dark silently keeps its light value —
 * which for a tint is a light-mode alpha over a near-black ground.
 */
const DARK_KEYS = [
  "--dtb-accent",
  "--dtb-bar-border",
  "--dtb-bg",
  "--dtb-border",
  "--dtb-danger",
  "--dtb-danger-bg",
  "--dtb-fg",
  "--dtb-field-bg",
  "--dtb-item-active-bg",
  "--dtb-item-hover-bg",
  "--dtb-item-pressed-bg",
  "--dtb-menu-bg",
  "--dtb-menu-shadow",
  "--dtb-muted",
  "--dtb-ok",
  "--dtb-ok-bg",
  "--dtb-panel-bg",
  "--dtb-shadow",
  "--dtb-warn",
  "--dtb-warn-bg",
] as const;

// --- the guards ----------------------------------------------------------

describe("token contrast", () => {
  // Vacuity guard: the maths is right before it is trusted to pass anything.
  it("computes the ratios WCAG defines", () => {
    const white = parseColor("#ffffff");
    const black = parseColor("#000000");
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
    // #767676 is the canonical smallest grey that clears 4.5:1 on white.
    expect(contrastRatio(parseColor("#767676"), white)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(parseColor("#777777"), white)).toBeLessThan(4.5);
    // Alpha is composited, not ignored: 50% black over white is mid grey.
    expect(composite(parseColor("rgba(0, 0, 0, 0.5)"), white)[0]).toBeCloseTo(127.5, 5);
  });

  it("reads every token every pair names, in every theme", () => {
    expect(PAIRS.length).toBeGreaterThan(40);
    for (const [name, tokens] of THEMES) {
      for (const pair of PAIRS) {
        expect(() => measure(tokens, pair), `${name}: ${pair.fg}`).not.toThrow();
      }
    }
  });

  // The two dark blocks are copies of each other by hand. If they drift, the
  // explicit theme and the OS-preferred one disagree and only one is measured.
  it("keeps the two dark blocks identical", () => {
    expect(darkPreferred).toEqual(darkExplicit);
  });

  // ...and comparing them to each other is not enough: an edit applied to both
  // stays invisible to that. Pin the key set instead.
  it.each([
    ["explicit", darkExplicit],
    ["prefers-color-scheme", darkPreferred],
  ])("restates exactly the expected tokens in the %s dark block", (_name, tokens) => {
    expect(Object.keys(tokens).sort()).toEqual([...DARK_KEYS]);
  });

  it.each(THEMES)("clears WCAG AA in %s", (_name, tokens) => {
    expect(shortfalls(tokens)).toEqual([]);
  });

  // Mutation proof: the assertion above is not vacuous. Each of these is a
  // value the stylesheet actually shipped, or one plausibly reached for.
  it.each([
    ["--dtb-warn", "#a8730c", "the amber that shipped at 3.79:1 on the bar"],
    ["--dtb-ok", "#1e8a54", "the green that shipped at 4.04:1 on the bar"],
    ["--dtb-accent", "#5e6ad2", "the indigo that shipped at 4.35:1 on the bar"],
    ["--dtb-danger", "#c0392b", "the red that shipped at 4.23:1 on its own tint"],
    ["--dtb-muted", "#6b6f76", "the grey that shipped at 3.47:1 on a selected chip"],
    ["--dtb-item-active-bg", "rgba(0, 0, 0, 0.13)", "the selected ground that shipped"],
    ["--dtb-item-hover-bg", "rgba(0, 0, 0, 0.4)", "a hover ground deepened past what it can carry"],
  ])("fails when %s is set back to %s", (token, value) => {
    const mutated = { ...light, [token]: value };
    const failures = shortfalls(mutated);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join("\n")).toContain(token);
    // And nothing else was collaterally broken by the mutation: every pair
    // that failed names the mutated token, as its foreground or in its ground.
    for (const line of failures) expect(line).toContain(token);
  });

  it("fails when a tint is thickened past what its colour can carry", () => {
    const mutated = { ...light, "--dtb-warn-bg": "rgba(133, 91, 10, 0.6)" };
    expect(shortfalls(mutated).join("\n")).toContain("--dtb-warn on --dtb-bg over @tint");
  });
});
