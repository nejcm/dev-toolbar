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

  /* The line-height is the glyph size rather than 0, because an icon may be a
     *character*: presentation.icon takes a ReactNode, and a string is the
     cheapest icon there is. A bare character is an anonymous flex item whose
     height is its line box, so a zero line-height collapsed the wrapper to zero
     height and left the character hanging out of a box that measured nothing.
     It has no effect on an element child, which the clamp below sizes. */
  [data-dev-toolbar] [data-dtb-kind="glyph"] {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    line-height: var(--dtb-glyph-size, 1.15em);
    color: inherit;
  }

  /* Clamp the icon itself, not the wrapper, and only the direct child: a 24px
     <svg> handed to an 11px bar would otherwise set the bar's height. The size
     is an em length, so it inherits --dtb-font-size and tracks the density
     block's 11px -> 12px switch with no token of its own. Spacing is the gap.

     The child carries its own line-height and text-align for the other kind of
     icon: a character wrapped in a span opts into this clamp, and a block child
     inheriting a zero line-height painted its glyph centred on the box's *top
     edge*, about half a glyph above the <svg>s beside it. Matching the line box
     to the clamped height centres the character in the box the clamp gives it. */
  [data-dev-toolbar] [data-dtb-kind="glyph"] > * {
    display: block;
    width: var(--dtb-glyph-size, 1.15em);
    height: var(--dtb-glyph-size, 1.15em);
    line-height: var(--dtb-glyph-size, 1.15em);
    text-align: center;
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

  /* max-content first track lines values up as their own column instead of trailing labels. */
  [data-dev-toolbar] [data-dtb-kind="rows"] {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--dtb-space-1) var(--dtb-space-5);
    margin: 0;
  }

  [data-dev-toolbar] [data-dtb-kind="rows"] dd {
    margin: 0;
  }

  /* Keeps a trailing action (pin, copy, reset) off the value it follows. */
  [data-dev-toolbar] [data-dtb-kind="rows"] dd > [data-dtb-kind="action"] {
    margin-inline-start: var(--dtb-space-2);
  }

  /* A panel's root: fills the body so a scroller inside it can take the rest. */
  [data-dev-toolbar] [data-dtb-kind="stack"] {
    display: flex;
    flex-direction: column;
    gap: var(--dtb-space-3);
    height: 100%;
    min-height: 0;
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

  /* A toolbar ending its panel is a footer: the rule moves above it. */
  [data-dev-toolbar] [data-dtb-kind="toolbar"]:last-child:not(:only-child) {
    padding-bottom: 0;
    padding-top: var(--dtb-space-3);
    border-bottom: 0;
    border-top: 1px solid var(--dtb-border);
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
