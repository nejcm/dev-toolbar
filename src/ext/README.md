# `src/ext/` — the first-party extensions

Nine extensions, one directory each, every one of them a genuinely *external*
consumer of the public extension contract. None imports a value from
`src/core/*` — only types, which erase at build time — and each ships on its own
opt-in subpath with its own bundle, so importing none of them leaves a bar that
hosts only your own tools.

| Directory | Subpath | What it gives you |
| --- | --- | --- |
| [`metrics/`](./metrics/README.md) | `ext/metrics` | Memory, interaction delay, jank and in-flight network, plus your own collectors |
| [`environment/`](./environment/README.md) | `ext/environment` | Environment, release, commit and actor context — all supplied by you, all redacted |
| [`flags/`](./flags/README.md) | `ext/flags` | Feature flags, with local overrides that survive a reload and a kill switch |
| [`command-menu/`](./command-menu/README.md) | `ext/command-menu` | A `⌘K` palette over every command the toolbar has aggregated |
| [`overlays/`](./overlays/README.md) | `ext/overlays` | Layout boxes, a column grid, an element inspector and focus order |
| [`diagnostics/`](./diagnostics/README.md) | `ext/diagnostics` | One snapshot for a bug report, including a console/error tail |
| [`theme-editor/`](./theme-editor/README.md) | `ext/theme-editor` | Live design-token editing, with CSS, a recipe or a link on the way out |
| [`a11y/`](./a11y/README.md) | `ext/a11y` | axe-core violations grouped by impact — the one optional peer |
| [`agent/`](./agent/README.md) | `ext/agent` | The bar's state and commands on a global, for an in-page agent |

Each README here is the developer's view: the files in the directory, what the
extension owns, the design decisions that bite, and its commands. The
consumer-facing page for each — options, worked examples, exported shapes — is
in [`docs/ext/`](../../docs/ext/).

## The shared conventions

- **`index.tsx`** is the factory. **`runtime.ts`** is the non-React logic,
  testable without a DOM. **`ui.tsx`** is the chip, panel and overlay slots.
  **`types.ts`** is the vocabulary. **`css.ts`** is the stylesheet, injected
  once, `styleNonce`-aware. **`__tests__/`** sits beside them.
- **Build the extension object once, at module scope.** Every README repeats it
  because rebuilding it each render throws away everything the runtime has
  accumulated.
- **Shared glue lives in [`src/kit/`](../kit/)**, value-imported through
  `@nejcm/dev-toolbar/kit` so CommonJS consumers get one instance.
  Measurement primitives — the event bus, ring buffers, the throttled store,
  `redact()` and `redactText()` — live in [`src/runtime/`](../runtime/).
- **Redaction is a per-extension decision**, made on the way *in*, so panel,
  clipboard, exports and `/ext/diagnostics` all read one masked snapshot. There
  is no second, rawer copy anywhere.
- `src/core/__tests__/boundary.test.ts` is the gate that keeps all of this true.

The contract itself is [`src/core/contract.ts`](../core/contract.ts), and
[docs/extension-contract.md](../../docs/extension-contract.md) is its prose form
— start there if you are writing your own.
