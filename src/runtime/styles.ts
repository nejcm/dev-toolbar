/**
 * Inject a stylesheet once per document. [dev-toolbar/runtime]
 *
 * Core's `injectStyles` prop is a *prop*, so an extension cannot see it, and an
 * extension that ships CSS therefore has to carry its own switch and its own
 * injector. `/ext/metrics` wrote one; `/ext/environment` was about to write the
 * same one again, which is the point at which it belongs somewhere shared.
 *
 * It lives here rather than in core for the reason the whole subpath exists:
 * importing core's injector would drag core's entire stylesheet string into an
 * extension's bundle. Extensions already import `/runtime`; core never does.
 *
 * The dedup key is a DOM attribute rather than a module flag, so two bundled
 * copies of a package — the dual-package hazard, or two toolbars on one page —
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
  // `entry` is developer-supplied but not attacker-controlled, so this is about
  // correctness, not an injection attack: a raw string interpolated into an
  // attribute selector changes the selector's meaning on a `"` (impersonating
  // another entry) and throws a SyntaxError on an unbalanced one. Comparing
  // the attribute directly sidesteps escaping entirely — it's O(n) over a
  // handful of style elements, which is simpler and just as fast as feature
  // detecting `CSS.escape`.
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
