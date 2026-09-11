# Documentation

Everything the [README](../README.md) links to, in one place.

## Using the package

| Document | What is in it |
| --- | --- |
| [api.md](./api.md) | The root entry: every `<DevToolbar>` prop, the toggle shortcut, the `⋮` menu, the escape-hatch exports and every published type |
| [styling.md](./styling.md) | The three ways to restyle the bar, why none of them needs `!important`, and how icons and bar text are configured |
| [ssr.md](./ssr.md) | Why the bar cannot mismatch on hydration, and the one Next.js app-router rule |
| [testing.md](./testing.md) | `@nejcm/dev-toolbar/testing` — `renderWithToolbar`, the fake layout, the mock bus and the Jest caveats |

## Writing an extension

| Document | What is in it |
| --- | --- |
| [extension-contract.md](./extension-contract.md) | The object you write, the slot props, `start(api)`, and the two lifecycle rules that bite |
| [runtime.md](./runtime.md) | `@nejcm/dev-toolbar/runtime` — event bus, ring buffers, throttled store, `redact()` and `redactText()` |
| [kit.md](./kit.md) | `@nejcm/dev-toolbar/kit` — the shared severity vocabulary, the storage/poll/style helpers, `data-dtb-kind`, the thin React controls, the `presentation` vocabulary and `embed()` |
| [embedding.md](./embedding.md) | Putting a third-party devtool on the bar: the four-line recipe that already works, the bring-your-own-CSS rule, the `embed()` frame helper, and one chip that opens a whole devtools shell such as TanStack Devtools |
| [architecture.md](./architecture.md) | What the shell guarantees, why the boundaries sit where they do, and the known gaps in the contract |
| [adr/](./adr/) | Decision records, and the process for adding one |

## The first-party extensions

| Extension | Document |
| --- | --- |
| `ext/metrics` | [Built-in metrics and custom collectors](./ext/metrics.md) |
| `ext/environment` | [ext/environment.md](./ext/environment.md) |
| `ext/flags` | [ext/flags.md](./ext/flags.md) |
| `ext/command-menu` | [ext/command-menu.md](./ext/command-menu.md) |
| `ext/overlays` | [ext/overlays.md](./ext/overlays.md) |
| `ext/diagnostics` | [ext/diagnostics.md](./ext/diagnostics.md) |
| `ext/theme-editor` | [ext/theme-editor.md](./ext/theme-editor.md) |
| `ext/agent` | [ext/agent.md](./ext/agent.md) |
| `ext/a11y` | [ext/a11y.md](./ext/a11y.md) — the one optional peer |

Each extension directory carries a README too — the developer's view of the same
extension: the files in it, what it owns, the decisions that bite, and its
commands. [`src/ext/README.md`](../src/ext/README.md) indexes all nine.

## Working on the package itself

| Document | What is in it |
| --- | --- |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Setup, the one command that matters, commits, PRs, releases |
| [../AGENTS.md](../AGENTS.md) | The repo map: which folder is which layer, and what may import what |
| [../CHANGELOG.md](../CHANGELOG.md) | Every release, including each place the extension contract moved |
