# Browser tests

Playwright specs that drive the playground in a real Chromium, one file per
feature recipe in
[`.claude/skills/verify-dev-toolbar/features/`](../../../.claude/skills/verify-dev-toolbar/features/README.md).
They exist so a change to `src/core`, `src/runtime` or `src/ext` is proven the
way a user meets it — layout, stacking, real keys, a reload, `localStorage` —
where vitest's jsdom cannot see, and so an agent can verify its own work with
one command instead of a hand-driven browser session.

```sh
bun run test:e2e            # at the repo root: builds dist/, then runs the suite
bun run test:e2e            # here: runs against the dist/ that already exists
bun run test:e2e:ui         # Playwright's UI mode, for writing or debugging a spec
bunx playwright show-report e2e-results/report
```

Chromium is installed once with `bunx playwright install chromium` (CI does
`--with-deps`). The first run of a fresh checkout needs it.

## How it is put together

- **Own server, own origin.** `playwright.config.ts` starts Vite on `:5274`,
  never the `bun run dev` playground on `:5273`. A different port is a
  different `localStorage`, so the suite cannot disturb a toolbar someone is
  looking at, and each test's fresh browser context starts with an empty store.
- **State through the bridge, selectors for input.** `fixtures.ts` wraps
  `window.__DEV_TOOLBAR__.instances.playground`: `read()`, `ext(id)`,
  `run(id, input)`, `storage()`. Every state assertion goes through it. A
  selector is for clicking, or for something that is genuinely pixels
  (geometry, stacking, focus). If an assertion cannot be made from
  `read().diagnostics`, the extension is under-publishing — fix that in
  `src/ext/<name>` rather than scraping.
- **Keyboard.** Press `` `${await toolbar.mod()}+K` ``, never a literal `Meta`
  or `ControlOrMeta`: the toolbar resolves `Mod` from the page's own platform,
  and a device profile with a Windows user agent on a Mac host will disagree
  with what Playwright sends.
- **Viewport 1280×800**, the same as the manual recipes, so numbers are
  comparable. At that width part of the bar is already collapsed into `⋮`.
- **`bridge-http.spec.ts` runs last, alone.** The dev-server plugin holds one
  snapshot slot; a second open page makes its `connection.ambiguous` true. It
  is a separate project with `dependencies` on the main one and one worker.
- **Failures keep evidence.** Traces and screenshots are retained on failure
  under `e2e-results/` (git-ignored). Open a trace with
  `bunx playwright show-trace <path>`.
- **A red test can be the finding.** `test.fail(true, reason)` keeps a known
  library bug visible without blocking the suite; Playwright reports the test
  as *unexpectedly passed* once the bug is fixed, which is the cue to remove
  the annotation. Never delete or loosen an assertion to get green.

## Adding a spec

Start from the matching recipe file, or write one there first — the recipe is
the maintained description of what a user sees. Assert on ids and order, never
on a bar count or an exact chip list at one width: both move whenever the
playground gains an extension. Use `expect.poll` around bridge reads that
follow an action; extensions publish on their own polls (flags 400 ms,
environment 500 ms).
