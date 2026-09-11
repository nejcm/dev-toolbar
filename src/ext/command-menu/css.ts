/**
 * `/ext/command-menu` styles. [dev-toolbar/ext/command-menu]
 *
 * Same rules as core: inside the `dev-toolbar` cascade layer, selectors scoped
 * by `[data-dev-toolbar]`, colours from `--dtb-*` tokens, parts namespaced
 * `cmd-*`. The overlay is `position: fixed` inside the toolbar root (which sets
 * no containing block), so it covers the viewport, not the 30px bar.
 */
import { KIT_CSS, createStyleInjector, ensureKitStyles } from "@nejcm/dev-toolbar/kit";

const COMMAND_MENU_EXTENSION_CSS = String.raw`@layer dev-toolbar {
  [data-dev-toolbar] [data-dtb-part="cmd-trigger"] {
    font-family: var(--dtb-font-mono);
  }

  /* ⌘⌃⌥⇧ aren't in the monospace faces; the UI face draws them at letter
     height, sized up slightly since they sit lower than a capital's cap height. */
  [data-dev-toolbar] [data-dtb-part="cmd-glyph"] {
    font-family: var(--dtb-font-family);
    font-size: 1.18em;
    line-height: 1;
  }

  /* The palette is modal, so it sits above everything else the toolbar root
     paints — including the ⋮ popup, which claims 1. */
  [data-dev-toolbar] [data-dtb-part="cmd-scrim"] {
    position: fixed;
    inset: 0;
    z-index: 2;
    background: rgba(0, 0, 0, 0.32);
  }

  [data-dev-toolbar] [data-dtb-part="cmd-dialog"] {
    position: fixed;
    z-index: 3;
    top: 12vh;
    /* Deliberately physical left: inset-inline-start: 50% is not equivalent under rtl. */
    left: 50%;
    transform: translateX(-50%);
    width: min(560px, calc(100vw - 32px));
    max-height: min(60vh, 520px);
    display: flex;
    flex-direction: column;
    background: var(--dtb-panel-bg);
    color: var(--dtb-fg);
    border: 1px solid var(--dtb-border);
    border-radius: calc(var(--dtb-radius) * 2);
    box-shadow: var(--dtb-shadow);
    font-family: var(--dtb-font-family);
    font-size: calc(var(--dtb-font-size) + 1px);
    overflow: hidden;
  }

  /* The query line, not a form field: its own padding/size instead of core's
     row-sized field geometry. Border/background/outline are off — the rule
     under it and the dialog's frame do that work instead. */
  [data-dev-toolbar] [data-dtb-part="cmd-input"] {
    flex: 0 0 auto;
    width: 100%;
    box-sizing: border-box;
    min-height: 0;
    padding: var(--dtb-space-3) var(--dtb-space-4);
    border: 0;
    border-bottom: 1px solid var(--dtb-border);
    border-radius: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: calc(var(--dtb-font-size) + 3px);
    outline: none;
  }

  /* Keyboard focus still needs a visible ring; inset because the field is
     flush with the dialog's frame. Stated here rather than left to core's
     field rule, which this part ties on specificity and would beat by
     injection order. */
  [data-dev-toolbar] [data-dtb-part="cmd-input"]:focus-visible {
    outline: 2px solid var(--dtb-accent);
    outline-offset: -2px;
  }

  [data-dev-toolbar] [data-dtb-part="cmd-list"] {
    flex: 1 1 auto;
    overflow: auto;
    padding: var(--dtb-space-2);
  }

  /* A group's name sits above its first option with enough air that it binds
     to the options below it rather than to the group above. */
  [data-dev-toolbar] [data-dtb-part="cmd-section"] {
    padding: var(--dtb-space-3) var(--dtb-space-3) var(--dtb-space-1);
    color: var(--dtb-muted);
    font-size: calc(var(--dtb-font-size) - 1px);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  [data-dev-toolbar] [data-dtb-part="cmd-section"]:first-child {
    padding-top: var(--dtb-space-1);
  }

  [data-dev-toolbar] [data-dtb-part="cmd-option"] {
    display: flex;
    align-items: center;
    gap: var(--dtb-space-3);
    min-height: 32px;
    padding: var(--dtb-space-1) var(--dtb-space-3);
    border-radius: var(--dtb-radius);
    cursor: pointer;
  }

  [data-dev-toolbar] [data-dtb-part="cmd-option"][aria-selected="true"] {
    background: var(--dtb-item-active-bg);
  }

  [data-dev-toolbar] [data-dtb-part="cmd-option-label"] {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  [data-dev-toolbar] [data-dtb-part="cmd-option-group"] {
    flex: 0 0 auto;
    color: var(--dtb-muted);
    font-size: calc(var(--dtb-font-size) - 1px);
  }

  [data-dev-toolbar] [data-dtb-part="cmd-option-hint"] {
    flex: 0 0 auto;
    color: var(--dtb-muted);
    font-family: var(--dtb-font-mono);
  }

  [data-dev-toolbar] [data-dtb-part="cmd-empty"] {
    padding: var(--dtb-space-5) var(--dtb-space-4);
    text-align: center;
  }

  [data-dev-toolbar] [data-dtb-part="cmd-error"] {
    padding: var(--dtb-space-2) var(--dtb-space-4);
    border-top: 1px solid var(--dtb-border);
    background: var(--dtb-danger-bg);
    color: var(--dtb-danger);
  }

  [data-dev-toolbar] [data-dtb-part="cmd-footer"] {
    display: flex;
    gap: var(--dtb-space-4);
    padding: var(--dtb-space-2) var(--dtb-space-4);
    border-top: 1px solid var(--dtb-border);
    color: var(--dtb-muted);
    font-size: calc(var(--dtb-font-size) - 1px);
  }

  [data-dev-toolbar] [data-dtb-part="cmd-footer"] kbd {
    font-family: var(--dtb-font-mono);
  }
}
`;

// Self-contained manual CSS deliberately repeats KIT_CSS; automatic injection deduplicates it.
export const COMMAND_MENU_CSS = `${KIT_CSS}\n${COMMAND_MENU_EXTENSION_CSS}`;

const injectCommandMenuStyles = createStyleInjector("ext-command-menu", COMMAND_MENU_EXTENSION_CSS);

export function ensureCommandMenuStyles(doc?: Document, nonce?: string): HTMLStyleElement | null {
  ensureKitStyles(doc, nonce);
  return injectCommandMenuStyles(doc, nonce);
}
