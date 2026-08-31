# @nejcm/dev-toolbar — shell-only architecture

## Context

`plans/dev-bar.md` currently specs one monolithic component: the shell owns metric
severity colors, tooltips, the drawer, a command menu, persisted prefs and overflow
(§3A), while §5–§7 bake in collectors, an event bus and feature-flag promotion. The
module registry in §4 is bolted onto a shell that already contains everything.

The redesign inverts that. `@nejcm/dev-toolbar` becomes **a bottom-bar shell and
nothing else** — chrome plus hosting. Every feature in §3 (environment, flags,
performance HUD, overlays, theme editor, diagnostics) becomes an extension passed in
by the consumer. The bar must also be restyleable without forking it.

Outcome: a core anyone can adopt in one line and extend without touching this repo,
with the §3 catalogue shipped as first-party extensions on separate subpath exports.

## Decisions

| Area | Decision |
| --- | --- |
| Distribution | One published package, many subpath exports. No monorepo. |
| Extension entry | `<DevToolbar extensions={[...]}>` as source of truth + `useDevToolbar()` for dynamic registration. **No global registry** (kills SSR, multi-root, test isolation). |
| Wrapping | Reads like wrapping, isn't: `children` render in a fragment untouched, bar portals to `document.body`, `--dev-toolbar-height` published, opt-in `<DevToolbarInset>`. |
| Style isolation | Light DOM, all shell CSS in `@layer`, scoped by `[data-dev-toolbar]`. **Reverses §3A's Shadow DOM call** — extensions are user code and Tailwind/CSS-in-JS/portals break inside a shadow root. |
| Core boundary | Chrome + hosting only. Event bus / ring buffers / throttled store move to an opt-in `/runtime` subpath core never imports. |
| Contract | Declarative object; `compact`/`panel` are render functions receiving slot props. `availability(ctx)` dropped — core has no `ctx`; consumer computes `hidden`. |
| Prod stripping | No build magic. `enabled` prop + documented `NODE_ENV`/lazy-import recipe. §6's prod-internal use stays viable. |
| Style API | `--dtb-*` tokens (primary), stable `data-dtb-part` attributes on every part, narrow `classNames` map. One built-in light/dark token set. |
| Failure | Per-extension error boundary on `compact` and `panel`; broken item degrades to an error chip. |
| Lifecycle | `start(api)` once on mount with `AbortSignal` + subscribable visibility. Core **reports** visibility, never auto-pauses (would corrupt cumulative metrics). |
| Panels | Core owns single-active-panel state; compact click toggles own panel; `openPanel`/`closePanel` on context; unmount on close unless `keepMounted`. Height resizable + persisted. |
| Persistence | Injectable sync `storage` adapter, `localStorage` default, keys `dtb:v1:<instanceId>:*`, `storage={null}` disables. |
| Command menu | Core **aggregates** `commands` and exposes `useToolbarCommands()`/`runCommand(id)`. Palette UI ships as `/ext/command-menu`. |
| SSR | `"use client"` banner on built entries; children server-render untouched; bar mounts client-only (no hydration mismatch — it isn't in server HTML). |
| CSS delivery | Runtime inject-once per entry, idempotent; `injectStyles={false}` escape hatch; `styles.css` still shipped. |
| Deps | Zero runtime deps by rule; optional `peerDependencies` as documented escape hatch; explicit `exports` subpaths (no wildcard); `CONTRACT_VERSION` core warns on. |
| Access control | None in core — §6 becomes guidance. `redact()` helper lives in `/runtime`. |
| Bar layout | `align: 'start' \| 'end'`, `order`, `priority`; `ResizeObserver`-driven collapse of lowest-priority items into a `···` menu. `position: 'bottom' \| 'top'`, persisted. |
| Testing | Publish `/testing` (`renderWithToolbar()`, fake-extension factory, mock bus with controllable time) + unpublished `examples/playground` Vite app linked `file:..`. |
| Publish | `0.1.0` after P0+P1, not after P0 alone. |

Assumed unless corrected: toggle shortcut `Ctrl/Cmd + Shift + .` with `shortcut` prop
and `shortcut={null}` to disable; React 18+ peer, `useSyncExternalStore` used directly.

## Contract

```ts
export const CONTRACT_VERSION = 1;

export interface DevToolbarExtension {
  id: string;
  label: string;
  contractVersion?: number;      // core warns on mismatch
  align?: "start" | "end";       // default "start"
  order?: number;
  priority?: number;             // overflow collapse order, low collapses first
  hidden?: boolean;              // consumer-computed; replaces availability(ctx)
  keepMounted?: boolean;         // panel survives close
  compact?: (props: CompactSlotProps) => React.ReactNode;
  panel?: (props: PanelSlotProps) => React.ReactNode;
  commands?: ToolbarCommand[];
  start?(api: ExtensionRuntimeApi): void | (() => void);
}

export interface CompactSlotProps {
  isOverflowed: boolean;
  isPanelOpen: boolean;
  density: "compact" | "comfortable";
  openPanel(): void;
  closePanel(): void;
}

export interface ExtensionRuntimeApi {
  signal: AbortSignal;
  isVisible(): boolean;
  subscribeVisibility(cb: (visible: boolean) => void): () => void;
  storage: ToolbarStorage;        // namespaced to this extension id
}
```

## Source layout

```text
src/
├── index.ts                 # DevToolbar, DevToolbarInset, useDevToolbar, types
├── core/
│   ├── DevToolbar.tsx       # portal, provider, shortcut, enabled, injectStyles
│   ├── Bar.tsx              # align regions, order/priority sort
│   ├── Overflow.tsx         # ResizeObserver measurement + ··· menu
│   ├── PanelHost.tsx        # single active panel, resize, keepMounted
│   ├── ExtensionBoundary.tsx
│   ├── store.ts             # useSyncExternalStore, no bus
│   ├── storage.ts           # adapter + localStorage default
│   ├── styles.ts            # inject-once, @layer, token defaults
│   └── contract.ts          # types + CONTRACT_VERSION
├── runtime/                 # opt-in: event-bus, ring-buffer, throttle, redact
├── ext/
│   ├── metrics/             # P1 — the contract's pressure test
│   ├── command-menu/  environment/  flags/      # P2
│   ├── overlays/  diagnostics/                  # P3
│   └── theme-editor/                            # P4
└── testing/                 # renderWithToolbar, makeExtension, mock bus
```

`exports` map gains `.`, `./runtime`, `./testing`, `./styles.css`, and one entry per
`./ext/*` — enumerated explicitly, not wildcarded. `tsup` entry list mirrors it;
`banner: { js: '"use client"' }`; `sideEffects: false` stays (style injection happens
inside components, not at module scope).

## Files to change

- [package.json](package.json) — multi-entry `exports`, `files`, keep zero deps
- [tsup.config.ts](tsup.config.ts) — entry array, `"use client"` banner, css output
- [src/index.ts](src/index.ts) — replace `VERSION` placeholder with the real surface
- [plans/dev-bar.md](plans/dev-bar.md) — targeted rewrites only: §3A shell
  responsibilities → chrome+hosting; §4 contract → the object above; §7 drawer
  ownership and promoted-flag home (`/ext/flags`); §8 phases → P0–P4 below; delete
  the Shadow DOM recommendation with a note on why. §3B–J, §5 and §6 stay, reframed
  as *extension* specs.
- **new** `plans/architecture.md` — shell contract, boundary rationale, style tokens,
  extension-authoring guide
- **new** `examples/playground/` — Vite React app, `file:..` dep, gitignored build

## Delivery

- **P0 — shell**: portal + provider + `enabled`, align/order/priority + overflow
  collapse, panel host, tokens + injection + `classNames`/`data-dtb-part`, storage
  adapter, error boundaries, toggle shortcut, `/testing`, playground.
- **P1 — runtime + first extension**: `/runtime` (bus, ring buffers, throttled store,
  `redact`) and `/ext/metrics` (memory, delay, jank, net per §3D). Expect the contract
  to move here — that's the point. **Publish `0.1.0` at the end of P1.**
- **P2**: `/ext/environment`, `/ext/flags` (incl. promoted flag), `/ext/command-menu`.
- **P3**: `/ext/overlays`, `/ext/diagnostics`.
- **P4**: `/ext/theme-editor`.

## Verification

1. `npm run typecheck && npm run build` — confirm `dist` emits every declared subpath
   with `.d.ts` and a `"use client"` banner, and that core's chunk imports nothing
   from `runtime/` or `ext/`.
2. `npm test` — unit: order/align sorting, overflow collapse under a mocked
   `ResizeObserver`, single-panel invariant, `keepMounted`, storage adapter round-trip
   with `storage={null}`, error boundary containment (throwing extension leaves the
   bar rendered), `CONTRACT_VERSION` mismatch warning.
3. Playground (`cd examples/playground && npm run dev`): bar renders bottom-fixed over
   an app with its own `100vh` layout without disturbing it; `--dev-toolbar-height`
   reads correctly; narrow the window and confirm low-priority items collapse into
   `···`; toggle shortcut; reload and confirm visibility, position, active panel and
   panel height persist; a deliberately throwing extension shows an error chip only.
4. Restyle check: override three `--dtb-*` tokens and one `classNames` slot from the
   playground's own CSS and confirm it wins without `!important`; verify an
   extension using Tailwind classes renders correctly (the Shadow DOM regression test).
5. SSR check: mount in a Next app-router page, confirm no hydration warning and that
   server HTML contains the app but not the bar.
