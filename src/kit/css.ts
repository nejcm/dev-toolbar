export const KIT_CSS = String.raw`@layer dev-toolbar {
  [data-dev-toolbar] [data-dtb-kind="chip"] {
    display: inline-flex;
    align-items: center;
    gap: var(--dtb-chip-gap);
    white-space: nowrap;
  }

  [data-dev-toolbar] [data-dtb-kind="dot"] {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--dtb-muted);
    flex: 0 0 auto;
  }

  [data-dev-toolbar] [data-dtb-kind="label"] {
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-kind="value"] {
    font-family: var(--dtb-font-mono);
  }

  [data-dev-toolbar] [data-dtb-kind="action"] {
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

  [data-dev-toolbar] [data-dtb-kind="action"]:hover:not(:disabled) {
    background: var(--dtb-item-hover-bg);
  }

  [data-dev-toolbar] [data-dtb-kind="note"] {
    margin: 0;
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-kind="tag"] {
    padding: 0 var(--dtb-space-1);
    border-radius: var(--dtb-radius);
    font-size: calc(var(--dtb-font-size) - 1px);
  }

  [data-dev-toolbar] [data-dtb-kind="row"] {
    display: grid;
    padding: var(--dtb-space-2) var(--dtb-space-3);
    border: 1px solid var(--dtb-border);
    border-radius: var(--dtb-radius);
  }

  /* The two-column key/value readout. A max-content first track is what makes
     the values line up as their own column instead of trailing their labels,
     and the wide column gap is what makes that column scannable. */
  [data-dev-toolbar] [data-dtb-kind="rows"] {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--dtb-space-1) var(--dtb-space-5);
    margin: 0;
  }

  [data-dev-toolbar] [data-dtb-kind="rows"] dd {
    margin: 0;
  }

  [data-dev-toolbar] [data-dtb-kind="list"] {
    display: flex;
    flex-direction: column;
    gap: var(--dtb-space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  [data-dev-toolbar] [data-dtb-kind="empty"] {
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-kind="banner"] {
    padding: var(--dtb-space-2) var(--dtb-space-3);
    border-radius: var(--dtb-radius);
  }

  [data-dev-toolbar] [data-dtb-kind="search"] {
    flex: 1 1 220px;
    min-width: 140px;
    max-width: 320px;
  }

  [data-dev-toolbar] [data-dtb-kind="toolbar"] {
    display: flex;
    align-items: center;
    gap: var(--dtb-space-2);
    flex-wrap: wrap;
    padding-bottom: var(--dtb-space-3);
    border-bottom: 1px solid var(--dtb-border);
  }

  [data-dev-toolbar] [data-dtb-kind="dot"][data-dtb-severity="unknown"] {
    background: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-kind="dot"][data-dtb-severity="ok"] {
    background: var(--dtb-ok);
  }

  [data-dev-toolbar] [data-dtb-kind="dot"][data-dtb-severity="warn"] {
    background: var(--dtb-warn);
  }

  [data-dev-toolbar] [data-dtb-kind="dot"][data-dtb-severity="bad"] {
    background: var(--dtb-danger);
  }

  [data-dev-toolbar] [data-dtb-kind="dot"][data-dtb-severity="override"] {
    background: var(--dtb-accent);
  }

  [data-dev-toolbar] [data-dtb-kind="value"][data-dtb-severity="warn"] {
    color: var(--dtb-warn);
  }

  [data-dev-toolbar] [data-dtb-kind="value"][data-dtb-severity="bad"] {
    color: var(--dtb-danger);
  }

  [data-dev-toolbar] [data-dtb-kind="value"][data-dtb-severity="override"] {
    color: var(--dtb-accent);
  }

  [data-dev-toolbar] [data-dtb-kind="banner"][data-dtb-severity="ok"] {
    border: 1px solid var(--dtb-ok);
    background: var(--dtb-ok-bg);
    color: var(--dtb-ok);
  }

  [data-dev-toolbar] [data-dtb-kind="banner"][data-dtb-severity="warn"] {
    border: 1px solid var(--dtb-warn);
    background: var(--dtb-warn-bg);
    color: var(--dtb-warn);
  }

  [data-dev-toolbar] [data-dtb-kind="banner"][data-dtb-severity="bad"] {
    border: 1px solid var(--dtb-danger);
    background: var(--dtb-danger-bg);
    color: var(--dtb-danger);
  }

  [data-dev-toolbar] [data-dtb-kind="banner"][data-dtb-severity="override"] {
    border: 1px solid var(--dtb-accent);
    background: var(--dtb-item-active-bg);
    color: var(--dtb-accent);
  }
}
`;
