/**
 * `/ext/diagnostics` styles. [dev-toolbar/ext/diagnostics]
 *
 * Same rules as core: scoped by `[data-dev-toolbar]`, colours from `--dtb-*`
 * tokens, parts namespaced `diag-*`. Nothing here is safety-load-bearing, so
 * (§14.7) nothing uses `!important`.
 */
import { ensureStyleSheet } from "../../runtime";

export const DIAGNOSTICS_CSS = String.raw`@layer dev-toolbar {
  [data-dev-toolbar] [data-dtb-part="diag-chip"] {
    display: inline-flex;
    align-items: center;
    gap: var(--dtb-chip-gap);
    white-space: nowrap;
  }

  [data-dev-toolbar] [data-dtb-part="diag-dot"] {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--dtb-muted);
    flex: 0 0 auto;
  }

  [data-dev-toolbar] [data-dtb-part="diag-chip"][data-dtb-incomplete="true"]
    [data-dtb-part="diag-dot"] {
    background: var(--dtb-warn);
  }

  [data-dev-toolbar] [data-dtb-part="diag-value"] {
    font-family: var(--dtb-font-mono);
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="diag-panel"] {
    display: flex;
    flex-direction: column;
    gap: var(--dtb-space-3);
    height: 100%;
    min-height: 0;
  }

  [data-dev-toolbar] [data-dtb-part="diag-toolbar"] {
    display: flex;
    align-items: center;
    gap: var(--dtb-space-2);
    flex-wrap: wrap;
    padding-bottom: var(--dtb-space-3);
    border-bottom: 1px solid var(--dtb-border);
  }

  [data-dev-toolbar] [data-dtb-part="diag-action"] {
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

  [data-dev-toolbar] [data-dtb-part="diag-action"]:hover:not(:disabled) {
    background: var(--dtb-item-hover-bg);
  }

  [data-dev-toolbar] [data-dtb-part="diag-action"]:disabled {
    opacity: 0.5;
    cursor: default;
  }

  [data-dev-toolbar] [data-dtb-part="diag-formats"] {
    display: inline-flex;
    border: 1px solid var(--dtb-border);
    border-radius: var(--dtb-radius);
    overflow: hidden;
  }

  [data-dev-toolbar] [data-dtb-part="diag-format"] {
    display: inline-flex;
    align-items: center;
    min-height: var(--dtb-control-height);
    padding: 0 var(--dtb-control-padding-x);
    border: 0;
    background: transparent;
    color: var(--dtb-muted);
    font: inherit;
    cursor: pointer;
  }

  [data-dev-toolbar] [data-dtb-part="diag-format"][aria-pressed="true"] {
    background: var(--dtb-item-active-bg);
    color: var(--dtb-fg);
  }

  [data-dev-toolbar] [data-dtb-part="diag-note"] {
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="diag-omissions"] {
    margin: 0;
    padding: var(--dtb-space-2) var(--dtb-space-3);
    border-radius: var(--dtb-radius);
    background: var(--dtb-warn-bg);
    color: var(--dtb-warn);
  }

  [data-dev-toolbar] [data-dtb-part="diag-omission-list"] {
    margin: var(--dtb-space-1) 0 0;
    padding-inline-start: var(--dtb-space-4);
  }

  /* The review surface — gets the panel's free space; it must be read before copying. */
  [data-dev-toolbar] [data-dtb-part="diag-preview"] {
    flex: 1 1 auto;
    min-height: 0;
    margin: 0;
    padding: var(--dtb-space-3);
    overflow: auto;
    border: 1px solid var(--dtb-border);
    border-radius: var(--dtb-radius);
    background: var(--dtb-item-bg);
    color: var(--dtb-fg);
    font-family: var(--dtb-font-mono);
    font-size: 11px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    tab-size: 2;
  }

  [data-dev-toolbar] [data-dtb-part="diag-empty"] {
    color: var(--dtb-muted);
  }
}
`;

export function ensureDiagnosticsStyles(doc?: Document): HTMLStyleElement | null {
  return ensureStyleSheet("ext-diagnostics", DIAGNOSTICS_CSS, doc);
}
