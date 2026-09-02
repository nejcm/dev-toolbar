/**
 * `/ext/flags` styles. [dev-toolbar/ext/flags]
 *
 * Same rules as core, `/ext/metrics` and `/ext/environment`: scoped under
 * `[data-dev-toolbar]`, colours from `--dtb-*` tokens, `data-dtb-part` names
 * namespaced `flag-*`.
 *
 * An active override maps to `--dtb-accent` (§7's colour table). An override
 * the application never received outranks it and is graded `bad` (danger
 * tokens) — a row claiming "overridden" while the app disagrees is the one
 * failure this panel exists to make impossible.
 */
import { ensureStyleSheet } from "../../runtime";

export const FLAGS_CSS = String.raw`@layer dev-toolbar {
  [data-dev-toolbar] [data-dtb-part="flag-chip"] {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }

  [data-dev-toolbar] [data-dtb-part="flag-label"] {
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="flag-count"] {
    font-family: var(--dtb-font-mono);
  }

  [data-dev-toolbar] [data-dtb-part="flag-chip"][data-dtb-overridden="true"]
    [data-dtb-part="flag-count"] {
    color: var(--dtb-accent);
    font-weight: 600;
  }

  /* The promoted flag: its own control in the bar, not a row in the panel. */
  [data-dev-toolbar] [data-dtb-part="flag-promoted"] {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 1px 7px;
    border: 1px solid var(--dtb-border);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    white-space: nowrap;
  }

  [data-dev-toolbar] [data-dtb-part="flag-promoted"]:hover {
    background: var(--dtb-item-hover-bg);
  }

  [data-dev-toolbar] [data-dtb-part="flag-promoted"]:focus-visible {
    outline: 2px solid var(--dtb-accent);
    outline-offset: 1px;
  }

  [data-dev-toolbar] [data-dtb-part="flag-promoted"][aria-checked="true"] {
    border-color: var(--dtb-accent);
    color: var(--dtb-accent);
  }

  [data-dev-toolbar]
    [data-dtb-part="flag-promoted"][data-dtb-overridden="true"] {
    background: var(--dtb-item-hover-bg);
    border-style: dashed;
  }

  [data-dev-toolbar] [data-dtb-part="flag-promoted-dot"] {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--dtb-muted);
    flex: 0 0 auto;
  }

  [data-dev-toolbar]
    [data-dtb-part="flag-promoted"][aria-checked="true"]
    [data-dtb-part="flag-promoted-dot"] {
    background: var(--dtb-accent);
  }

  [data-dev-toolbar] [data-dtb-part="flag-promoted-value"] {
    font-family: var(--dtb-font-mono);
  }

  [data-dev-toolbar] [data-dtb-part="flag-overflow"] {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 2px 4px;
  }

  /* Panel */

  [data-dev-toolbar] [data-dtb-part="flag-panel"] {
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 100%;
    min-height: 0;
  }

  [data-dev-toolbar] [data-dtb-part="flag-toolbar"] {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    flex-wrap: wrap;
  }

  [data-dev-toolbar] [data-dtb-part="flag-search"] {
    flex: 1 1 180px;
    min-width: 120px;
    padding: 2px 6px;
    border: 1px solid var(--dtb-border);
    border-radius: var(--dtb-radius);
    background: transparent;
    color: inherit;
    font: inherit;
  }

  [data-dev-toolbar] [data-dtb-part="flag-action"] {
    padding: 2px 8px;
    border: 1px solid var(--dtb-border);
    border-radius: var(--dtb-radius);
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  [data-dev-toolbar] [data-dtb-part="flag-action"]:hover:not(:disabled) {
    background: var(--dtb-item-hover-bg);
  }

  [data-dev-toolbar] [data-dtb-part="flag-action"]:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  [data-dev-toolbar] [data-dtb-part="flag-action"][data-dtb-action="clear-all"] {
    border-color: var(--dtb-accent);
    color: var(--dtb-accent);
  }

  [data-dev-toolbar] [data-dtb-part="flag-banner"] {
    flex: 0 0 auto;
    margin: 0;
    padding: 4px 8px;
    border-radius: var(--dtb-radius);
    border: 1px solid var(--dtb-border);
  }

  [data-dev-toolbar] [data-dtb-part="flag-banner"][data-dtb-tone="error"] {
    background: var(--dtb-danger-bg);
    color: var(--dtb-danger);
    border-color: var(--dtb-danger);
  }

  [data-dev-toolbar] [data-dtb-part="flag-banner"][data-dtb-tone="warn"] {
    background: var(--dtb-warn-bg);
    color: var(--dtb-warn);
    border-color: var(--dtb-warn);
  }

  [data-dev-toolbar] [data-dtb-part="flag-list"] {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  [data-dev-toolbar] [data-dtb-part="flag-row"] {
    display: grid;
    grid-template-columns: 1fr max-content;
    gap: 2px 12px;
    padding: 6px 8px;
    border: 1px solid var(--dtb-border);
    border-radius: var(--dtb-radius);
  }

  [data-dev-toolbar] [data-dtb-part="flag-row"][data-dtb-severity="override"] {
    border-color: var(--dtb-accent);
  }

  [data-dev-toolbar] [data-dtb-part="flag-row"][data-dtb-severity="warn"] {
    border-color: var(--dtb-warn);
  }

  [data-dev-toolbar] [data-dtb-part="flag-row"][data-dtb-severity="bad"] {
    border-color: var(--dtb-danger);
    background: var(--dtb-danger-bg);
  }

  [data-dev-toolbar] [data-dtb-part="flag-name"] {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    font-weight: 600;
  }

  [data-dev-toolbar] [data-dtb-part="flag-key"] {
    font-family: var(--dtb-font-mono);
    font-weight: 400;
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="flag-tag"] {
    padding: 0 4px;
    border-radius: var(--dtb-radius);
    font-weight: 400;
    font-size: calc(var(--dtb-font-size) - 1px);
    color: var(--dtb-muted);
    background: var(--dtb-item-hover-bg);
  }

  [data-dev-toolbar] [data-dtb-part="flag-tag"][data-dtb-tag="override"] {
    color: var(--dtb-accent);
  }

  [data-dev-toolbar] [data-dtb-part="flag-tag"][data-dtb-tag="masked"],
  [data-dev-toolbar] [data-dtb-part="flag-tag"][data-dtb-tag="expired"],
  [data-dev-toolbar] [data-dtb-part="flag-tag"][data-dtb-tag="orphaned"],
  [data-dev-toolbar] [data-dtb-part="flag-tag"][data-dtb-tag="reload"] {
    color: var(--dtb-warn);
    background: var(--dtb-warn-bg);
  }

  [data-dev-toolbar] [data-dtb-part="flag-tag"][data-dtb-tag="not-applied"],
  [data-dev-toolbar] [data-dtb-part="flag-tag"][data-dtb-tag="rejected"] {
    color: var(--dtb-danger);
    background: var(--dtb-danger-bg);
  }

  [data-dev-toolbar] [data-dtb-part="flag-editor"] {
    grid-row: span 2;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  [data-dev-toolbar] [data-dtb-part="flag-input"][data-dtb-invalid="true"] {
    border-color: var(--dtb-danger);
  }

  [data-dev-toolbar] [data-dtb-part="flag-input"] {
    width: 12ch;
    padding: 1px 4px;
    border: 1px solid var(--dtb-border);
    border-radius: var(--dtb-radius);
    background: transparent;
    color: inherit;
    font: inherit;
    font-family: var(--dtb-font-mono);
  }

  [data-dev-toolbar] [data-dtb-part="flag-switch"] {
    padding: 1px 8px;
    border: 1px solid var(--dtb-border);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-family: var(--dtb-font-mono);
    cursor: pointer;
  }

  [data-dev-toolbar] [data-dtb-part="flag-switch"][aria-checked="true"] {
    border-color: var(--dtb-accent);
    color: var(--dtb-accent);
  }

  [data-dev-toolbar] [data-dtb-part="flag-values"] {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="flag-value"] {
    font-family: var(--dtb-font-mono);
    color: var(--dtb-fg);
  }

  [data-dev-toolbar]
    [data-dtb-part="flag-value"][data-dtb-role="effective"][data-dtb-overridden="true"] {
    color: var(--dtb-accent);
  }

  [data-dev-toolbar] [data-dtb-part="flag-meta"] {
    grid-column: 1 / -1;
    margin: 2px 0 0;
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="flag-empty"] {
    max-width: 70ch;
    margin: 0;
  }

  [data-dev-toolbar] [data-dtb-part="flag-note"] {
    margin: 0;
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="flag-note"] code,
  [data-dev-toolbar] [data-dtb-part="flag-empty"] code {
    font-family: var(--dtb-font-mono);
  }
}
`;

const FLAGS_STYLE_ENTRY = "ext-flags";

/** Injects the stylesheet once per document, via `/runtime`'s shared injector. */
export function ensureFlagsStyles(doc?: Document): HTMLStyleElement | null {
  return ensureStyleSheet(FLAGS_STYLE_ENTRY, FLAGS_CSS, doc);
}
