/**
 * `/ext/metrics` styles. [dev-toolbar/ext/metrics]
 *
 * Same rules as core: everything inside the `dev-toolbar` cascade layer, every
 * selector scoped by `[data-dev-toolbar]`, every colour and metric from a
 * `--dtb-*` token. Overriding `--dtb-warn` in your own stylesheet restyles the
 * chips along with the rest of the bar, and unlayered CSS still wins without
 * `!important`.
 *
 * Part names are namespaced (`metrics-*`) because `data-dtb-part` is a shared
 * attribute: core owns the unprefixed names, an extension owns names prefixed
 * with its own id.
 */
import { ensureStyleSheet } from "../../runtime";

export const METRICS_CSS = String.raw`@layer dev-toolbar {
  [data-dev-toolbar] [data-dtb-part="metrics-chips"] {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }

  [data-dev-toolbar] [data-dtb-part="metrics-chip"] {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }

  [data-dev-toolbar] [data-dtb-part="metrics-label"] {
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="metrics-value"] {
    font-family: var(--dtb-font-mono);
    font-variant-numeric: tabular-nums;
  }

  [data-dev-toolbar] [data-dtb-part="metrics-dot"] {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--dtb-muted);
    flex: 0 0 auto;
  }

  [data-dev-toolbar] [data-dtb-severity="ok"] [data-dtb-part="metrics-dot"] {
    background: var(--dtb-ok);
  }

  [data-dev-toolbar] [data-dtb-severity="warn"] [data-dtb-part="metrics-dot"] {
    background: var(--dtb-warn);
  }

  [data-dev-toolbar] [data-dtb-severity="bad"] [data-dtb-part="metrics-dot"] {
    background: var(--dtb-danger);
  }

  [data-dev-toolbar] [data-dtb-severity="warn"] [data-dtb-part="metrics-value"] {
    color: var(--dtb-warn);
  }

  [data-dev-toolbar] [data-dtb-severity="bad"] [data-dtb-part="metrics-value"] {
    color: var(--dtb-danger);
  }

  [data-dev-toolbar] [data-dtb-part="metrics-overflow-list"] {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 2px 4px;
  }

  [data-dev-toolbar] [data-dtb-part="metrics-overflow-row"] {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background: none;
    border: 0;
    padding: 2px 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  [data-dev-toolbar] [data-dtb-part="metrics-panel"] {
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 100%;
    min-height: 0;
  }

  [data-dev-toolbar] [data-dtb-part="metrics-tabs"] {
    display: flex;
    gap: var(--dtb-gap);
    flex: 0 0 auto;
    border-bottom: 1px solid var(--dtb-border);
    padding-bottom: 4px;
  }

  [data-dev-toolbar] [data-dtb-part="metrics-tab"] {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border: 0;
    border-radius: var(--dtb-radius);
    background: transparent;
    color: var(--dtb-muted);
    font: inherit;
    cursor: pointer;
  }

  [data-dev-toolbar] [data-dtb-part="metrics-tab"]:hover {
    background: var(--dtb-item-hover-bg);
  }

  [data-dev-toolbar] [data-dtb-part="metrics-tab"][aria-selected="true"] {
    background: var(--dtb-item-active-bg);
    color: var(--dtb-fg);
  }

  [data-dev-toolbar] [data-dtb-part="metrics-tab"]:focus-visible {
    outline: 2px solid var(--dtb-accent);
    outline-offset: -1px;
  }

  [data-dev-toolbar] [data-dtb-part="metrics-section"] {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
  }

  [data-dev-toolbar] [data-dtb-part="metrics-headline"] {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  [data-dev-toolbar] [data-dtb-part="metrics-headline-value"] {
    font-family: var(--dtb-font-mono);
    font-size: calc(var(--dtb-font-size) * 2);
    line-height: 1.1;
  }

  [data-dev-toolbar] [data-dtb-part="metrics-hint"] {
    color: var(--dtb-muted);
    max-width: 70ch;
  }

  [data-dev-toolbar] [data-dtb-part="metrics-sparkline"] {
    display: block;
    width: 100%;
    height: 44px;
    border: 1px solid var(--dtb-border);
    border-radius: var(--dtb-radius);
    background: var(--dtb-item-hover-bg);
  }

  [data-dev-toolbar] [data-dtb-part="metrics-sparkline"] path {
    fill: none;
    stroke: var(--dtb-accent);
    stroke-width: 1.5;
    stroke-linejoin: round;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }

  [data-dev-toolbar] [data-dtb-severity="warn"] [data-dtb-part="metrics-sparkline"] path {
    stroke: var(--dtb-warn);
  }

  [data-dev-toolbar] [data-dtb-severity="bad"] [data-dtb-part="metrics-sparkline"] path {
    stroke: var(--dtb-danger);
  }

  [data-dev-toolbar] [data-dtb-part="metrics-rows"] {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 2px 16px;
    margin: 0;
  }

  [data-dev-toolbar] [data-dtb-part="metrics-rows"] dt {
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="metrics-rows"] dd {
    margin: 0;
    font-family: var(--dtb-font-mono);
  }

  [data-dev-toolbar] [data-dtb-part="metrics-requests"] {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--dtb-font-mono);
  }

  [data-dev-toolbar] [data-dtb-part="metrics-requests"] th {
    text-align: left;
    font-weight: 500;
    color: var(--dtb-muted);
    font-family: var(--dtb-font-family);
  }

  [data-dev-toolbar] [data-dtb-part="metrics-requests"] th,
  [data-dev-toolbar] [data-dtb-part="metrics-requests"] td {
    padding: 2px 8px 2px 0;
    border-bottom: 1px solid var(--dtb-border);
    white-space: nowrap;
  }

  [data-dev-toolbar] [data-dtb-part="metrics-requests"] td[data-dtb-url] {
    white-space: normal;
    word-break: break-all;
    font-family: var(--dtb-font-family);
  }

  [data-dev-toolbar] [data-dtb-part="metrics-requests"] tr[data-dtb-state="failed"] td {
    color: var(--dtb-danger);
  }

  [data-dev-toolbar] [data-dtb-part="metrics-requests"] tr[data-dtb-state="active"] td {
    color: var(--dtb-warn);
  }

  [data-dev-toolbar] [data-dtb-part="metrics-actions"] {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    border-top: 1px solid var(--dtb-border);
    padding-top: 6px;
  }

  [data-dev-toolbar] [data-dtb-part="metrics-action"] {
    padding: 2px 8px;
    border: 1px solid var(--dtb-border);
    border-radius: var(--dtb-radius);
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  [data-dev-toolbar] [data-dtb-part="metrics-action"]:hover {
    background: var(--dtb-item-hover-bg);
  }

  [data-dev-toolbar] [data-dtb-part="metrics-action"]:focus-visible {
    outline: 2px solid var(--dtb-accent);
    outline-offset: -1px;
  }

  [data-dev-toolbar] [data-dtb-part="metrics-note"] {
    color: var(--dtb-muted);
  }
}
`;

export const METRICS_STYLE_ENTRY = "ext-metrics";

/**
 * Injects the stylesheet once per document, through `/runtime`'s shared
 * injector. It is not core's: importing core's would drag the whole core
 * stylesheet string into this bundle, and `/ext/metrics` is meant to be
 * addable without paying for anything it does not use. The dedup key is a DOM
 * attribute, so two bundled copies still inject once.
 */
export function ensureMetricsStyles(doc?: Document): HTMLStyleElement | null {
  return ensureStyleSheet(METRICS_STYLE_ENTRY, METRICS_CSS, doc);
}
