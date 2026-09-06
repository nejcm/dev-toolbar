/**
 * `/ext/diagnostics` styles. [dev-toolbar/ext/diagnostics]
 *
 * Same rules as core: scoped by `[data-dev-toolbar]`, colours from `--dtb-*`
 * tokens, parts namespaced `diag-*`. Nothing here is safety-load-bearing, so
 * (§14.7) nothing uses `!important`.
 */
import { KIT_CSS, createStyleInjector, ensureKitStyles } from "@nejcm/dev-toolbar/kit";

const DIAGNOSTICS_EXTENSION_CSS = String.raw`@layer dev-toolbar {
  [data-dev-toolbar] [data-dtb-part="diag-chip"][data-dtb-incomplete="true"]
    [data-dtb-part="diag-dot"] {
    background: var(--dtb-warn);
  }

  [data-dev-toolbar] [data-dtb-part="diag-value"] {
    color: var(--dtb-muted);
  }

  /* §1B's badge: the count of what the console tail caught, on the chip. */
  [data-dev-toolbar] [data-dtb-part="diag-errors"] {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.5em;
    padding: 0 0.35em;
    border-radius: var(--dtb-radius);
    background: var(--dtb-warn-bg);
    color: var(--dtb-warn);
    font-variant-numeric: tabular-nums;
  }

  [data-dev-toolbar] [data-dtb-part="diag-errors"][data-dtb-tone="error"] {
    background: var(--dtb-danger-bg);
    color: var(--dtb-danger);
  }

  [data-dev-toolbar] [data-dtb-part="diag-panel"] {
    display: flex;
    flex-direction: column;
    gap: var(--dtb-space-3);
    height: 100%;
    min-height: 0;
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

  [data-dev-toolbar] [data-dtb-part="diag-omissions"] {
    margin: 0;
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
    font-size: var(--dtb-font-size);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    tab-size: 2;
  }
}
`;

// Self-contained manual CSS deliberately repeats KIT_CSS; automatic injection deduplicates it.
export const DIAGNOSTICS_CSS = `${KIT_CSS}\n${DIAGNOSTICS_EXTENSION_CSS}`;

const injectDiagnosticsStyles = createStyleInjector("ext-diagnostics", DIAGNOSTICS_EXTENSION_CSS);

export function ensureDiagnosticsStyles(doc?: Document, nonce?: string): HTMLStyleElement | null {
  ensureKitStyles(doc, nonce);
  return injectDiagnosticsStyles(doc, nonce);
}
