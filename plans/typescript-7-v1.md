---
description: Documents why the typescript@^7 upgrade was reverted (tsup's dts step breaks on the Go-native package) and lays out what has to change upstream before a retry.
date: 2026-09-02
status: blocked
---

# The path to TypeScript 7

Written 2026-09-02, after the dependency bump that tried `typescript@^7.0.2` and
had to be reverted to `^5.9.3`. Everything in "What is actually true" below was
measured in this repo, not inferred; the commands are included so it can be
re-measured when any of it changes.

## What is actually true

TypeScript 7 is the Go-native port. The npm package no longer ships the classic
compiler API:

```sh
node -p "require('./node_modules/typescript/package.json').exports['.']"
# ./lib/version.cjs
node -e "console.log(Object.keys(require('typescript')))"
# [ 'version', 'versionMajorMinor' ]
```

`ts.sys`, `ts.createProgram` and everything built on them are gone from the
default entry. The remaining surface is `tsc`, plus `./unstable/*` (sync/async
API, `ast`, `fs`, `proto`).

Consequences, in order of how they surface:

1. **`bun run typecheck` passes.** `tsc --noEmit` is unaffected. This is the
   trap: the upgrade looks clean and the failure is one script further on.
2. **`tsconfig.json` needed `baseUrl` removed** (TS5102 — the option is gone).
   Already done; `paths` were tsconfig-relative already, so it is a no-op under
   5.9 and forward-compatible. Nothing to redo.
3. **`bun run build` dies before it starts:**

   ```
   TypeError: Cannot read properties of undefined (reading 'useCaseSensitiveFileNames')
     at node_modules/.pnpm/rollup-plugin-dts@6.1.1/.../rollup-plugin-dts.cjs
     (/Users/nejc/Work/dev-toolbar/node_modules/tsup/dist/rollup.js:4857:37)
   ```

   `tsup --no-dts` builds fine. **Only the `.d.ts` step is blocked.**

### Why it cannot be fixed with an override

`rollup-plugin-dts` is not a dependency of tsup and not a resolvable module:

```sh
node -p "Object.keys(require('./node_modules/tsup/package.json').dependencies)"
# ...no rollup-plugin-dts
ls node_modules/rollup-plugin-dts        # ENOENT
grep -n "require('typescript')" node_modules/tsup/dist/rollup.js
# 6468: var _typescript = require('typescript'); ...
```

Version 6.1.1 is **inlined into tsup's own bundle**. No `overrides`,
`resolutions` or bun `patchedDependencies` entry can reach it. It takes a tsup
release.

### The ecosystem has already moved; tsup has not

| Package | TS 7 support |
| --- | --- |
| `rollup-plugin-dts@6.5.1` | peer `typescript: ^4.5 \|\| ^5 \|\| ^6 \|\| ^7`, via optional peer `@typescript/typescript6@^6` (published, 6.0.2) |
| `rolldown-plugin-dts@0.27.13+` | peer `typescript: ^5.0.0 \|\| ^6.0.0 \|\| ~7.0.0`, plus `@typescript/native-preview` |
| `tsup@8.5.1` (latest) | vendors `rollup-plugin-dts@6.1.1` — **blocked** |
| `tsdown@0.22.14` | depends on `rolldown-plugin-dts@^0.27.13` — **works** |

tsup 8.5.1 is the latest release. There is no newer version to upgrade to.

### The codebase is 12 annotations from needing no TypeScript API at all

```sh
bunx tsc --noEmit --isolatedDeclarations 2>&1 | grep -c "error TS"   # 14
```

All 14, in full:

| Count | Rule | Files |
| --- | --- | --- |
| 8 | TS9010 (needs explicit type annotation) | `src/core/css.ts` plus every extension's `css.ts` (command-menu, diagnostics, environment, flags, metrics, overlays, theme-editor) |
| 4 | TS9010 | `src/core/context.ts:54`, `src/core/OverlayHost.tsx:81`, `src/ext/overlays/runtime.ts:93`, `src/ext/overlays/types.ts:197` |
| 2 | TS9037 (default export not inferable) | `tsup.config.ts:7`, `vitest.config.ts:6` — **config files, not in the `dts.entry` map; irrelevant** |

So **12 real annotations**, eight of which are the same mechanical fix on the
generated-adjacent `css.ts` files. This matters more than it looks: with
`isolatedDeclarations`, emitting `.d.ts` becomes a purely syntactic
transform. A dts generator then needs no type checker, no `ts.createProgram`,
and no TypeScript version opinion — which removes the entire class of breakage
this document is about, permanently.

## The options

**A. Wait for tsup.** Cost: nothing. Then `typescript: ^7`, delete the pin, done.
Risk: unbounded. tsup's dts step has been unchanged for a while and the
rolldown-era successor (tsdown) is where that ecosystem's attention is. This
could be a long wait, and it is not something this repo controls. Keep as the
happy path, do not plan around it.

**B. Migrate `tsup` → `tsdown`.** The intended successor, same rolldown/Vite
orbit, ships a tsup migration path. Unblocks TS 7 today. Cost: a real build
change — `entry`/`dts.entry`, `format: ["esm","cjs"]`, `banner` (`"use client"`),
`treeshake: false`, `external`, `sourcemap`, and the `styles.css` entry all have
to land identically.

**C. Drop dts bundling; emit with `tsc --emitDeclarationOnly`.** Rejected.
`tsc` mirrors `src/` (`dist/runtime/index.d.ts`), the `exports` map points at a
flat layout (`dist/runtime.d.ts`), and CJS needs `.d.cts` separately. It would
churn the published `exports` map — a public API surface — to work around a
build tool. Wrong trade.

**D. `isolatedDeclarations` + oxc-based dts.** Not an alternative to B; it is
what makes B cheap and permanent. Do it first, on its own.

## Recommended path

Three independent phases. Each is shippable alone and none strands the repo
mid-migration.

### Phase 1 — turn on `isolatedDeclarations` (do this now, under TS 5.9)

Independently valuable, zero build risk, and it is the load-bearing step.

1. Add the 12 explicit annotations listed above.
2. Set `"isolatedDeclarations": true` in `tsconfig.json`, next to the existing
   `isolatedModules`.
3. `bun run verify`. No build change yet — tsup keeps generating dts exactly as
   today.

Why it pays for itself regardless of TS 7: explicit types at every module
boundary is what the extension contract already claims to be
(`src/core/contract.ts`), the annotations are checked rather than inferred, and
`.d.ts` output stops depending on inference across file boundaries. Also makes
Phase 2's diff readable — dts output should be unchanged, so any diff is a
migration bug.

**Exit criteria:** `bun run verify` green; `git diff --stat dist/` shows no
change in the emitted `.d.ts`/`.d.cts` beyond added annotations.

### Phase 2 — migrate the build to `tsdown`

Only after Phase 1. Port `tsup.config.ts` to `tsdown.config.ts`, keeping the
entry map and `dts.entry` explicit (never a wildcard — see AGENTS.md) and
enabling the isolated-declarations dts path.

The safety net already exists and is unusually good here; run all of it:

- `src/testing/__tests__/exports.test.ts` — resolves and imports through Node's
  own exports map, asserts the `"use client"` banner in **both** formats, that
  each entry emits its own `.d.ts`, that `@testing-library/react` is never a
  static import, and that the subpath imports without it installed.
- `bun run test:jest-consumer` — a real CommonJS/Jest consumer of `dist/`.
- `bun run playground:build` — a real Vite consumer via `file:../..`.
- Diff `dist/` against a Phase 1 build. It should be near-identical.

Watch specifically for: the `"use client"` banner surviving (the reason
`treeshake: false` exists — rollup hoisted imports above it), `.d.cts` emission
for the CJS half, the `styles.css` entry, and sourcemaps.

**Exit criteria:** all four above green, `dist/` diff explainable line by line.

### Phase 3 — flip to TypeScript 7

1. `typescript: ^7` in `package.json` **and** `examples/playground/package.json`.
2. Confirm `baseUrl` is still absent from both tsconfigs.
3. `bun run verify`, then the full Phase 2 net again.

**Exit criteria:** `bun run verify` green with `tsc --version` reporting 7.x.

## Triggers to revisit

- **A tsup release bumping its vendored `rollup-plugin-dts` to ≥6.5.1.** Check
  `grep -n "rollup-plugin-dts@" node_modules/tsup/dist/rollup.js` after any tsup
  bump. If it lands, Phase 3 becomes a one-line change and Phase 2 is optional —
  though Phase 1 is still worth having.
- **Dependabot proposing `typescript` 7.x.** It will; the pin is `^5.9.3`, so the
  major arrives as its own ungrouped PR (per `.github/dependabot.yml`). Close it
  with a link to this file until Phase 2 is done.
- **`@typescript/native-preview` reaching stable.** It is `7.0.0-dev.*` today and
  is what `rolldown-plugin-dts` prefers for the TS 7 path.

## Do not

- Do not alias `typescript` to `@typescript/typescript6` to satisfy the vendored
  plugin. It would make `tsc` itself TS 6, so `typecheck` would stop testing what
  ships.
- Do not bump `target`/`lib` past `ES2022` as part of this. That is a
  **consumer-facing browser** decision and has nothing to do with the Node
  floor or the compiler version.
- Do not add a dts wildcard to work around entry duplication. AGENTS.md is
  explicit: a missing entry means silently unpublishable or untyped.
