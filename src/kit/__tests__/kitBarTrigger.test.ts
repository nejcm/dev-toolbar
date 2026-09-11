import { describe, expect, it } from "vitest";
import { CORE_CSS } from "../../core/css";
import { splitTopLevel, styleRules } from "../../test-utils/css-rules";
import { KIT_CSS } from "../css";

/**
 * The kit's `action` and `tag` resets must never land on a bar trigger.
 *
 * `Action` (and `CopyButton`) stamp `data-dtb-kind="action"`, whose kit rule is
 * the *panel* control reset; `Tag` stamps `data-dtb-kind="tag"`, a small padded
 * marker one step down in font size. An extension author who reaches for either
 * to build a `compact` slot puts it on an element that also carries
 * `data-dtb-part="trigger"`, which core styles as a bar chip. Before the
 * `:not()` guards the selectors tied at (0,2,0) inside the same
 * `@layer dev-toolbar`, so source order decided — and the kit sheet is injected
 * after core's (confirmed in Chromium: `core`, `kit`, then the extension
 * sheets). The kit rule won: an `Action` chip painted a 1px frame no other bar
 * chip has and measured 8px wider (it cost the playground a Linux-only CI
 * failure, `overflow.spec.ts`, commit c9542a9); a `Tag` chip measured 12px
 * narrower. A consumer of the published kit would have had no signal at all.
 *
 * jsdom does not resolve `var()` and does not resolve this cascade — asked for
 * `padding` on exactly this element it answers `"0"`, and for `border-width`,
 * `16px` — so `getComputedStyle` cannot see the bug. What follows is a cascade
 * small enough to be honest about: the two sheets in injection order, read by
 * `test-utils/css-rules` (which already fails closed on anything it cannot
 * model), restricted to unconditional rules whose selectors are attribute-only
 * compounds — optionally negated — joined by descendant or child combinators,
 * and resolved by specificity then source order. Everything else is recorded
 * rather than parsed, and the escape-hatch test below fails the suite if any
 * recorded rule declares geometry at all, `GEOMETRY_ALLOWLIST` aside.
 */

/* --- the cascade ----------------------------------------------------------- */

/** The geometry that separates a bar chip from a panel button or a tag. */
const GEOMETRY = [
  "padding",
  "padding-block",
  "padding-inline",
  "border",
  "border-width",
  "border-block",
  "border-inline",
  "min-height",
  "height",
  "font-size",
] as const;

/**
 * Whether a *declaration* counts as geometry for the escape-hatch check —
 * deliberately wider than `GEOMETRY`, which is only the table's columns. Any
 * longhand of a box dimension counts; `border-radius`, `-color` and `-style`
 * paint rather than measure, so they do not.
 */
function declaresGeometry(property: string): boolean {
  if (/^border-(radius|color|style)/.test(property)) return false;
  return /^(padding|border|margin|width|height|min-width|min-height|max-width|max-height|inline-size|block-size|box-sizing|font-size|font)(-|$)/.test(
    property,
  );
}

/** One attribute selector, parsed: `[a]` is a name, `[a="b"]` a name and value. */
interface Attr {
  readonly name: string;
  /** `undefined` means "present with any value". */
  readonly value: string | undefined;
}

interface Compound {
  /** Attribute conditions the element must satisfy. */
  readonly attrs: readonly Attr[];
  /** Attribute conditions the element must *not* satisfy. */
  readonly nots: readonly Attr[];
}

interface Step {
  /** The combinator *before* this compound; meaningless on the first. */
  readonly combinator: "descendant" | "child";
  readonly compound: Compound;
}

interface Rule {
  readonly steps: readonly Step[];
  readonly decls: Readonly<Record<string, string>>;
  readonly order: number;
}

const ATTR_TEXT = /\[[^\]]+\]/y;

/**
 * `[name]` or `[name="value"]`, parsed into the two so they compare
 * semantically: string equality would read `[data-dtb-part]` and
 * `[data-dtb-part="trigger"]` as unrelated tokens, and a guard written the
 * first way would look like it matched nothing.
 */
function parseAttr(text: string): Attr | null {
  const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(text);
  if (m === null) return null;
  return { name: m[1] as string, value: m[2] };
}

/** `[a][b]:not([c])` -> a compound; null for anything this cannot read. */
function parseCompound(part: string): Compound | null {
  const attrs: Attr[] = [];
  const nots: Attr[] = [];
  let i = 0;
  while (i < part.length) {
    if (part.startsWith(":not(", i)) {
      const close = part.indexOf(")", i);
      if (close === -1) return null;
      const attr = parseAttr(part.slice(i + 5, close));
      if (attr === null) return null;
      nots.push(attr);
      i = close + 1;
      continue;
    }
    ATTR_TEXT.lastIndex = i;
    const m = ATTR_TEXT.exec(part);
    if (m === null) return null;
    const attr = parseAttr(m[0]);
    if (attr === null) return null;
    attrs.push(attr);
    i = ATTR_TEXT.lastIndex;
  }
  return attrs.length === 0 && nots.length === 0 ? null : { attrs, nots };
}

function parseSelector(selector: string): readonly Step[] | null {
  const steps: Step[] = [];
  let combinator: Step["combinator"] = "descendant";
  for (const part of selector.trim().split(/\s+/)) {
    if (part === ">") {
      combinator = "child";
      continue;
    }
    if (part === "+" || part === "~") return null;
    const compound = parseCompound(part);
    if (compound === null) return null;
    steps.push({ combinator, compound });
    combinator = "descendant";
  }
  return steps.length === 0 ? null : steps;
}

/** Split on top-level `;`, ignoring any inside a string or parentheses. */
function splitDeclarations(block: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (const char of block) {
    if (quote !== "") {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === ";" && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current.trim());
  return parts.filter((part) => part !== "");
}

/** Fails closed, like the scanner it sits on: an unreadable declaration throws. */
function parseDeclarations(block: string, prelude: string): Record<string, string> {
  const decls: Record<string, string> = {};
  for (const text of splitDeclarations(block)) {
    const m = /^([\w-]+)\s*:\s*([\s\S]+)$/.exec(text);
    if (m === null) throw new Error(`unreadable declaration "${text}" in "${prelude}"`);
    decls[m[1] as string] = (m[2] as string).replace(/\s+/g, " ").trim();
  }
  return decls;
}

const rules: Rule[] = [];
/** Selector -> the declarations of a rule this cascade could not parse. */
const unreadable: Array<readonly [string, Readonly<Record<string, string>>]> = [];
let order = 0;

/** The one at-rule context whose rules always apply. */
const UNCONDITIONAL = "@layer dev-toolbar";

/**
 * Both sheets, in the order the DOM receives them, walked by the shared
 * `styleRules` scanner rather than a second regex parser — it tracks enclosing
 * at-rules and throws on anything it does not model, which is exactly the
 * fail-closed floor this cascade needs under it.
 *
 * A rule inside any at-rule other than the plain `@layer dev-toolbar` is
 * conditional, so it is recorded unreadable rather than resolved: core's
 * `@media (prefers-reduced-motion: reduce)` block lands there, and so would a
 * `@media` rule that set padding on a trigger — which the escape-hatch test
 * below would then fail on, because that selector is not allowlisted.
 */
function collect(css: string): void {
  for (const rule of styleRules(css)) {
    const conditional = rule.enclosing.some((at) => at !== UNCONDITIONAL);
    const decls = parseDeclarations(rule.block, rule.prelude);
    if (Object.keys(decls).length === 0) continue;
    // Top-level commas only: the list inside `:where(h1, h2, ...)` is one
    // selector, and splitting it would file half a rule under the other half.
    for (const trimmed of splitTopLevel(rule.prelude, ",")) {
      const steps = conditional ? null : parseSelector(trimmed);
      if (steps === null) unreadable.push([trimmed, decls]);
      else {
        rules.push({ steps, decls, order });
        order += 1;
      }
    }
  }
}

collect(CORE_CSS);
collect(KIT_CSS);

/** An element as its attribute selectors, outermost ancestor first. */
type Element = readonly (readonly string[])[];

/** The fixtures are written as selector text; parsing them fails closed too. */
function parseElement(element: Element): readonly (readonly Attr[])[] {
  return element.map((level) =>
    level.map((text) => {
      const attr = parseAttr(text);
      if (attr === null) throw new Error(`unreadable fixture attribute "${text}"`);
      return attr;
    }),
  );
}

type ParsedElement = readonly (readonly Attr[])[];

/** `[name]` is satisfied by any value; `[name="v"]` only by that value. */
function attrMatches(condition: Attr, attrs: readonly Attr[]): boolean {
  return attrs.some(
    (a) =>
      a.name === condition.name && (condition.value === undefined || a.value === condition.value),
  );
}

function compoundMatches(compound: Compound, attrs: readonly Attr[]): boolean {
  return (
    compound.attrs.every((a) => attrMatches(a, attrs)) &&
    compound.nots.every((a) => !attrMatches(a, attrs))
  );
}

function matchesAt(steps: readonly Step[], i: number, element: ParsedElement, j: number): boolean {
  if (j < 0) return false;
  const step = steps[i] as Step;
  if (!compoundMatches(step.compound, element[j] as readonly Attr[])) return false;
  if (i === 0) return true;
  if (step.combinator === "child") return matchesAt(steps, i - 1, element, j - 1);
  for (let k = j - 1; k >= 0; k -= 1) if (matchesAt(steps, i - 1, element, k)) return true;
  return false;
}

function matches(steps: readonly Step[], element: ParsedElement): boolean {
  return matchesAt(steps, steps.length - 1, element, element.length - 1);
}

/** `:not()` takes the specificity of its argument, so a `[attr]` arg counts 1. */
function specificity(steps: readonly Step[]): number {
  return steps.reduce((n, s) => n + s.compound.attrs.length + s.compound.nots.length, 0);
}

/** The winning value of `property` on `element`, or undefined. */
function resolve(element: Element, property: string): string | undefined {
  const parsed = parseElement(element);
  let best: { spec: number; order: number; value: string } | undefined;
  for (const rule of rules) {
    const value = rule.decls[property];
    if (value === undefined) continue;
    if (!matches(rule.steps, parsed)) continue;
    const spec = specificity(rule.steps);
    if (best === undefined || spec > best.spec || (spec === best.spec && rule.order > best.order)) {
      best = { spec, order: rule.order, value };
    }
  }
  return best?.value;
}

/** Every geometry property any rule sets on `element`, winner only. */
function geometryOf(element: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const property of GEOMETRY) {
    const value = resolve(element, property);
    if (value !== undefined) out[property] = value;
  }
  return out;
}

/* --- the elements ---------------------------------------------------------- */

const ROOT = ["[data-dev-toolbar]"] as const;
const KIND_ACTION = '[data-dtb-kind="action"]';
const KIND_TAG = '[data-dtb-kind="tag"]';
const PART_TRIGGER = '[data-dtb-part="trigger"]';

/** An `Action` used, wrongly but plausibly, as an extension's bar trigger. */
const ACTION_AS_TRIGGER: Element = [ROOT, [PART_TRIGGER, KIND_ACTION]];
/** A `Tag` used as a bar readout — `span[data-dtb-part="trigger"]` is sanctioned. */
const TAG_AS_TRIGGER: Element = [ROOT, [PART_TRIGGER, KIND_TAG]];
/** The bar trigger every other extension writes: a plain element, no kind. */
const PLAIN_TRIGGER: Element = [ROOT, [PART_TRIGGER]];
/**
 * An `Action` where it belongs: inside a panel, and carrying the namespaced
 * part every first-party panel button ships (`env-action`, `flag-action`,
 * `diag-action`, `thm-action`, `metrics-action`). The part matters: a guard
 * written `:not([data-dtb-part])` rather than `:not([data-dtb-part="trigger"])`
 * would strip the reset off all five, and a fixture with no part at all would
 * never notice.
 */
const PANEL_ACTION: Element = [
  ROOT,
  ['[data-dtb-part="panel"]'],
  ['[data-dtb-part="env-action"]', KIND_ACTION],
];
/** A `Tag` where it belongs: inside a panel. */
const PANEL_TAG: Element = [ROOT, ['[data-dtb-part="panel"]'], [KIND_TAG]];
/** A kit `Chip` used as a bar trigger — legitimate, and deliberately untouched. */
const CHIP_AS_TRIGGER: Element = [ROOT, [PART_TRIGGER, '[data-dtb-kind="chip"]']];

/**
 * Unreadable rules that declare geometry and are allowed to. Exact selector
 * text, so a *new* rule of the same shape fails closed instead of inheriting
 * the exemption.
 *
 * Core's button reset is the only entry. It is
 * `:where(button):where(:not([data-dtb-embed] *))` — zero specificity by
 * construction (styles.css, "the button face"), so every part rule and every
 * kind rule outranks it and it can never be the winner on a bar chip. A rule
 * of that *shape* without the zero specificity — `[data-dtb-part="item"] >
 * button`, say, at (0,2,1) — would beat core's trigger rule in a browser, and
 * is precisely what this list exists to catch.
 */
const GEOMETRY_ALLOWLIST: readonly string[] = [
  // Core's element-level defaults, every one of them zero-specificity by
  // construction (`:where(...)`, see styles.css and docs/embedding.md), so
  // every part rule and every kind rule outranks them and none can win on a
  // bar chip. A rule of this *shape* without the zero specificity —
  // `[data-dtb-part="item"] > button { padding }`, say, at (0,2,1) — would beat
  // core's trigger rule in a browser, and is exactly what this list catches.
  "[data-dev-toolbar] :where(:not([data-dtb-embed] *))",
  "[data-dev-toolbar] :where(:not([data-dtb-embed] *))::before",
  "[data-dev-toolbar] :where(:not([data-dtb-embed] *))::after",
  "[data-dev-toolbar] :where(button):where(:not([data-dtb-embed] *))",
  "[data-dev-toolbar] :where(blockquote, dd, dl, figure, h1, h2, h3, h4, h5, h6, p, pre):where(:not([data-dtb-embed] *))",
  "[data-dev-toolbar] :where(menu, ol, ul):where(:not([data-dtb-embed] *))",
  '[data-dev-toolbar] :where(input:not([type="color"]):not([type="checkbox"])):where(:not([data-dtb-embed] *))',
  "[data-dev-toolbar] :where(select):where(:not([data-dtb-embed] *))",
  "[data-dev-toolbar] :where(textarea):where(:not([data-dtb-embed] *))",

  // Generated boxes, not the element: a `::before`/`::after` separator or
  // legend rule sizes its own pseudo-element and cannot move the chip's box.
  '[data-dev-toolbar] [data-dtb-part="region"] > [data-dtb-part="item"]:not(:first-child)::before',
  '[data-dev-toolbar] [data-dtb-part="region"] > [data-dtb-part="overflow-button"]:not(:first-child)::before',
  "[data-dev-toolbar] [data-dtb-legend]::after",

  // Kit rules whose subject cannot be a bar trigger: the child of a glyph, a
  // `<dd>` inside a `rows` grid, and a panel `toolbar` in last position. A
  // trigger is none of those, and all three are inside a panel.
  '[data-dev-toolbar] [data-dtb-kind="glyph"] > *',
  '[data-dev-toolbar] [data-dtb-kind="rows"] dd',
  '[data-dev-toolbar] [data-dtb-kind="rows"] dd > [data-dtb-kind="action"]',
  '[data-dev-toolbar] [data-dtb-kind="toolbar"]:last-child:not(:only-child)',
];

describe("the kit action reset and core's bar trigger", () => {
  it("parses enough of both sheets to be a cascade", () => {
    expect(rules.length).toBeGreaterThan(60);
  });

  /**
   * The escape hatch has to stay shut. Not "does the selector mention the
   * trigger" — a rule can reach a bar chip without naming it, and
   * `[data-dtb-part="item"] > button { padding }` at (0,2,1) beats core's
   * (0,2,0) trigger rule while mentioning neither `trigger` nor `action`. So:
   * *any* unreadable rule that declares geometry fails, unless its exact
   * selector text is allowlisted above.
   */
  it("has no unparsed rule that declares geometry", () => {
    const dangerous = unreadable.filter(
      ([selector, decls]) =>
        !GEOMETRY_ALLOWLIST.includes(selector) && Object.keys(decls).some(declaresGeometry),
    );
    expect(dangerous).toEqual([]);
  });

  /** Not vacuous: the allowlisted rule really is in the unreadable pile. */
  it("allowlists a rule that is actually there", () => {
    for (const selector of GEOMETRY_ALLOWLIST) {
      expect(unreadable.map(([s]) => s)).toContain(selector);
    }
  });

  /** And conditional rules really are held out, rather than read as absolute. */
  it("records a conditional rule as unreadable", () => {
    expect(unreadable.map(([s]) => s)).toContain('[data-dev-toolbar] [data-dtb-part="trigger"]');
  });

  it.each([
    ["an Action", ACTION_AS_TRIGGER],
    ["a Tag", TAG_AS_TRIGGER],
    ["a Chip", CHIP_AS_TRIGGER],
  ])("leaves %s used as a bar trigger with the bar's own geometry", (_name, element) => {
    expect(geometryOf(element)).toEqual(geometryOf(PLAIN_TRIGGER));
  });

  /**
   * Spelled out, so the failure names the defect rather than a diff of two
   * computed objects: the bar's 7px/9px padding token and no border, never the
   * panel's 10px/12px token, its 1px frame or its min-height, and never the
   * tag's `--dtb-space-1` or its one-step-down font size.
   */
  it.each([
    ["an Action", ACTION_AS_TRIGGER],
    ["a Tag", TAG_AS_TRIGGER],
  ])("gives %s on the bar the bar's padding, no border and no font step", (_name, element) => {
    expect(resolve(element, "padding")).toBe("0 var(--dtb-item-padding-x)");
    expect(resolve(element, "border")).toBe("0");
    expect(resolve(element, "min-height")).toBeUndefined();
    expect(resolve(element, "font-size")).toBeUndefined();
  });

  it("still applies the panel control reset to an Action in a panel", () => {
    expect(resolve(PANEL_ACTION, "padding")).toBe("0 var(--dtb-control-padding-x)");
    expect(resolve(PANEL_ACTION, "border")).toBe("1px solid var(--dtb-border)");
    expect(resolve(PANEL_ACTION, "min-height")).toBe("var(--dtb-control-height)");
  });

  it("still applies the tag reset to a Tag in a panel", () => {
    expect(resolve(PANEL_TAG, "padding")).toBe("0 var(--dtb-space-1)");
    expect(resolve(PANEL_TAG, "font-size")).toBe("calc(var(--dtb-font-size) - 1px)");
  });

  /**
   * Where the line is drawn. `chip` is the other kind an extension really does
   * put on a bar element, and it is pixel-neutral there — it declares no
   * geometry of its own that core's trigger rule does not already declare — so
   * it needs no guard, and giving it one would be a change with no defect
   * behind it. The row above proves that; this one proves the guard is not
   * simply being handed out to everything.
   */
  it("leaves the chip kind unguarded", () => {
    expect(KIT_CSS).toContain('[data-dtb-kind="chip"] {');
  });
});
