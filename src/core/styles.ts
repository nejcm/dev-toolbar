import { CORE_CSS } from "./css";

const STYLE_ATTRIBUTE = "data-dev-toolbar-styles";
const CORE_STYLE_ENTRY = "core";

/**
 * Injects a stylesheet once per document per entry. Dedupes via the DOM (not a
 * module-level flag) so separate ESM/CJS or bundled copies still inject only
 * once. Call from inside a component, never at module scope, to keep
 * `sideEffects: false` honest.
 *
 * Deliberately the same shape as `ensureStyleSheet` in `src/runtime/styles.ts`
 * — core may not import `runtime/`, so the two are kept in step by hand.
 *
 * @param entry Unique per stylesheet. Core uses `"core"`.
 * @param nonce CSP nonce, set as the `nonce` *property* (the attribute is
 * hidden by browsers once read back). Without it, a host sending
 * `style-src 'self' 'nonce-…'` blocks the injected stylesheet with no
 * diagnosable failure — this function still returns a valid element either
 * way. Applied only when the element is created: a later call with a different
 * nonce does not mutate an existing sheet, because the nonce is evaluated at
 * insertion time and this function is first-writer-wins.
 */
export function ensureStyles(
  entry: string = CORE_STYLE_ENTRY,
  css: string = CORE_CSS,
  doc?: Document,
  nonce?: string,
): HTMLStyleElement | null {
  const target = doc ?? (typeof document === "undefined" ? null : document);
  if (!target?.head) return null;

  // `entry` is developer-supplied, not attacker-controlled — this is about
  // correctness, not injection: interpolated raw into an attribute selector, a
  // `"` in it changes the selector's meaning, and `querySelector` throws a
  // `SyntaxError` out of a render effect. Comparing the attribute directly
  // sidesteps escaping entirely, and is O(n) over a handful of elements.
  const existing = Array.from(
    target.head.querySelectorAll<HTMLStyleElement>(`style[${STYLE_ATTRIBUTE}]`),
  ).find((node) => node.getAttribute(STYLE_ATTRIBUTE) === entry);
  if (existing) return existing;

  const style = target.createElement("style");
  style.setAttribute(STYLE_ATTRIBUTE, entry);
  if (nonce) style.nonce = nonce;
  style.textContent = css;
  target.head.appendChild(style);
  return style;
}

export { CORE_CSS };
