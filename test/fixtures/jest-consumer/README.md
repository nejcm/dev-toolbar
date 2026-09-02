# CommonJS / Jest consumer fixture

**Do not delete this as redundant with the vitest suite. It is not.**

## What it guards

Two things, both invisible to the main test suite.

**One core instance across entry points.** `src/testing` must value-import core through
`@nejcm/dev-toolbar` (external in `tsup.config.ts`), not `../core/*`: the CJS build has
no code splitting, so a relative value import is inlined and a consumer requiring both
`.` and `./testing` gets two cores. The vitest suite cannot see this — it aliases both
specifiers to the same files in `src/`.

**The optional Testing Library peer.** `@nejcm/dev-toolbar/testing` loads
`@testing-library/react` — an *optional* peer — through two different paths:

- **ESM runners** get a cached dynamic `import()`, so `act` and `render` come from
  the host's own module graph. A `createRequire()` here would return a second copy
  whose `cleanup()` would not clean up what our `render()` mounted.
- **Jest** never resolves a dynamic `import()` inside its vm sandbox, so the
  CommonJS build falls back to `module.require` — which *is* Jest's own resolver,
  returning the copy already in its registry. Jest 29 left that import pending
  forever; Jest 30 rejects it with "A dynamic import callback was invoked without
  --experimental-vm-modules". Either way it never yields a module, and the
  fallback is what supplies Testing Library — confirmed by disabling the fallback
  and watching `render.test.js` go red.

That optional peer must also never appear as a **static** import, or importing the
subpath for `createMockBus()` alone would fail with `ERR_MODULE_NOT_FOUND` on a
project that never installed Testing Library.

## Why the vitest suite cannot cover this

It runs in an ESM host, so it only ever exercises the first path. It can grep the
built bundle for the *shape* of an import, and it does — but that is a canary, not
proof. The things that break this are invisible in review:

- an esbuild upgrade changing how a bare `require` is emitted;
- a `tsup.config.ts` change reintroducing esbuild's `__require` shim (which is
  truthy in ESM, silently widening a guard meant to be dead there);
- re-enabling `treeshake`.

This failure class has already shipped twice in one phase: first as a static import
that made the whole subpath unimportable without Testing Library, then as a
dynamic-import-only load that broke every Jest consumer even with it installed.

## What the tests assert

| File | Asserts |
| --- | --- |
| `render.test.js` | The DOM-free helpers work; `renderWithToolbar()` renders **with no `setTestingLibrary()` call**; and Testing Library's `cleanup()`, called through the *test file's own* `require`, unmounts what the toolbar rendered — proving one shared registry copy rather than two instances. |
| `shared-instance.test.js` | The main entry and `./testing` resolve to **one** core: their `createMemoryStorage` is identical, the main entry's `useDevToolbar()` works inside `renderWithToolbar()`, and `<DevToolbarInset>` reads the height variable the rendered toolbar publishes. `dist/testing.cjs` used to inline its own copy of core — CJS has no code splitting — so all three failed. Invisible to vitest, which aliases both specifiers to `src/`. |
| `missing-rtl.test.js` | With Testing Library mocked unresolvable: the subpath still imports and the non-DOM helpers still work, and `renderWithToolbar()` throws a message naming the `require(...)` remedy and the `setupFilesAfterEnv` note — not the `await import(...)` form, which is the one thing that cannot work here. |

## Running it

```bash
npm run test:jest-consumer     # from the repo root; builds first
```

It is a **standalone script, deliberately outside `npm test`**: it needs a fresh
`dist/`, and a second test runner inside the vitest run would confuse both.

`sync-package.mjs` copies the built `dist/` into this fixture's `node_modules` as
`@nejcm/dev-toolbar`, with the real `exports` map. It copies rather than links
because Jest resolves through realpath, and a link would pull React from the repo
root while the tests pull it from here — two React copies, and an "invalid hook
call" with nothing to do with what is under test.

There is deliberately no `setupFiles`. A `jest.setup.cjs` used to exist to filter
the multi-kilobyte "Could not parse CSS stylesheet" error that Jest 29's older
bundled jsdom logged on every render, because it does not understand `@layer`.
Jest 30 bundles jsdom 26, which parses `@layer` fine, so the filter was deleted
rather than left swallowing `console.error` for nothing — a fixture nobody can
read when it fails is a fixture nobody keeps.

Nothing here is published: the root `files` field is `dist`, `README.md`, `LICENSE`.
