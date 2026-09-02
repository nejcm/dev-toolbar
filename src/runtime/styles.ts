/**
 * Inject a stylesheet once per document. [dev-toolbar/runtime]
 *
 * Core's `injectStyles` prop isn't visible to extensions, so any extension
 * shipping CSS needs its own injector; this is the shared one. It lives here
 * rather than in core so importing it doesn't drag core's stylesheet string
 * into an extension's bundle (extensions already import `/runtime`; core
 * never does).
 *
 * The dedup key is a DOM attribute rather than a module flag, so two bundled
 * copies of a package (the dual-package hazard, or two toolbars on one page)
 * still inject exactly once.
 */

export const STYLE_ATTRIBUTE = "data-dev-toolbar-styles";

/**
 * @param entry Unique per stylesheet, e.g. `"ext-metrics"`. Core uses `"core"`.
 * @param nonce CSP nonce, set as the `nonce` *property* (the attribute is hidden
 * by browsers once read back). Without it, a host sending `style-src 'self'
 * 'nonce-…'` blocks the injected stylesheet with no diagnosable failure — the
 * function still returns a valid element either way. Applied only when the
 * element is created: a later call with a different nonce does not mutate an
 * existing sheet — the CSP nonce is evaluated at insertion time, and this
 * function is first-writer-wins.
 * @returns The existing or newly created element, or `null` with no document.
 */
export function ensureStyleSheet(
  entry: string,
  css: string,
  doc?: Document,
  nonce?: string,
): HTMLStyleElement | null {
  const target = doc ?? (typeof document === "undefined" ? null : document);
  if (!target?.head) return null;
  // `entry` is developer-supplied, not attacker-controlled — this is about
  // correctness, not injection: a raw string in an attribute selector could
  // change the selector's meaning on a `"`. Comparing the attribute directly
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
