/**
 * `/ext/overlays` styles. [dev-toolbar/ext/overlays]
 *
 * Same rules as core and the other extensions: inside the `dev-toolbar` cascade
 * layer, every selector scoped by `[data-dev-toolbar]`, every colour from a
 * `--dtb-*` token where a token exists, every part name namespaced by kind
 * (`ovl-*`).
 *
 * With one deliberate exception, and it is the most important thing in this
 * file. **Four declarations on the drawing surface carry `!important`**, which
 * nothing else in this package does.
 *
 * The reason is that §4.1's layering is designed to *lose*: unlayered author CSS
 * beats any layered rule, at any specificity, so that a consumer can restyle the
 * bar without `!important`. That is right for colour and wrong for safety. A
 * single unlayered `div { pointer-events: auto }` — a reset, a drag-and-drop
 * library, the weakest rule CSS can express — would otherwise re-enable pointer
 * events on the surface and let a full-viewport overlay swallow every click in
 * the page. Review demonstrated exactly that.
 *
 * `!important` fixes it in both directions, because the cascade reverses layer
 * order for important declarations: an author-important declaration beats every
 * unlayered *normal* one, and a **layered** important declaration beats an
 * unlayered important one. So a hostile-by-accident rule cannot reach these four
 * however it is written. What can still reach them is a rule deliberately
 * targeting this part *inside* `@layer dev-toolbar` with equal or greater
 * specificity — which is somebody switching the guard off on purpose, and is
 * the honest limit of what CSS can promise.
 *
 * The four, and what each one is protecting:
 *
 * - **`pointer-events: none`, on the surface and on every descendant.** Nothing
 *   this extension draws can be clicked, hovered, dragged or focused, so a click
 *   always lands on the application underneath. A debugging overlay that ate the
 *   button you were trying to press is the failure that would make the whole
 *   feature untrustworthy.
 * - **`z-index: -1`, inside the toolbar root.** The root establishes a stacking
 *   context at `--dtb-z-index`, so a negative child paints *below the bar and
 *   the panel* while the whole context still paints *above the application*.
 *   That is exactly the layer an overlay wants: over the page, under the tool.
 *   The command palette's scrim and dialog sit at `z-index: 1`/`2` in the same
 *   context, so they are above this too and the palette is never drawn over.
 *   Left overridable, `div { z-index: 0 }` would lift the surface to bar level.
 * - **`position: fixed` and `inset: 0`.** The root sets no containing block, so
 *   the surface covers the viewport rather than the 30px bar (§13.2) — and,
 *   because the wrapper is `display: contents`, a surface knocked back to
 *   `position: static` would become a flex child of the root and start adding
 *   height to the toolbar.
 *
 * Everything else here is ordinary layered CSS and stays overridable, which is
 * the point: the colours, sizes and fonts of what is drawn are yours to change.
 */
import { ensureStyleSheet } from "../../runtime";

export const OVERLAYS_CSS = String.raw`@layer dev-toolbar {
  [data-dev-toolbar] [data-dtb-part="ovl-surface"] {
    /* The four !important declarations. See the note at the top of this file:
       layered CSS is designed to lose to unlayered author CSS, which is right
       for colour and wrong for a guard. Do not remove them to be tidy. */
    position: fixed !important;
    inset: 0 !important;
    z-index: -1 !important;
    /* Nothing drawn here is interactive. Repeated on every descendant below, so
       a future addition cannot accidentally become a click target. */
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
    /* Horizontal centring, not a pinned edge: left: 50% + translateX(-50%) is
       symmetric and needs no RTL mirroring. inset-inline-start: 50% would NOT
       be equivalent — under dir="rtl" that resolves to the right edge at the
       midpoint while translateX(-50%) still shifts left by half the width,
       landing this (explicitly-widthed) element a full width off-centre.
       Left deliberately physical. */
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
    gap: 6px;
    max-width: 90vw;
    padding: 2px 6px;
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
    /* Horizontal centring, not a pinned edge: left: 50% + translateX(-50%) is
       symmetric and needs no RTL mirroring. inset-inline-start: 50% would NOT
       be equivalent — under dir="rtl" that resolves to the right edge at the
       midpoint while translateX(-50%) still shifts left by half the width,
       landing the notice a full width off-centre. Left deliberately physical. */
    left: 50%;
    transform: translateX(-50%);
    padding: 2px 8px;
    border-radius: var(--dtb-radius);
    background: var(--dtb-warn-bg);
    color: var(--dtb-warn);
    border: 1px solid var(--dtb-border);
  }

  /* ---- Bar chip ---- */

  [data-dev-toolbar] [data-dtb-part="ovl-chip"] {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  [data-dev-toolbar] [data-dtb-part="ovl-dot"] {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="ovl-chip"][data-dtb-active="true"]
    [data-dtb-part="ovl-dot"] {
    background: var(--dtb-accent);
  }

  [data-dev-toolbar] [data-dtb-part="ovl-value"] {
    font-family: var(--dtb-font-mono);
  }

  /* ---- Panel ---- */

  [data-dev-toolbar] [data-dtb-part="ovl-panel"] {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 720px;
  }

  [data-dev-toolbar] [data-dtb-part="ovl-rows"] {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  [data-dev-toolbar] [data-dtb-part="ovl-row"] {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 8px;
    padding: 6px 8px;
    border: 1px solid var(--dtb-border);
    border-radius: var(--dtb-radius);
  }

  [data-dev-toolbar] [data-dtb-part="ovl-row"][data-dtb-on="true"] {
    background: var(--dtb-item-active-bg);
  }

  [data-dev-toolbar] [data-dtb-part="ovl-toggle"] {
    display: flex;
    align-items: center;
    gap: 6px;
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
  [data-dev-toolbar] [data-dtb-part="ovl-cost"],
  [data-dev-toolbar] [data-dtb-part="ovl-note"] {
    grid-column: 2;
    margin: 0;
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="ovl-cost"]::before {
    content: "cost: ";
    font-family: var(--dtb-font-mono);
  }

  [data-dev-toolbar] [data-dtb-part="ovl-tag"] {
    padding: 0 4px;
    border-radius: var(--dtb-radius);
    background: var(--dtb-warn-bg);
    color: var(--dtb-warn);
    font-family: var(--dtb-font-mono);
    font-size: calc(var(--dtb-font-size) - 1px);
  }

  [data-dev-toolbar] [data-dtb-part="ovl-error"] {
    padding: 6px 8px;
    border-radius: var(--dtb-radius);
    background: var(--dtb-danger-bg);
    color: var(--dtb-danger);
  }

  [data-dev-toolbar] [data-dtb-part="ovl-actions"] {
    display: flex;
    align-items: center;
    gap: 8px;
  }
}
`;

export function ensureOverlaysStyles(doc?: Document): HTMLStyleElement | null {
  return ensureStyleSheet("ext-overlays", OVERLAYS_CSS, doc);
}
