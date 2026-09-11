import { describe, expect, it } from "vitest";
import { KIT_CSS } from "../../kit/css";
import { CORE_CSS } from "../../core/css";
import { A11Y_CSS } from "../a11y/css";
import { COMMAND_MENU_CSS } from "../command-menu/css";
import { DIAGNOSTICS_CSS } from "../diagnostics/css";
import { ENVIRONMENT_CSS } from "../environment/css";
import { FLAGS_CSS } from "../flags/css";
import { METRICS_CSS } from "../metrics/css";
import { OVERLAYS_CSS } from "../overlays/css";
import { BOXES_CSS } from "../overlays/runtime";
import { THEME_EDITOR_CSS } from "../theme-editor/css";
import { extensionRoster } from "../../test-utils/extension-roster";

// left/right, the margin/padding/border -left/-right properties, and
// text-align: left|right all pin to a physical side regardless of dir="rtl";
// so does a four-value padding/margin shorthand, which can hide an asymmetric
// left/right pair behind logical-looking property names. The logical
// equivalents (inset-inline*, text-align: start|end, padding-block/-inline)
// flip automatically.
const PHYSICAL_CSS_PATTERN =
  /\bleft\s*:|\bright\s*:|\bborder-(?:left|right)(?:-(?:width|color|style))?\s*:|\bborder-(?:top|bottom)-(?:left|right)-radius\s*:|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)|\b(?:float|clear)\s*:\s*(left|right)\b|\bbackground-position\s*:\s*(left|right)\b|\b(?:inset|padding|margin)\s*:\s*[^\s;]+\s+[^\s;]+\s+[^\s;]+\s+[^\s;]+\s*;/;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function splitTopLevelSelectors(prelude: string): string[] {
  const parts: string[] = [];
  let current = "";
  let parenDepth = 0;
  let stringQuote: '"' | "'" | null = null;

  for (let i = 0; i < prelude.length; i++) {
    const ch = prelude[i];

    if (stringQuote) {
      current += ch;
      if (ch === "\\") {
        if (i + 1 < prelude.length) {
          current += prelude[++i];
        }
      } else if (ch === stringQuote) {
        stringQuote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      stringQuote = ch;
      current += ch;
    } else if (ch === "(") {
      parenDepth++;
      current += ch;
    } else if (ch === ")") {
      parenDepth--;
      current += ch;
    } else if (ch === "," && parenDepth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }

  const tail = current.trim();
  if (tail) {
    parts.push(tail);
  }

  return parts;
}

function unscopedSelectorParts(prelude: string): string[] {
  return splitTopLevelSelectors(prelude).filter((part) => !part.startsWith("[data-dev-toolbar]"));
}

function scopeViolations(css: string): string[] {
  const stripped = stripComments(css);
  const violations: string[] = [];
  let depth = 0;
  let atRuleDepth = -1;
  let preludeStart = 0;
  let scopedDepth1Rules = 0;

  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === "{") {
      const prelude = stripped.slice(preludeStart, i).trim();
      if (depth === 0) {
        if (prelude !== "@layer dev-toolbar") {
          violations.push(prelude);
        }
      } else if (depth === 1) {
        const isAtRule = prelude.startsWith("@");
        if (!isAtRule) {
          const unscoped = unscopedSelectorParts(prelude);
          if (unscoped.length > 0) {
            violations.push(...unscoped);
          } else {
            scopedDepth1Rules++;
          }
        }
        if (isAtRule) {
          atRuleDepth = depth + 1;
        }
      } else if (depth === 2 && atRuleDepth === 2) {
        // @keyframes and nested at-rules are intentionally unsupported here —
        // add handling when the first animation lands.
        const unscoped = unscopedSelectorParts(prelude);
        if (unscoped.length > 0) {
          violations.push(...unscoped);
        } else {
          scopedDepth1Rules++;
        }
      }
      depth++;
      preludeStart = i + 1;
    } else if (ch === "}") {
      if (atRuleDepth === depth) {
        atRuleDepth = -1;
      }
      depth--;
      preludeStart = i + 1;
    }
  }

  if (depth !== 0) {
    violations.push(`unclosed braces (depth ${depth})`);
  }

  if (scopedDepth1Rules === 0) {
    violations.push("no [data-dev-toolbar] rules in @layer dev-toolbar");
  }

  return violations;
}

// Removed by exact match so any other left/right creeping in elsewhere is still caught.
function removeAllowlisted(
  css: string,
  allow: ReadonlyArray<{ text: string; count: number }>,
): string {
  let sanitized = css;
  for (const { text, count } of allow) {
    for (let n = 0; n < count; n++) {
      const index = sanitized.indexOf(text);
      expect(index, `expected allow-listed "${text}"`).toBeGreaterThanOrEqual(0);
      sanitized = sanitized.slice(0, index) + sanitized.slice(index + text.length);
    }
  }
  return sanitized;
}

interface SheetDefinition {
  css: string;
  allow: readonly { text: string; count: number; why: string }[];
}

const EXTENSION_SHEET_DEFINITIONS: Record<string, SheetDefinition> = {
  a11y: { css: A11Y_CSS, allow: [] },
  "command-menu": {
    css: COMMAND_MENU_CSS,
    allow: [
      {
        text: "left: 50%;",
        count: 1,
        why: 'cmd-dialog centres itself with `left: 50%` + `transform: translateX(-50%)`. That pair is symmetric and needs no RTL mirroring — `inset-inline-start: 50%` is NOT an equivalent here, because under dir="rtl" it resolves to the right edge landing at the midpoint while translateX(-50%) still shifts left by half the width, so the dialog would end up a full width off-centre. See the comment on cmd-dialog in css.ts. Removed by exact text so any other left/right creeping in elsewhere is still caught.',
      },
    ],
  },
  diagnostics: { css: DIAGNOSTICS_CSS, allow: [] },
  environment: { css: ENVIRONMENT_CSS, allow: [] },
  flags: { css: FLAGS_CSS, allow: [] },
  metrics: { css: METRICS_CSS, allow: [] },
  overlays: {
    css: OVERLAYS_CSS,
    allow: [
      {
        text: "left: 50%;",
        count: 2,
        why: 'ovl-grid-columns and ovl-notice centre horizontally with `left: 50%` + `transform: translateX(-50%)`. Both are symmetric and need no RTL mirroring — `inset-inline-start: 50%` is NOT an equivalent because under dir="rtl" it resolves to the right edge landing at the midpoint while translateX(-50%) still shifts left by half the width, so the element ends up a full width off-centre (visibly so for ovl-grid-columns, which has an explicit width). See the comments on those rules in css.ts. Also on this drawing surface: the box and label parts (`ovl-box`, `ovl-label`, `ovl-focus-box`, `ovl-focus-badge`) are positioned by inline `left`/`top` styles set in ui.tsx from getBoundingClientRect() — a physical, viewport-relative measurement — which never appear in this exported CSS string, so they need no whitelisting here.',
      },
      {
        text: "right: auto;",
        count: 1,
        why: "ovl-grid-columns pairs `left: 50%; right: auto;` with `transform: translateX(-50%)` for deliberate horizontal centring that must stay physical; see css.ts.",
      },
    ],
  },
  "theme-editor": { css: THEME_EDITOR_CSS, allow: [] },
};

const styledExtensionNames = extensionRoster().withStyles;
const extensionSheets = styledExtensionNames.map((name) => {
  const sheet = EXTENSION_SHEET_DEFINITIONS[name];
  if (!sheet) {
    throw new Error(`Missing stylesheet test entry for extension "${name}"`);
  }
  return { name, ...sheet };
});

const SHEETS = [
  { name: "core", css: CORE_CSS, allow: [] as const },
  { name: "kit", css: KIT_CSS, allow: [] as const },
  ...extensionSheets,
];

describe("stylesheet test roster", () => {
  it("has exactly one definition per styled extension", () => {
    expect(
      Object.keys(EXTENSION_SHEET_DEFINITIONS).sort(),
      "stylesheet test definitions must match the styled extension roster",
    ).toEqual(styledExtensionNames);
  });
});

describe.each(SHEETS)("$name stylesheet", ({ css, allow }) => {
  const withoutComments = stripComments(css);

  for (const { text, count, why } of allow) {
    it(`allows "${text}" exactly ${count} time(s): ${why}`, () => {
      const matches =
        withoutComments.match(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? [];
      expect(matches).toHaveLength(count);
    });
  }

  it("positions with logical properties so chips and panels mirror under RTL", () => {
    const sanitized = removeAllowlisted(withoutComments, allow);
    expect(sanitized).not.toMatch(PHYSICAL_CSS_PATTERN);
  });

  it("wraps every rule in @layer dev-toolbar and scopes by [data-dev-toolbar]", () => {
    expect(stripComments(css).trimStart()).toMatch(/^@layer dev-toolbar \{/);
    expect(scopeViolations(css)).toEqual([]);
  });
});

describe("overlays host-outline sheet is deliberately unlayered", () => {
  it("negates [data-dev-toolbar] without a layer wrapper and stays RTL-safe", () => {
    const withoutComments = stripComments(BOXES_CSS);
    expect(withoutComments).not.toContain("@layer");
    expect(withoutComments).toContain(":not([data-dev-toolbar])");
    expect(withoutComments).not.toMatch(PHYSICAL_CSS_PATTERN);
  });
});

describe("the checker itself", () => {
  it("flags an unscoped rule inside @media", () => {
    const css = stripComments(`@layer dev-toolbar {
  @media (max-width: 600px) {
    .leaked { color: red; }
  }
}`);
    expect(scopeViolations(css)).toContain(".leaked");
  });

  it("flags a rule after the layer's closing brace", () => {
    const css = stripComments(`@layer dev-toolbar {
  [data-dev-toolbar] { color: red; }
}
.leaked { color: blue; }`);
    expect(scopeViolations(css)).toContain(".leaked");
  });

  it("flags an unscoped selector in a comma-separated list", () => {
    const css = stripComments(`@layer dev-toolbar {
  [data-dev-toolbar] a,
  .leaked { color: red; }
}`);
    expect(scopeViolations(css)).toContain(".leaked");
  });

  it("does not split commas inside :is() or :not()", () => {
    const css = stripComments(`@layer dev-toolbar {
  [data-dev-toolbar] :is(a, .nested) { color: red; }
  [data-dev-toolbar]:not(.foo, .bar) { color: blue; }
}`);
    expect(scopeViolations(css)).toEqual([]);
  });

  it("does not split commas inside attribute selector quotes", () => {
    const css = stripComments(`@layer dev-toolbar {
  [data-dev-toolbar][data-x="a,b"] { color: red; }
}`);
    expect(scopeViolations(css)).toEqual([]);
  });

  it("flags an unscoped selector after a quoted attribute value containing parens", () => {
    const css = stripComments(`@layer dev-toolbar {
  [data-dev-toolbar][data-x="("], .leaked { color: red; }
}`);
    expect(scopeViolations(css)).toContain(".leaked");
  });

  it("flags text-align: left", () => {
    const css = "text-align: left;";
    expect(css).toMatch(PHYSICAL_CSS_PATTERN);
  });

  it("flags four-value padding shorthand", () => {
    const css = "padding: 1px 2px 3px 4px;";
    expect(css).toMatch(PHYSICAL_CSS_PATTERN);
  });

  it.each([
    ["four-value inset", "inset: 1px 2px 3px 4px;"],
    ["border-left", "border-left : 1px solid red;"],
    ["border-right", "border-right: 1px solid red;"],
    ["border-top-left-radius", "border-top-left-radius: 4px;"],
    ["border-top-right-radius", "border-top-right-radius: 4px;"],
    ["border-bottom-left-radius", "border-bottom-left-radius: 4px;"],
    ["border-bottom-right-radius", "border-bottom-right-radius: 4px;"],
    ["border-left-width", "border-left-width: 1px;"],
    ["four-value inset with whitespace", "inset : 1px 2px 3px 4px;"],
    ["float left", "float: left;"],
    ["clear right", "clear: right;"],
    ["background-position left", "background-position: left top;"],
    ["background-position right", "background-position: right top;"],
    ["left with whitespace", "left : 0;"],
  ])("flags %s", (_name, css) => {
    expect(css).toMatch(PHYSICAL_CSS_PATTERN);
  });

  it("requires every depth-zero block to be the dev-toolbar layer", () => {
    const css = stripComments(`@layer dev-toolbar {
  [data-dev-toolbar] { color: red; }
}
@layer app {
  [data-dev-toolbar] { color: blue; }
}`);
    expect(scopeViolations(css)).toContain("@layer app");
  });
});
