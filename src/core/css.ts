/**
 * Single source of truth for the core stylesheet: this constant is generated
 * from src/styles.css (shipped as the ./styles.css subpath export) and a unit
 * test fails if the two drift.
 */
export const CORE_CSS = String.raw`/**
 * @nejcm/dev-toolbar core styles.
 *
 * Everything lives inside the dev-toolbar cascade layer and is scoped by the
 * [data-dev-toolbar] attribute, so unlayered consumer CSS always wins without
 * !important. Shipped both as this file and as a runtime injection
 * (injectStyles={false} opts out).
 *
 * Single source of truth: CORE_CSS in src/core/css.ts is generated from this
 * file and a unit test fails if the two drift.
 */
@layer dev-toolbar {
  [data-dev-toolbar] {
    --dtb-font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI",
      sans-serif;
    --dtb-font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
    --dtb-font-size: 11px;
    --dtb-bar-height: 30px;
    --dtb-radius: 4px;
    --dtb-gap: 2px;
    --dtb-padding-x: 6px;
    --dtb-item-padding-x: 6px;
    --dtb-z-index: 2147483000;
    --dtb-bg: #f6f6f7;
    --dtb-fg: #202124;
    --dtb-muted: #6b6f76;
    --dtb-border: rgba(0, 0, 0, 0.12);
    --dtb-accent: #5e6ad2;
    --dtb-item-bg: transparent;
    --dtb-item-hover-bg: rgba(0, 0, 0, 0.06);
    --dtb-item-active-bg: rgba(94, 106, 210, 0.14);
    --dtb-panel-bg: #ffffff;
    --dtb-menu-bg: #ffffff;
    --dtb-shadow: 0 6px 24px rgba(0, 0, 0, 0.14);
    --dtb-danger: #c0392b;
    --dtb-danger-bg: rgba(192, 57, 43, 0.12);

    position: fixed;
    left: 0;
    right: 0;
    display: flex;
    flex-direction: column;
    max-height: 90vh;
    font-family: var(--dtb-font-family);
    font-size: var(--dtb-font-size);
    line-height: 1.4;
    color: var(--dtb-fg);
    z-index: var(--dtb-z-index);
  }

  [data-dev-toolbar],
  [data-dev-toolbar] *,
  [data-dev-toolbar] *::before,
  [data-dev-toolbar] *::after {
    box-sizing: border-box;
  }

  [data-dev-toolbar][data-dtb-color-scheme="dark"],
  [data-dev-toolbar][data-dtb-color-scheme="system"] {
    color-scheme: light dark;
  }

  [data-dev-toolbar][data-dtb-color-scheme="dark"] {
    --dtb-bg: #17181a;
    --dtb-fg: #e6e6e8;
    --dtb-muted: #9a9ea6;
    --dtb-border: rgba(255, 255, 255, 0.14);
    --dtb-accent: #8b95f2;
    --dtb-item-hover-bg: rgba(255, 255, 255, 0.08);
    --dtb-item-active-bg: rgba(139, 149, 242, 0.2);
    --dtb-panel-bg: #1d1e21;
    --dtb-menu-bg: #1d1e21;
    --dtb-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
    --dtb-danger: #ff7b6b;
    --dtb-danger-bg: rgba(255, 123, 107, 0.16);
  }

  @media (prefers-color-scheme: dark) {
    [data-dev-toolbar]:not([data-dtb-color-scheme="light"]) {
      --dtb-bg: #17181a;
      --dtb-fg: #e6e6e8;
      --dtb-muted: #9a9ea6;
      --dtb-border: rgba(255, 255, 255, 0.14);
      --dtb-accent: #8b95f2;
      --dtb-item-hover-bg: rgba(255, 255, 255, 0.08);
      --dtb-item-active-bg: rgba(139, 149, 242, 0.2);
      --dtb-panel-bg: #1d1e21;
      --dtb-menu-bg: #1d1e21;
      --dtb-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
      --dtb-danger: #ff7b6b;
      --dtb-danger-bg: rgba(255, 123, 107, 0.16);
    }
  }

  [data-dev-toolbar][data-dtb-position="bottom"] {
    bottom: 0;
    flex-direction: column-reverse;
  }

  [data-dev-toolbar][data-dtb-position="top"] {
    top: 0;
    flex-direction: column;
  }

  [data-dev-toolbar][data-dtb-density="comfortable"] {
    --dtb-bar-height: 36px;
    --dtb-font-size: 12px;
    --dtb-item-padding-x: 8px;
  }

  [data-dev-toolbar] [data-dtb-part="bar"] {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--dtb-gap);
    flex: 0 0 auto;
    min-height: var(--dtb-bar-height);
    height: var(--dtb-bar-height);
    padding: 0 var(--dtb-padding-x);
    background: var(--dtb-bg);
    overflow: hidden;
  }

  [data-dev-toolbar][data-dtb-position="bottom"] [data-dtb-part="bar"] {
    border-top: 1px solid var(--dtb-border);
  }

  [data-dev-toolbar][data-dtb-position="top"] [data-dtb-part="bar"] {
    border-bottom: 1px solid var(--dtb-border);
  }

  [data-dev-toolbar] [data-dtb-part="region"] {
    display: flex;
    align-items: center;
    gap: var(--dtb-gap);
    min-width: 0;
  }

  [data-dev-toolbar] [data-dtb-part="region"][data-dtb-align="end"] {
    justify-content: flex-end;
  }

  [data-dev-toolbar] [data-dtb-part="item"] {
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    max-width: 100%;
  }

  [data-dev-toolbar] [data-dtb-part="trigger"],
  [data-dev-toolbar] [data-dtb-part="overflow-button"] {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: calc(var(--dtb-bar-height) - 8px);
    padding: 0 var(--dtb-item-padding-x);
    border: 0;
    border-radius: var(--dtb-radius);
    background: var(--dtb-item-bg);
    color: inherit;
    font: inherit;
    white-space: nowrap;
    cursor: pointer;
  }

  [data-dev-toolbar] [data-dtb-part="trigger"]:hover,
  [data-dev-toolbar] [data-dtb-part="overflow-button"]:hover {
    background: var(--dtb-item-hover-bg);
  }

  [data-dev-toolbar] [data-dtb-part="trigger"][aria-expanded="true"],
  [data-dev-toolbar] [data-dtb-part="overflow-button"][aria-expanded="true"] {
    background: var(--dtb-item-active-bg);
  }

  [data-dev-toolbar] [data-dtb-part="trigger"]:focus-visible,
  [data-dev-toolbar] [data-dtb-part="overflow-button"]:focus-visible {
    outline: 2px solid var(--dtb-accent);
    outline-offset: -1px;
  }

  [data-dev-toolbar] [data-dtb-part="overflow-menu"] {
    position: absolute;
    right: var(--dtb-padding-x);
    display: flex;
    flex-direction: column;
    gap: var(--dtb-gap);
    min-width: 160px;
    max-height: 50vh;
    padding: 4px;
    border: 1px solid var(--dtb-border);
    border-radius: var(--dtb-radius);
    background: var(--dtb-menu-bg);
    box-shadow: var(--dtb-shadow);
    overflow: auto;
  }

  [data-dev-toolbar][data-dtb-position="bottom"]
    [data-dtb-part="overflow-menu"] {
    bottom: calc(var(--dtb-bar-height) + 4px);
  }

  [data-dev-toolbar][data-dtb-position="top"] [data-dtb-part="overflow-menu"] {
    top: calc(var(--dtb-bar-height) + 4px);
  }

  [data-dev-toolbar] [data-dtb-part="overflow-menu-item"] {
    display: flex;
    align-items: center;
    padding: 2px;
    border-radius: var(--dtb-radius);
  }

  [data-dev-toolbar] [data-dtb-part="panel"] {
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
    height: var(--dtb-panel-height, 320px);
    min-height: 0;
    background: var(--dtb-panel-bg);
    overflow: hidden;
  }

  [data-dev-toolbar][data-dtb-position="bottom"] [data-dtb-part="panel"] {
    border-top: 1px solid var(--dtb-border);
  }

  [data-dev-toolbar][data-dtb-position="top"] [data-dtb-part="panel"] {
    border-bottom: 1px solid var(--dtb-border);
  }

  [data-dev-toolbar] [data-dtb-part="panel"][hidden] {
    display: none;
  }

  [data-dev-toolbar] [data-dtb-part="panel-body"] {
    flex: 1 1 auto;
    min-height: 0;
    padding: 8px;
    overflow: auto;
  }

  [data-dev-toolbar] [data-dtb-part="panel-resizer"] {
    flex: 0 0 auto;
    height: 5px;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: ns-resize;
    touch-action: none;
  }

  [data-dev-toolbar] [data-dtb-part="panel-resizer"]:hover,
  [data-dev-toolbar] [data-dtb-part="panel-resizer"]:focus-visible {
    background: var(--dtb-accent);
    outline: none;
  }

  [data-dev-toolbar][data-dtb-position="bottom"]
    [data-dtb-part="panel-resizer"] {
    order: -1;
  }

  [data-dev-toolbar] [data-dtb-part="error-chip"] {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: calc(var(--dtb-bar-height) - 8px);
    padding: 0 var(--dtb-item-padding-x);
    border-radius: var(--dtb-radius);
    background: var(--dtb-danger-bg);
    color: var(--dtb-danger);
    font-family: var(--dtb-font-mono);
    white-space: nowrap;
  }

  [data-dev-toolbar] [data-dtb-part="error-chip"][data-dtb-slot="panel"] {
    margin: 8px;
  }
}
`;
