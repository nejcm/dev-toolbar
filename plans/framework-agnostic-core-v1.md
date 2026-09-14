---
description: Assesses porting the core to Vue/Svelte/vanilla — quantifies the React coupling (1,362 lines of chrome, three contract fields) and proposes an additive Phase 0 plus a v2 mount-function breaking change.
date: 2026-09-03
status: proposed
---

# A framework-agnostic core (Vue, Svelte, vanilla)

Written 2026-09-03, after the question "could v2 be plugged into Svelte or Vue
apps too?". Every number below was measured in this repo on `bb0103f`, not
estimated; the commands are included so it can be re-measured when the shape
changes.

Bundler-genericity is a separate, already-solved question — see
[Appendix A](#appendix-a--bundlers-are-already-generic). This document is only
about *framework*.

## Verdict

Doable, and cheaper than it looks, because the repo already made the two
decisions that usually kill this kind of port: the logic lives in framework-free
`runtime.ts` files, and extensions import only *types* from core. The React
coupling is concentrated in **1,362 lines of chrome** plus **2,425 lines of
extension UI** — and exactly **three fields** of the public contract.

The whole thing turns on one breaking change: slots become *mount functions*
rather than *things that return a `ReactNode`*. That is what makes it a v2.

There is also a Phase 0 that is **additive, ships under `CONTRACT_VERSION` 1,
and buys most of the optionality at a fraction of the cost**. If only one
sentence of this document survives, it should be that one.

## What is actually true

### The React surface in core

```sh
for f in src/core/*.ts src/core/*.tsx; do
  printf "%-32s react=%s lines=%s\n" "$f" "$(grep -c 'from "react' $f)" "$(wc -l < $f)"
done
```

| File | React | Lines | Verdict |
| --- | --- | --: | --- |
| `store.ts` | no | 189 | kernel |
| `css.ts` | no | 322 | kernel |
| `commands.ts` | no | 158 | kernel |
| `shortcut.ts` | no | 131 | kernel |
| `storage.ts` | no | 127 | kernel |
| `diagnostics.ts` | no | 111 | kernel |
| `styles.ts` | no | 32 | kernel |
| `contract.ts` | `import type { ReactNode }` | 203 | kernel, after the v2 slot change |
| `DevToolbar.tsx` | yes | 539 | port |
| `Overflow.tsx` | yes | 318 | port — the hard one |
| `PanelHost.tsx` | yes | 199 | port |
| `Bar.tsx` | yes | 119 | port |
| `ExtensionBoundary.tsx` | yes | 77 | port, with a caveat |
| `OverlayHost.tsx` | yes | 72 | port |
| `DevToolbarInset.tsx` | yes | 38 | port, or drop |
| `context.ts` | yes | 83 | React adapter only |

**1,070 lines of core are already framework-free. 1,362 lines are chrome to
port.** `context.ts` does not get ported; it becomes part of the React adapter.

The React API actually used is small and unexotic:

```sh
grep -rhoE "\b(useState|useEffect|useLayoutEffect|useRef|useMemo|useCallback|useSyncExternalStore|useId|createPortal|createContext|useContext|memo)\b" src/core | sort | uniq -c | sort -rn
# 20 useEffect  18 useRef  10 useState  6 useMemo  5 useCallback
#  4 createContext  3 useContext  3 memo  2 useSyncExternalStore
#  2 useLayoutEffect  2 useId  2 createPortal
```

No `Suspense`, no transitions, no `use()`, no server components. `createPortal`
is `appendChild`. `useId` is a counter. `useSyncExternalStore` is the store in
`src/core/store.ts:113`, which is already a plain `subscribe(listener) =>
unsubscribe` / `getSnapshot()` pair with no React in the file.

### The React surface in the extensions

```sh
wc -l src/ext/*/ui.tsx src/ext/*/runtime.ts
```

| Extension | `ui.tsx` (React) | `runtime.ts` (framework-free) |
| --- | --: | --: |
| `theme-editor` | 573 | 1,429 |
| `flags` | 560 | 658 |
| `overlays` | 321 | 758 |
| `command-menu` | 290 | 471 |
| `metrics` | 238 | 189 |
| `diagnostics` | 233 | 1,047 |
| `environment` | 210 | 548 |
| **Total** | **2,425** | **5,100** |

**Two thirds of the extension code is already portable and needs no work.** The
`index.tsx` / `runtime.ts` / `ui.tsx` convention in
[AGENTS.md](../AGENTS.md) is what makes this true, and it was not written with
this port in mind — it is a free win, and worth protecting deliberately from
here on.

The only shared React glue is `useExtensionSurface` in
`src/ext/shared/hooks.ts` — 3 lines of body, `useEffect` plus
`useSyncExternalStore`. Per framework that is a rewrite of a handful of lines,
not a module.

### The three fields that are the whole problem

`src/core/contract.ts:167-176`:

```ts
compact?: (props: CompactSlotProps) => ReactNode;
panel?:   (props: PanelSlotProps)   => ReactNode;
overlay?: (props: OverlaySlotProps) => ReactNode;
```

Everything else in `DevToolbarExtension` — `id`, `label`, `align`, `order`,
`priority`, `hidden`, `keepMounted`, `commands`, `diagnostics`, `start(api)` —
is already framework-free, as is all of `ExtensionRuntimeApi`
(`signal`, `isVisible`, `subscribeVisibility`, `storage`, `getCommands`,
`runCommand`, `getDiagnostics`). An extension that contributes only commands
and diagnostics is *already* framework-agnostic today.

## The change: slots mount, they do not return

```ts
export type SlotMount<P> = (el: HTMLElement, props: P) => SlotHandle | void;

export interface SlotHandle {
  /** Called when the host re-renders with new props; omit and core remounts. */
  update?(props: unknown): void;
  destroy?(): void;
}
```

Core owns an empty `HTMLElement` per slot and hands it over. What the extension
puts inside is its own business: `createRoot().render()`, `createApp().mount()`,
`mount(Component, { target })`, or `el.textContent = "…"`.

Why mount and not the alternatives:

- **Not a web component with shadow DOM.** The light-DOM promise in the README
  ("Tailwind and CSS-in-JS work inside extensions", restyleable without
  `!important`) is a real feature and shadow DOM takes it away. Custom elements
  *without* shadow DOM are an option for the host-facing tag, but they buy
  little over a `mount()` function and cost a registration namespace.
- **Not React core plus Vue/Svelte wrappers.** It works, and it drags React into
  a Vue app to render a debug bar. Non-starter.
- **Not "return an HTML string".** No event handlers, no lifecycle.

### What gets worse, honestly

`ExtensionBoundary` (`src/core/ExtensionBoundary.tsx:24`) is a React error
boundary — `getDerivedStateFromError` catches an extension's *render* error and
swaps in the error chip while the bar stays up. A vanilla core can only
`try`/`catch` around `mount`, `update` and `destroy`. An error thrown later,
inside the extension's own framework's render, becomes that framework's
problem.

This is a genuine capability regression for React extensions and must be
documented, not glossed. Mitigation: the React adapter keeps a real boundary
*inside* its own `mount` implementation, so React extensions in a React host
lose nothing; a Vue extension gets whatever `app.config.errorHandler` gives it.

## Phases

### Phase 0 — mount slots, additive, `CONTRACT_VERSION` stays 1

Add `mountCompact` / `mountPanel` / `mountOverlay` as optional fields alongside
the React three. Core prefers a mount field when present, and renders it through
a ~30-line `<MountSlot>` component (`ref` + `useEffect` + cleanup) inside the
existing hosts.

Result: a **vanilla, Vue or Svelte extension runs in today's React host**, with
no kernel extraction, no chrome port, no new packages, no contract bump. Third
party extensions gain a framework-free authoring path immediately.

- Touches: `contract.ts`, `PanelHost.tsx`, `Overflow.tsx`/`Bar.tsx`,
  `OverlayHost.tsx`, plus one new `MountSlot.tsx`.
- Tests: one fake extension in `src/testing/makeExtension.tsx` that mounts a
  plain `<div>`; mount/update/destroy ordering; a throwing `mount` still shows
  the error chip.
- Docs: a "framework-free extensions" section under **The extension contract**.
- **Estimate: ~1 day.** This is the highest-value item in the document.

### Phase 1 — extract the kernel (no behaviour change)

Move the 1,070 already-React-free lines behind an explicit non-React API:
`createToolbarKernel({ instanceId, storage, shortcut, container, … })` returning
`{ store, register, getCommands, runCommand, getDiagnostics, publishHeight,
bindShortcut, dispose }`. React core becomes a consumer of it.

The point is not code movement, it is *pinning the seam*: after this, the
boundary test can assert that the kernel imports nothing from React, so the port
cannot silently regress while the rest of the work happens.

- New: `src/kernel/`. `src/core/` keeps only the `.tsx`.
- `src/core/__tests__/boundary.test.ts` gains a rule: `src/kernel/**` must not
  import `react`.
- **Estimate: ~2 days**, mostly test relocation.

### Phase 2 — the vanilla chrome

Port the 1,362 lines. In difficulty order:

1. **`Overflow.tsx` (318)** — the only real engineering. It measures rendered
   items with a `ResizeObserver` (`Overflow.tsx:193-199`) and re-partitions the
   bar. Without reconciliation you own the diff of "which items are in the bar
   vs the `···` popup" by hand. Budget the most time here and keep the existing
   overflow tests as the contract — they are behavioural, not React-specific.
2. **`DevToolbar.tsx` (539)** — mostly wiring that the kernel now owns:
   portal → `container.appendChild`, height publishing already isolated at
   `DevToolbar.tsx:399-416`, `ResizeObserver` unchanged.
3. **`PanelHost.tsx` (199)**, **`Bar.tsx` (119)**, **`OverlayHost.tsx` (72)** —
   straightforward; `keepMounted` becomes "do not call `destroy`".
4. **`ExtensionBoundary.tsx` (77)** — `try`/`catch` plus the error chip, with
   the caveat above.
5. **`DevToolbarInset.tsx` (38)** — drop it. `--dev-toolbar-height` is already
   published and documented; a one-line CSS rule replaces the component in any
   framework.
6. **`useId`** → a module counter. **`memo`** → nothing.

Ships as `@nejcm/dev-toolbar/vanilla`: `mount(options) => { update, destroy }`.

- **Estimate: ~1.5–2 weeks.**

### Phase 3 — framework adapters

Each adapter is thin: own the lifecycle, expose idiomatic state, wrap components
into `SlotMount`.

- **React** — `DevToolbar`, `useDevToolbar`, `useToolbarCommands` keep their
  current signatures over kernel + vanilla. The v1 React slot fields stay
  supported through an internal bridge, so **existing extensions keep working**
  and v2 is not a rewrite for consumers.
- **Vue** — `shallowRef` + `store.subscribe`; a `<DevToolbar>` component with
  `provide`/`inject` in place of context.
- **Svelte** — nearly free: Svelte's store contract is `subscribe(cb(value)) =>
  unsubscribe`, and `src/core/store.ts:113` is `subscribe(listener: () => void)`
  with no immediate call. A ~5-line wrapper that fires `cb(getSnapshot())` on
  subscribe and on each notify satisfies it.

- **Estimate: ~2 days React (mostly re-pointing tests), ~3 days each for Vue and
  Svelte including their own playgrounds.**

### Phase 4 — first-party extension UIs

The 5,100 framework-free lines are reused verbatim. The decision is what to do
with the 2,425 lines of `ui.tsx`:

- **Option A — rewrite each `ui.tsx` once, in vanilla.** Every host gets every
  first-party extension. `metrics` (238), `environment` (210) and `diagnostics`
  (233) are lists and tables and are genuinely easy. `flags` (560) and
  `theme-editor` (573) are form-heavy — inputs, selects, per-row commit on Enter
  or blur, refusal states — and are the ones that hurt without a framework.
- **Option B — keep them React and ship Vue/Svelte hosts with no first-party
  extensions.** Cheap, and a Vue consumer gets a bar with nothing in it. Not a
  product.
- **Option C — A for the five easy ones, per-framework for `flags` and
  `theme-editor`.** Most likely the honest answer once someone has actually
  written the vanilla `flags` panel.

Start with `metrics` as the pathfinder: smallest `ui.tsx`, no forms, and it
proves the whole stack end to end.

- **Estimate: ~1 week for the five simple UIs; `flags` and `theme-editor`
  deserve their own estimate after the pathfinder.**

### Phase 5 — repo mechanics

Not optional, and easy to underestimate:

- **Packaging.** Today one package, ten subpaths, "a new subpath must be added
  explicitly to `exports` *and* to `entry` and `dts.entry`". Adapters for three
  frameworks with different peer deps want separate packages — `react` must not
  be a peer of a Vue consumer's install. That means a workspace, and
  `release-please-config.json` grows from one `"."` entry to one per package.
- **`src/core/__tests__/boundary.test.ts`** gains the kernel rule and loses
  assumptions about a single bundle.
- **`scripts/bundle-size.mjs`** currently reads one `package.json` `exports` map.
- **Playgrounds.** `examples/playground` is a Vite React app consuming `dist/`
  via `file:../..`. Vue and Svelte want the same treatment, and the
  `verify-dev-toolbar` skill wants to know about them.
- **`src/testing/`** is React-specific (`@testing-library/react`, optional
  peer). `makeExtension`, `createMockBus`, `installToolbarLayout` and
  `createMemoryStorage` are not — they split into a framework-free testing
  package with `renderWithToolbar` staying in the React one.

- **Estimate: ~1 week.**

## Contract v2, precisely

Removed:

```ts
compact?: (props: CompactSlotProps) => ReactNode;
panel?:   (props: PanelSlotProps)   => ReactNode;
overlay?: (props: OverlaySlotProps) => ReactNode;
```

Added:

```ts
compact?: SlotMount<CompactSlotProps>;
panel?:   SlotMount<PanelSlotProps>;
overlay?: SlotMount<OverlaySlotProps>;
```

`CONTRACT_VERSION` → `2`. `contract.ts` drops its `import type { ReactNode }`
and becomes framework-free, which is the tell that the job is done.

Migration for a third-party React extension is mechanical, and the React adapter
ships the helper:

```ts
import { fromComponent } from "@nejcm/dev-toolbar-react";
panel: fromComponent(MyPanel),   // was: panel: (props) => <MyPanel {...props} />
```

Per [ADR-003](../docs/adr/ADR-003-contract-version-policy.md) this is the first
non-additive change to the contract, so it wants its own ADR recording why the
`ReactNode` slot was the thing that had to go.

## Cost, in one table

| Phase | Scope | Measured size | Estimate | Risk |
| --- | --- | --- | --- | --- |
| 0 | mount slots, additive | ~30 new lines + 4 touched files | 1 day | very low |
| 1 | kernel extraction | 1,070 lines moved | 2 days | low |
| 2 | vanilla chrome | 1,362 lines ported | 1.5–2 weeks | **high — `Overflow`** |
| 3 | react / vue / svelte adapters | new | ~1.5 weeks | medium |
| 4 | five simple ext UIs | ~1,200 lines rewritten | 1 week | medium |
| 4b | `flags` + `theme-editor` UIs | 1,133 lines rewritten | re-estimate after 4 | **high** |
| 5 | workspace, release, sizes, playgrounds, testing split | — | 1 week | medium |

Roughly **6–7 weeks** for the whole thing, of which Phase 0 is one day and
delivers the "third-party extensions can be framework-free" half of the value.

## Decisions needed before Phase 2

1. **Is there a real Vue or Svelte consumer?** Everything from Phase 2 on is
   speculative without one. Phase 0 and 1 are worth doing regardless — 0 for
   the authoring path, 1 because pinning the kernel seam is good architecture
   whether or not the port ever happens.
2. **Custom element or `mount()` as the host-facing API?** A
   `<dev-toolbar>` element is attractive for non-bundled hosts (a Rails or
   Django page with a script tag) and would widen the audience beyond
   frameworks. It is a separable decision, layerable on top of Phase 2.
3. **Does the error-isolation regression need a mitigation beyond the React
   adapter's own boundary?** An extension crashing the bar for a Vue consumer is
   the kind of thing this package exists not to do.
4. **Option A, B or C for Phase 4.**

## What would make this not worth doing

If no non-React consumer materialises, Phases 2–4 are ~5 weeks spent to support
a hypothesis, and the chrome port trades React's reconciliation for hand-written
DOM diffing in `Overflow` — the one place the React version is doing real work.
Phase 0 exists precisely so that outcome is cheap: a framework-free extension
API costs one day and forecloses nothing.

## Appendix A — bundlers are already generic

Measured, same commit:

```sh
grep -rn "import\.meta" src --include='*.ts' --include='*.tsx'   # nothing
grep -rn "process\.env" src                                       # 2 test files + 1 doc comment
```

No Vite-isms in shipped code. Dual ESM/CJS, `target: es2022`, explicit subpath
`exports`, `sideEffects: ["*.css"]`, runtime style injection so no CSS-import
pipeline is required, and `test/fixtures/jest-consumer` is a real
webpack-era CommonJS consumer. webpack, rspack, Parcel, esbuild, Next, Remix and
Astro islands need nothing new.

Two known constraints, both deliberate:

- **`node10` resolution is unsupported** (`check:package --profile node16`), so
  a host on `moduleResolution: "node"` sees no subpath types. Documentation, not
  code.
- **Every host writes its own production gate.** `enabled` defaults to `true`
  and the library has no portable dev-detection. The lazy-import recipe at
  README "Keeping it out of production" uses `process.env.NODE_ENV`, which is
  wrong for a Vite host — that section should show both spellings.

## Re-measuring

```sh
# React coupling in core
for f in src/core/*.ts src/core/*.tsx; do
  printf "%-32s react=%s lines=%s\n" "$f" "$(grep -c 'from "react' $f)" "$(wc -l < $f)"
done
# portable vs React extension code
wc -l src/ext/*/ui.tsx src/ext/*/runtime.ts
# the React-shaped contract fields
grep -n "ReactNode" src/core/contract.ts
```
