/**
 * `/ext/theme-editor` styles. [dev-toolbar/ext/theme-editor]
 *
 * Same rules as core and the other extensions: inside the `dev-toolbar` cascade
 * layer, every selector scoped by `[data-dev-toolbar]`, every colour from a
 * `--dtb-*` token, every part name namespaced by kind (`thm-*`).
 *
 * No declaration carries `!important` — this extension's guard against writing
 * reserved names (`RESERVED_PREFIXES` in `./types`) is a refusal to ever emit
 * them, not a cascade fight, so no `!important` is needed to win one.
 *
 * Every selector starts at `[data-dev-toolbar]`, so this file cannot style the
 * application: app appearance is decided by the custom properties the runtime
 * writes, which are the consumer's own tokens, never ours.
 */
import { ensureStyleSheet } from "../../runtime";

export const THEME_EDITOR_CSS = String.raw`@layer dev-toolbar {
  /* ---- Bar chip ---- */

  [data-dev-toolbar] [data-dtb-part="thm-chip"] {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  [data-dev-toolbar] [data-dtb-part="thm-dot"] {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--dtb-muted);
  }

  [data-dev-toolbar]
    [data-dtb-part="thm-chip"][data-dtb-edited="true"]
    [data-dtb-part="thm-dot"] {
    background: var(--dtb-accent);
  }

  [data-dev-toolbar]
    [data-dtb-part="thm-chip"][data-dtb-preview="false"]
    [data-dtb-part="thm-dot"] {
    background: var(--dtb-warn);
  }

  [data-dev-toolbar] [data-dtb-part="thm-count"] {
    font-family: var(--dtb-font-mono);
  }

  /* ---- Panel ---- */

  [data-dev-toolbar] [data-dtb-part="thm-panel"] {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 860px;
  }

  [data-dev-toolbar] [data-dtb-part="thm-toolbar"],
  [data-dev-toolbar] [data-dtb-part="thm-actions"] {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  [data-dev-toolbar] [data-dtb-part="thm-search"],
  [data-dev-toolbar] [data-dtb-part="thm-input"],
  [data-dev-toolbar] [data-dtb-part="thm-select"],
  [data-dev-toolbar] [data-dtb-part="thm-import"] {
    padding: 2px 6px;
    border: 1px solid var(--dtb-border);
    border-radius: var(--dtb-radius);
    background: var(--dtb-panel-bg);
    color: var(--dtb-fg);
    font: inherit;
    font-family: var(--dtb-font-mono);
  }

  [data-dev-toolbar] [data-dtb-part="thm-import"] {
    width: 100%;
    min-height: 64px;
    resize: vertical;
  }

  [data-dev-toolbar] [data-dtb-part="thm-input"][data-dtb-invalid="true"] {
    border-color: var(--dtb-danger);
  }

  [data-dev-toolbar] [data-dtb-part="thm-action"] {
    padding: 2px 8px;
    border: 1px solid var(--dtb-border);
    border-radius: var(--dtb-radius);
    background: var(--dtb-item-bg);
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  [data-dev-toolbar] [data-dtb-part="thm-action"]:hover:not(:disabled) {
    background: var(--dtb-item-hover-bg);
  }

  [data-dev-toolbar] [data-dtb-part="thm-action"]:disabled {
    opacity: 0.5;
    cursor: default;
  }

  [data-dev-toolbar] [data-dtb-part="thm-action"][data-dtb-on="true"] {
    background: var(--dtb-item-active-bg);
  }

  [data-dev-toolbar] [data-dtb-part="thm-note"] {
    margin: 0;
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="thm-banner"] {
    margin: 0;
    padding: 6px 8px;
    border-radius: var(--dtb-radius);
  }

  [data-dev-toolbar] [data-dtb-part="thm-banner"][data-dtb-tone="error"] {
    background: var(--dtb-danger-bg);
    color: var(--dtb-danger);
  }

  [data-dev-toolbar] [data-dtb-part="thm-banner"][data-dtb-tone="warn"] {
    background: var(--dtb-warn-bg);
    color: var(--dtb-warn);
  }

  [data-dev-toolbar] [data-dtb-part="thm-banner"][data-dtb-tone="info"] {
    background: var(--dtb-item-active-bg);
  }

  /* ---- Groups and rows ---- */

  [data-dev-toolbar] [data-dtb-part="thm-group-name"] {
    margin: 0;
    font-size: calc(var(--dtb-font-size) - 1px);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="thm-list"] {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0 0 8px;
    padding: 0;
    list-style: none;
  }

  [data-dev-toolbar] [data-dtb-part="thm-row"] {
    display: grid;
    grid-template-columns: minmax(140px, 1fr) auto;
    gap: 2px 8px;
    padding: 6px 8px;
    border: 1px solid var(--dtb-border);
    border-radius: var(--dtb-radius);
  }

  [data-dev-toolbar] [data-dtb-part="thm-row"][data-dtb-severity="override"] {
    background: var(--dtb-item-active-bg);
  }

  [data-dev-toolbar] [data-dtb-part="thm-row"][data-dtb-severity="warn"] {
    background: var(--dtb-warn-bg);
  }

  [data-dev-toolbar] [data-dtb-part="thm-row"][data-dtb-severity="bad"] {
    background: var(--dtb-danger-bg);
  }

  [data-dev-toolbar] [data-dtb-part="thm-name"] {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  [data-dev-toolbar] [data-dtb-part="thm-token"] {
    font-family: var(--dtb-font-mono);
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="thm-tag"] {
    padding: 0 4px;
    border-radius: var(--dtb-radius);
    background: var(--dtb-warn-bg);
    color: var(--dtb-warn);
    font-family: var(--dtb-font-mono);
    font-size: calc(var(--dtb-font-size) - 1px);
  }

  [data-dev-toolbar] [data-dtb-part="thm-tag"][data-dtb-tag="edited"] {
    background: var(--dtb-item-active-bg);
    color: var(--dtb-accent);
  }

  [data-dev-toolbar] [data-dtb-part="thm-tag"][data-dtb-tag="not-applied"] {
    background: var(--dtb-danger-bg);
    color: var(--dtb-danger);
  }

  [data-dev-toolbar] [data-dtb-part="thm-editor"] {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    justify-content: flex-end;
  }

  [data-dev-toolbar] [data-dtb-part="thm-swatch"] {
    width: 14px;
    height: 14px;
    border: 1px solid var(--dtb-border);
    border-radius: 3px;
  }

  [data-dev-toolbar] [data-dtb-part="thm-color"] {
    width: 26px;
    height: 20px;
    padding: 0;
    border: 1px solid var(--dtb-border);
    border-radius: var(--dtb-radius);
    background: none;
    cursor: pointer;
  }

  [data-dev-toolbar] [data-dtb-part="thm-values"] {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    grid-column: 1 / -1;
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="thm-value"] {
    font-family: var(--dtb-font-mono);
    color: var(--dtb-fg);
  }

  [data-dev-toolbar]
    [data-dtb-part="thm-value"][data-dtb-role="effective"][data-dtb-overridden="true"] {
    color: var(--dtb-accent);
  }

  [data-dev-toolbar] [data-dtb-part="thm-meta"] {
    grid-column: 1 / -1;
    margin: 0;
    color: var(--dtb-muted);
  }

  /* ---- Export ---- */

  [data-dev-toolbar] [data-dtb-part="thm-output"] {
    max-height: 220px;
    margin: 0;
    padding: 8px;
    overflow: auto;
    border: 1px solid var(--dtb-border);
    border-radius: var(--dtb-radius);
    background: var(--dtb-panel-bg);
    font-family: var(--dtb-font-mono);
    white-space: pre-wrap;
    word-break: break-word;
  }
}
`;

export function ensureThemeEditorStyles(doc?: Document): HTMLStyleElement | null {
  return ensureStyleSheet("ext-theme-editor", THEME_EDITOR_CSS, doc);
}
