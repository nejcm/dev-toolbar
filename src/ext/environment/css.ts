/**
 * `/ext/environment` styles. [dev-toolbar/ext/environment]
 *
 * Same rules as core and as `/ext/metrics`: inside the `dev-toolbar` cascade
 * layer, every selector scoped by `[data-dev-toolbar]`, every colour from a
 * `--dtb-*` token, and every `data-dtb-part` name namespaced by kind (`env-*`)
 * rather than by the id a particular instance carries.
 */
import { ensureStyleSheet } from "../../runtime";

export const ENVIRONMENT_CSS = String.raw`@layer dev-toolbar {
  [data-dev-toolbar] [data-dtb-part="env-chip"] {
    display: inline-flex;
    align-items: center;
    gap: 6px;
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
    gap: 4px;
    padding: 0 4px;
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
    gap: 8px;
    height: 100%;
    min-height: 0;
  }

  [data-dev-toolbar] [data-dtb-part="env-banner"] {
    flex: 0 0 auto;
    padding: 4px 8px;
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
    gap: 10px;
  }

  [data-dev-toolbar] [data-dtb-part="env-group-title"] {
    margin: 0;
    color: var(--dtb-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: calc(var(--dtb-font-size) - 1px);
  }

  [data-dev-toolbar] [data-dtb-part="env-rows"] {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 2px 16px;
    margin: 2px 0 0;
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
    margin-inline-start: 6px;
    padding: 0 4px;
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
    max-width: 70ch;
    color: var(--dtb-fg);
  }

  [data-dev-toolbar] [data-dtb-part="env-empty"] code {
    font-family: var(--dtb-font-mono);
  }

  [data-dev-toolbar] [data-dtb-part="env-actions"] {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    border-top: 1px solid var(--dtb-border);
    padding-top: 6px;
  }

  [data-dev-toolbar] [data-dtb-part="env-action"] {
    padding: 2px 8px;
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

  [data-dev-toolbar] [data-dtb-part="env-overflow"] {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 2px 4px;
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
 * Injects the stylesheet once per document, through `/runtime`'s shared
 * injector — the dedup key is a DOM attribute, so two bundled copies of the
 * package still inject once.
 *
 * Core's `injectStyles` prop is a prop, invisible to extensions, so this
 * extension carries its own switch — `environment({ injectStyles: false })` —
 * and exports `ENVIRONMENT_CSS` for consumers who ship CSS themselves.
 */
export function ensureEnvironmentStyles(doc?: Document): HTMLStyleElement | null {
  return ensureStyleSheet(ENVIRONMENT_STYLE_ENTRY, ENVIRONMENT_CSS, doc);
}
