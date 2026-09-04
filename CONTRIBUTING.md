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
fails it will not merge. CI does not run it verbatim, though: it runs
`verify:static` and then `test:coverage`, so the suite runs once there instead
of twice.

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
this after `verify:static`, where it is the only run of the suite, and a drop
below a floor fails the build.

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
2. Run `.github/workflows/release.yml` from the Actions tab
   (`workflow_dispatch`). The `push:` trigger is **commented out**, so landing on
   `main` releases nothing by itself — a run is started by hand, and it releases
   everything unreleased at once. Restore the `push:` block to go back to
   release-on-merge. The workflow runs `release-please`, which opens a
   **release PR** titled
   `chore(release): release X.Y.Z`, carrying the version bump and the generated
   `CHANGELOG.md` section.
3. The same job **squash-merges the open release PR** and deletes its branch.
   It looks the PR up by release-please's `release-please--` branch prefix
   rather than trusting the action to report one as created this run, so a
   release left stranded by an earlier failure is picked up and finished by the
   next push instead of sitting open forever.
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
   reusable workflow, and it is the only CI the release commit gets.
   `ci.yml` skips the release PR itself (by release-please's
   `release-please--*` branch prefix, or the `chore(release):` title marker)
   and skips draft PRs.
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

**Within a run, no release is declined.** A dispatched run ships every `feat:`
and `fix:` that has reached `main` since the last release, under a version
nobody chose by hand; the gate can stop a _broken_ release, not an unwanted one.
Deciding _when_ is the dispatch itself. If a change should not ship yet, either
do not dispatch, or land it behind `chore:`/`refactor:`, which move no version.

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
under that same shape (never finding the `v0.1.0` bootstrap tag, and so
summarising the entire history in the first release PR), and name the PR
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

The last resort is publishing that exact tag by hand
(`git checkout vX.Y.Z && npm publish --access public`). It works, but trusted
publishing only authenticates from CI, so a manual publish means a credential
and 2FA prompt — and it re-opens the token path the bootstrap closed. Prefer
rolling forward.

### One-time bootstrap — NOT YET DONE

**This has to happen once before any of the above reaches npm.** npm trusted
publishing cannot create a package that does not exist yet
([npm/cli#8544](https://github.com/npm/cli/issues/8544)), and nothing has been
published: `npm view @nejcm/dev-toolbar` is a 404. So the first version goes out
**by hand, from a laptop**, and until it does, `release.yml` tags and releases
versions it cannot publish — which is what `v0.2.0` … `v0.5.0` are.

That means the first published version is **whatever `main` is at now**, not
`0.1.0`; substitute it for `X.Y.Z` below. It ships **without provenance**:
`npm --provenance` only works from CI, and CI cannot publish yet. That is the
accepted price of never creating a publish token, not an oversight to fix later
— a version, once published, cannot be re-published with provenance added. Every
release after it gets provenance automatically through trusted publishing.

1. **Confirm the npm account's 2FA is passkey/WebAuthn.** New TOTP enrolments
   have been disabled since October 2025.
2. **Confirm the entry-point workflow filename is `release.yml`** and leave it
   alone. npm's trusted publisher matches on the calling workflow's filename, so
   this has to be settled before npm is configured, not after. Renaming the file
   later breaks publishing. It is settled: `release.yml`.
3. **Skim <https://docs.npmjs.com/policies/dual-use/>.** Almost certainly not
   applicable, but this package reads runtime diagnostics, and finding out at
   publish time would be a bad surprise.
4. **Publish from the tagged release commit.** Do **not** use the `0.0.0`
   placeholder trick that circulates in npm/cli#8544 — a version number, once
   used, can never be reused, even after an unpublish.

   ```sh
   git switch main && git pull            # must be the commit vX.Y.Z tags
   git status --porcelain                 # must print nothing
   bun install --frozen-lockfile

   bun run verify                         # format, typecheck, lint, build, test,
                                          #   package shape
   bun install --frozen-lockfile --cwd test/fixtures/jest-consumer
   bun run test:jest-consumer             # the CommonJS packaging check

   npm whoami                             # `npm login` if this fails; it opens
                                          # the browser for the passkey
   npm publish --access public --dry-run  # read the file list before committing
   npm publish --access public
   ```

   Nothing else is needed before the last line: `prepublishOnly` runs
   `typecheck && build`, so `npm publish` builds `dist/` itself — verified from a
   checkout with `dist/` deleted, where the dry run rebuilt it and packed exactly
   the `files` field — `dist/` plus `CHANGELOG.md`, `README.md`, `LICENSE` and the
   always-included `package.json` — and nothing from `src/`, `test/` or
   `examples/`. That file list is what the dry run is for; read it rather than
   trusting a size quoted here, which drifts every time the bundle changes.
   `--access public` is passed explicitly even though `publishConfig.access`
   already says so: a scoped package defaults to restricted, and this is not a
   place to rely on one file agreeing with another.

   Do **not** use `bun publish`. It supports neither provenance nor OIDC and
   silently ignores `publishConfig.provenance` ([oven-sh/bun#18611](https://github.com/oven-sh/bun/issues/18611))
   — a failure that looks like success.

5. **Wait ~5 minutes** for npm's publish-time malware scan before expecting the
   package to be installable.
6. **Configure the Trusted Publisher on npmjs.com**: GitHub Actions, repository
   `nejcm/dev-toolbar`, workflow filename `release.yml`, no environment (see the
   comment in `release.yml` for why there is no environment).
7. **Close the token path for good.** Set npm **Publishing access** to "Require
   two-factor authentication and disallow tokens" — trusted publishing is
   compatible with that setting, tokens are not — and enable **immutable
   releases** in the GitHub repository settings. There is no publish token in
   this repository and there should never be one.
8. **Update the README's status note**, which says the package is not on npm yet.

Tagging is not a step here: release-please already tags each release, and
`.release-please-manifest.json` tracks the current version, so it reads commits
from the newest tag. (The original bootstrap plan hand-published and hand-tagged
`0.1.0`; that never happened, and `v0.1.0` does not exist. Nothing depends on it
now.)

Delete this whole "One-time bootstrap" subsection once it is done.

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
