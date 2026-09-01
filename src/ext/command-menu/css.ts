/**
 * `/ext/command-menu` styles. [dev-toolbar/ext/command-menu]
 *
 * Same rules as core and the other extensions: inside the `dev-toolbar` cascade
 * layer, every selector scoped by `[data-dev-toolbar]`, every colour from a
 * `--dtb-*` token, every part name namespaced by kind (`cmd-*`).
 *
 * The overlay is `position: fixed` and sits inside the toolbar root, which sets
 * no containing block — so it covers the viewport rather than the 30px bar, and
 * still inherits the root's tokens, density and colour scheme.
 */
import { ensureStyleSheet } from "../../runtime";

export const COMMAND_MENU_CSS = String.raw`@layer dev-toolbar {
  [data-dev-toolbar] [data-dtb-part="cmd-trigger"] {
    font-family: var(--dtb-font-mono);
  }

  [data-dev-toolbar] [data-dtb-part="cmd-scrim"] {
    position: fixed;
    inset: 0;
    z-index: 1;
    background: rgba(0, 0, 0, 0.32);
  }

  [data-dev-toolbar] [data-dtb-part="cmd-dialog"] {
    position: fixed;
    z-index: 2;
    top: 12vh;
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

  [data-dev-toolbar] [data-dtb-part="cmd-input"] {
    flex: 0 0 auto;
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    border: 0;
    border-bottom: 1px solid var(--dtb-border);
    background: transparent;
    color: inherit;
    font: inherit;
    outline: none;
  }

  [data-dev-toolbar] [data-dtb-part="cmd-list"] {
    flex: 1 1 auto;
    overflow: auto;
    padding: 4px;
  }

  [data-dev-toolbar] [data-dtb-part="cmd-section"] {
    padding: 6px 8px 2px;
    color: var(--dtb-muted);
    font-size: calc(var(--dtb-font-size) - 1px);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  [data-dev-toolbar] [data-dtb-part="cmd-option"] {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
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
    padding: 16px 12px;
    color: var(--dtb-muted);
    text-align: center;
  }

  [data-dev-toolbar] [data-dtb-part="cmd-error"] {
    padding: 8px 12px;
    border-top: 1px solid var(--dtb-border);
    background: var(--dtb-danger-bg);
    color: var(--dtb-danger);
  }

  [data-dev-toolbar] [data-dtb-part="cmd-footer"] {
    display: flex;
    gap: 12px;
    padding: 6px 12px;
    border-top: 1px solid var(--dtb-border);
    color: var(--dtb-muted);
    font-size: calc(var(--dtb-font-size) - 1px);
  }

  [data-dev-toolbar] [data-dtb-part="cmd-footer"] kbd {
    font-family: var(--dtb-font-mono);
  }
}
`;

export function ensureCommandMenuStyles(doc?: Document): HTMLStyleElement | null {
  return ensureStyleSheet("ext-command-menu", COMMAND_MENU_CSS, doc);
}
