/**
 * `/ext/metrics` styles. [dev-toolbar/ext/metrics]
 *
 * Same rules as core: everything inside the `dev-toolbar` cascade layer,
 * scoped by `[data-dev-toolbar]`, colours from `--dtb-*` tokens. Part names
 * are namespaced (`metrics-*`) since `data-dtb-part` is shared with core and
 * other extensions.
 */
import { ensureStyleSheet } from "../../runtime";

export const METRICS_CSS = String.raw`@layer dev-toolbar {
  /* Several readouts in one slot. They are peers, not one label-value pair,
     so they take the bar's inter-item gap rather than the tighter chip gap. */
  [data-dev-toolbar] [data-dtb-part="metrics-chips"] {
    display: inline-flex;
    align-items: center;
    gap: var(--dtb-item-gap);
  }

  /* Five readouts in a row that has no dividers inside it, so the boundaries
     have to come from binding rather than from more width — the bar cannot
     afford more width or the whole extension collapses into the ⋮ sooner.
     The dot belongs to the label after it, so it sits nearer that label than
     the label sits to its own value, and the eye groups dot-label-value
     before it groups value-dot. */
  [data-dev-toolbar] [data-dtb-part="metrics-chip"] [data-dtb-part="metrics-dot"] {
    margin-inline-end: calc(var(--dtb-space-1) - var(--dtb-chip-gap));
  }

  [data-dev-toolbar] [data-dtb-part="metrics-chip"] {
    display: inline-flex;
    align-items: center;
    gap: var(--dtb-chip-gap);
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

  /* Inside a ⋮ row, which supplies the padding — see core's
     overflow-menu-item. */
  [data-dev-toolbar] [data-dtb-part="metrics-overflow-list"] {
    display: flex;
    flex-direction: column;
    gap: var(--dtb-space-1);
    padding: 0;
  }

  [data-dev-toolbar] [data-dtb-part="metrics-overflow-row"] {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--dtb-space-4);
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  [data-dev-toolbar] [data-dtb-part="metrics-panel"] {
    display: flex;
    flex-direction: column;
    gap: var(--dtb-space-3);
    height: 100%;
    min-height: 0;
  }

  /* The tabs sit on the same rule the panel's footer closes with, and the
     row is inset from it by a hair so a selected tab's ground does not touch
     the rule. */
  [data-dev-toolbar] [data-dtb-part="metrics-tabs"] {
    display: flex;
    gap: var(--dtb-space-1);
    flex: 0 0 auto;
    border-bottom: 1px solid var(--dtb-border);
    padding-bottom: var(--dtb-space-2);
  }

  [data-dev-toolbar] [data-dtb-part="metrics-tab"] {
    display: inline-flex;
    align-items: center;
    gap: var(--dtb-space-1);
    min-height: var(--dtb-control-height);
    padding: 0 var(--dtb-control-padding-x);
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
    gap: var(--dtb-space-3);
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
  }

  [data-dev-toolbar] [data-dtb-part="metrics-headline"] {
    display: flex;
    align-items: baseline;
    gap: var(--dtb-space-2);
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
    gap: var(--dtb-space-1) var(--dtb-space-5);
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
    text-align: start;
    font-weight: 500;
    color: var(--dtb-muted);
    font-family: var(--dtb-font-family);
  }

  [data-dev-toolbar] [data-dtb-part="metrics-requests"] th,
  [data-dev-toolbar] [data-dtb-part="metrics-requests"] td {
    padding-block: var(--dtb-space-1);
    padding-inline: 0 var(--dtb-space-4);
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

  /* The panel's floor — same rule and same measure as the tabs above it. */
  [data-dev-toolbar] [data-dtb-part="metrics-actions"] {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--dtb-space-2);
    flex: 0 0 auto;
    border-top: 1px solid var(--dtb-border);
    padding-top: var(--dtb-space-3);
  }

  [data-dev-toolbar] [data-dtb-part="metrics-action"] {
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

const METRICS_STYLE_ENTRY = "ext-metrics";

/**
 * Injects the stylesheet once per document via `/runtime`'s shared injector
 * (not core's, so this bundle doesn't pull in core's stylesheet). Dedup key
 * is a DOM attribute, so two bundled copies still inject once.
 */
export function ensureMetricsStyles(doc?: Document, nonce?: string): HTMLStyleElement | null {
  return ensureStyleSheet(METRICS_STYLE_ENTRY, METRICS_CSS, doc, nonce);
}
