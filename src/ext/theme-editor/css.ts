/**
 * `/ext/theme-editor` styles. Inside the `dev-toolbar` cascade layer, every
 * selector scoped by `[data-dev-toolbar]` so this file cannot style the
 * application. No `!important`: reserved names are refused outright (see
 * `RESERVED_PREFIXES` in `./types`), so there's never a cascade fight to win.
 */
import { KIT_CSS, createStyleInjector, ensureKitStyles } from "@nejcm/dev-toolbar/kit";

const THEME_EDITOR_EXTENSION_CSS = String.raw`@layer dev-toolbar {
  /* ---- Bar chip ---- */

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
    gap: var(--dtb-space-3);
    max-width: 860px;
  }

  [data-dev-toolbar] [data-dtb-part="thm-actions"] {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--dtb-space-2);
  }

  /* Geometry, ground and border come from core's field rule; these are the
     token names and values a developer types, so they stay mono. */
  [data-dev-toolbar] [data-dtb-part="thm-search"],
  [data-dev-toolbar] [data-dtb-part="thm-input"],
  [data-dev-toolbar] [data-dtb-part="thm-select"],
  [data-dev-toolbar] [data-dtb-part="thm-import"] {
    font-family: var(--dtb-font-mono);
  }

  /* The part+kind pair keeps the field's intrinsic minimum above the kit's 140px default. */
  [data-dev-toolbar] [data-dtb-part="thm-search"][data-dtb-kind="search"] {
    min-width: auto;
  }

  [data-dev-toolbar] [data-dtb-part="thm-import"] {
    width: 100%;
    min-height: 88px;
    resize: vertical;
  }

  [data-dev-toolbar] [data-dtb-part="thm-input"][data-dtb-invalid="true"] {
    border-color: var(--dtb-danger);
  }

  [data-dev-toolbar] [data-dtb-part="thm-action"]:disabled {
    opacity: 0.5;
    cursor: default;
  }

  [data-dev-toolbar] [data-dtb-part="thm-action"][data-dtb-on="true"] {
    background: var(--dtb-item-active-bg);
  }

  [data-dev-toolbar] [data-dtb-part="thm-banner"] {
    margin: 0;
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

  /* The heading also carries data-dtb-legend — core owns that treatment, so
     every extension's sections look alike. */

  /* The part+kind pair keeps this margin override above the kit's zero-margin default. */
  [data-dev-toolbar] [data-dtb-part="thm-list"][data-dtb-kind="list"] {
    margin-block-end: var(--dtb-space-5);
  }

  [data-dev-toolbar] [data-dtb-part="thm-row"] {
    grid-template-columns: minmax(140px, 1fr) auto;
    gap: var(--dtb-space-1) var(--dtb-space-4);
    align-items: center;
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
    gap: var(--dtb-chip-gap);
  }

  [data-dev-toolbar] [data-dtb-part="thm-token"] {
    font-family: var(--dtb-font-mono);
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="thm-tag"] {
    background: var(--dtb-warn-bg);
    color: var(--dtb-warn);
    font-family: var(--dtb-font-mono);
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
    gap: var(--dtb-space-2);
    justify-content: flex-end;
  }

  [data-dev-toolbar] [data-dtb-part="thm-swatch"] {
    width: 14px;
    height: 14px;
    border: 1px solid var(--dtb-border);
    border-radius: 3px;
  }

  [data-dev-toolbar] [data-dtb-part="thm-color"] {
    width: 30px;
    height: var(--dtb-control-height);
    padding: 0;
    border: 1px solid var(--dtb-border);
    border-radius: var(--dtb-radius);
    background: none;
    cursor: pointer;
  }

  [data-dev-toolbar] [data-dtb-part="thm-values"] {
    display: flex;
    flex-wrap: wrap;
    gap: var(--dtb-space-3);
    grid-column: 1 / -1;
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="thm-value"] {
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
    padding: var(--dtb-space-3);
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

// Self-contained manual CSS deliberately repeats KIT_CSS; automatic injection deduplicates it.
export const THEME_EDITOR_CSS = `${KIT_CSS}\n${THEME_EDITOR_EXTENSION_CSS}`;

const injectThemeEditorStyles = createStyleInjector("ext-theme-editor", THEME_EDITOR_EXTENSION_CSS);

export function ensureThemeEditorStyles(doc?: Document, nonce?: string): HTMLStyleElement | null {
  ensureKitStyles(doc, nonce);
  return injectThemeEditorStyles(doc, nonce);
}
