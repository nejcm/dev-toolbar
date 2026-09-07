/**
 * `/ext/a11y` styles. [dev-toolbar/ext/a11y]
 *
 * Same rules as the other extensions: everything inside the `dev-toolbar`
 * cascade layer, scoped by `[data-dev-toolbar]`, colours from `--dtb-*`
 * tokens, parts namespaced `a11y-*`.
 *
 * The highlight surface repeats `/ext/overlays`' four `!important`
 * declarations (`position`, `inset`, `z-index`, `pointer-events`) for the same
 * reason and by deliberate duplication: an extension may not import a
 * sibling's stylesheet, and a stray unlayered `div { pointer-events: auto }`
 * would otherwise turn a viewport-sized layer into a click trap.
 *
 * Box geometry is set inline from `getBoundingClientRect()`, so no physical
 * `inset-*` value appears here and nothing needs RTL mirroring.
 */
import { KIT_CSS, createStyleInjector, ensureKitStyles } from "@nejcm/dev-toolbar/kit";

const A11Y_EXTENSION_CSS = String.raw`@layer dev-toolbar {
  [data-dev-toolbar] [data-dtb-part="a11y-chip"][data-dtb-status="unsupported"]
    [data-dtb-part="a11y-value"] {
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="a11y-panel"] {
    display: flex;
    flex-direction: column;
    gap: var(--dtb-space-3);
    min-height: 0;
  }

  [data-dev-toolbar] [data-dtb-part="a11y-actions"] {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--dtb-space-2);
  }

  [data-dev-toolbar] [data-dtb-part="a11y-meta"] {
    display: flex;
    flex-wrap: wrap;
    gap: var(--dtb-space-2);
    color: var(--dtb-muted);
  }

  [data-dev-toolbar] [data-dtb-part="a11y-groups"] {
    display: flex;
    flex-direction: column;
    gap: var(--dtb-space-3);
    overflow: auto;
    min-height: 0;
  }

  [data-dev-toolbar] [data-dtb-part="a11y-group"] {
    display: flex;
    flex-direction: column;
    gap: var(--dtb-space-2);
  }

  [data-dev-toolbar] [data-dtb-part="a11y-group-heading"] {
    display: flex;
    align-items: center;
    gap: var(--dtb-space-2);
    margin: 0;
    font-size: inherit;
    font-weight: 600;
  }

  [data-dev-toolbar] [data-dtb-part="a11y-rule"] {
    display: flex;
    flex-direction: column;
    gap: var(--dtb-space-1);
    padding-block: var(--dtb-space-2);
    padding-inline: var(--dtb-space-2);
    border: 1px solid var(--dtb-border);
    border-radius: var(--dtb-radius);
  }

  [data-dev-toolbar]
    [data-dtb-part="a11y-rule"][data-dtb-impact="critical"],
  [data-dev-toolbar] [data-dtb-part="a11y-rule"][data-dtb-impact="serious"] {
    border-color: var(--dtb-danger);
  }

  [data-dev-toolbar] [data-dtb-part="a11y-rule-head"] {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--dtb-space-2);
  }

  [data-dev-toolbar] [data-dtb-part="a11y-rule-id"] {
    font-family: var(--dtb-font-mono);
  }

  [data-dev-toolbar] [data-dtb-part="a11y-nodes"] {
    display: flex;
    flex-direction: column;
    gap: var(--dtb-space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  [data-dev-toolbar] [data-dtb-part="a11y-node"] {
    display: flex;
    align-items: center;
    gap: var(--dtb-space-2);
  }

  [data-dev-toolbar] [data-dtb-part="a11y-node-target"] {
    font-family: var(--dtb-font-mono);
    color: var(--dtb-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  [data-dev-toolbar] [data-dtb-part="a11y-node-html"] {
    font-family: var(--dtb-font-mono);
    color: var(--dtb-muted);
    overflow-x: auto;
    white-space: pre;
  }

  [data-dev-toolbar] [data-dtb-part="a11y-node"][data-dtb-selected="true"] {
    outline: 1px solid var(--dtb-accent);
  }

  /* The highlight surface. See the file header before touching the four
     !important declarations. */
  [data-dev-toolbar] [data-dtb-part="a11y-surface"] {
    position: fixed !important;
    inset: 0 !important;
    z-index: -1 !important;
    pointer-events: none !important;
    overflow: hidden;
    font-family: var(--dtb-font-mono);
    font-size: 10px;
    line-height: 1.3;
    -webkit-user-select: none;
    user-select: none;
  }

  [data-dev-toolbar] [data-dtb-part="a11y-surface"] * {
    pointer-events: none !important;
  }

  [data-dev-toolbar] [data-dtb-part="a11y-box"] {
    position: absolute;
    outline: 2px solid var(--dtb-danger);
    background: var(--dtb-danger-bg);
  }

  [data-dev-toolbar] [data-dtb-part="a11y-box"][data-dtb-impact="moderate"],
  [data-dev-toolbar] [data-dtb-part="a11y-box"][data-dtb-impact="minor"] {
    outline-color: var(--dtb-warn);
    background: var(--dtb-warn-bg);
  }

  [data-dev-toolbar] [data-dtb-part="a11y-badge"] {
    position: absolute;
    padding-block: 1px;
    padding-inline: 4px;
    border-radius: var(--dtb-radius);
    background: var(--dtb-danger);
    color: var(--dtb-bg);
    white-space: nowrap;
  }

  [data-dev-toolbar] [data-dtb-part="a11y-badge"][data-dtb-impact="moderate"],
  [data-dev-toolbar] [data-dtb-part="a11y-badge"][data-dtb-impact="minor"] {
    background: var(--dtb-warn);
  }
}
`;

// Self-contained manual CSS deliberately repeats KIT_CSS; automatic injection deduplicates it.
export const A11Y_CSS = `${KIT_CSS}\n${A11Y_EXTENSION_CSS}`;

const injectA11yStyles = createStyleInjector("ext-a11y", A11Y_EXTENSION_CSS);

export function ensureA11yStyles(doc?: Document, nonce?: string): HTMLStyleElement | null {
  ensureKitStyles(doc, nonce);
  return injectA11yStyles(doc, nonce);
}
