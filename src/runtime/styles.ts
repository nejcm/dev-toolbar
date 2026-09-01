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
 * @returns The existing or newly created element, or `null` with no document.
 */
export function ensureStyleSheet(
  entry: string,
  css: string,
  doc?: Document,
): HTMLStyleElement | null {
  const target = doc ?? (typeof document === "undefined" ? null : document);
  if (!target?.head) return null;
  const existing = target.head.querySelector<HTMLStyleElement>(
    `style[${STYLE_ATTRIBUTE}="${entry}"]`,
  );
  if (existing) return existing;
  const style = target.createElement("style");
  style.setAttribute(STYLE_ATTRIBUTE, entry);
  style.textContent = css;
  target.head.appendChild(style);
  return style;
}
