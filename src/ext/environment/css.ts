/**
 * `/ext/environment` styles. [dev-toolbar/ext/environment]
 *
 * Same rules as core and `/ext/metrics`: scoped by `[data-dev-toolbar]` inside
 * the `dev-toolbar` cascade layer, colours from `--dtb-*` tokens, `data-dtb-part`
 * names namespaced by kind (`env-*`) rather than instance id.
 */
import { ensureStyleSheet } from "../../runtime";

export const ENVIRONMENT_CSS = String.raw`@layer dev-toolbar {
  [data-dev-toolbar] [data-dtb-part="env-chip"] {
    display: inline-flex;
    align-items: center;
    gap: var(--dtb-chip-gap);
    white-space: nowrap;
  }

  [data-dev-toolbar] [data-dtb-part="env-dot"] {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--dtb-muted);
    flex: 0 0 auto;
  }

  [data-dev-toolbar] [data-dtb-severity="ok"] [data-dtb-part="env-dot"] {
    background: var(--dtb-ok);
  }

  [data-dev-toolbar] [data-dtb-severity="warn"] [data-dtb-part="env-dot"] {
    background: var(--dtb-warn);
  }

  [data-dev-toolbar] [data-dtb-severity="bad"] [data-dtb-part="env-dot"] {
    background: var(--dtb-danger);
  }

  [data-dev-toolbar] [data-dtb-part="env-label"] {
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="env-value"] {
    font-family: var(--dtb-font-mono);
  }

  [data-dev-toolbar] [data-dtb-severity="warn"] [data-dtb-part="env-value"] {
    color: var(--dtb-warn);
  }

  [data-dev-toolbar] [data-dtb-severity="bad"] [data-dtb-part="env-value"] {
    color: var(--dtb-danger);
  }

  /* Impersonation has to be unmistakable, in the bar and in the panel. */
  [data-dev-toolbar] [data-dtb-part="env-alert"] {
    display: inline-flex;
    align-items: center;
    gap: var(--dtb-space-1);
    padding: 0 var(--dtb-space-1);
    border-radius: var(--dtb-radius);
    background: var(--dtb-danger-bg);
    color: var(--dtb-danger);
    font-family: var(--dtb-font-mono);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  [data-dev-toolbar] [data-dtb-part="env-panel"] {
    display: flex;
    flex-direction: column;
    gap: var(--dtb-space-3);
    height: 100%;
    min-height: 0;
  }

  [data-dev-toolbar] [data-dtb-part="env-banner"] {
    flex: 0 0 auto;
    padding: var(--dtb-space-2) var(--dtb-space-3);
    border-radius: var(--dtb-radius);
    background: var(--dtb-danger-bg);
    color: var(--dtb-danger);
    border: 1px solid var(--dtb-danger);
  }

  [data-dev-toolbar] [data-dtb-part="env-body"] {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    /* Sections are separated by air and by their legend rule, not by boxes,
       so the gap has to be big enough to beat the row gap inside a section
       several times over. */
    gap: var(--dtb-space-5);
  }

  /* The heading also carries data-dtb-legend, which is where its type and its
     trailing rule come from — core owns that treatment so every extension's
     sections look alike. Nothing is left to restate here. */

  [data-dev-toolbar] [data-dtb-part="env-rows"] {
    display: grid;
    grid-template-columns: max-content 1fr;
    /* A wide column gap is what makes a two-column readout scannable: the
       values line up as their own column instead of trailing their labels. */
    gap: var(--dtb-space-1) var(--dtb-space-5);
    margin: 0;
  }

  [data-dev-toolbar] [data-dtb-part="env-rows"] dt {
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="env-rows"] dd {
    margin: 0;
    font-family: var(--dtb-font-mono);
    word-break: break-word;
  }

  [data-dev-toolbar] [data-dtb-part="env-row-value"][data-dtb-alarming="true"] {
    color: var(--dtb-danger);
  }

  [data-dev-toolbar] [data-dtb-part="env-missing"] {
    color: var(--dtb-muted);
    font-family: var(--dtb-font-family);
    font-style: italic;
  }

  [data-dev-toolbar] [data-dtb-part="env-tag"] {
    margin-inline-start: var(--dtb-chip-gap);
    padding: 0 var(--dtb-space-1);
    border-radius: var(--dtb-radius);
    font-family: var(--dtb-font-family);
    font-size: calc(var(--dtb-font-size) - 1px);
    color: var(--dtb-muted);
    background: var(--dtb-item-hover-bg);
    vertical-align: 1px;
  }

  [data-dev-toolbar] [data-dtb-part="env-tag"][data-dtb-tag="masked"] {
    color: var(--dtb-warn);
    background: var(--dtb-warn-bg);
  }

  [data-dev-toolbar] [data-dtb-part="env-empty"] {
    display: flex;
    flex-direction: column;
    gap: var(--dtb-space-2);
    max-width: 70ch;
    color: var(--dtb-fg);
  }

  [data-dev-toolbar] [data-dtb-part="env-empty"] code {
    font-family: var(--dtb-font-mono);
  }

  /* The panel's floor: a rule across the measure with the copy actions under
     it. Its rule and a section legend's rule share the same two ends, so the
     panel reads as one ruled column rather than as stacked fragments. */
  [data-dev-toolbar] [data-dtb-part="env-actions"] {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--dtb-space-2);
    flex: 0 0 auto;
    padding-top: var(--dtb-space-3);
    border-top: 1px solid var(--dtb-border);
  }

  [data-dev-toolbar] [data-dtb-part="env-action"] {
    display: inline-flex;
    align-items: center;
    min-height: var(--dtb-control-height);
    padding: 0 var(--dtb-control-padding-x);
    border: 1px solid var(--dtb-border);
    border-radius: var(--dtb-radius);
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  [data-dev-toolbar] [data-dtb-part="env-action"]:hover {
    background: var(--dtb-item-hover-bg);
  }

  [data-dev-toolbar] [data-dtb-part="env-action"]:focus-visible {
    outline: 2px solid var(--dtb-accent);
    outline-offset: -1px;
  }

  [data-dev-toolbar] [data-dtb-part="env-note"] {
    color: var(--dtb-muted);
    margin: 0;
  }

  /* Inside a ⋮ row, which supplies the padding — see core's
     overflow-menu-item. */
  [data-dev-toolbar] [data-dtb-part="env-overflow"] {
    display: flex;
    flex-direction: column;
    gap: var(--dtb-space-1);
    padding: 0;
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
    text-align: start;
  }
}
`;

const ENVIRONMENT_STYLE_ENTRY = "ext-environment";

/**
 * Injects the stylesheet once per document via `/runtime`'s shared injector
 * (dedup key is a DOM attribute, so two bundled copies still inject once).
 * Core's `injectStyles` prop isn't visible to extensions, so this extension
 * has its own switch — `environment({ injectStyles: false })` — and exports
 * `ENVIRONMENT_CSS` for consumers who ship CSS themselves.
 */
export function ensureEnvironmentStyles(doc?: Document): HTMLStyleElement | null {
  return ensureStyleSheet(ENVIRONMENT_STYLE_ENTRY, ENVIRONMENT_CSS, doc);
}
