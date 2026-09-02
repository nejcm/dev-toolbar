import { CORE_CSS } from "./css";

const STYLE_ATTRIBUTE = "data-dev-toolbar-styles";
const CORE_STYLE_ENTRY = "core";

/**
 * Injects a stylesheet once per document per entry. Dedupes via the DOM (not a
 * module-level flag) so separate ESM/CJS or bundled copies still inject only
 * once. Call from inside a component, never at module scope, to keep
 * `sideEffects: false` honest.
 */
export function ensureStyles(
  entry: string = CORE_STYLE_ENTRY,
  css: string = CORE_CSS,
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

export { CORE_CSS };
