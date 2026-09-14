# Extensions

First-party extensions ship as separate opt-in subpaths. Import only the ones your
toolbar uses.

| Extension | What it adds |
| --- | --- |
| [`ext/metrics`](./metrics.md) | Memory, interaction delay, jank, in-flight network requests and consumer-supplied collectors |
| [`ext/environment`](./environment.md) | Consumer-supplied environment, release, commit and actor context, with redaction |
| [`ext/flags`](./flags.md) | Feature flags with persisted local overrides and a `?dtb-flags=reset` kill switch |
| [`ext/command-menu`](./command-menu.md) | A `Mod+K` palette over every command the toolbar aggregates |
| [`ext/overlays`](./overlays.md) | Layout boxes, a column grid, an element inspector and focus order |
| [`ext/diagnostics`](./diagnostics.md) | A reviewable bug-report snapshot built from page facts, performance entries and extension diagnostics |
| [`ext/theme-editor`](./theme-editor.md) | Live custom-property editing with CSS, recipe, design-tokens and link exports |
| [`ext/agent`](./agent.md) | The toolbar's state and commands on a global for in-page agents in development builds |
| [`ext/a11y`](./a11y.md) | On-demand axe-core scans, grouped violations and click-to-highlight |

[Documentation index](../README.md) · [Extension contract](../extension-contract.md)
