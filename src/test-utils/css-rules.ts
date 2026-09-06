/**
 * A small, deliberate CSS scanner for the stylesheet invariants in
 * `__tests__`. It exists so a test can assert something about *every* rule in
 * a shipped sheet without a hand-maintained list of rules or of elements —
 * the omission mechanism those lists carry is exactly what the invariants are
 * there to catch.
 *
 * It is not a CSS parser and does not try to be. Every construct it does not
 * recognise throws, so an unfamiliar sheet fails a test and a human decides,
 * rather than being scanned to a vacuous pass.
 */

/** At-rules whose block holds further rules, and is therefore descended into. */
const NESTING_AT_RULES = new Set(["layer", "media", "supports", "container", "scope"]);

/** At-rules whose block holds no style rules, and is therefore skipped whole. */
const OPAQUE_AT_RULES = new Set([
  "keyframes",
  "-webkit-keyframes",
  "font-face",
  "property",
  "page",
  "counter-style",
  "font-feature-values",
]);

export interface StyleRule {
  /** The rule's prelude, whitespace collapsed: one or more selectors. */
  readonly prelude: string;
  /** The at-rule preludes it sits inside, outermost first. */
  readonly enclosing: readonly string[];
}

function stripComments(css: string): string {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  if (stripped.includes("/*") || stripped.includes("*/")) {
    throw new Error("css-rules: unbalanced comment; refusing to scan");
  }
  return stripped;
}

/** Index just past the `}` matching the `{` at `open`. */
function endOfBlock(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error("css-rules: unterminated block; refusing to scan");
}

/**
 * Every style rule in `css`, descending through `@layer`, `@media` and the
 * other nesting at-rules. Throws on anything else: an unknown at-rule, a
 * nested style rule (this codebase writes none), a stray declaration.
 */
export function styleRules(css: string): StyleRule[] {
  const source = stripComments(css);
  const rules: StyleRule[] = [];
  const enclosing: string[] = [];
  let prelude = "";
  let i = 0;

  const take = (): string => {
    const text = prelude.trim().replace(/\s+/g, " ");
    prelude = "";
    return text;
  };

  while (i < source.length) {
    const char = source[i];
    if (char === "{") {
      const text = take();
      if (text.startsWith("@")) {
        const name = /^@([\w-]+)/.exec(text)?.[1] ?? "";
        if (NESTING_AT_RULES.has(name)) {
          enclosing.push(text);
          i += 1;
          continue;
        }
        if (OPAQUE_AT_RULES.has(name)) {
          i = endOfBlock(source, i);
          continue;
        }
        throw new Error(`css-rules: unrecognised at-rule "${text}"; refusing to scan`);
      }
      if (text === "") throw new Error("css-rules: block with an empty prelude");
      const end = endOfBlock(source, i);
      if (source.slice(i + 1, end - 1).includes("{")) {
        throw new Error(`css-rules: nested rule inside "${text}"; refusing to scan`);
      }
      rules.push({ prelude: text, enclosing: [...enclosing] });
      i = end;
      continue;
    }
    if (char === "}") {
      if (take() !== "") throw new Error("css-rules: text before a closing brace");
      if (enclosing.pop() === undefined) throw new Error("css-rules: unbalanced closing brace");
      i += 1;
      continue;
    }
    if (char === ";") {
      const text = take();
      if (!text.startsWith("@")) {
        throw new Error(`css-rules: declaration outside a rule ("${text}")`);
      }
      i += 1;
      continue;
    }
    prelude += char;
    i += 1;
  }

  if (enclosing.length > 0) throw new Error("css-rules: unclosed at-rule block");
  if (take() !== "") throw new Error("css-rules: trailing text after the last rule");
  return rules;
}

/** Split on top-level `separator`, ignoring any inside (), [] or a string. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (const char of text) {
    if (quote !== "") {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (char === separator && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current.trim());
  return parts.filter((part) => part !== "");
}

/**
 * The rightmost compound of a complex selector — the elements the rule
 * actually styles. Everything before the last top-level combinator is the
 * context it requires, and combinators inside `:where()`/`:not()` are not
 * top-level, so `:where(:not([data-dtb-embed] *))` stays part of its compound.
 */
function subjectCompound(selector: string): string {
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < selector.length; i += 1) {
    const char = selector[i] as string;
    if (quote !== "") {
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (depth === 0 && (char === " " || char === ">" || char === "+" || char === "~")) {
      start = i + 1;
    }
  }
  return selector.slice(start);
}

/** The zero-specificity opt-out core writes on every element-level default. */
const EMBED_GUARD = ":where(:not([data-dtb-embed] *))";

export interface EmbedGuardAudit {
  /** Selectors whose subject is the toolbar root itself. */
  readonly root: string[];
  /** Selectors whose subject requires a toolbar-owned `data-dtb-*` attribute. */
  readonly keyed: string[];
  /** Element-level descendant defaults carrying the guard. */
  readonly guarded: string[];
  /** Element-level descendant defaults *not* carrying it — the failures. */
  readonly unguarded: string[];
}

/**
 * Sort every selector in `css` by whether it can reach into a `data-dtb-embed`
 * subtree, working from the selector text alone — no fixture, no element list.
 *
 * The subject compound (the elements a rule actually styles) decides it:
 *
 * - it contains `[data-dev-toolbar]` → the toolbar root, which an embedded
 *   subtree never is → `root`;
 * - it contains a `[data-dtb-*]` attribute → a toolbar-owned part, kind or
 *   opt-in, which nothing inside an embed frame carries → `keyed`;
 * - otherwise the rule styles descendants by element, attribute or state, so
 *   it lands on a vendor's DOM unless it carries {@link EMBED_GUARD} →
 *   `guarded` or `unguarded`.
 *
 * It fails closed: a selector that is not scoped by `[data-dev-toolbar]` at
 * all throws rather than being sorted, as does any sheet {@link styleRules}
 * cannot scan. The `keyed` exemption is why this is core's invariant and not
 * every sheet's: it holds because every `[data-dtb-*]` element in a core
 * selector's *context* is either the root or an ancestor of the embed frame,
 * so requiring one on the subject is what rules a vendor element out.
 */
export function auditEmbedGuards(css: string): EmbedGuardAudit {
  const audit: EmbedGuardAudit = { root: [], keyed: [], guarded: [], unguarded: [] };
  for (const rule of styleRules(css)) {
    for (const selector of splitTopLevel(rule.prelude, ",")) {
      if (!selector.includes("[data-dev-toolbar]")) {
        throw new Error(`css-rules: "${selector}" is not scoped by [data-dev-toolbar]`);
      }
      // A pseudo-element decorates the element its compound selects; the
      // compound is what decides whose DOM the rule reaches.
      const subject = subjectCompound(selector).replace(/::[a-z-]+(\([^)]*\))?/g, "");
      if (subject.includes("[data-dev-toolbar]")) {
        audit.root.push(selector);
        continue;
      }
      const withoutGuard = subject.split(EMBED_GUARD).join("");
      if (withoutGuard.includes("[data-dtb-")) {
        audit.keyed.push(selector);
        continue;
      }
      (withoutGuard === subject ? audit.unguarded : audit.guarded).push(selector);
    }
  }
  return audit;
}
