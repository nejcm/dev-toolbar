/**
 * Shared vocabulary for `/ext/theme-editor`. Design tokens are
 * consumer-owned state: this extension owns no design system, only the
 * override map.
 *
 * A token *name* is validated but never redacted — it becomes a CSS
 * identifier, so the hazard is syntax (`;`/`}` closing a declaration), and
 * masking it would corrupt every export while guarding nothing. A token
 * *value* is both validated (it's written into the page) and redacted (it
 * can leave on a clipboard).
 */
import { matchesQuery as matchesKitQuery, type SeverityWithOverride } from "@nejcm/dev-toolbar/kit";

/** What kind of value a token holds — decides the editor, parsing strictness, and (per `render()` in the runtime) whether the value may be masked by key name. */
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
   * The application's own value, **before any toolbar edit**. Omit it and the
   * extension reads the computed value off the surface element instead (the
   * usual case). See `TokenView.base` for what that costs.
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
 * One place edits are applied. The selector is resolved with
 * `document.querySelector` at apply time, so a surface not yet on the page
 * simply has nothing to write to and says so.
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
 * `:root` is an ancestor of the portalled toolbar root, so writing `--dtb-*`
 * or `--dev-toolbar-height` there would repaint the tool you're using to make
 * the edit — refused as a name, not fought as a cascade rule.
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
 * Deny list of escaping constructs (not an allow list — `var()`, `calc()`
 * etc. are fine): `;{}` open/close a declaration, `\` and comment markers
 * hide a terminated payload, `<` matters since this may be pasted into a
 * `<style>` block, and `url(`/`image-set(`/`@import` would let a shared
 * theme link fetch from another host.
 */
const VALUE_FORBIDDEN =
  /[;{}<>\\]|\/\*|\*\/|\burl\s*\(|\bimage-set\s*\(|\bexpression\s*\(|@import|\bsrc\s*:/i;

/** How deeply `()`/`[]` may nest before a value is treated as pathological. */
const MAX_NESTING_DEPTH = 32;

/**
 * A quote-aware structural scan for balance that `VALUE_FORBIDDEN`'s
 * character deny list can't catch (e.g. `calc(` that never closes) — an
 * unbalanced value printed into a `cssText()` export would swallow the
 * declarations after it.
 *
 * Must run after `VALUE_FORBIDDEN`: `\` is already denied by then, so this
 * scanner needs no escape state. Moving it earlier would make `"a\"b"`
 * misread as a string.
 *
 * `!` is refused outside quotes only (`--label: "wow!"` is legitimate)
 * because a bare `!important` is silently dropped whole by CSSOM, which
 * would leave the panel claiming an edit was applied that never took.
 */
function structurallySound(value: string): boolean {
  const stack: string[] = [];
  let quote: string | null = null;
  for (const character of value) {
    if (quote !== null) {
      // An unescaped newline makes a `<bad-string>` token; the browser drops
      // the whole declaration silently, same as `!important`.
      if (character === "\n") return false;
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(" || character === "[") {
      stack.push(character === "(" ? ")" : "]");
      if (stack.length > MAX_NESTING_DEPTH) return false;
      continue;
    }
    if (character === ")" || character === "]") {
      if (stack.pop() !== character) return false;
      continue;
    }
    if (character === "!") return false;
  }
  return quote === null && stack.length === 0;
}

const NUMBER_SHAPE = /^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;
const LENGTH_SHAPE =
  /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%|vh|vw|vmin|vmax|ch|ex|pt|pc|cm|mm|in|q|deg|rad|turn|s|ms|fr)?$/i;
const FUNCTIONAL = /^(?:calc|clamp|min|max|var|env|round)\s*\(/i;

/**
 * The type-independent (and whole security-relevant) half of
 * `checkTokenValue`, split out so the pre-mount reader and the mounted
 * runtime share one policy. Not exported — `checkStoredEntry` is the
 * intended door for a caller with no catalogue.
 */
function checkTokenValueShape(raw: string): ValueRefusal | null {
  const value = raw.trim();
  if (value === "") return "empty";
  if (value.length > MAX_VALUE_LENGTH) return "too-long";
  if (VALUE_FORBIDDEN.test(value)) return "syntax";
  if (!structurallySound(value)) return "syntax";
  return null;
}

/**
 * Accepts or refuses one edited value. The type pass only refuses what's
 * definitely not that type (numbers/lengths have a fixed shape); colours and
 * free strings pass through, since enumerating valid color syntax would
 * refuse tomorrow's.
 */
export function checkTokenValue(type: TokenType, raw: string): ValueRefusal | null {
  const shape = checkTokenValueShape(raw);
  if (shape !== null) return shape;
  const value = raw.trim();
  // Must run after the structural scan — a broken `calc(` should still be refused.
  if (FUNCTIONAL.test(value)) return null;
  if (type === "number" && !NUMBER_SHAPE.test(value)) return "type";
  if (type === "length" && !LENGTH_SHAPE.test(value)) return "type";
  return null;
}

export function describeValueRefusal(refusal: ValueRefusal, type: TokenType): string {
  switch (refusal) {
    case "empty":
      return "nothing was typed — clear the override instead if that is what you meant.";
    case "too-long":
      return `longer than ${MAX_VALUE_LENGTH} characters.`;
    case "syntax":
      return (
        "contains something this editor will not write into a stylesheet — ; { } < > \\ /* or " +
        "url(), an unbalanced bracket, an unterminated string, or a bare `!`."
      );
    case "type":
      return `not a ${type}.`;
  }
}

/** The literal `/runtime` mask, refused as an incoming value. */
export const MASK_SENTINEL = "[redacted]";

/** Why a persisted entry was refused. `null` means it can be applied. */
export type StoredEntryRefusal = TokenRefusal | ValueRefusal;

/**
 * The one policy for a `name → value` pair arriving from storage rather than
 * the editor. `localStorage` is writable by every script on the origin, so
 * an entry can't be trusted just because we wrote it. Shared by the mounted
 * runtime's `vetStored` and the pre-mount `readStoredThemeOverrides`, which
 * used to disagree before this existed. `type` is optional since the
 * pre-mount caller may have no catalogue; omitting it falls back to the
 * loosest type, `"string"`.
 */
export function checkStoredEntry(
  name: string,
  value: unknown,
  options: { type?: TokenType; mask?: string } = {},
): StoredEntryRefusal | null {
  const nameRefusal = checkTokenName(name);
  // A **reserved** name is dropped rather than orphaned: it can never be
  // written, so keeping it would be residue with no way to clear one row.
  if (nameRefusal !== null) return nameRefusal;
  if (typeof value !== "string") return "syntax";
  const mask = options.mask ?? MASK_SENTINEL;
  // Never the mask itself: a redacted export read back would otherwise pin a
  // token to the literal string `[redacted]`.
  if (value.trim() === mask || value.includes(MASK_SENTINEL)) return "syntax";
  return checkTokenValue(options.type ?? "string", value);
}

/**
 * True when a surface selector is safe to print into exported CSS text.
 * `querySelector` fails closed on a malformed selector at resolve time, but
 * `cssText` prints it regardless, so a selector like
 * `:root { } body { background: url(…) } .z` could export a working rule the
 * consumer never wrote. Combinators (`>`, `+`, `~`) are deliberately not
 * denied — refusing `#app > main` would silently export the block scoped to
 * `:root` instead, a wrong scope that's worse than a refusal.
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
   * The application's own value, ignoring this extension's edit. Read via
   * `getComputedStyle` only while not overridden — once the override is on
   * the element, the computed value *is* the override, so the last
   * pre-override read is kept instead of re-reading.
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
   * True when redaction changed the description or group name rather than
   * the value. Kept separate from `masked`, which drives the editor (it
   * won't seed itself from a masked value); both still count toward what an
   * export withholds.
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

/**
 * What a consumer's `presentation` callbacks are told about the bar control.
 *
 * Deliberately not `ThemeSnapshot`: as a callback parameter this type is
 * contravariant, so every field here is one that can never be renamed without
 * breaking consumer code. It carries only what the chip paints —
 * `tokenCount`/`overriddenCount`/`preview` drive the value word and the
 * `data-dtb-edited`/`-preview` attributes; `supplied`/`writable` are the two
 * states an icon would most want to draw differently. Derivable fields
 * (`edited`, the value word, `surface`'s shape) are left out.
 */
export interface ThemeEditorBarView {
  /** How many design tokens the catalogue declares. The value word when nothing is edited. */
  tokenCount: number;
  /** How many carry a local edit. Drives `data-dtb-edited` and the value word. */
  overriddenCount: number;
  /** False while edits are held back so you can see the application untouched. Drives `data-dtb-preview`. */
  preview: boolean;
  /** False when the consumer supplied no tokens at all. */
  supplied: boolean;
  /** False when there is nowhere to write — no document, or no element matches the surface. */
  writable: boolean;
}

/** Chip/row colour. Same vocabulary the other extensions use. */
export type TokenSeverity = Exclude<SeverityWithOverride, "ok">;

export function severityFor(view: TokenView): TokenSeverity {
  if (view.applyError !== undefined) return "bad";
  if (view.refusal !== null || view.orphaned) return "warn";
  if (view.overridden) return "override";
  return "unknown";
}

export function matchesQuery(view: TokenView, query: string): boolean {
  return matchesKitQuery([view.name, view.label, view.description, view.group], query);
}

/* -------------------------------------------------------------------------- */
/* Recipes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A shareable recipe. Deliberately not a colour-model delta (`{l, c, h}` etc)
 * since this extension owns no palette generator — an override is the
 * literal value the token takes, a self-describing document. That also makes
 * the Figma export deterministic: what's exported is what's applied.
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
 * Parses foreign JSON into a recipe, refusing everything it cannot vouch for:
 * a wrong schema version, a non-object, a non-string entry. Names and values
 * are *not* filtered here — the caller checks those against its live
 * catalogue.
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
  if (rawOverrides === null || typeof rawOverrides !== "object" || Array.isArray(rawOverrides)) {
    return { recipe: null, error: "the recipe has no `overrides` object." };
  }
  const overrides: Record<string, string> = {};
  for (const [name, value] of Object.entries(rawOverrides as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    // Object.defineProperty, not assignment: an override literally named
    // `__proto__` must round-trip as data, not mutate the prototype.
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
      surface: typeof candidate["surface"] === "string" ? candidate["surface"] : DEFAULT_SURFACE.id,
      overrides,
      createdAt: typeof candidate["createdAt"] === "string" ? candidate["createdAt"] : "",
      ...(typeof candidate["createdBy"] === "string" ? { createdBy: candidate["createdBy"] } : {}),
    },
    error: null,
  };
}
