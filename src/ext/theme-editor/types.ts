/**
 * Shared vocabulary for `/ext/theme-editor`. [dev-toolbar/ext/theme-editor]
 *
 * Design tokens are **consumer-owned state**, exactly like the flags
 * `/ext/flags` edits and the session context `/ext/environment` renders. This
 * extension owns no design system, generates no palette and reaches for no
 * global. You hand it the tokens your application publishes; it edits them,
 * shows you the difference, and gives you the edit back as something you can
 * paste into code or hand to a designer.
 *
 * The one piece of state it owns is the override map, because that is a toolbar
 * preference and nothing else in the app knows about it.
 *
 * Two validation rules in this file carry the whole safety story, and they are
 * deliberately different from each other:
 *
 * - **A token *name* is validated, never redacted.** It ends up as a CSS
 *   identifier in an inline style and in exported CSS text, so the hazard is
 *   *syntax* — a name carrying `;` or `}` closes the declaration and opens a
 *   rule of the attacker's choosing. Masking it would corrupt every export and
 *   guard nothing.
 * - **A token *value* is validated **and** redacted.** Validated because it is
 *   about to be written into the page; redacted because it is about to leave on
 *   a clipboard.
 *
 * That is §15.3's "both halves of a join are foreign" with the correction this
 * extension forced: both halves are foreign, and the right treatment of each
 * half depends on what it becomes downstream, not on the fact that it is
 * foreign.
 */

/**
 * What kind of value a token holds.
 *
 * It decides the editor, the parsing strictness — and, per `render()` in the
 * runtime, whether the value may be masked by key name at all.
 */
export type TokenType = "color" | "length" | "number" | "string";

export interface DesignTokenDefinition {
  /** The custom property, including the leading `--`. */
  name: string;
  /** Human name. Defaults to the name with its `--` stripped. */
  label?: string;
  description?: string;
  /** Panel grouping. Defaults to `"Tokens"`. */
  group?: string;
  /** Defaults to the shape of `value` / `defaultValue`, else `"string"`. */
  type?: TokenType;
  /**
   * The application's own value, **before any toolbar edit**.
   *
   * Omit it and the extension reads the computed value off the surface element
   * instead — which is the usual case, because a design system's tokens are
   * already declared in CSS. See `TokenView.base` for what that costs.
   */
  value?: string;
  /** What the design system calls this token's default. */
  defaultValue?: string;
  /**
   * Never render or copy this token's value.
   *
   * `redact()` already masks credential-shaped values; this is the manual
   * override for one only you know is sensitive.
   */
  sensitive?: boolean;
}

export type TokensInput =
  | readonly DesignTokenDefinition[]
  | (() => readonly DesignTokenDefinition[]);

/**
 * One place edits are applied, per §3H's "surface/subtree selection".
 *
 * The selector is resolved with `document.querySelector` at apply time, so a
 * surface that is not on the page yet simply has nothing to write to and says
 * so.
 */
export interface ThemeSurface {
  id: string;
  label?: string;
  /** Any selector. `":root"` is the default surface. */
  selector: string;
}

export const DEFAULT_SURFACE: ThemeSurface = {
  id: "root",
  label: "Application root",
  selector: ":root",
};

/* -------------------------------------------------------------------------- */
/* Names                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Prefixes this extension will never write, whatever a consumer declares.
 *
 * This is the guard that keeps an app edit from restyling the toolbar. The
 * toolbar's own surface is styled entirely from `--dtb-*` (§4.1) and it
 * publishes `--dev-toolbar-height`; a surface of `:root` is an ancestor of the
 * portalled toolbar root, so writing either name there would repaint the tool
 * you are using to make the edit.
 *
 * It is a **refusal to write the name at all**, not a CSS rule, and that is
 * deliberate. §14.7's lesson is that a guard does not belong in a layer designed
 * to lose; the generalisation is that a guard expressible as "never do the
 * thing" should not be expressed in the cascade at all, where specificity,
 * layering and `!important` all get a vote. Nothing here has to win an argument
 * with the consumer's stylesheet, because nothing here is ever written.
 *
 * Restyling the bar is a supported thing to want — it is done from your own
 * stylesheet, unlayered, per §4.1, which needs no help from this extension.
 */
export const RESERVED_PREFIXES: readonly string[] = ["--dtb-", "--dev-toolbar"];

/** Why a token cannot be edited. `null` means it can. */
export type TokenRefusal = "syntax" | "reserved";

/**
 * Conservative on purpose: CSS allows nearly anything in a custom property
 * name, and we are about to concatenate this into CSS text.
 */
const NAME_SHAPE = /^--[A-Za-z0-9_][A-Za-z0-9_-]*$/;

export function checkTokenName(name: unknown): TokenRefusal | null {
  if (typeof name !== "string" || name.length === 0 || name.length > 128) {
    return "syntax";
  }
  if (!NAME_SHAPE.test(name)) return "syntax";
  const lower = name.toLowerCase();
  if (RESERVED_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return "reserved";
  }
  return null;
}

export function describeRefusal(refusal: TokenRefusal): string {
  return refusal === "reserved"
    ? "reserved — this name belongs to the toolbar's own styling, and editing it here would restyle the toolbar instead of your app. Restyle the bar from your own stylesheet."
    : "not a token name this editor will write — use --letters-digits-and-dashes.";
}

/* -------------------------------------------------------------------------- */
/* Values                                                                      */
/* -------------------------------------------------------------------------- */

/** Why a value was refused. `null` means it was accepted. */
export type ValueRefusal = "empty" | "syntax" | "too-long" | "type";

export const MAX_VALUE_LENGTH = 512;

/**
 * Characters and constructs that must never reach a declaration this extension
 * writes or exports.
 *
 * `;` `{` `}` end or open a declaration or a rule. `\` and `/*` hide the rest
 * of a comment-terminated payload. `<` matters because the same string is
 * exported as CSS text a consumer may paste into a `<style>` block. `url(` and
 * `image-set(` fetch — a shared theme link that made the page issue a request
 * to somebody else's host would be a genuine exfiltration channel, not a
 * cosmetic problem — and `@import` is the same thing by another route.
 *
 * `var()`, `calc()`, `color-mix()` and friends are all fine and are the whole
 * point of a modern token, so this is a deny list of the four constructs that
 * escape a declaration, not an allow list of the syntax somebody might want.
 */
const VALUE_FORBIDDEN =
  /[;{}<>\\]|\/\*|\*\/|\burl\s*\(|\bimage-set\s*\(|\bexpression\s*\(|@import|\bsrc\s*:/i;

const NUMBER_SHAPE = /^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;
const LENGTH_SHAPE =
  /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%|vh|vw|vmin|vmax|ch|ex|pt|pc|cm|mm|in|q|deg|rad|turn|s|ms|fr)?$/i;
const FUNCTIONAL = /^(?:calc|clamp|min|max|var|env|round)\s*\(/i;

/**
 * Accepts or refuses one edited value.
 *
 * The safety pass is universal and strict. The *type* pass refuses only what is
 * definitely not a value of that type — numbers and lengths, which have a
 * shape — and lets colours and free strings through, because `oklch()`,
 * `color-mix()` and `var()` are all legitimate colours and a matcher that tried
 * to enumerate them would refuse tomorrow's syntax.
 *
 * `undefined` rather than a coerced fallback, for `/ext/flags`' reason
 * (§12.4): a refused edit is recoverable and a silently corrected one is not.
 */
export function checkTokenValue(
  type: TokenType,
  raw: string,
): ValueRefusal | null {
  const value = raw.trim();
  if (value === "") return "empty";
  if (value.length > MAX_VALUE_LENGTH) return "too-long";
  if (VALUE_FORBIDDEN.test(value)) return "syntax";
  if (FUNCTIONAL.test(value)) return null;
  if (type === "number" && !NUMBER_SHAPE.test(value)) return "type";
  if (type === "length" && !LENGTH_SHAPE.test(value)) return "type";
  return null;
}

export function describeValueRefusal(
  refusal: ValueRefusal,
  type: TokenType,
): string {
  switch (refusal) {
    case "empty":
      return "nothing was typed — clear the override instead if that is what you meant.";
    case "too-long":
      return `longer than ${MAX_VALUE_LENGTH} characters.`;
    case "syntax":
      return "contains something this editor will not write into a stylesheet — ; { } < > \\ /* or url().";
    case "type":
      return `not a ${type}.`;
  }
}

/**
 * True when a surface selector is safe to print into exported CSS text.
 *
 * A selector is *resolved* with `querySelector`, which already fails closed on
 * anything malformed — but `cssText` **prints** it, and that is a different
 * hazard. `:root { } body { background: url(…) } .z` is not a valid selector, so
 * nothing resolves and nothing is applied; the exported stylesheet would
 * nonetheless carry a working rule the consumer never wrote, into a file
 * somebody pastes into their app. Found by attacking the export path.
 *
 * The §16.2 shape again: refuse to emit rather than try to escape. The deny
 * list is therefore only the characters that **end a selector and start
 * something else** — `;` `{` `}`, a comment opener, `<` (which is not selector
 * syntax at all and is how you close a `<style>` block somebody pasted this
 * into), a backslash escape, and `url(`.
 *
 * Combinators are **not** on it. The first cut denied `>`, `+` and `~` under a
 * comment claiming "a real selector never contains any of these", which was
 * simply false: `#app > main` is an ordinary surface selector, and denying it
 * silently exported the block scoped to `:root` with a note saying it could not
 * be printed — a wrong scope in a stylesheet, which is worse than the refusal
 * it was imitating. `@` is likewise allowed *except* at the start, because
 * that is the only position where it can open an at-rule, and it is legal
 * inside an attribute selector's value.
 */
export function isPrintableSelector(selector: string): boolean {
  return (
    typeof selector === "string" &&
    selector.length > 0 &&
    selector.length <= 200 &&
    !/[;{}<\\]|\/\*|\*\/|\burl\s*\(/i.test(selector) &&
    !selector.trimStart().startsWith("@")
  );
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** True when a browser's `<input type="color">` can round-trip this value. */
export function isHexColor(value: string | null | undefined): boolean {
  return typeof value === "string" && HEX.test(value.trim());
}

/** Six-digit hex for `<input type="color">`, which refuses anything else. */
export function toColorInputValue(value: string): string {
  const hex = value.trim();
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    const [r, g, b] = [hex[1], hex[2], hex[3]] as [string, string, string];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^#[0-9a-f]{4}$/i.test(hex)) {
    const [r, g, b] = [hex[1], hex[2], hex[3]] as [string, string, string];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^#[0-9a-f]{8}$/i.test(hex)) return hex.slice(0, 7).toLowerCase();
  return hex.toLowerCase();
}

/** Guesses a token's type from whatever value there is to look at. */
export function inferType(definition: DesignTokenDefinition): TokenType {
  if (definition.type) return definition.type;
  const probe = (definition.value ?? definition.defaultValue ?? "").trim();
  if (probe === "") return "string";
  if (
    HEX.test(probe) ||
    /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\s*\(/i.test(probe)
  ) {
    return "color";
  }
  if (NUMBER_SHAPE.test(probe)) return "number";
  if (LENGTH_SHAPE.test(probe)) return "length";
  return "string";
}

/** `--brand-500` → `brand 500`. Only ever a fallback for a missing `label`. */
export function humanise(name: string): string {
  return name.replace(/^--/, "").replace(/[-_]+/g, " ").trim();
}

/* -------------------------------------------------------------------------- */
/* Views                                                                       */
/* -------------------------------------------------------------------------- */

export interface TokenView {
  name: string;
  label: string;
  description?: string;
  group: string;
  type: TokenType;

  /**
   * The application's own value, ignoring this extension's edit.
   *
   * Supplied by the consumer when they set `value`; otherwise read off the
   * surface with `getComputedStyle`. In the second case it is read only while
   * the token is **not** overridden, and the last pre-override read is kept
   * afterwards — because once the override is on the element, the computed
   * value *is* the override, and re-reading it would make every row claim the
   * app already agreed with the edit. That is `/ext/flags`' §12.1 rule arriving
   * from the other direction: never derive "what it was" from "what it is".
   */
  base: string | null;
  defaultValue: string | null;
  /** The local edit, or `undefined`. */
  override?: string;
  /** `override ?? base` — what this extension believes the page is rendering. */
  effective: string | null;
  overridden: boolean;

  /** Display strings. Already redacted; there is no unmasked path to the UI. */
  effectiveText: string;
  baseText: string;
  defaultText: string;
  /** True when redaction changed the value this row shows. */
  masked: boolean;
  /**
   * True when redaction changed something this row shows that is **not** the
   * value — its description or its group name.
   *
   * Separate from `masked` on purpose. `masked` is about the value and drives
   * the editor — the input refuses to seed itself from a masked value — and a
   * row whose *description* was scrubbed has a perfectly usable value. But both
   * of these are exported (the Figma `$description`, and the group as a JSON
   * key), so anything that *counts* what was withheld from an outbound document
   * has to include them, or the count and the thing it counts are not the same
   * thing (§15.3).
   *
   * The group joined this flag late, and only because §16.8's checklist names
   * the case: it is consumer-supplied configuration that reaches an outbound
   * document, and "configuration is a source like any other".
   */
  metadataMasked: boolean;

  /** Non-null when this token can never be edited. See `describeRefusal`. */
  refusal: TokenRefusal | null;
  /** True when only a stored override names this token; the catalogue does not. */
  orphaned: boolean;
  /** Set when writing this token to the surface failed. Cleared by its own success. */
  applyError?: string;
}

export interface ThemeSnapshot {
  revision: number;
  tokens: readonly TokenView[];
  /** Group name → the tokens in it, in catalogue order. Panel rendering only. */
  groups: readonly { name: string; tokens: readonly TokenView[] }[];
  overriddenCount: number;
  maskedCount: number;
  refusedCount: number;
  /** True when the consumer supplied no tokens at all. */
  supplied: boolean;
  /** False when there is nowhere to write — no document, or no element matches. */
  writable: boolean;
  /** Currently selected surface. */
  surface: ThemeSurface;
  surfaces: readonly ThemeSurface[];
  /** False while edits are held back so you can see the application untouched. */
  preview: boolean;
  /** The application's colour mode, when a `mode` adapter was supplied. */
  mode: "light" | "dark" | null;
  modeWritable: boolean;
  /** Per token, the last failure from writing to the surface. */
  applyErrors: Readonly<Record<string, string>>;
  /** Set when the token list itself could not be read. */
  readError: string | null;
  /** What the last import/link/preset did, for the panel's status line. */
  notice: string | null;
}

/** Chip/row colour. Same vocabulary the other extensions use. */
export type TokenSeverity = "unknown" | "warn" | "bad" | "override";

export function severityFor(view: TokenView): TokenSeverity {
  if (view.applyError !== undefined) return "bad";
  if (view.refusal !== null || view.orphaned) return "warn";
  if (view.overridden) return "override";
  return "unknown";
}

export function matchesQuery(view: TokenView, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return [view.name, view.label, view.description, view.group]
    .filter((part): part is string => typeof part === "string")
    .some((part) => part.toLowerCase().includes(needle));
}

/* -------------------------------------------------------------------------- */
/* Recipes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * §3H's shareable recipe, with one deliberate divergence.
 *
 * §3H suggests `overrides: Record<string, { l?, c?, h?, alpha? }>` — a delta in
 * OKLCH — plus `inputs: { base, accent, contrast }`. Both presume the toolbar
 * owns a colour model and a scale generator: something has to turn "lightness
 * +4" into a value, and that something is a design system. This extension
 * deliberately owns neither (see the note at the top of `index.tsx`), so an
 * override here is the **literal value** the token takes, and the recipe is a
 * complete, self-describing document rather than a delta against a generator
 * the reader may not have.
 *
 * That also makes the Figma pipeline in §3H deterministic in the only way that
 * matters: what is exported is what is applied.
 */
export interface ThemeRecipe {
  schemaVersion: 1;
  name: string;
  mode: "light" | "dark";
  /** The surface id the edits were made against. */
  surface: string;
  /** Token name → literal CSS value. */
  overrides: Readonly<Record<string, string>>;
  createdAt: string;
  createdBy?: string;
}

export const RECIPE_SCHEMA_VERSION = 1;

export interface RecipeParse {
  recipe: ThemeRecipe | null;
  /** Human-readable reason, when `recipe` is `null`. */
  error: string | null;
}

/**
 * Parses foreign JSON into a recipe, refusing everything it cannot vouch for.
 *
 * Names and values are *not* filtered here — the caller does that against its
 * live catalogue, because "is this a token this application has" is not a
 * question a parser can answer. What this does refuse is a wrong schema
 * version, a non-object, and a non-string entry.
 */
export function parseRecipe(raw: string): RecipeParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { recipe: null, error: "that is not JSON." };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { recipe: null, error: "a recipe has to be a JSON object." };
  }
  const candidate = parsed as Record<string, unknown>;
  if (candidate["schemaVersion"] !== RECIPE_SCHEMA_VERSION) {
    return {
      recipe: null,
      error: `schemaVersion ${String(candidate["schemaVersion"])} — this toolbar reads version ${RECIPE_SCHEMA_VERSION}.`,
    };
  }
  const rawOverrides = candidate["overrides"];
  if (
    rawOverrides === null ||
    typeof rawOverrides !== "object" ||
    Array.isArray(rawOverrides)
  ) {
    return { recipe: null, error: "the recipe has no `overrides` object." };
  }
  const overrides: Record<string, string> = {};
  for (const [name, value] of Object.entries(
    rawOverrides as Record<string, unknown>,
  )) {
    if (typeof value !== "string") continue;
    // `Object.defineProperty`, not assignment: an override literally called
    // `__proto__` must round-trip as data. `/runtime`'s `redact()` learned this
    // the hard way (§12.5) and every rebuild path in this package now does it.
    Object.defineProperty(overrides, name, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  const mode = candidate["mode"];
  return {
    recipe: {
      schemaVersion: RECIPE_SCHEMA_VERSION,
      name: typeof candidate["name"] === "string" ? candidate["name"] : "Theme",
      mode: mode === "dark" ? "dark" : "light",
      surface:
        typeof candidate["surface"] === "string"
          ? candidate["surface"]
          : DEFAULT_SURFACE.id,
      overrides,
      createdAt:
        typeof candidate["createdAt"] === "string"
          ? candidate["createdAt"]
          : "",
      ...(typeof candidate["createdBy"] === "string"
        ? { createdBy: candidate["createdBy"] }
        : {}),
    },
    error: null,
  };
}
