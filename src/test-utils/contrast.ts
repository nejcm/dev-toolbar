/**
 * WCAG 1.4.3 / 1.4.11 arithmetic over the shipped design tokens, shared by
 * core's `contrast.test.ts` and by the extension sheets that stack a token's
 * tint on top of another one.
 *
 * Not a colour library: it reads exactly the two value forms `src/styles.css`
 * declares (`#rrggbb` and `rgb()`/`rgba()`) and throws on anything else, so a
 * token this cannot parse fails the suite instead of being skipped.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* -------------------------------------------------------------------------- */
/* Colour                                                                      */
/* -------------------------------------------------------------------------- */

export type Rgba = readonly [number, number, number, number];

export function parseColor(value: string): Rgba {
  const trimmed = value.trim();
  const long = /^#([0-9a-f]{6})$/i.exec(trimmed);
  if (long) {
    const n = Number.parseInt(long[1] as string, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const short = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (short) {
    const [r, g, b] = (short[1] as string).split("").map((c) => Number.parseInt(c + c, 16));
    return [r as number, g as number, b as number, 1];
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(
    trimmed,
  );
  if (fn) {
    return [Number(fn[1]), Number(fn[2]), Number(fn[3]), fn[4] === undefined ? 1 : Number(fn[4])];
  }
  // Fails closed: a token this cannot read must not be silently skipped.
  throw new Error(`contrast: unreadable colour ${JSON.stringify(value)}`);
}

/** Source-over composite. The toolbar's grounds are opaque, so the result is. */
export function composite(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
}

/** WCAG 2.x relative luminance (sRGB). */
function luminance(c: Rgba): number {
  const channel = (raw: number): number => {
    const s = raw / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
}

export function contrastRatio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/* -------------------------------------------------------------------------- */
/* Tokens                                                                      */
/* -------------------------------------------------------------------------- */

export type Tokens = Readonly<Record<string, string>>;

const STYLESHEET = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

/** The `--dtb-*` declarations of the one block whose prelude ends at `marker`. */
function declarationsAfter(marker: string, sheet: string = STYLESHEET): Tokens {
  const at = sheet.indexOf(marker);
  if (at === -1) throw new Error(`contrast: block not found: ${marker}`);
  if (sheet.indexOf(marker, at + 1) !== -1) {
    throw new Error(`contrast: block prelude is not unique: ${marker}`);
  }
  let depth = 0;
  let start = -1;
  for (let i = at; i < sheet.length; i += 1) {
    const ch = sheet[i];
    if (ch === "{") {
      if (depth === 0) start = i + 1;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const body = sheet.slice(start, i);
        const out: Record<string, string> = {};
        for (const m of body.matchAll(/(--dtb-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
          out[m[1] as string] = (m[2] as string).trim();
        }
        return out;
      }
    }
  }
  throw new Error(`contrast: unbalanced block: ${marker}`);
}

const LIGHT_BLOCK = "[data-dev-toolbar] {";
const DARK_BLOCK = '[data-dev-toolbar][data-dtb-color-scheme="dark"] {';
const DARK_MEDIA_BLOCK = '[data-dev-toolbar]:not([data-dtb-color-scheme="light"]) {';

export const light = declarationsAfter(LIGHT_BLOCK);
export const darkExplicit = declarationsAfter(DARK_BLOCK);
export const darkPreferred = declarationsAfter(DARK_MEDIA_BLOCK);

/**
 * Dark is only ever an override of light: a token the dark blocks do not
 * restate keeps its light value, and is measured with the dark grounds.
 */
export const THEMES: ReadonlyArray<readonly [string, Tokens]> = [
  ["light", light],
  ["dark", { ...light, ...darkExplicit }],
  ["dark (prefers-color-scheme)", { ...light, ...darkPreferred }],
];

function read(tokens: Tokens, name: string): string {
  const value = tokens[name];
  if (value === undefined) throw new Error(`contrast: no such token: ${name}`);
  return value;
}

/* -------------------------------------------------------------------------- */
/* Measuring                                                                   */
/* -------------------------------------------------------------------------- */

/** Small text owes 4.5:1 (1.4.3); non-text owes 3:1 (1.4.11). */
export const FLOOR = { text: 4.5, nontext: 3 } as const;

/**
 * A ground is a stack: the opaque surface first, then any translucent layers
 * painted over it, outermost last. `"@tint"` is the foreground's own
 * `<token>-bg`, which is how a badge and a banner are drawn — the severity
 * colour on a low alpha of itself over whatever surface it sits on.
 */
export function ratioOn(tokens: Tokens, fg: string, ground: readonly string[]): number {
  const tint = `${fg}-bg`;
  let surface = parseColor(read(tokens, ground[0] as string));
  for (const layer of ground.slice(1)) {
    surface = composite(parseColor(read(tokens, layer === "@tint" ? tint : layer)), surface);
  }
  return contrastRatio(parseColor(read(tokens, fg)), surface);
}
