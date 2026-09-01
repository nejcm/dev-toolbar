# Contributing

Thanks for helping out. This is a small library with a deliberately narrow
surface, so most of what follows is about keeping that surface honest.

## Getting set up

Requires [bun](https://bun.sh) and Node 20 or newer (`.nvmrc` pins the major).
The exact bun version is in `package.json` under `packageManager`, and CI reads
that same field, so matching it locally means matching CI.

```sh
bun install
```

`bun install` also runs `simple-git-hooks`, which installs the `pre-commit` and
`commit-msg` hooks described below. If hooks ever stop firing, run
`bunx simple-git-hooks` to reinstall them.

## The one command that matters

```sh
bun run verify
```

That is `typecheck && lint && test && build`, in sequence — the exact gate CI
runs. If it passes locally it passes in CI, and a PR that fails it will not
merge.

The individual pieces, when you want a faster loop:

| Command | What it does |
| --- | --- |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | `oxlint --max-warnings=59` |
| `bun run lint:fix` | `oxlint --fix` |
| `bun run format` | `oxfmt` (JS/TS only) |
| `bun run format:check` | `oxfmt --check` |
| `bun run test` | `vitest run` |
| `bun run test:watch` | `vitest` |
| `bun run build` | `tsup` |

Two things about `lint` that catch people out:

- **`--max-warnings=59` is a ratchet, not a suggestion.** It is pinned to the
  exact number of warnings in the tree today. Adding one warning fails the
  build. If you legitimately reduce the count, lower the number in
  `package.json` in the same PR so the budget tightens instead of leaving slack
  for someone else's new warning.
- **oxfmt handles JS and TS only.** CSS, JSON and Markdown have no formatter
  here. `.editorconfig` is what keeps them consistent, so install the
  EditorConfig extension (`.vscode/extensions.json` recommends it).

`bun run test:jest-consumer` is deliberately *not* part of `bun run test`. It
builds the package and runs a real jest-based consumer against `dist/`, which is
slow. Run it when you change the build output, the `exports` map, or anything
about how the package is packaged.

### The playground

```sh
bun run playground:install   # once
bun run playground           # Vite on :5273
```

The playground consumes the package through its `exports` map, so it reads
`dist/`, not `src/`. After editing `src/` you must `bun run build` (or keep
`bun run dev` running) before the playground shows your change.

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org).
This is enforced: the `commit-msg` hook runs `commitlint` against
`.commitlintrc.json`, and a non-conforming message is rejected before the commit
is created.

```
<type>(<optional scope>): <description>
```

`type` must be one of `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`,
`refactor`, `revert`, `style`, `test`. A `!` after the type/scope or a
`BREAKING CHANGE:` footer marks a breaking change.

```
feat(flags): add a per-flag reset control
fix(core): stop the overflow menu closing on its own scrollbar
docs: document the extension contract
```

Body and footer line lengths are deliberately unlimited — the defaults reject
long URLs and `Co-Authored-By:` trailers, which is not a useful thing to be
strict about.

There is a `.gitmessage` template in the repo with the types and footers spelled
out. It is **opt-in and machine-local** — nothing in the repo turns it on for
you, and it is not checked by anything:

```sh
git config commit.template .gitmessage
```

It is a convenience for writing the message, not a gate. The `commit-msg`
commitlint hook is the actual gate.

### What the hooks do

- **`pre-commit`** runs `lint-staged`, which formats (`oxfmt`) and auto-fixes
  (`oxlint --fix`) only the JS/TS files you staged. Fixes are applied in place,
  so re-stage if it changes something.
- **`commit-msg`** runs `commitlint`.

To bypass both in an emergency: `SKIP_SIMPLE_GIT_HOOKS=1 git commit ...`. CI
still runs `bun run verify`, so bypassing buys you nothing except a red PR.

## Pull requests

`.github/PULL_REQUEST_TEMPLATE.md` pre-fills the shape: What / Why /
Implementation Details / Screenshots / Additional Context, plus a checklist.
Keep a PR to a single goal — a formatting sweep and a behaviour change in one
diff cannot be reviewed, and cannot be reverted independently.

## The extension contract

Most contributions are extensions, so this is the part worth reading carefully.
`README.md` documents the contract for consumers; the notes below are the parts
that matter when you are changing the library itself.

An extension is a **plain object**. Nothing needs to be imported from this
package except its types. In practice extensions are factory functions returning
that object, with state captured in the closure — there is no global registry.
The interface lives in `src/core/contract.ts` (`DevToolbarExtension`), which is
the source of truth; the README's copy is a summary and has drifted from it
before.

First-party extensions live one directory per extension under `src/ext/<name>/`,
each following the same file convention: `index.tsx` (the factory), `runtime.ts`
(non-React logic), `ui.tsx`, `types.ts`, `css.ts`, `__tests__/`.

A new extension is a new published subpath, so it must be added **explicitly**
to both:

- the `exports` map in `package.json`, and
- the `entry` and `dts.entry` maps in `tsup.config.ts`.

Never as a wildcard. An entry that is missing from either is silently
unpublishable or untyped.

Rules that the code actually enforces or depends on:

- **`id` is the identity.** It keys deduplication, panel state, per-extension
  storage and the `data-dtb-ext-id` attribute. Changing an id is a breaking
  change for consumers who persisted state against it.
- **Build the object once, outside render.** Core warns (once per id) when an
  already-started id reappears with a different `start` function reference,
  because that means the extension is being rebuilt every render.
- **Slot functions must be cheap.** `compact`, `panel` and `overlay` run on
  every toolbar render.
- **Import only types from this package where you can.** A *value* import from a
  subpath is not guaranteed by the bundler to resolve to the same module
  instance as the host's core. This is why `src/ext/diagnostics/runtime.ts`
  keeps its own `TARGET_CONTRACT_VERSION` constant instead of importing
  `CONTRACT_VERSION`.
- **Failures are isolated, not silent.** `compact` and `panel` each render
  inside an `ExtensionBoundary`; a throw becomes an error chip rather than
  taking down the bar. Throws from `start()` and its cleanup are caught and
  logged. Do not rely on this — it is a safety net, not error handling.

## `CONTRACT_VERSION`

`CONTRACT_VERSION` is exported from `src/core/contract.ts` and is currently `1`.
Extensions may declare `contractVersion`; core compares the two.

**What a mismatch does today: it logs a `console.warn` and nothing else.** The
extension still renders, still starts, still contributes commands and
diagnostics. An absent `contractVersion` is silent, and nothing warns when the
toolbar is `enabled={false}`. The field is documentation, not a gate — core has
no basis to decide what a mismatch means, and refusing to render would turn a
warning into an outage.

**When to bump it is not a settled rule, and this document will not invent
one.** What exists is precedent: every change so far has been additive — a new
optional field, or a widened existing one — and none of them bumped, on the
reasoning that bumping for an additive change spends the one signal a version
number carries. That precedent leaned partly on "nothing has been published
yet", which stopped being true at `0.1.0`.

So: **if you are changing the contract in a way that is not purely additive,
Settling this properly is a pending architecture decision, written up as
[ADR-003](./docs/adr/ADR-003-contract-version-policy.md) — which states the three
candidate policies and what each costs, and settles none of them. Read it before
raising the question, so the PR argues about the options rather than rediscovering
them.

If you add an extension that needs to *state* a contract version, copy the
equality assertion alongside the constant, not just the constant —
`src/ext/diagnostics/__tests__/diagnostics.test.tsx` asserts
`TARGET_CONTRACT_VERSION === CONTRACT_VERSION` so the hand-maintained copy
cannot drift unnoticed.

## Tests

`vitest`, with tests colocated in `__tests__/` next to what they cover. New
behaviour needs a test; a bug fix needs a test that fails before the fix. The
`src/testing/` entry point (`renderWithToolbar`, `makeExtension`, `mockBus`) is

## Further reading

- [docs/architecture.md](./docs/architecture.md) — the reference for the shipped core:
  what the shell guarantees, why the boundaries sit where they do, the full style
  surface, the extension-authoring guide, and the known gaps in the contract.
- [docs/adr/](./docs/adr/) — decision records, and when to add one. The short version:
  an ADR is for a decision whose reversal would be paid for by consumers. Most
  decisions are not that.
- [src/core/contract.ts](./src/core/contract.ts) — the contract itself. Where it and
  any document disagree, the file is right.
- [AGENTS.md](./AGENTS.md) — the same repo map, written for coding agents. It is the
  single source; `CLAUDE.md` only points at it, so edit `AGENTS.md`.
