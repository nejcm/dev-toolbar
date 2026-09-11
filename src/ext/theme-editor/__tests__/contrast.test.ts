import { describe, expect, it } from "vitest";
import {
  FLOOR,
  THEMES,
  type Tokens,
  contrastRatio,
  parseColor,
} from "../../../test-utils/contrast";
import { THEME_EDITOR_CSS } from "../css";
import { type TokenView, severityFor } from "../types";

/**
 * WCAG 1.4.3 for this panel's own stacks.
 *
 * `src/core/__tests__/contrast.test.ts` measures the tokens against core's
 * surfaces. It cannot see this: a token row is tinted by its severity, and the
 * tags inside it carry tints of their own, so a tag in a tinted row paints a
 * second translucent layer on the first. Every edited token row hit that —
 * `severityFor` returns `"override"` exactly when `view.overridden`, and the
 * `edited` tag renders on exactly the same condition, so `--dtb-accent` was
 * read on `--dtb-item-active-bg` over `--dtb-item-active-bg` over the panel at
 * 4.36:1 — axe, pointed at the open panel with that row scrolled into view,
 * called it a serious violation at 4.37 on a composited `#d8d8d8`. An orphaned
 * or refused token was the same shape in warn, at 4.10:1.
 *
 * A kit tag is `--dtb-font-size - 1px`, so 10px compact and 11px comfortable:
 * smaller than the bar's own text and still far under WCAG's 18.66px large-text
 * threshold, so the floor is 4.5:1 either way.
 *
 * Rather than restate the fix, this measures what the stylesheet says: the
 * grounds are resolved out of `THEME_EDITOR_CSS` by the cascade, so deleting
 * the rule that keeps a tag from restacking its row's tint fails here.
 */

/* --- a cascade small enough to be honest about ----------------------------- */

/**
 * The sheet's own selectors are chains of attribute-only compounds joined by
 * descendant or child combinators, which is little enough cascade to model
 * exactly. `KIT_CSS` — prepended to `THEME_EDITOR_CSS` — also carries
 * pseudo-classes and element selectors this cannot read; those rules are
 * recorded instead of parsed, and a guard below fails if any of them could
 * reach a row or a tag.
 */
type Compound = readonly string[];
type Combinator = "descendant" | "child";

interface Step {
  /** The combinator *before* this compound; meaningless on the first. */
  readonly combinator: Combinator;
  readonly compound: Compound;
}

interface Rule {
  readonly steps: readonly Step[];
  readonly decls: Readonly<Record<string, string>>;
  readonly order: number;
}

/** Selector parts that, if unreadable, would make this test's cascade a lie. */
const RELEVANT = ["thm-row", "thm-tag", 'data-dtb-kind="row"', 'data-dtb-kind="tag"'];

const unreadable: string[] = [];

function parseSelector(selector: string): readonly Step[] | null {
  const steps: Step[] = [];
  let combinator: Combinator = "descendant";
  for (const part of selector.trim().split(/\s+/)) {
    if (part === ">") {
      combinator = "child";
      continue;
    }
    const attrs = part.match(/\[[^\]]+\]/g);
    if (attrs === null || attrs.join("") !== part) return null;
    steps.push({ combinator, compound: attrs });
    combinator = "descendant";
  }
  return steps.length === 0 ? null : steps;
}

function parseRules(css: string): Rule[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/@media|@supports|@container/.test(stripped)) {
    throw new Error("theme-editor contrast: conditional at-rules are not modelled");
  }
  const body = stripped.replace(/@layer\s+[a-z-]+\s*\{/g, "");
  const rules: Rule[] = [];
  let order = 0;
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const prelude = (m[1] as string).replace(/\s+/g, " ").trim();
    if (prelude === "" || prelude.startsWith("@")) continue;
    const decls: Record<string, string> = {};
    for (const d of (m[2] as string).matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)) {
      decls[d[1] as string] = (d[2] as string).trim();
    }
    for (const selector of prelude.split(",")) {
      const steps = parseSelector(selector);
      if (steps === null) unreadable.push(selector.trim());
      else {
        rules.push({ steps, decls, order });
        order += 1;
      }
    }
  }
  if (rules.length < 20) throw new Error("theme-editor contrast: sheet did not parse");
  return rules;
}

const RULES = parseRules(THEME_EDITOR_CSS);

/** An element as its attribute selectors, outermost ancestor first. */
type Element = readonly Compound[];

function matchesAt(steps: readonly Step[], i: number, element: Element, j: number): boolean {
  if (j < 0) return false;
  const step = steps[i] as Step;
  if (!step.compound.every((attr) => (element[j] as Compound).includes(attr))) return false;
  if (i === 0) return true;
  if (step.combinator === "child") return matchesAt(steps, i - 1, element, j - 1);
  for (let k = j - 1; k >= 0; k -= 1) {
    if (matchesAt(steps, i - 1, element, k)) return true;
  }
  return false;
}

function matches(steps: readonly Step[], element: Element): boolean {
  return matchesAt(steps, steps.length - 1, element, element.length - 1);
}

/** The winning value of `property` on `element`, or undefined. */
function resolve(element: Element, property: string): string | undefined {
  let best: { spec: number; order: number; value: string } | undefined;
  for (const rule of RULES) {
    const value = rule.decls[property];
    if (value === undefined) continue;
    if (!matches(rule.steps, element)) continue;
    const spec = rule.steps.reduce((n, step) => n + step.compound.length, 0);
    if (best === undefined || spec > best.spec || (spec === best.spec && rule.order > best.order)) {
      best = { spec, order: rule.order, value };
    }
  }
  return best?.value;
}

/* --- the stacks ------------------------------------------------------------ */

const ROOT: Compound = ["[data-dev-toolbar]"];

const SEVERITIES = ["unknown", "warn", "bad", "override"] as const;
const TAGS = ["edited", "not-applied", "orphaned", "masked"] as const;

/** `var(--x)` -> `--x`; `transparent` and `none` -> no layer. */
function groundToken(value: string | undefined): string | null {
  if (value === undefined || value === "transparent" || value === "none") return null;
  const m = /^var\((--dtb-[a-z0-9-]+)\)$/.exec(value);
  if (m === null) throw new Error(`theme-editor contrast: unmodelled ground ${value}`);
  return m[1] as string;
}

function foregroundToken(value: string | undefined): string {
  const m = /^var\((--dtb-[a-z0-9-]+)\)$/.exec(value ?? "var(--dtb-fg)");
  if (m === null) throw new Error(`theme-editor contrast: unmodelled colour ${value}`);
  return m[1] as string;
}

interface Stack {
  readonly where: string;
  readonly fg: string;
  readonly ground: readonly string[];
}

/** Every (row severity, tag) the panel can paint, as a measurable stack. */
const STACKS: readonly Stack[] = SEVERITIES.flatMap((severity) =>
  TAGS.map((tag): Stack => {
    const row: Compound = [
      '[data-dtb-part="thm-row"]',
      '[data-dtb-kind="row"]',
      `[data-dtb-severity="${severity}"]`,
    ];
    const tagEl: Compound = [
      '[data-dtb-part="thm-tag"]',
      '[data-dtb-kind="tag"]',
      `[data-dtb-tag="${tag}"]`,
    ];
    const element: Element = [ROOT, row, tagEl];
    const ground = ["--dtb-panel-bg"];
    const rowGround = groundToken(resolve([ROOT, row], "background"));
    if (rowGround !== null) ground.push(rowGround);
    const tagGround = groundToken(resolve(element, "background"));
    if (tagGround !== null) ground.push(tagGround);
    return {
      where: `a${tag === "edited" ? "n" : ""} "${tag}" tag in a${severity === "unknown" || severity === "override" ? "n" : ""} ${severity} row`,
      fg: foregroundToken(resolve(element, "color")),
      ground,
    };
  }),
);

function ratio(tokens: Tokens, stack: Stack): number {
  let surface = parseColor(tokens[stack.ground[0] as string] as string);
  for (const layer of stack.ground.slice(1)) {
    const c = parseColor(tokens[layer] as string);
    const a = c[3];
    surface = [
      c[0] * a + surface[0] * (1 - a),
      c[1] * a + surface[1] * (1 - a),
      c[2] * a + surface[2] * (1 - a),
      1,
    ];
  }
  return contrastRatio(parseColor(tokens[stack.fg] as string), surface);
}

function shortfalls(tokens: Tokens): string[] {
  return STACKS.filter((s) => ratio(tokens, s) < FLOOR.text).map(
    (s) =>
      `${s.fg} on ${s.ground.join(" over ")} (${s.where}): ${ratio(tokens, s).toFixed(2)}:1, needs ${FLOOR.text}:1`,
  );
}

/* --- the guards ------------------------------------------------------------ */

describe("theme-editor contrast", () => {
  // Vacuity: the cascade above actually reads this sheet, and the stacks it
  // produces are the ones the panel paints.
  // The rules this cascade could not read must be rules that cannot reach a
  // row or a tag; otherwise the grounds below are resolved from half a sheet.
  it("reads every rule that could reach a row or a tag", () => {
    expect(unreadable.filter((s) => RELEVANT.some((part) => s.includes(part)))).toEqual([]);
  });

  it("resolves the grounds out of the stylesheet", () => {
    expect(STACKS).toHaveLength(SEVERITIES.length * TAGS.length);
    // A row with no severity tint: the tag's own tint over the panel.
    const plain = STACKS.find((s) => s.where === 'a "masked" tag in an unknown row');
    expect(plain?.ground).toEqual(["--dtb-panel-bg", "--dtb-warn-bg"]);
    // ...and inside a tinted row the tag's own ground is opaque, so
    // compositing the stack lands back on the panel and the row's tint is
    // erased rather than stacked.
    const edited = STACKS.find((s) => s.where === 'an "edited" tag in an override row');
    expect(edited?.ground).toEqual(["--dtb-panel-bg", "--dtb-item-active-bg", "--dtb-panel-bg"]);
    expect(edited?.fg).toBe("--dtb-accent");
    const [, lightTokens] = THEMES[0] as readonly [string, Tokens];
    expect(ratio(lightTokens, edited as Stack)).toBeCloseTo(
      contrastRatio(
        parseColor(lightTokens["--dtb-accent"] as string),
        parseColor(lightTokens["--dtb-panel-bg"] as string),
      ),
      10,
    );
  });

  // The condition the defect rode in on: the `edited` tag and the `override`
  // severity fire on one and the same field, so this stack is not a corner.
  it("paints an edited tag on every overridden row", () => {
    const view: TokenView = {
      name: "--app-accent",
      label: "Accent",
      group: "Colour",
      type: "color",
      base: "#000000",
      defaultValue: null,
      override: "#4652c9",
      effective: "#4652c9",
      overridden: true,
      effectiveText: "#4652c9",
      baseText: "#000000",
      defaultText: "",
      masked: false,
      metadataMasked: false,
      refusal: null,
      orphaned: false,
    };
    // `severityFor` tints the row on the same field `ui.tsx` renders the tag
    // on, so "an edited tag inside an override row" is every edited row.
    expect(severityFor(view)).toBe("override");
  });

  it.each(THEMES)("clears WCAG AA in %s", (_name, tokens) => {
    expect(shortfalls(tokens)).toEqual([]);
  });

  // Mutation proof: restoring the restack — the shipped defect — fails here.
  it("fails when a tag restacks its row's tint", () => {
    const restacked = STACKS.map((s) =>
      s.where === 'an "edited" tag in an override row'
        ? { ...s, ground: ["--dtb-panel-bg", "--dtb-item-active-bg", "--dtb-item-active-bg"] }
        : s,
    );
    const failing = restacked.filter((s) => ratio(THEMES[0]?.[1] as Tokens, s) < FLOOR.text);
    expect(failing.map((s) => s.where)).toEqual(['an "edited" tag in an override row']);
  });
});
