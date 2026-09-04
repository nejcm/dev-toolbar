/**
 * `/ext/overlays` styles. [dev-toolbar/ext/overlays]
 *
 * Same rules as core and the other extensions: everything inside the
 * `dev-toolbar` cascade layer, scoped by `[data-dev-toolbar]`, colours from
 * `--dtb-*` tokens, parts namespaced `ovl-*`.
 *
 * Exception: the drawing surface's four `!important` declarations
 * (`pointer-events`, `z-index`, `position`, `inset`) — the only ones in this
 * package. Layered CSS is designed to lose to unlayered author CSS (so
 * consumers can restyle without `!important`), but that is wrong for safety:
 * a stray unlayered `div { pointer-events: auto }` would re-enable pointer
 * events on the surface and let it swallow every click in the page (review
 * demonstrated exactly that). `!important` blocks this because the cascade
 * reverses layer order for important declarations, so a layered-important
 * rule beats an unlayered-important one. Only a rule deliberately targeting
 * this part inside `@layer dev-toolbar` can still override them — someone
 * switching the guard off on purpose.
 *
 * What each one protects: `pointer-events: none` keeps every click landing on
 * the app underneath; `z-index: -1` (inside the toolbar root's own stacking
 * context) paints the surface over the page but under the bar, panel and
 * command palette; `position: fixed` + `inset: 0` cover the viewport rather
 * than the 30px bar, and guard against the `display: contents` wrapper
 * turning a `position: static` surface into a height-adding flex child.
 *
 * Everything else is ordinary layered CSS and stays overridable.
 */
import { KIT_CSS, createStyleInjector, ensureKitStyles } from "@nejcm/dev-toolbar/kit";

const OVERLAYS_EXTENSION_CSS = String.raw`@layer dev-toolbar {
  [data-dev-toolbar] [data-dtb-part="ovl-surface"] {
    /* The four !important declarations — see file header. Do not remove. */
    position: fixed !important;
    inset: 0 !important;
    z-index: -1 !important;
    /* Repeated on every descendant below so nothing can become a click target. */
    pointer-events: none !important;
    overflow: hidden;
    font-family: var(--dtb-font-mono);
    font-size: 10px;
    line-height: 1.3;
    -webkit-user-select: none;
    user-select: none;
  }

  [data-dev-toolbar] [data-dtb-part="ovl-surface"] * {
    pointer-events: none !important;
  }

  /* ---- Column grid ---- */

  [data-dev-toolbar] [data-dtb-part="ovl-grid"] {
    position: absolute;
    inset: 0;
  }

  [data-dev-toolbar] [data-dtb-part="ovl-grid-columns"],
  [data-dev-toolbar] [data-dtb-part="ovl-grid-baseline"] {
    position: absolute;
    inset: 0;
  }

  [data-dev-toolbar] [data-dtb-part="ovl-grid-columns"] {
    /* left + translateX(-50%) centres symmetrically without RTL mirroring;
       inset-inline-start: 50% would NOT be equivalent under dir="rtl". */
    left: 50%;
    right: auto;
    transform: translateX(-50%);
  }

  /* ---- Element inspector ---- */

  [data-dev-toolbar] [data-dtb-part="ovl-box"] {
    position: absolute;
    box-sizing: border-box;
  }

  [data-dev-toolbar] [data-dtb-part="ovl-box"][data-dtb-box="margin"] {
    background: rgba(246, 178, 107, 0.16);
    outline: 1px dashed rgba(246, 178, 107, 0.8);
  }

  [data-dev-toolbar] [data-dtb-part="ovl-box"][data-dtb-box="border"] {
    background: rgba(88, 166, 255, 0.14);
    outline: 1px solid var(--dtb-accent);
  }

  [data-dev-toolbar] [data-dtb-part="ovl-box"][data-dtb-box="content"] {
    outline: 1px dashed rgba(88, 166, 255, 0.7);
  }

  [data-dev-toolbar] [data-dtb-part="ovl-label"] {
    position: absolute;
    display: flex;
    align-items: center;
    gap: var(--dtb-chip-gap);
    max-width: 90vw;
    padding: 2px var(--dtb-chip-gap);
    border-radius: var(--dtb-radius);
    background: var(--dtb-panel-bg);
    color: var(--dtb-fg);
    border: 1px solid var(--dtb-border);
    box-shadow: var(--dtb-shadow);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  [data-dev-toolbar] [data-dtb-part="ovl-label-name"] {
    color: var(--dtb-accent);
  }

  [data-dev-toolbar] [data-dtb-part="ovl-label-size"],
  [data-dev-toolbar] [data-dtb-part="ovl-label-note"] {
    color: var(--dtb-muted);
  }

  /* ---- Focus order ---- */

  [data-dev-toolbar] [data-dtb-part="ovl-focus-box"] {
    position: absolute;
    box-sizing: border-box;
    outline: 1px dashed var(--dtb-ok);
    outline-offset: 1px;
  }

  [data-dev-toolbar]
    [data-dtb-part="ovl-focus-box"][data-dtb-named="false"] {
    outline-color: var(--dtb-danger);
    background: var(--dtb-danger-bg);
  }

  [data-dev-toolbar] [data-dtb-part="ovl-focus-badge"] {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: 260px;
    padding: 0 4px;
    border-radius: var(--dtb-radius);
    background: var(--dtb-ok);
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  [data-dev-toolbar]
    [data-dtb-part="ovl-focus-badge"][data-dtb-named="false"] {
    background: var(--dtb-danger);
  }

  [data-dev-toolbar] [data-dtb-part="ovl-notice"] {
    position: absolute;
    top: 8px;
    /* left + translateX(-50%) centres symmetrically without RTL mirroring. */
    left: 50%;
    transform: translateX(-50%);
    padding: 2px 8px;
    border-radius: var(--dtb-radius);
    background: var(--dtb-warn-bg);
    color: var(--dtb-warn);
    border: 1px solid var(--dtb-border);
  }

  /* ---- Bar chip ---- */

  [data-dev-toolbar] [data-dtb-part="ovl-chip"][data-dtb-active="true"]
    [data-dtb-part="ovl-dot"] {
    background: var(--dtb-accent);
  }

  /* ---- Panel ---- */

  [data-dev-toolbar] [data-dtb-part="ovl-panel"] {
    display: flex;
    flex-direction: column;
    gap: var(--dtb-space-3);
    max-width: 720px;
  }

  /* One overlay is one card: the switch on the first line, and its summary,
     cost and any note indented under it in the second column, so a row of
     four reads as four decisions rather than as a paragraph. */
  /* The part+kind pair keeps this padding override above the kit's row default. */
  [data-dev-toolbar] [data-dtb-part="ovl-row"][data-dtb-kind="row"] {
    grid-template-columns: auto 1fr;
    gap: var(--dtb-space-1) var(--dtb-space-2);
    padding: var(--dtb-space-3);
  }

  [data-dev-toolbar] [data-dtb-part="ovl-row"][data-dtb-on="true"] {
    background: var(--dtb-item-active-bg);
  }

  [data-dev-toolbar] [data-dtb-part="ovl-toggle"] {
    display: flex;
    align-items: center;
    gap: var(--dtb-chip-gap);
    grid-column: 1 / -1;
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  [data-dev-toolbar] [data-dtb-part="ovl-summary"],
  [data-dev-toolbar] [data-dtb-part="ovl-cost"] {
    grid-column: 2;
    margin: 0;
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="ovl-note"] {
    grid-column: 2;
  }

  [data-dev-toolbar] [data-dtb-part="ovl-cost"]::before {
    content: "cost: ";
    font-family: var(--dtb-font-mono);
  }

  [data-dev-toolbar] [data-dtb-part="ovl-tag"] {
    background: var(--dtb-warn-bg);
    color: var(--dtb-warn);
    font-family: var(--dtb-font-mono);
  }

  [data-dev-toolbar] [data-dtb-part="ovl-error"] {
    background: var(--dtb-danger-bg);
    color: var(--dtb-danger);
  }

  /* No data-dtb-bleed here for the same reason as the theme editor's masthead:
     this panel caps itself at 720px, so its rule belongs to that measure and
     not to the panel's inline edges. */
  [data-dev-toolbar] [data-dtb-part="ovl-actions"] {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--dtb-space-2);
    padding-top: var(--dtb-space-3);
    border-top: 1px solid var(--dtb-border);
  }
}
`;

// Self-contained manual CSS deliberately repeats KIT_CSS; automatic injection deduplicates it.
export const OVERLAYS_CSS = `${KIT_CSS}\n${OVERLAYS_EXTENSION_CSS}`;

const injectOverlaysStyles = createStyleInjector("ext-overlays", OVERLAYS_EXTENSION_CSS);

export function ensureOverlaysStyles(doc?: Document, nonce?: string): HTMLStyleElement | null {
  ensureKitStyles(doc, nonce);
  return injectOverlaysStyles(doc, nonce);
}
