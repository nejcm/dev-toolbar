/**
 * `/ext/environment` styles. [dev-toolbar/ext/environment]
 *
 * Same rules as core and `/ext/metrics`: scoped by `[data-dev-toolbar]` inside
 * the `dev-toolbar` cascade layer, colours from `--dtb-*` tokens, `data-dtb-part`
 * names namespaced by kind (`env-*`) rather than instance id.
 */
import { KIT_CSS, createStyleInjector, ensureKitStyles } from "@nejcm/dev-toolbar/kit";

const ENVIRONMENT_EXTENSION_CSS = String.raw`@layer dev-toolbar {
  /* Impersonation has to be unmistakable, in the bar and in the panel. */
  [data-dev-toolbar] [data-dtb-part="env-alert"] {
    display: inline-flex;
    align-items: center;
    gap: var(--dtb-space-1);
    padding: 0 var(--dtb-space-1);
    border-radius: var(--dtb-radius);
    background: var(--dtb-danger-bg);
    color: var(--dtb-danger);
    font-family: var(--dtb-font-mono);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  [data-dev-toolbar] [data-dtb-part="env-panel"] {
    display: flex;
    flex-direction: column;
    gap: var(--dtb-space-3);
    height: 100%;
    min-height: 0;
  }

  [data-dev-toolbar] [data-dtb-part="env-banner"] {
    flex: 0 0 auto;
    background: var(--dtb-danger-bg);
    color: var(--dtb-danger);
    border: 1px solid var(--dtb-danger);
  }

  [data-dev-toolbar] [data-dtb-part="env-body"] {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    /* Sections are separated by air and by their legend rule, not by boxes,
       so the gap has to be big enough to beat the row gap inside a section
       several times over. */
    gap: var(--dtb-space-5);
  }

  /* The heading also carries data-dtb-legend, which is where its type and its
     trailing rule come from — core owns that treatment so every extension's
     sections look alike. Nothing is left to restate here. */

  /* Grid, gap and the dd reset come from the kit's rows kind. What stays
     here is the one thing only this panel needs: a hostname or a build id is a
     single unbreakable token, and without this it widens the value column past
     the panel instead of wrapping. */
  [data-dev-toolbar] [data-dtb-part="env-rows"] dd {
    word-break: break-word;
  }

  [data-dev-toolbar] [data-dtb-part="env-row-value"][data-dtb-alarming="true"] {
    color: var(--dtb-danger);
  }

  [data-dev-toolbar] [data-dtb-part="env-missing"] {
    color: var(--dtb-muted);
    font-family: var(--dtb-font-family);
    font-style: italic;
  }

  [data-dev-toolbar] [data-dtb-part="env-tag"] {
    margin-inline-start: var(--dtb-chip-gap);
    font-family: var(--dtb-font-family);
    color: var(--dtb-muted);
    background: var(--dtb-item-hover-bg);
    vertical-align: 1px;
  }

  [data-dev-toolbar] [data-dtb-part="env-tag"][data-dtb-tag="masked"] {
    color: var(--dtb-warn);
    background: var(--dtb-warn-bg);
  }

  /* The part+kind pair keeps this foreground override above the kit's muted default. */
  [data-dev-toolbar] [data-dtb-part="env-empty"][data-dtb-kind="empty"] {
    display: flex;
    flex-direction: column;
    gap: var(--dtb-space-2);
    max-width: 70ch;
    color: var(--dtb-fg);
  }

  [data-dev-toolbar] [data-dtb-part="env-empty"] code {
    font-family: var(--dtb-font-mono);
  }

  /* The panel's floor: a rule across the measure with the copy actions under
     it. Its rule and a section legend's rule share the same two ends, so the
     panel reads as one ruled column rather than as stacked fragments. */
  [data-dev-toolbar] [data-dtb-part="env-actions"] {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--dtb-space-2);
    flex: 0 0 auto;
    padding-top: var(--dtb-space-3);
    border-top: 1px solid var(--dtb-border);
  }

  [data-dev-toolbar] [data-dtb-part="env-action"]:focus-visible {
    outline: 2px solid var(--dtb-accent);
    outline-offset: -1px;
  }

  /* Inside a ⋮ row, which supplies the padding — see core's
     overflow-menu-item. */
  [data-dev-toolbar] [data-dtb-part="env-overflow"] {
    display: flex;
    flex-direction: column;
    gap: var(--dtb-space-1);
    padding: 0;
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
    text-align: start;
  }
}
`;

// Self-contained manual CSS deliberately repeats KIT_CSS; automatic injection deduplicates it.
export const ENVIRONMENT_CSS = `${KIT_CSS}\n${ENVIRONMENT_EXTENSION_CSS}`;

const ENVIRONMENT_STYLE_ENTRY = "ext-environment";
const injectEnvironmentStyles = createStyleInjector(
  ENVIRONMENT_STYLE_ENTRY,
  ENVIRONMENT_EXTENSION_CSS,
);

/**
 * Injects both stylesheets once per document through the kit's injectors.
 * Their DOM keys deduplicate across bundled copies.
 * Core's `injectStyles` prop isn't visible to extensions, so this extension
 * has its own switch — `environment({ injectStyles: false })` — and exports
 * the self-contained `ENVIRONMENT_CSS` for consumers who ship CSS themselves.
 */
export function ensureEnvironmentStyles(doc?: Document, nonce?: string): HTMLStyleElement | null {
  ensureKitStyles(doc, nonce);
  return injectEnvironmentStyles(doc, nonce);
}
