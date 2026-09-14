# Contributing

Thanks for helping out. This is a small library with a deliberately narrow
surface, so most of what follows is about keeping that surface honest.

## Getting set up

Requires [bun](https://bun.sh) and Node 24 or newer (`.nvmrc` pins the major).
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

That is `format:check && typecheck && lint && knip && build && test &&
check:package`, in sequence. `format:check` goes first because it takes about
ten milliseconds: if the tree is mis-formatted you find out immediately rather
than after `tsc` has run. If it passes locally it passes in CI, and a PR that
fails it will not merge. CI does not run it verbatim, though: it splits the
work across three parallel jobs — `package` (`verify:static`, then the two
packaging fixtures, which pack the `dist/` it just built), `unit`
(`test:coverage`) and `browser` (the playground's Playwright suite).
`verify:static` stops short of `vitest run` because `unit` runs the same suite
instrumented, so the suite runs once across CI instead of twice, and no lane
can delay another.

The individual pieces, when you want a faster loop:

| Command                 | What it does                                                   |
| ----------------------- | -------------------------------------------------------------- |
| `bun run verify:static` | everything in `verify` but `vitest run` — what CI runs         |
| `bun run typecheck`     | `tsc --noEmit`                                                 |
| `bun run lint`          | `oxlint --max-warnings=0`                                      |
| `bun run lint:fix`      | `oxlint --fix`                                                 |
| `bun run format`        | `oxfmt` (JS, TS and YAML)                                      |
| `bun run format:check`  | `oxfmt --check` (the first step of `verify`)                   |
| `bun run test`          | `vitest run`                                                   |
| `bun run test:watch`    | `vitest`                                                       |
| `bun run test:coverage` | `vitest run --coverage`                                        |
| `bun run build`         | `tsup`                                                         |
| `bun run check:package` | `publint` + `attw` over a packed tarball                       |
| `bun run knip`          | unused files, exports and dependencies — also part of `verify` |
| `bun run size`          | builds, then prints a per-entrypoint size table                |

`check:package` runs `attw` with `--profile node16` on purpose. Subpath exports
are invisible to the pre-`exports` `node10` algorithm, so a consumer needs
`moduleResolution` `node16` or `bundler`; `node10` is deliberately unsupported
and its failures in that report are expected.

Two things about `lint` that catch people out:

- **`--max-warnings=0` is a ratchet, not a suggestion.** The tree has no
  warnings, and adding one fails the build. If a rule is wrong about your code,
  suppress it on the line that earns it with an `oxlint-disable-next-line`
  comment and a sentence saying why — do not raise the budget.
- **oxfmt is configured for JS, TS and YAML here.** That includes the workflows
  under `.github/`, so a mis-indented `.yml` fails `format:check`. CSS, JSON and
  Markdown are left to `.editorconfig`, so install the EditorConfig extension
  (`.vscode/extensions.json` recommends it).

Formatting is checked in CI as well as fixed on commit. The `pre-commit` hook
formats what you staged, but plenty of commits never see it — edits made in the
GitHub web UI, `git commit --no-verify`, `SKIP_SIMPLE_GIT_HOOKS=1`, and a fresh
clone where `bun install` has not yet installed the hooks. Dependabot counts
too, but only for its `github-actions` bumps: those edit workflow YAML, which
oxfmt formats. Its `bun` updates and release-please's commits touch only JSON,
the lockfile and Markdown, all of which `.oxfmtrc.json` ignores. `format:check`
inside `verify` is what catches the rest. If it fails, `bun run format` fixes
it.

`bun run test:coverage` is a second, instrumented run of the same suite, kept
out of `verify` because the instrumentation is slow enough to notice in a local
loop. The thresholds in `vitest.config.ts` are floors set just under the measured
numbers, so they fail on a regression rather than on ordinary movement. CI runs
it in the `unit` job, where it is the only run of the suite, and a drop below a
floor fails the build. That job exists so nothing else can take it down with
it: until 2026-09-11 coverage ran last in a single serial job, and a stalled
Ubuntu mirror four steps upstream — fetching fallback fonts Chromium did not
need — ran the job past its limit and cancelled the coverage gate outright.

Coverage measures **all** of `src/` bar the test files. If you are tempted to add
an `exclude` entry, measure both ways first and put the numbers in the comment —
the header there records an earlier attempt where three of four excludes rested
on a wrong guess about what those files contained, and quietly put ~1,700 lines
of shipped logic outside the gate.

`bun run knip` reports unused files, exports and dependencies, and it is a gate:
it runs inside `verify`, right after `lint` — it needs no build and takes well
under a second, so the cheapest failure comes first. Unused code fails your
local run before it fails CI. CI also runs it a second time as a report-only
step that writes the findings to the job summary — that copy swallows its exit
code, so the report still renders on a run `verify:static` has already failed.
Its value here is specific: with 11 separately importable entry points, a subpath
can stop being referenced without anything else noticing.

Keep it clean by fixing the code, not by widening `knip.json`. An export used
only inside its own file should lose the `export` keyword; an export that
nothing uses should go. Reach for `ignoreExportsUsedInFile` only for a case you
can name here — the tree currently needs none, and testing through the public
surface is the better answer to "but the test imports it".

`bun run size` prints a per-entrypoint table of gzip, raw, CJS and `.d.ts`
sizes. Read `scripts/bundle-size.mjs`'s header before changing it — the obvious
implementations of this report are all wrong for a code-split build.

`bun run test:jest-consumer` is deliberately _not_ part of `bun run test`. It
builds the package and runs a real jest-based consumer against `dist/`, which is
slow. Run it when you change the build output, the `exports` map, or anything
about how the package is packaged. `bun run test:vite-consumer` is its ESM twin:
it packs the tarball and drives a Vite dev server consuming it, dependency
optimizer and all, in Chromium (needs `bunx playwright install chromium` once).

### The playground

```sh
bun run playground:install   # once
bun run playground           # Vite on :5273
```

The playground consumes the package through its `exports` map, so it reads
`dist/`, not `src/`. After editing `src/` you must `bun run build` (or keep
`bun run dev` running) before the playground shows your change.

`playground:install` deletes `examples/playground/node_modules/@nejcm` before
installing, and needs to. For a `file:` dependency bun copies the whole
repository root rather than the `files` list, so once a previous install has
left a copy in place, the copy's source contains its own destination and bun
recurses into it until it fails with `ENOENT: failed copying files from cache
to destination`. Removing the copy first is what keeps a second install
working. The files inside the copied `dist/` are symlinks back to the root, so
the playground still reads whatever was last built.

## Docs site

VitePress builds the published documentation directly from `docs/`.

```sh
bun run docs:dev
bun run verify:docs
```

The first command runs the local docs server. The second builds the site and fails on
dead links. `docs/README.md` remains the repository index and serves at
`/README.html`; it is deliberately not rewritten, because the `[Documentation index]`
footers across `docs/` link to it as `./README.md` and a rewrite would point them at a
route that is never emitted. Any `docs/<folder>/README.md` intended to serve at
`/<folder>/` does need its own `<folder>/README.md` to `<folder>/index.md` rewrite in
`docs/.vitepress/config.ts` — and no file under `docs/` may then link to that folder
README by name.

Keep links within `docs/` relative. A link from `docs/` to a file elsewhere in the
repository must use an absolute `https://github.com/nejcm/dev-toolbar/blob/main/…`
URL, because VitePress cannot resolve a relative link outside its source root.

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
still runs the same checks, so bypassing buys you nothing except a red PR.

## Pull requests

`.github/PULL_REQUEST_TEMPLATE.md` pre-fills the shape: What / Why /
Implementation Details / Screenshots / Additional Context, plus a checklist.
Keep a PR to a single goal — a formatting sweep and a behaviour change in one
diff cannot be reviewed, and cannot be reverted independently.

### The PR title is the commit message

The repository is configured **squash-only** — squash is the only merge method
enabled, branches are deleted on merge, and the squash commit takes its
**subject from the PR title** and its **body from the PR description**. That is
a repository setting, invisible in the tree, and the check below rests on it.

So the PR title is the message that lands on `main` — the one release-please
reads to decide the version bump and write the changelog section. GitHub
appends ` (#<number>)` to it. A PR titled `fixes` becomes a commit nothing can
classify: no bump, no changelog entry, no error.

The title must therefore be a Conventional Commit, in exactly the form above.
This is checked in CI by `.github/workflows/pr-title.yml`, which pipes the
title — with the ` (#<number>)` suffix, so the length limit is checked against
the real subject — through the same `commitlint` and the same
`.commitlintrc.json` as the `commit-msg` hook. The rules are the same as the
hook's, but the budget is not: `header-max-length` is checked against the title
_plus_ that suffix, so a title in the high nineties passes the `commit-msg`
hook locally and still fails here. It runs on drafts too, and re-runs when you
edit the title.

The other half follows from the same setting: **branch commit subjects are
discarded at merge**, and the **PR description becomes the commit body**. So a
`BREAKING CHANGE:` footer, or the `!` after the type that marks a breaking
change, belongs in the PR title and description — release-please reads them
there. Putting either in a branch commit has no effect at all; the squash throws
that subject and body away.

## The extension contract

Most contributions are extensions, so this is the part worth reading carefully.
[docs/extension-contract.md](./docs/extension-contract.md) documents the contract
for consumers; the notes below are the parts that matter when you are changing the
library itself.

An extension is a **plain object**. Nothing needs to be imported from this
package except its types. In practice extensions are factory functions returning
that object, with state captured in the closure — there is no global registry.
The interface lives in `src/core/contract.ts` (`DevToolbarExtension`), which is
the source of truth; the copy in `docs/` is a summary and has drifted from it
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
- **Import only types from this package where you can.** A _value_ import from a
  subpath is not guaranteed by the bundler to resolve to the same module
  instance as the host's core. This is why `src/ext/diagnostics/runtime.ts`
  keeps its own `TARGET_CONTRACT_VERSION` constant instead of importing
  `CONTRACT_VERSION`.
- **Failures are isolated, not silent.** `compact` and `panel` each render
  inside an `ExtensionBoundary`; a throw becomes an error chip rather than
  taking down the bar. Throws from `start()` and its cleanup are caught and
  logged. Do not rely on this — it is a safety net, not error handling.

## `CONTRACT_VERSION`

`CONTRACT_VERSION` is exported from `src/core/contract.ts` and is currently `2`.
Extensions may declare `contractVersion`; core compares the two.

**What v2 added.** `ToolbarCommand` grew `description`, an optional `input`
schema and a typed `run(input)` that may resolve a value, and
`ExtensionRuntimeApi` grew `invokeCommand(id, input?)` — `runCommand` that
resolves what `run()` returned rather than only whether the id was found.

That is additive for anyone **writing** an extension: every v1 command object
compiles unchanged, because `In` and `Out` both default to `void`. It is *not*
additive for anyone **constructing** an `ExtensionRuntimeApi`. `invokeCommand`
is a required member, so every hand-rolled fake `api` in a test suite is a
compile error until it grows one. Core supplies the real object, so no shipped
extension broke; ten fakes inside this repo did. Use
`fakeExtensionApi()` from `@nejcm/dev-toolbar/testing` rather than hand-rolling
another one — it is there so the next widening costs one edit instead of ten.
[ADR-003](./docs/adr/ADR-003-contract-version-policy.md) records this as the gap
none of its candidate policies can express: "additive" was doing duty for two
different claims and only one of them held.

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

So the interim rule is: **do not bump silently. If you are changing the contract
in a way that is not purely additive, say so in the PR description and raise the
version question there.** Do not assume the additive precedent covers you — the
v2 bump above followed exactly this route, and is a data point rather than a
settlement.

Settling this properly is a pending architecture decision, written up as
[ADR-003](./docs/adr/ADR-003-contract-version-policy.md) — which states the three
candidate policies and what each costs, and settles none of them. Read it before
raising the question, so the PR argues about the options rather than rediscovering
them.

If you add an extension that needs to _state_ a contract version, copy the
equality assertion alongside the constant, not just the constant —
`src/ext/diagnostics/__tests__/diagnostics.test.tsx` asserts
`TARGET_CONTRACT_VERSION === CONTRACT_VERSION` so the hand-maintained copy
cannot drift unnoticed.

## Tests

`vitest`, with tests colocated in `__tests__/` next to what they cover. New
behaviour needs a test; a bug fix needs a test that fails before the fix. The
`src/testing/` entry point (`renderWithToolbar`, `makeExtension`,
`createMockBus`, `fakeExtensionApi`) is both the published test-helper surface
and what this repo's own tests use — so if you are writing setup boilerplate,
check whether it belongs there before copying it into a third `__tests__/`
directory.

## Releasing

Releases are automated. You do not edit `version` in `package.json`, and you do
not write changelog entries by hand.

### The steady state

1. Land a conventional commit on `main`. `feat:` and `fix:` are what move the
   version; `chore:`, `docs:`, `refactor:` and friends do not, unless they carry
   a `BREAKING CHANGE:` footer.
2. That push starts `.github/workflows/release.yml` — the `push:` trigger on
   `main` is **live**, so landing a version-moving commit releases it without
   anyone doing anything. (`workflow_dispatch` is still there for a re-run, or
   for release-by-hand if the `push:` block is ever commented out again.) The
   workflow runs `release-please`, which opens a
   **release PR** titled
   `chore(release): release X.Y.Z`, carrying the version bump and the generated
   `CHANGELOG.md` section.
3. The same job **squash-merges the open release PR** and deletes its branch.
   It looks the PR up in the repo rather than trusting the action to report one
   as created this run, so a release left stranded by an earlier failure is
   picked up and finished by the next push instead of sitting open forever.
   Three things have to hold for a PR to qualify: it is **not** from a fork, its
   branch carries release-please's `release-please--` prefix, and it carries the
   `autorelease: pending` label. Branch names and titles are attacker-chosen on
   a fork PR, so the prefix alone would let an outsider's PR be merged
   unreviewed; the label is applied by the PAT and a fork author cannot set it.
   The merge passes `--match-head-commit`, so a push racing the merge aborts it.
   Don't set a custom `label` in `release-please-config.json` without updating
   the workflow — the selection would match nothing and every release would
   become a green no-op (the step warns when it rejects a prefix-matching PR).
   The PR is not a review step and is never left open — it exists because
   merging it is how release-please recognises a release, and because the squash
   subject (`chore(release): release X.Y.Z (#N)`) is what it parses afterwards.
4. A second `release-please` step in the same job then reads that merged commit,
   tags it (`vX.Y.Z`) and creates the GitHub release. It is a second step rather
   than a second workflow run because the merge lands through the API under
   `GITHUB_TOKEN`, which triggers no workflows — so the `push` trigger never
   sees it. One push to `main` is one whole release.
5. The same run then gates on CI and publishes to npm. Both jobs check out the
   release **tag**, not `github.sha` — that is the commit the run started from,
   which predates the release commit, and checking it out would gate the wrong
   tree and pack the previous version. The gate is `ci.yml` called as a
   reusable workflow, and it is the only CI the release commit gets. It runs
   all of CI, not a subset, even though a release commit changes only
   `package.json`, `CHANGELOG.md` and `.release-please-manifest.json`: this
   repository has no branch protection, so `main` accepts a direct push, and
   the `chore(release):` marker below lets a PR opt out of CI by title. The
   gate is what stands between either of those and npm.
   `ci.yml` skips the release PR itself (by release-please's
   `release-please--*` branch prefix, or the `chore(release):` title marker, and
   only for a **same-repo** PR — otherwise any fork could opt out of CI by
   naming its branch) and skips draft PRs.
6. Publishing uses npm **trusted publishing** (OIDC). There is no npm token in
   this repository, and there should never be one again.

Steps 2 and 4 authenticate with a repository secret, `GH_TOKEN` — a PAT with
**contents**, **pull requests** and **workflows** write. `GITHUB_TOKEN` is not
enough: GitHub refuses `POST /repos/{owner}/{repo}/releases` from it when the
tag's commit range touches `.github/workflows/`, returning only `Resource not
accessible by integration`. That is what stalled `v0.3.0`, which sat bumped and
changelogged on `main` with no tag, no GitHub release and nothing on npm. Step 3
deliberately keeps using `GITHUB_TOKEN` — merging under the PAT would make the
release commit re-trigger this workflow. If the PAT expires, the job fails on its
first step with an explicit message rather than an opaque 403.

**Within a run, no release is declined.** A run ships every `feat:` and `fix:`
that has reached `main` since the last release, under a version nobody chose by
hand; the gate can stop a _broken_ release, not an unwanted one. With
release-on-merge there is no separate "when" to decide — merging *is* the
decision. If a change should not ship yet, keep it off `main`, or land it behind
`chore:`/`refactor:`, which move no version.

After a failed `publish`, use "Re-run failed jobs" on the original run. Two runs
in quick succession do not race: `concurrency` uses a fixed `release` group with
`cancel-in-progress: false`, so the second queues and releases whatever is still
unreleased when its turn comes — often nothing, which is a clean no-op.

That title is not release-please's default, and the exact string is
load-bearing. The default pattern is `chore${scope}: release${component}
${version}` with `${scope}` always filled from the target branch, so left alone
the PR would be titled `chore(main): release dev-toolbar X.Y.Z`. `ci.yml` skips
the release commit — both as a PR and, if the `push:` trigger is restored, as a
push to `main` — by looking for `chore(release):`, because `release.yml` re-runs
CI itself as its gate; with the default title that skip never fires and every
release is verified twice.
(The PR skip has a second, independent signal — the `release-please--*` branch
prefix — so it survives the title pattern breaking. The push skip does not.)
`pull-request-title-pattern` in `release-please-config.json` substitutes the
literal `chore(release)` for `chore${scope}` to keep the marker. The substitute
still parses as a conventional commit, and — this is the part that is easy to
break — it still round-trips through release-please's own title parser, which is
how release-please finds the previous release and how it turns a merged PR into
a GitHub release. An arbitrary title would break far more than the CI skip.

`group-pull-request-title-pattern` is set to the identical string, and both keys
have to stay. They are not duplicates of each other:

- The **per-package** `pull-request-title-pattern` is what titles the PR today.
  release-please's merge plugin, which would otherwise rewrite the title from the
  group pattern, does not run here: `separate-pull-requests` defaults to `true`
  when the config declares exactly one package.
- The **top-level** `group-pull-request-title-pattern` is still used, as the
  second pattern release-please tries when parsing a merged release PR's title
  while creating the GitHub release. It also becomes the operative _titling_
  pattern the day a second package is added, because that flips
  `separate-pull-requests` to `false` and hands the title to the merge plugin —
  whose own default, `chore: release ${branch}`, contains neither the marker nor
  a version.

`include-component-in-tag` is `false`, and that is not a stylistic choice
either. release-please defaults it to **`true`**, and the `node` release type
derives the component from the package name with the scope stripped — so the
default would tag releases `dev-toolbar-v0.2.0`, look for previous releases
under that same shape (never matching the plain `vX.Y.Z` tags this repo
actually has, and so summarising the entire history in the first release PR),
and name the PR
`... release dev-toolbar 0.2.0`. With it `false` the tags are plain `v0.2.0`,
which is what every `vX.Y.Z` in this document means. `include-v-in-tag` stays
`true` and is what supplies the `v` itself; the two are independent.

Versioning is pre-1.0 semantics, set in `release-please-config.json`:
`bump-minor-pre-major` is on, so a `BREAKING CHANGE:` bumps the minor
(`0.1.0` -> `0.2.0`) rather than going to `1.0.0`. Turn that off deliberately
when the API is ready to be called stable. This says nothing about when
`CONTRACT_VERSION` should change — see the section above; that policy is
genuinely unsettled and belongs in an ADR, not in a release config.

The `## 0.1.0` section of `CHANGELOG.md` is hand-written and predates the
automation. It is kept verbatim; generated sections stack above it. The HTML
comment at the top of that file explains what anchors the insertion point.

### When a release is tagged but not published

`release-please` creates the git tag and the GitHub release _before_ the gate
and the publish job run. So a failure in either leaves the repo one version
ahead of npm: `vX.Y.Z` is tagged, the GitHub release is live, `package.json` and
`CHANGELOG.md` say `X.Y.Z` on `main`, and the registry has never heard of it.
Nothing is corrupt, but it will not fix itself.

**If the failure was transient** — a registry blip, a network error, a flaky
test — **use "Re-run failed jobs", never "Re-run all jobs".** A partial re-run
keeps the outputs of the jobs that already succeeded, so `release-please`'s
`release_created` is still `true` and `publish` runs on the second attempt
against the same commit.

A _full_ re-run is the trap, and it does not announce itself. When
`release-please` tagged the release it also relabelled the release PR from
`autorelease: pending` to `autorelease: tagged`, and release-please finds merged
release PRs by filtering for the _pending_ label. So a full re-run finds nothing
to release: `release_created` is never set, `gate` and `publish` skip, and the
whole run **completes green having published nothing**. That is worse than a
failure, because the only signal is a green check on a release that does not
exist on npm. (A duplicate-release error — the other thing you might expect — is
reachable only if the very first run died _between_ tagging and relabelling,
leaving a pending PR next to an existing tag.)

**If the failure was real** — the gate caught something — a re-run cannot help,
because the commit is unchanged. Fix it forward: the fix lands on `main` as its
own commit and produces a _new_ release PR for the next version. `X.Y.Z` stays
tagged and unpublished, and that is usually the right outcome — let `X.Y.Z+1` be
the first published version. There is no gap to explain, because npm never saw
`X.Y.Z`. Do not delete and re-push the tag to reuse the number: a GitHub
release already points at it, and release-please relabelled that release PR
`autorelease: tagged` the moment it tagged, so it will not offer `X.Y.Z` again
regardless of what you do to the tag.

The last resort is publishing that exact tag by hand. It works, but trusted
publishing only authenticates from CI, so a manual publish means a credential
and 2FA prompt — and it re-opens the token path trusted publishing exists to
avoid. Prefer rolling forward. If you must, do it in this order:

1. `git checkout vX.Y.Z` in a **clean** checkout — `git status --porcelain` must
   print nothing — then `bun install --frozen-lockfile`.
2. `bun run verify`, then the CommonJS packaging check:
   `bun install --frozen-lockfile --cwd test/fixtures/jest-consumer` — the root
   install does not reach that standalone fixture and `test:jest-consumer` does
   not install it — then `bun run test:jest-consumer`.
3. `npm whoami` (`npm login` opens the browser for the passkey; new TOTP
   enrolments were disabled in October 2025), then
   `npm publish --access public --dry-run` and **read the file list** — `dist/`
   plus `CHANGELOG.md`, `README.md`, `LICENSE` and `package.json`, and nothing
   from `src/`, `test/` or `examples/`. `prepublishOnly` runs
   `typecheck && build`, so the dry run rebuilds `dist/` itself.
4. `npm publish --access public` — the flag explicitly, because a scoped package
   defaults to restricted — then wait ~5 minutes for npm's publish-time malware
   scan before expecting the package to be installable.

### How the first publish happened

`0.5.0`, on 2026-09-08, is the first version on npm, and it went out **by hand**:
the registry records its publisher as the `nejcm` account, on npm 11.17.0 and Node
26.4.0, while every version from `0.6.0` on records
`GitHub Actions <npm-oidc-no-reply@github.com>` on npm 11.19.0 and Node 24.20.0
(`npm view @nejcm/dev-toolbar@0.5.0 --json`, field `_npmUser`). That is a person's
credential rather than CI's OIDC; which machine it was typed on npm does not record.

It had to be a manual publish because npm trusted publishing cannot create a package
that does not exist yet ([npm/cli#8544](https://github.com/npm/cli/issues/8544)): an
initial version has to go out manually or with a token, so it could not take this
repository's token-free CI path.

That bootstrap restriction is why `0.5.0` did not come from `release.yml`. It is
**not** the whole reason `v0.2.0`, `v0.3.0`, `v0.4.0` and `v0.4.1` are tagged and
never published: the workflow was still being fixed across those releases, and the
runs failed in different ways. The run on the `0.4.0` release PR retried `gh pr merge`
five times against `fatal: not a git repository` and never reached its tag step
([run 33714746207](https://github.com/nejcm/dev-toolbar/actions/runs/33714746207));
an earlier run failed inside release-please with "Resource not accessible by
integration"
([run 33711560073](https://github.com/nejcm/dev-toolbar/actions/runs/33711560073));
and `a9c8d05` records that the gate and publish jobs checked out the triggering push
instead of the release commit, so the `v0.4.0` run's `npm publish` packed `0.3.0`.
Those tags staying unpublished is the outcome the fix-it-forward rule above
prescribes anyway — `0.5.0` became the first published version, with no gap to
explain.

**No published version carries provenance**, and the reason is the repository,
not the publish path: npm generates a Sigstore provenance attestation only when
the source repository is **public**, and `nejcm/dev-toolbar` is private. So
trusted publishing attests nothing, and `--provenance` is not a missing flag to
add — it is unavailable to a private repository. Checked 2026-09-10: npm's
attestation endpoint 404s for `0.5.0`, `0.6.0` and `0.8.1` alike — the
hand-published version and the CI-published ones equally — and no version
carries `dist.attestations`. Making the repository public would start attesting
the *next* release; a version, once published, cannot be re-published with
provenance added, so everything up to that point stays unattested either way.

Everything since is automatic. The npm trusted publisher is configured for
GitHub Actions, repository `nejcm/dev-toolbar`, workflow filename `release.yml`,
no environment (see the comment in `release.yml`), and the steady state above has
published every release from `0.6.0` on. Two invariants keep it that way:

- **Do not rename `.github/workflows/release.yml`.** npm's trusted publisher
  matches on the calling workflow's filename; renaming the file breaks publishing
  until it is reconfigured on npmjs.com.
- **There is no publish token in this repository and there should never be one.**
  Trusted publishing needs none. What is meant to enforce that is npm's
  **Publishing access** setting — "Require two-factor authentication and
  disallow tokens", which trusted publishing is compatible with and tokens are
  not — together with immutable releases in the GitHub repository settings.
  Neither is readable from the repository, so both are stated here as the
  intended configuration; confirm them on npmjs.com and in repo settings rather
  than trusting this line. Publishing a tag by hand — the last resort above —
  needs a credential and a 2FA prompt instead, which is the other reason to
  prefer rolling forward.

Tagging is not a manual step either: release-please tags each release and
`.release-please-manifest.json` tracks the current version, so it reads commits
from the newest tag. (`v0.1.0` does not exist; the original plan to hand-publish
it never happened, and nothing depends on it.)

Do **not** use `bun publish` anywhere. It supports neither OIDC nor provenance,
and silently ignores `publishConfig.provenance`
([oven-sh/bun#18611](https://github.com/oven-sh/bun/issues/18611)) — a failure
that looks like success. OIDC is the half that bites here: without it there is
no trusted publishing, and CI has no other credential. (Provenance is moot for
the reason above, and `publishConfig.provenance` is not set.)

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
