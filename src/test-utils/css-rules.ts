/**
 * A small CSS scanner for the stylesheet invariants in `__tests__`. Not a
 * full parser: any construct it doesn't recognise throws rather than
 * scanning to a vacuous pass.
 */

/** At-rules whose block holds further rules, and is therefore descended into. */
const NESTING_AT_RULES = new Set(["layer", "media", "supports", "container", "scope"]);

// The only statement forms this scanner passes over; everything else (`@import`
// above all) throws rather than silently skipping it.
const STATEMENT_AT_RULES = new Set(["charset", "layer"]);

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
  /**
   * The text between the rule's braces, comments already replaced by a space.
   * Raw, not parsed into declarations — a caller that needs them parses what
   * it models and fails closed on the rest, the way this scanner does.
   */
  readonly block: string;
}

// `quoted` marks string indices so structural checks can skip them — braces
// and comment openers inside a quoted value are not structure.
interface ScannedSource {
  readonly source: string;
  readonly quoted: readonly boolean[];
}

// Fails closed: an unterminated comment/string or an escape throws.
function scanSource(css: string): ScannedSource {
  let source = "";
  const quoted: boolean[] = [];
  let i = 0;
  const emit = (text: string, inString: boolean): void => {
    source += text;
    for (let n = 0; n < text.length; n += 1) quoted.push(inString);
  };
  while (i < css.length) {
    const char = css[i] as string;
    if (char === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end === -1) throw new Error("css-rules: unterminated comment; refusing to scan");
      emit(" ", false);
      i = end + 2;
      continue;
    }
    if (char === "*" && css[i + 1] === "/") {
      throw new Error("css-rules: unbalanced comment; refusing to scan");
    }
    if (char === '"' || char === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== char) {
        if (css[j] === "\\") {
          throw new Error("css-rules: escape inside a string; refusing to scan");
        }
        if (css[j] === "\n") break;
        j += 1;
      }
      if (j >= css.length || css[j] !== char) {
        throw new Error("css-rules: unterminated string; refusing to scan");
      }
      emit(css.slice(i, j + 1), true);
      i = j + 1;
      continue;
    }
    emit(char, false);
    i += 1;
  }
  return { source, quoted };
}

/** Index just past the `}` matching the `{` at `open`, ignoring quoted text. */
function endOfBlock(scanned: ScannedSource, open: number): number {
  const { source, quoted } = scanned;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (quoted[i] === true) continue;
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error("css-rules: unterminated block; refusing to scan");
}

/** Does an unquoted `char` appear in `[from, to)`? */
function hasUnquoted(scanned: ScannedSource, char: string, from: number, to: number): boolean {
  for (let i = from; i < to; i += 1) {
    if (scanned.quoted[i] !== true && scanned.source[i] === char) return true;
  }
  return false;
}

/**
 * Every style rule in `css`, descending through `@layer`, `@media` and the
 * other nesting at-rules. Throws on anything else it doesn't model.
 */
export function styleRules(css: string): StyleRule[] {
  const scanned = scanSource(css);
  const { source, quoted } = scanned;
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
    const char = quoted[i] === true ? "" : source[i];
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
          i = endOfBlock(scanned, i);
          continue;
        }
        throw new Error(`css-rules: unrecognised at-rule "${text}"; refusing to scan`);
      }
      if (text === "") throw new Error("css-rules: block with an empty prelude");
      const end = endOfBlock(scanned, i);
      if (hasUnquoted(scanned, "{", i + 1, end - 1)) {
        throw new Error(`css-rules: nested rule inside "${text}"; refusing to scan`);
      }
      rules.push({ prelude: text, enclosing: [...enclosing], block: source.slice(i + 1, end - 1) });
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
      const name = /^@([\w-]+)/.exec(text)?.[1] ?? "";
      if (!STATEMENT_AT_RULES.has(name)) {
        throw new Error(`css-rules: unrecognised at-rule statement "${text}"; refusing to scan`);
      }
      i += 1;
      continue;
    }
    prelude += source[i];
    i += 1;
  }

  if (enclosing.length > 0) throw new Error("css-rules: unclosed at-rule block");
  if (take() !== "") throw new Error("css-rules: trailing text after the last rule");
  return rules;
}

/** Split on top-level `separator`, ignoring any inside (), [] or a string. */
export function splitTopLevel(text: string, separator: string): string[] {
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
 * actually styles. Combinators inside `:where()`/`:not()` are not top-level,
 * so `:where(:not([data-dtb-embed] *))` stays part of its compound.
 */
function subjectCompound(selector: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i += 1) {
    const char = selector[i] as string;
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (depth === 0 && (char === " " || char === ">" || char === "+" || char === "~")) {
      start = i + 1;
    }
  }
  return selector.slice(start);
}

// Functional pseudo-classes taking a selector list where the subject matches
// *some* branch: a condition holds only if every branch imposes it.
const SELECTOR_LIST_PSEUDOS = new Set(["is", "where", "matches", "any"]);

// A token inside `:not()`'s argument is never a positive condition on the
// subject. The argument is still parsed, so unmodelled syntax throws.
const NEGATION_PSEUDOS = new Set(["not"]);

// Recognised but say nothing about whether the subject is toolbar-owned;
// their arguments are not parsed. Anything absent from all three sets throws.
const NEUTRAL_PSEUDOS = new Set([
  "active",
  "after",
  "any-link",
  "autofill",
  "backdrop",
  "before",
  "checked",
  "default",
  "defined",
  "dir",
  "disabled",
  "empty",
  "enabled",
  "file-selector-button",
  "first-child",
  "first-letter",
  "first-line",
  "first-of-type",
  "focus",
  "focus-visible",
  "focus-within",
  "fullscreen",
  "has",
  "hover",
  "in-range",
  "indeterminate",
  "invalid",
  "lang",
  "last-child",
  "last-of-type",
  "link",
  "marker",
  "modal",
  "nth-child",
  "nth-last-child",
  "nth-last-of-type",
  "nth-of-type",
  "only-child",
  "only-of-type",
  "open",
  "optional",
  "out-of-range",
  "placeholder",
  "placeholder-shown",
  "popover-open",
  "read-only",
  "read-write",
  "required",
  "root",
  "selection",
  "target",
  "user-invalid",
  "user-valid",
  "valid",
  "visited",
]);

/** Index just past the `close` matching the `open` character at `from`. */
function matchingIndex(text: string, from: number, open: string, close: string): number {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    const char = text[i];
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error(`css-rules: unbalanced "${open}" in "${text}"; refusing to classify`);
}

/**
 * Strips quoted attribute values so a `[data-dtb-*]`-looking token inside one
 * isn't mistaken for a condition. An unterminated quote or escape throws.
 */
function stripStrings(selector: string): string {
  if (selector.includes("\\")) {
    throw new Error(`css-rules: escape in "${selector}"; refusing to classify`);
  }
  const stripped = selector.replace(/"[^"]*"|'[^']*'/g, "");
  if (stripped.includes('"') || stripped.includes("'")) {
    throw new Error(`css-rules: unbalanced quote in "${selector}"; refusing to classify`);
  }
  return stripped;
}

/**
 * A compound selector split into the simple selectors it ANDs together.
 * Throws on any syntax this scanner does not model, rather than skipping it.
 */
function compoundPieces(compound: string): string[] {
  const pieces: string[] = [];
  let current = "";
  let i = 0;
  const flush = (): void => {
    if (current !== "") pieces.push(current);
    current = "";
  };
  while (i < compound.length) {
    const char = compound[i] as string;
    if (char === "[") {
      flush();
      const end = matchingIndex(compound, i, "[", "]");
      pieces.push(compound.slice(i, end));
      i = end;
      continue;
    }
    if (char === ":") {
      flush();
      let j = i + 1;
      if (compound[j] === ":") j += 1;
      while (j < compound.length && /[\w-]/.test(compound[j] as string)) j += 1;
      if (compound[j] === "(") j = matchingIndex(compound, j, "(", ")");
      pieces.push(compound.slice(i, j));
      i = j;
      continue;
    }
    if (char === "." || char === "#") {
      flush();
      current = char;
      i += 1;
      continue;
    }
    if (/[\w\-*|]/.test(char)) {
      current += char;
      i += 1;
      continue;
    }
    throw new Error(
      `css-rules: unsupported selector syntax in "${compound}"; refusing to classify`,
    );
  }
  flush();
  return pieces;
}

interface Pseudo {
  readonly name: string;
  readonly args: string;
}

/** The name and argument of a `:pseudo(...)` piece, rejecting unknown names. */
function parsePseudo(piece: string): Pseudo {
  const match = /^::?([\w-]+)(?:\((.*)\))?$/s.exec(piece);
  if (match === null) {
    throw new Error(`css-rules: unreadable pseudo "${piece}"; refusing to classify`);
  }
  const name = match[1] as string;
  const args = match[2] ?? "";
  if (
    !SELECTOR_LIST_PSEUDOS.has(name) &&
    !NEGATION_PSEUDOS.has(name) &&
    !NEUTRAL_PSEUDOS.has(name)
  ) {
    throw new Error(`css-rules: unrecognised pseudo "${piece}"; refusing to classify`);
  }
  return { name, args };
}

/**
 * Does *every* element matching `compound` necessarily carry an attribute
 * `test` accepts? A token inside `:not()` is not a condition the subject
 * meets, and a token in one branch of `:is()`/`:where()` is not one every
 * matching element meets.
 */
function requiresAttribute(compound: string, test: (name: string) => boolean): boolean {
  let required = false;
  for (const piece of compoundPieces(compound)) {
    if (piece.startsWith("[")) {
      const name = /^\[\s*([\w-]+)/.exec(piece)?.[1];
      if (name === undefined) {
        throw new Error(`css-rules: unreadable attribute "${piece}"; refusing to classify`);
      }
      if (test(name)) required = true;
      continue;
    }
    if (!piece.startsWith(":")) continue;
    const { name, args } = parsePseudo(piece);
    if (SELECTOR_LIST_PSEUDOS.has(name)) {
      const branches = splitTopLevel(args, ",");
      if (branches.length === 0) {
        throw new Error(`css-rules: empty selector list in "${piece}"; refusing to classify`);
      }
      // Every branch, evaluated on the branch's own subject: `:is(A B)` puts
      // its condition on B, the element `:is()` selects, not on A.
      if (branches.every((branch) => requiresAttribute(subjectCompound(branch), test))) {
        required = true;
      }
      continue;
    }
    if (NEGATION_PSEUDOS.has(name)) {
      // Parsed for its syntax only. Never a positive condition.
      for (const branch of splitTopLevel(args, ",")) compoundPieces(subjectCompound(branch));
    }
  }
  return required;
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
 * Sorts every selector in `css` by its subject compound; throws on anything
 * unscoped by `[data-dev-toolbar]` or unparseable. `keyed` requires the
 * *selected* element itself to carry a toolbar-owned attribute; see
 * docs/embedding.md.
 */
export function auditEmbedGuards(css: string): EmbedGuardAudit {
  const audit: EmbedGuardAudit = { root: [], keyed: [], guarded: [], unguarded: [] };
  for (const rule of styleRules(css)) {
    for (const selector of splitTopLevel(rule.prelude, ",")) {
      const scrubbed = stripStrings(selector);
      if (!scrubbed.includes("[data-dev-toolbar]")) {
        throw new Error(`css-rules: "${selector}" is not scoped by [data-dev-toolbar]`);
      }
      const subject = subjectCompound(scrubbed);
      const pieces = compoundPieces(subject);
      if (requiresAttribute(subject, (name) => name === "data-dev-toolbar")) {
        audit.root.push(selector);
        continue;
      }
      if (requiresAttribute(subject, (name) => name.startsWith("data-dtb-"))) {
        audit.keyed.push(selector);
        continue;
      }
      const guarded = pieces.some((piece) => piece.replace(/\s+/g, " ") === EMBED_GUARD);
      (guarded ? audit.guarded : audit.unguarded).push(selector);
    }
  }
  return audit;
}
