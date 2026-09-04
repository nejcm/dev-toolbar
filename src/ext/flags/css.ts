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
import { KIT_CSS, createStyleInjector, ensureKitStyles } from "@nejcm/dev-toolbar/kit";

const FLAGS_EXTENSION_CSS = String.raw`@layer dev-toolbar {
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
    gap: var(--dtb-chip-gap);
    /* The same box a core trigger gets, so the pill does not sit shorter than
       the chips either side of it. */
    height: calc(var(--dtb-bar-height) - 10px);
    padding: 0 var(--dtb-item-padding-x);
    border: 1px solid var(--dtb-border);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    font: inherit;
    line-height: 1;
    cursor: pointer;
    white-space: nowrap;
    transition: background-color 120ms ease, border-color 120ms ease;
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

  [data-dev-toolbar]
    [data-dtb-part="flag-promoted"][aria-checked="true"]
    [data-dtb-part="flag-promoted-dot"] {
    background: var(--dtb-accent);
  }

  /* Inside a ⋮ row, which supplies the padding — see core's
     overflow-menu-item. */
  [data-dev-toolbar] [data-dtb-part="flag-overflow"] {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--dtb-space-1);
    padding: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    [data-dev-toolbar] [data-dtb-part="flag-promoted"] {
      transition: none;
    }
  }

  /* Panel */

  [data-dev-toolbar] [data-dtb-part="flag-panel"] {
    display: flex;
    flex-direction: column;
    gap: var(--dtb-space-3);
    height: 100%;
    min-height: 0;
  }

  /* The search field leads, the actions follow it, and the note wraps to its
     own line rather than squeezing the field — hence the field's basis. */
  [data-dev-toolbar] [data-dtb-part="flag-toolbar"] {
    flex: 0 0 auto;
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
  }

  [data-dev-toolbar] [data-dtb-part="flag-list"] {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
  }

  /* One flag is one card: its name and tags on the first line, its values on
     the second, its editor spanning both on the end side. The row gap has to
     be small — the two lines are one statement — and the column gap large, so
     the editor never crowds the values it is about to change. */
  [data-dev-toolbar] [data-dtb-part="flag-row"] {
    grid-template-columns: 1fr max-content;
    gap: var(--dtb-space-1) var(--dtb-space-4);
    align-items: center;
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
    gap: var(--dtb-chip-gap);
    flex-wrap: wrap;
    font-weight: 600;
  }

  [data-dev-toolbar] [data-dtb-part="flag-key"] {
    font-family: var(--dtb-font-mono);
    font-weight: 400;
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="flag-tag"] {
    font-weight: 400;
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
    gap: var(--dtb-space-2);
  }

  [data-dev-toolbar] [data-dtb-part="flag-input"][data-dtb-invalid="true"] {
    border-color: var(--dtb-danger);
  }

  /* Geometry and ground come from core's field rule. A value is a value, so
     it is set in the same mono face the row prints it in. */
  [data-dev-toolbar] [data-dtb-part="flag-input"] {
    width: 16ch;
    font-family: var(--dtb-font-mono);
  }

  [data-dev-toolbar] [data-dtb-part="flag-switch"] {
    display: inline-flex;
    align-items: center;
    min-height: var(--dtb-control-height);
    padding: 0 var(--dtb-control-padding-x);
    border: 1px solid var(--dtb-border);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-family: var(--dtb-font-mono);
    cursor: pointer;
  }

  [data-dev-toolbar] [data-dtb-part="flag-switch"]:hover {
    background: var(--dtb-item-hover-bg);
  }

  [data-dev-toolbar] [data-dtb-part="flag-switch"][aria-checked="true"] {
    border-color: var(--dtb-accent);
    color: var(--dtb-accent);
  }

  [data-dev-toolbar] [data-dtb-part="flag-values"] {
    display: flex;
    gap: var(--dtb-space-3);
    flex-wrap: wrap;
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="flag-value"] {
    color: var(--dtb-fg);
  }

  [data-dev-toolbar]
    [data-dtb-part="flag-value"][data-dtb-role="effective"][data-dtb-overridden="true"] {
    color: var(--dtb-accent);
  }

  [data-dev-toolbar] [data-dtb-part="flag-meta"] {
    grid-column: 1 / -1;
    margin: var(--dtb-space-1) 0 0;
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="flag-empty"] {
    max-width: 70ch;
    margin: 0;
  }

  /* The panel's floor: the last thing to read, under a rule that matches the
     one closing the toolbar at the top. */
  [data-dev-toolbar] [data-dtb-part="flag-note"][data-dtb-role="escape-hatch"] {
    flex: 0 0 auto;
    padding-top: var(--dtb-space-3);
    border-top: 1px solid var(--dtb-border);
  }

  [data-dev-toolbar] [data-dtb-part="flag-note"] code,
  [data-dev-toolbar] [data-dtb-part="flag-empty"] code {
    font-family: var(--dtb-font-mono);
  }
}
`;

// Self-contained manual CSS deliberately repeats KIT_CSS; automatic injection deduplicates it.
export const FLAGS_CSS = `${KIT_CSS}\n${FLAGS_EXTENSION_CSS}`;

const FLAGS_STYLE_ENTRY = "ext-flags";
const injectFlagsStyles = createStyleInjector(FLAGS_STYLE_ENTRY, FLAGS_EXTENSION_CSS);

/** Injects the kit and extension sheets once per document. */
export function ensureFlagsStyles(doc?: Document, nonce?: string): HTMLStyleElement | null {
  ensureKitStyles(doc, nonce);
  return injectFlagsStyles(doc, nonce);
}
