# ADR-001 — Extensions are plain objects passed in as a prop

**Status:** Accepted. Shipped in `0.1.0` as `CONTRACT_VERSION` 1.

## Context

The package is a shell: chrome plus hosting, with every actual feature — metrics,
flags, environment, overlays, diagnostics, theme editing — living in an extension.
Seven first-party extensions were written against the contract before `0.1.0`, and
third parties are expected to write more. So the shape of an extension is the
package's real public API, and it is hard to reverse twice over: it is what
consumers write code against, and it is what the first-party extensions on nine
subpath exports are already written as.

Two properties had to hold at once.

**An extension must be writable without importing a value from this package.** A
first-party extension ships on its own subpath (`@nejcm/dev-toolbar/ext/metrics`) and
is bundled separately from core. If it imported a *value* from core — a React context,
a base class, a `defineExtension()` helper — that value would have to resolve to the
same module instance as the host application's copy of core, and no bundler guarantees
that for a subpath entry. Types are safe because they erase at build time.

**Registration must not be global.** The alternative shape — extensions register
themselves on import, into a module-level registry — is how most devtools do it and it
breaks four things here: SSR (module state is shared across requests on a warm server),
two toolbars on one page (the second sees the first's items), test isolation
(registration outlives the test that did it), and ordering (it becomes import order,
which nobody controls).

## Decision

An extension is a **plain object** with an `id`, a `label`, optional slot functions
(`compact`, `panel`, `overlay`), optional `commands` and `diagnostics`, and an optional
`start(api)`. In practice it is produced by a factory function that captures its state
in a closure. It is handed to the shell as a prop — `<DevToolbar extensions={[…]}>` —
or registered for a mounted subtree with `useDevToolbar().register()`.

The full type is `DevToolbarExtension` in `src/core/contract.ts`, which is the source
of truth.

Core hands the extension everything it needs through arguments rather than imports:
slot props for render-time state, and `api` for `signal`, `isVisible()`,
`subscribeVisibility()`, namespaced `storage`, `getCommands()`, `runCommand()` and
`getDiagnostics()`. `getCommands()` and `getDiagnostics()` exist *only* because of the
no-value-imports rule — they are how an extension reads core's aggregations without
importing one.

Core aggregates `commands` and `diagnostics` and renders neither. The palette is
`/ext/command-menu`; the snapshot is `/ext/diagnostics`.

### Alternatives considered

| Option | Why not |
| --- | --- |
| A base class or `defineExtension()` helper | A value import from core, so it breaks the moment the extension is bundled separately from the host's copy of core. |
| Extensions as React components | The shell needs to know about an extension before it renders it — ordering, overflow priority, whether it is hidden, what commands it contributes. All of that would have to be smuggled through static properties or a context handshake. |
| A module-level registry with self-registration on import | Breaks SSR, multi-root, test isolation and ordering. See Context. |
| `availability(ctx)` — the extension decides whether it applies | Core has no `ctx`: no identity, no session, no capabilities. It would have to invent one, which is the whole thing this package refuses to do. Replaced by consumer-computed `hidden`. |

### Risk accepted

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| A consumer builds the object inline in render, so `start()`'s closure is orphaned every render while the bar shows an object that owns nothing | High — it is the natural thing to write | Silent: chips freeze, collectors leak, nothing throws | Core warns once per id when an already-started id reappears with a different `start` reference. Cannot be fixed in core; the identity is the consumer's. |
| A third-party extension imports a value from a core subpath anyway and works in the author's bundler, then breaks in a consumer's | Medium | Two module instances, silently divergent state | Documented in `docs/architecture.md` §7; `api` carries the accessors that remove the reason to do it. First-party extensions import only types, so the rule is exercised, not just written. |
| `id` collisions between independently authored extensions | Low | De-duplication drops one; storage and panel state alias | `id` is documented as the identity and namespacing is advised. Not enforced. |

## Consequences

- Nothing needs to be imported from this package to write an extension except its
  types, so a stranger's package is a genuinely external consumer of the same contract
  the first-party ones use. `/ext/metrics` is built that way on purpose — it is the
  test of this decision.
- The extension object owns its lifecycle, so it must be referentially stable. This is
  the single most common way to use the package wrong.
- Calling a factory twice gives two independent extensions, which is a feature
  (`metrics({ id: "metrics-worker" })`) and a hazard (mind the ids).
- Core cannot redact, gate or interpret anything an extension contributes, because it
  may not import `/runtime` and has no context. Readers of the aggregations redact for
  themselves. See `docs/architecture.md` §10.
- Adding a slot is a contract change. The narrowness is the point.
