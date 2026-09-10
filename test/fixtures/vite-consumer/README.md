# Vite consumer fixture

**Do not delete this as redundant with the playground's browser suite. It is not.**

## What it guards

One thing, invisible to every other suite: **the packed package, through a bundler's
dependency optimizer, resolves one React** for core, `/kit` and `ext/*`.

A consumer on Vite 8 saw `embed()`'s chip throw "Invalid hook call … more than one
copy of React" while `@nejcm/dev-toolbar` and every `ext/*` entry worked on the same
page, and dropped `embed()` for it. Nothing here could have seen that coming:

- **The vitest suite** aliases every package specifier to `src/`; there is no bundler
  and no `dist/`.
- **The Jest fixture** proves module identity for CommonJS, where the risk is a
  relative import inlined into two entries. ESM code-splits, so that class is absent —
  and a different one takes its place.
- **The playground** is the only browser-level proof the package has, and it *opts
  out* of the optimizer: `examples/playground/vite.config.ts` sets
  `optimizeDeps.exclude: ["@nejcm/dev-toolbar"]` and `resolve.dedupe`, because it
  consumes a `file:../..` link and a linked package would otherwise resolve React
  from the repo root. So `bun run test:e2e` has never exercised the path a real npm
  consumer takes, and cannot see what that path does to module identity.

This fixture stands where the consumer stands: `bun pm pack` output, unpacked into a
real `node_modules/@nejcm/dev-toolbar` directory (no link), a Vite config with nothing
in it but the React plugin, and a page importing four subpaths — core, `/kit`, and
`ext/flags` and `ext/environment`, both of which call kit hooks from their chips.

## What the spec asserts

`e2e/consumer.spec.ts`, one test, one cold dev server:

- the shell mounts and shows every trigger: the two first-party chips, the kit's chip
  for the `embed()` with a `value` (`data-dtb-part="embed-chip"`), and core's own
  trigger for the one without;
- **no error chip** anywhere on the bar, before or after opening the embed panels and
  the flags panel — core's boundary is where a second React would surface;
- no page error, and no console error matching *Invalid hook call* or *more than one
  copy of React*;
- and the evidence about identity itself, from the network: Vite served the package's
  entries from `node_modules/.vite/deps/` (so the optimizer, not a bypass, is what the
  run proves), served `react.js` **exactly once**, and served every optimized file
  under exactly one `?v=` hash — a re-optimization mid-page shows up as the same file
  twice with two hashes, which is what two Reacts look like on the wire.

Selectors, not the agent bridge: the bridge is one more `ext/*` entry, and a bridge
read is least trustworthy in exactly the failure this looks for. The parts used
(`trigger`, `error-chip`, `embed-chip`, `panel`) are documented styling hooks.

## What the fixture found

The consumer saw `embed()`'s chip fail while `ext/*` worked, and the `/kit` import had
arrived in a later commit than the `ext/*` ones, with the dev server up. The proposal
that motivated this fixture guessed at Vite's *late discovery* path. Here is what the
fixture can and cannot say about that.

**Cold start is clean — and that is all the automated spec covers.** With every import
in `src/main.tsx` and `node_modules/.vite` cleared, the page loads with one `react.js`,
no error chip and no console error.

**A first discovery of `/kit` on a running server reproduces the error, transiently.**
Done by hand (below), adding the `/kit` import to a page the server already serves logs:

```
[vite] hmr update /src/main.tsx
[vite] dependency optimized: @nejcm/dev-toolbar/kit
[vite] optimized dependencies changed. reloading
[vite] [console.error] Invalid hook call. Hooks can only be called inside of the body of a function component. …
[vite] [console.error] TypeError: Cannot read properties of null (reading 'useEffect')
    at exports.useEffect (…/node_modules/.vite/deps/react.js?v=f2eb7629:737:30)
    at EmbedChip (…/node_modules/.vite/deps/kit-fCpUMLKr.js?v=f2eb7629:940:29)
[vite] [console.error] [dev-toolbar] extension "vendor-live" crashed in its compact slot. …
```

On the wire, the hot update loads the newly discovered `@nejcm_dev-toolbar_kit.js` and,
through it, `react.js?v=f2eb7629` — while the page's core still holds
`react.js?v=1fba983e`. Two Reacts for one hot update; the first hook in the new entry
throws and core's boundary shows an error chip. About 100 ms later Vite's full reload
lands and everything is served under one hash again. With `optimizeDeps.include` naming
the subpaths, the same edit is an ordinary hot update — no re-optimization, no reload,
no second `react.js`. That recipe is in [`docs/embedding.md`](../../../docs/embedding.md).

**What it does not explain.** The consumer's chip stayed broken; here the error lasts
until the reload. Nothing in this fixture reproduces a failure that survives it, so the
persistent case is open — a second `react` in that tree, or something else in Vite 8's
optimizer, are both still possible.

`embed()` without `value` renders no kit code on the bar, so its trigger cannot be the
first hook to trip over a late discovery either way.

### Reproducing the transient error by hand

Vite keeps an entry once it has optimized it, so the import must be *absent* at start:

1. In `src/main.tsx`, remove the `embed` import and both `embed({ … })` entries.
2. `bun run dev` here — it packs, unpacks and clears `node_modules/.vite` first — and
   open the page.
3. Put the import and the two entries back, and watch the terminal and the page.

To see the mitigation, add the `optimizeDeps.include` list from `docs/embedding.md` to
`vite.config.ts` and repeat from step 1.

## Running it

On a fresh checkout, in this order — the first two once per machine, in **this**
directory, because the root install covers neither. This fixture is not a workspace,
and the root has no `@playwright/test` of its own for `bunx` to resolve:

```bash
bun install --frozen-lockfile         # in test/fixtures/vite-consumer
bunx playwright install chromium      # in test/fixtures/vite-consumer, so it is this
                                      #   directory's exact pin that picks the build
bun run test:vite-consumer            # from the repo root; builds and packs first
```

`ci.yml` installs, then Chromium, then runs, in that order and from that directory,
with `sync` and a `typecheck` in between; the `test` script syncs again itself.

It is a **standalone script, deliberately outside `bun run test`**: it needs a fresh
`dist/`, a tarball, a browser and a dev server — none of which belongs inside a vitest
run. Around 10 s locally, once Chromium is installed.

Its dependencies are installed with bun, like the rest of the repo, and locked in
`bun.lock`. `@nejcm/dev-toolbar` is deliberately **not** among them: `sync-package.mjs`
runs `bun pm pack` at the repo root and unpacks the tarball into this fixture's
`node_modules`, so `--frozen-lockfile` installs stay reproducible while the package
under test is always the one just built. It also clears `node_modules/.vite` — Vite
keys its pre-bundle cache on the lockfile and config, not on a dependency's contents,
and would otherwise serve the previous run's optimized deps over a rebuilt `dist/`.

`@playwright/test` is pinned exactly, like the playground's, because the browser build
must match the package. CI installs and caches a Chromium for each pin from its own
directory, so the two pins need not stay equal — while they are, the second install is
a no-op download.

The server runs on `:5276`, its own origin, like the playground's suite on `:5274`
(`:5275` is that suite's documented alternate). `DTB_VITE_CONSUMER_PORT` overrides it.

Nothing here is published: the root `files` field is `dist`, `CHANGELOG.md`,
`README.md`, `LICENSE`.
