/**
 * Shared vocabulary for `/ext/theme-editor`. [dev-toolbar/ext/theme-editor]
 *
 * Design tokens are **consumer-owned state**: this extension owns no design
 * system and generates no palette. You hand it the tokens your application
 * publishes; it edits them, shows the difference, and gives the edit back as
 * something pasteable into code or handed to a designer. The one state it owns
 * is the override map — a toolbar preference nothing else in the app knows.
 *
 * Two validation rules carry the safety story, deliberately different:
 * - **A token *name* is validated, never redacted.** It ends up as a CSS
 *   identifier in inline style and exported CSS text, so the hazard is
 *   *syntax* — `;` or `}` closes the declaration and opens an attacker's rule.
 *   Masking it would corrupt every export and guard nothing.
 * - **A token *value* is validated *and* redacted.** Validated because it's
 *   about to be written into the page; redacted because it's about to leave
 *   on a clipboard.
 */

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
 * Prefixes this extension will never write, whatever a consumer declares —
 * the guard against an app edit restyling the toolbar. The toolbar is styled
 * entirely from `--dtb-*` and publishes `--dev-toolbar-height`; since `:root`
 * is an ancestor of the portalled toolbar root, writing either name there
 * would repaint the tool you're using to make the edit.
 *
 * This is a **refusal to write the name at all**, not a CSS rule, so it never
 * has to win an argument with the consumer's stylesheet. Restyling the bar is
 * still supported — just from your own stylesheet, unlayered, per §4.1.
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
 * Constructs that must never reach a declaration this extension writes or
 * exports: `;{}` open/close a declaration or rule, `\` and `/*` hide a
 * comment-terminated payload, `<` matters because this string may be pasted
 * into a `<style>` block, and `url(`/`image-set(`/`@import` fetch — a shared
 * theme link causing a request to another host would be exfiltration, not a
 * cosmetic problem. This is a deny list of escaping constructs, not an allow
 * list — `var()`, `calc()`, `color-mix()` etc. are all fine.
 */
const VALUE_FORBIDDEN =
  /[;{}<>\\]|\/\*|\*\/|\burl\s*\(|\bimage-set\s*\(|\bexpression\s*\(|@import|\bsrc\s*:/i;

const NUMBER_SHAPE = /^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;
const LENGTH_SHAPE =
  /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%|vh|vw|vmin|vmax|ch|ex|pt|pc|cm|mm|in|q|deg|rad|turn|s|ms|fr)?$/i;
const FUNCTIONAL = /^(?:calc|clamp|min|max|var|env|round)\s*\(/i;

/**
 * Accepts or refuses one edited value. The safety pass is universal and
 * strict; the *type* pass refuses only what's definitely not that type
 * (numbers/lengths have a fixed shape) and lets colours and free strings
 * through, since a matcher trying to enumerate valid color syntax would
 * refuse tomorrow's. Returns `undefined` rather than a coerced fallback: a
 * refused edit is recoverable, a silently corrected one is not.
 */
export function checkTokenValue(type: TokenType, raw: string): ValueRefusal | null {
  const value = raw.trim();
  if (value === "") return "empty";
  if (value.length > MAX_VALUE_LENGTH) return "too-long";
  if (VALUE_FORBIDDEN.test(value)) return "syntax";
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
      return "contains something this editor will not write into a stylesheet — ; { } < > \\ /* or url().";
    case "type":
      return `not a ${type}.`;
  }
}

/**
 * True when a surface selector is safe to print into exported CSS text.
 *
 * `querySelector` already fails closed on a malformed selector at *resolve*
 * time, but `cssText` **prints** it regardless — e.g.
 * `:root { } body { background: url(…) } .z` resolves to nothing, yet would
 * still export a working rule the consumer never wrote. So this refuses to
 * emit rather than tries to escape: the deny list covers only characters that
 * end a selector and start something else (`;{}`, a comment opener, `<`, a
 * backslash escape, `url(`).
 *
 * Combinators (`>`, `+`, `~`) are deliberately *not* denied — `#app > main` is
 * an ordinary selector, and refusing it would silently export the block
 * scoped to `:root` instead, a wrong scope that's worse than a refusal. `@` is
 * allowed except at the start (the only position it can open an at-rule); it's
 * legal inside an attribute selector's value.
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
   * The application's own value, ignoring this extension's edit. Supplied by
   * the consumer via `value`, or read off the surface with `getComputedStyle`
   * — but only while the token is **not** overridden; the last pre-override
   * read is kept afterwards, since once the override is on the element the
   * computed value *is* the override, and re-reading it would falsely claim
   * the app already agreed with the edit.
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
   * value — its description or group name. Kept separate from `masked`
   * because `masked` drives the editor (it refuses to seed itself from a
   * masked value) while a row with only a scrubbed *description* still has a
   * usable value — but both are exported (Figma `$description`, group as a
   * JSON key), so anything counting what was withheld from an outbound
   * document must include them too.
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
 * §3H's shareable recipe, with one deliberate divergence: §3H suggests an
 * OKLCH delta (`overrides: Record<string, { l?, c?, h?, alpha? }>` plus
 * `inputs: { base, accent, contrast }`), which presumes the toolbar owns a
 * colour model and scale generator. This extension owns neither, so an
 * override here is the **literal value** the token takes — a complete,
 * self-describing document rather than a delta against a generator the
 * reader may not have. That also makes the Figma pipeline deterministic:
 * what is exported is what is applied.
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
