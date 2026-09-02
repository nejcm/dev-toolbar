# AGENTS.md

`@nejcm/dev-toolbar` is a published React library: an extensible, low-overhead in-app
developer toolbar. The package is a **shell** — chrome plus hosting. It renders a
fixed bar, sorts and collapses the items it is given, hosts one panel at a time,
persists preferences and isolates failures. It ships no metrics, no flag adapters and
no opinions about what a number means; those are extensions, and the first-party ones
live on their own subpath exports. Zero runtime dependencies, light DOM, SSR-safe.
The contract an extension is written against is the real public API.

## Structure

| Folder | Layer | Stack | Talks to |
| --- | --- | --- | --- |
| `src/core/` | The shell: portal, bar, overflow, panel host, overlay host, storage, styles, aggregations | React 18/19, `useSyncExternalStore`, no deps | Nothing. **Never imports `runtime/` or `ext/`.** |
| `src/runtime/` | Opt-in primitives for extensions that measure: event bus, ring buffers, throttled store, `redact()`, style injection | Framework-free TS | Nothing in this package |
| `src/ext/<name>/` | First-party extensions, one directory each | React + `src/runtime`, **types only** from core | `src/runtime`, core's *types* |
| `src/testing/` | `renderWithToolbar`, `makeExtension`, `mockBus`, fake layout | React + optional `@testing-library/react` peer | core's *types* relatively, core's *values* through `@nejcm/dev-toolbar` |
| `examples/playground/` | Vite app consuming the built package via `file:../..` | Vite, React | `dist/`, as a real consumer does |
| `test/fixtures/jest-consumer/` | A real Jest 29 + CommonJS consumer of `dist/` | Jest, npm | `dist/`, as a CommonJS consumer does |
| `docs/` | Durable architecture reference and ADRs | Markdown | — |
| `scripts/` | Repo tooling with no home in `src/`: currently the per-entrypoint size report | Plain ESM `.mjs`, no deps | `dist/`, `package.json` `exports` |
| `.github/actions/` | Composite actions the workflows share: `setup-job`, `report-bundle-size`, `knip-check` | GitHub Actions | `.github/workflows/` |

Each extension directory follows the same convention: `index.tsx` (the factory),
`runtime.ts` (non-React logic), `ui.tsx`, `types.ts`, `css.ts`, `__tests__/`.

## Checks

```sh
bun install                  # also installs the git hooks (simple-git-hooks)
bun run verify               # format:check && typecheck && lint && knip && build &&
                             #   test && check:package — the CI gate
bun run typecheck            # tsc --noEmit
bun run lint                 # oxlint --max-warnings=0  (a ratchet, see below)
bun run lint:fix             # oxlint --fix
bun run format               # oxfmt — JS, TS and YAML
bun run format:check         # oxfmt --check — first in `verify`, cheapest failure first
bun run test                 # vitest run
bun run test:watch           # vitest
bun run test:coverage        # vitest run --coverage — enforces the floors in vitest.config.ts
bun run build                # tsup
bun run check:package        # publint + attw over a packed tarball (needs dist/)
bun run knip                 # unused files, exports and deps — a gate, inside `verify`
bun run size                 # builds, then a per-entrypoint size table
bun run test:jest-consumer   # builds, then runs Jest against dist/ — not part of `test`
bun run playground           # builds, then Vite on :5273
```

`check:package` uses `--profile node16` on purpose: subpath exports are
invisible to the pre-`exports` `node10` algorithm, so consumers need
`moduleResolution` `node16` or `bundler` and `node10` is deliberately
unsupported.

`bun run verify` is the one command that matters. If it passes locally it passes in
CI; `.github/workflows/ci.yml` runs exactly it, then `test:coverage` as a second
gate and `size` as an advisory job-summary report. CI re-runs `knip` after
`verify` too, but only to write the readable report to the job summary — the
gate is the `knip` inside `verify`, so unused code fails on your machine first.

## Conventions

- **Bun, not npm.** The exception is `test/fixtures/jest-consumer`, which uses npm
  internally on purpose — it exists to be a real npm/CommonJS consumer.
- **Zero runtime dependencies is a rule, not an accident.** New `dependencies` need a
  reason that survives the question "why can't the consumer pass this in?".
- **Core never imports `runtime/` or `ext/`.** Extensions import only *types* from
  core — a value import is not guaranteed by the bundler to resolve to the same module
  instance as the host's copy. This is why `ExtensionRuntimeApi` carries
  `getCommands()`, `runCommand()` and `getDiagnostics()`.
- **`src/testing/` value-imports core through `@nejcm/dev-toolbar`, never `../core/*`.**
  The CJS build does not code-split, so a relative value import is *inlined* into
  `dist/testing.cjs` and a CommonJS consumer who requires both `.` and `./testing` gets
  two cores — two React contexts, and `useDevToolbar()` throwing inside
  `renderWithToolbar()`. The package's own name is in `external` in `tsup.config.ts`
  so both formats resolve to the host's copy. `import type` from `../core/*` is fine:
  types erase. Guarded by `src/core/__tests__/boundary.test.ts` and
  `test/fixtures/jest-consumer/shared-instance.test.js`.
- **A new subpath must be added explicitly** to the `exports` map in `package.json`
  *and* to `entry` and `dts.entry` in `tsup.config.ts`. Never a wildcard. Missing from
  either means silently unpublishable or untyped.
- **`src/core/css.ts` is a hand-maintained byte-identical copy of `src/styles.css`**,
  enforced by `src/core/__tests__/css.test.ts`. Edit `src/styles.css`, then paste its
  contents into the template literal in `css.ts`; `src/styles.css` is excluded from
  the formatter so the bytes stay identical.
- **Conventional Commits, enforced.** The `commit-msg` hook runs commitlint. The
  `pre-commit` hook runs `oxfmt` + `oxlint --fix` over staged JS/TS. The repo is
  configured **squash-only**, with the squash commit's subject taken from the
  **PR title** and its body from the **PR description** — a repository setting,
  invisible in the tree. So the PR title is the message that lands on `main` and
  the one release-please reads; `.github/workflows/pr-title.yml` runs the same
  commitlint over it, including the ` (#<number>)` GitHub appends. Branch commit
  subjects are discarded at merge, so a `BREAKING CHANGE:` footer or a
  `!`-suffixed type belongs in the PR title and description, where
  release-please reads it — not in a branch commit.
- **`--max-warnings=0` is a ratchet.** A new warning fails the build. The tree is
  clean; keep it that way, or suppress a warning at the line that earns it with a
  comment saying why.
- **Tests are colocated** in `__tests__/` next to what they cover. New behaviour needs
  a test; a bug fix needs a test that fails before the fix. `src/testing/` is both the
  published test helper surface and what the internal tests use — if you are writing
  setup boilerplate, check whether it belongs there.
- **Changing the extension contract is a published-API change.** Say so in the PR
  description, and read [ADR-003](./docs/adr/ADR-003-contract-version-policy.md) before
  touching `CONTRACT_VERSION`.
- `plans/` is git-ignored local scratch. Doc comments in `src/` cite it by section as
  historical provenance; those are markers, not links.

## Further reading

- [README.md](./README.md) — the consumer-facing documentation for every entry point
- [CONTRIBUTING.md](./CONTRIBUTING.md) — setup, the commit convention, the contract as
  it matters when changing the library
- [docs/architecture.md](./docs/architecture.md) — what the shell guarantees, why the
  boundaries sit where they do, the full style surface, how to write an extension, and
  the known gaps in the contract
- [docs/adr/](./docs/adr/) — decision records, and the process for adding one
- [src/core/contract.ts](./src/core/contract.ts) — the source of truth for the
  contract, and the best-documented file in the repo
