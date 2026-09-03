# Architecture — the `@nejcm/dev-toolbar` shell

This is the reference for the shipped core: what the shell guarantees, where its
boundaries are and why they sit there, the full styling surface, and how to write an
extension against it. The README documents the package for consumers; this document
is the *why*, and is the thing to read before changing the contract.

- Contract version: **1** (`CONTRACT_VERSION`, in `src/core/contract.ts`)
- Entries: `@nejcm/dev-toolbar` (root), `/runtime`, `/ext/metrics`,
  `/ext/environment`, `/ext/flags`, `/ext/command-menu`, `/ext/overlays`,
  `/ext/diagnostics`, `/ext/theme-editor`, `/testing`, `/styles.css`
- Runtime dependencies: **none**

`src/core/contract.ts` is the source of truth for the types. Where this document and
that file disagree, the file is right and this document is a bug.

> **A note on `plans/`.** The product design (`dev-bar.md`), the accepted delivery
> plan (`implementation.md`) and the per-phase working notes (`architecture.md`) are
> local scratch, not tracked in git. Doc comments in `src/` still cite them by section
> — `per plans/dev-bar.md §3D` — as provenance for *why a feature has the shape it
> has*. Those citations are historical markers, not links; everything that survived as
> a rule is here, in the README, or in `CONTRIBUTING.md`.

## 1. What the shell is

The root entry is chrome plus hosting, and nothing else. It:

- renders a fixed bar at the top or bottom of the viewport, in a portal on
  `document.body`;
- sorts the extensions it is given by `align`, then `order`;
- collapses the lowest-`priority` items into a `···` menu when the bar runs out of
  width, and lets them back out when the width returns;
- hosts at most one panel at a time, resizable and persisted;
- renders every extension's `overlay` slot, uncollapsed, for modal surfaces;
- publishes `--dev-toolbar-height`, and `--dev-toolbar-height-<instanceId>` per
  instance, and ships an opt-in `<DevToolbarInset>`;
- owns the token set, the `data-dtb-part` attributes and the `classNames` map;
- persists visibility, position, active panel and panel height through an injectable
  storage adapter;
- wraps every extension slot in its own error boundary;
- runs `start(api)` once per extension and *reports* visibility to it;
- aggregates extension-declared commands and diagnostics, and exposes them — it
  renders neither a palette nor a snapshot.

It does **not** know what a metric is, what a flag is, what "healthy" means, who the
user is, or what may be shown to them. Every one of those is an extension's job.

Everything the root entry exports is public and versioned, escape hatches included —
`CORE_CSS`, `ensureStyles`, the storage adapter factories, `STORAGE_PREFIX`,
`DEFAULT_SHORTCUT` and the panel-height bounds. The list, one line each, is
[README § Other exports](../README.md#other-exports). The aggregation functions
themselves are not exported: `collectCommands` and `collectDiagnostics` only ever
see the array they are handed, while `api.getCommands()` / `api.getDiagnostics()` and
`useToolbarCommands()` see the merged list the toolbar actually renders.

## 2. Boundary rationale

### Light DOM, not Shadow DOM

The obvious way to keep a dev toolbar from colliding with its host app is a shadow
root. We deliberately do not do that.

Extensions are **user code**. Inside a shadow root:

- Tailwind, and every other utility framework, stops working — its rules live in
  `document.head` and do not cross the boundary;
- most CSS-in-JS runtimes inject into `document.head` too, so styled components render
  unstyled;
- an extension's own `createPortal` targets (`document.body`) escape the shadow root
  and lose the styles it expected;
- design-system components that measure themselves, or rely on `:root` variables,
  behave differently than they do anywhere else in the app.

Isolation that only the shell's own styles enjoy is not worth taxing every extension
author. So the shell renders in the light DOM and buys its isolation a different way:

```css
@layer dev-toolbar {
  [data-dev-toolbar] { … }
}
```

Two properties fall out of that, and they are the whole style contract:

1. **Scoping.** Every core rule is prefixed with `[data-dev-toolbar]`, so core never
   touches app markup.
2. **Losing on purpose.** Every core rule is inside a cascade layer, and unlayered
   author CSS beats *any* layered rule regardless of specificity. A consumer's
   one-class selector overrides core's two-attribute selector without `!important`.

The playground exercises this both ways: a Tailwind-classed extension renders
correctly (the regression test), and the playground's own stylesheet restyles the bar
with no `!important` anywhere.

Recorded as [ADR-002](./adr/ADR-002-light-dom.md).

### No global registry

Extensions arrive as a prop (`extensions={[…]}`), plus `useDevToolbar().register()`
for anything scoped to a mounted subtree. There is no module-level registry, because
one would:

- break SSR — module state is shared across requests on a warm server;
- break two toolbars on one page — a second root would see the first one's items;
- leak between tests — registration would outlive the test that did it;
- make ordering depend on import order, which nobody controls.

Two toolbars on one page therefore have to share the one thing core does write
globally: the height custom property on `<html>`. Each instance owns
`--dev-toolbar-height-<instanceId>` (the id folded to `A-Za-z0-9_-`) and removes only
that on unmount; the unsuffixed `--dev-toolbar-height` is the `"default"` instance's,
which is what a consumer who never set `instanceId` already reads. `<DevToolbarInset>`
pads by its own instance's name and falls back to the unsuffixed one. Two instances
sharing an `instanceId` still collide — the same reason they may not share one for
persisted preferences (§3).

The one module-level structure in core is the command *host* set in
`src/core/commands.ts`. It is not a registry: entries are added on mount and removed
on unmount, and it exists only so the context-free `runCommand(id)` can reach a
mounted toolbar. Inside React, prefer `useDevToolbar().runCommand`.

Recorded, with the contract shape it follows from, as
[ADR-001](./adr/ADR-001-extensions-are-plain-objects.md).

### Core never imports `runtime/` or `ext/`

An event bus, ring buffers and a throttled store are what a *collector* needs, not
what chrome needs. Putting them in core would mean every consumer downloads the
machinery for measurement even when their toolbar is three buttons. They ship as an
opt-in `./runtime` subpath, which core never imports.

The same applies in reverse to `./testing`: it reaches nothing but core, so it stays
usable without `/runtime`. It reaches core through the package's own specifier
(`@nejcm/dev-toolbar`, marked `external` in `tsup.config.ts`) rather than a relative
path, for the reason in §7 — CJS output has no code splitting, so a relative *value*
import is inlined, and a CommonJS consumer mixing `.` with `./testing` would get two
cores, two React contexts and a `useDevToolbar()` that throws inside
`renderWithToolbar()`. Types erase and carry no instance identity, so those stay
relative. `src/core/__tests__/boundary.test.ts` asserts the import shape and the built
bytes; `test/fixtures/jest-consumer/shared-instance.test.js` asserts the consequence in
a real CommonJS consumer.

This rule is why core cannot redact anything it aggregates — see §10.

### `enabled`, not build magic

There is no bundler plugin and no `__DEV__` global. `enabled={false}` renders
`children` and nothing else: no portal, no lifecycle, no listeners, and any running
extension is torn down. For byte-level stripping, the consumer does it with tools they
already have — see the recipe in the README.

### Visibility is reported, never acted on

`start(api)` gets `isVisible()` and `subscribeVisibility()`. Core never pauses an
extension on its behalf. A cumulative counter that silently stops counting when the
bar is closed is worse than one that keeps going, and only the extension knows which
of its work is cumulative. `subscribeVisibility()`'s subscription is released
automatically when `api.signal` aborts, so an extension that keeps only the signal for
cleanup does not leak one per remount.

`isVisible()` is about **the bar**, not the document. Whether the tab is backgrounded
is `document.visibilityState`, it is not core's to report, and it is a different
question with different consequences — `/ext/metrics` reads both, and only the second
one makes it throw frames away.

### `hidden` is not visibility

`hidden` is the consumer saying *this extension does not exist for this actor*. Core
therefore treats it as absent everywhere, not merely unpainted.

Concretely, a hidden extension:

| | Enforced in |
| --- | --- |
| does not render in the bar or the `···` menu | `Bar.tsx` / `sortExtensions` |
| is never `start()`ed, and is torn down if it becomes hidden while running | `DevToolbar.tsx` |
| has no panel mounted, `keepMounted` included | `PanelHost.tsx` |
| has its `activePanelId` cleared on the transition | `DevToolbar.tsx` |
| contributes no commands and no diagnostics to the aggregations | `commands.ts` / `diagnostics.ts` |

Getting only the first two right is worse than getting none, because it *looks*
enforced. A hidden collector that still ran would keep `fetch` patched, keep retaining
request URLs and keep a `requestAnimationFrame` loop alive for somebody not permitted
to see any of it. A panel left mounted keeps the request table on screen. A command
left in the aggregate means `runCommand("metrics.copy")` still puts that table on the
clipboard — a front-door bypass of the whole thing.

The `activePanelId` clear is narrow on purpose: only a *present and hidden* extension
closes its panel. An id that is merely absent is left alone, which is what lets a
persisted `activePanelId` survive until the extension that owns it registers.

That distinction is also the answer for a consumer still waiting on the permissions
that decide `hidden`: **leave the extension out of the array while you do not know,
rather than passing `hidden: true`.** Absent preserves the persisted panel; a transient
`hidden: true` closes it, because as far as core can tell you have just said this actor
may not see it.

## 3. State, storage and lifecycle

State lives in a small store read through `useSyncExternalStore`. Four keys persist:

| Key | Value |
| --- | --- |
| `dtb:v1:<instanceId>:visible` | `boolean` |
| `dtb:v1:<instanceId>:position` | `"bottom" \| "top"` |
| `dtb:v1:<instanceId>:activePanel` | `string \| null` |
| `dtb:v1:<instanceId>:panelHeight` | `number`, clamped to 160–800 |

Each extension's `start(api)` gets `api.storage`, scoped to
`dtb:v1:<instanceId>:ext:<extensionId>:`.

`:` is the delimiter and is not escaped: `instanceId` and extension `id`s are
joined into the key as-is, so one containing `:` can alias another instance's
or extension's scope (`instanceId: "a:ext:b"` reads and writes the same keys
as `instanceId: "a"` with extension id `"b"`). ADR-001 already treats `id`
collisions as the consumer's responsibility; the same applies here. Keep both
ids to `[A-Za-z0-9_-]` — the set `instanceHeightVariable` (`DevToolbar.tsx`)
already folds non-conforming `instanceId`s down to.

The adapter is a synchronous three-method interface (`getItem`/`setItem`/`removeItem`),
which is exactly `localStorage`'s shape — that is why `localStorage` is the default.
`storage={null}` disables persistence. A throwing adapter degrades to defaults rather
than taking down the render.

`storage` and `instanceId` are **read once, on mount**. The store, the context's
`storage` and every extension's namespaced view all derive from that single captured
adapter, so they can never disagree about where preferences live. To move an instance
to a different namespace, remount it (`key={instanceId}`).

Lifecycle order for one extension:

1. It appears in the merged extension list (props first, then dynamic registrations,
   de-duplicated by `id`) and is not `hidden`.
2. `start(api)` runs once. Its return value, if a function, is the cleanup.
3. It renders `compact` (in the bar or in the `···` menu), `overlay` (always, while
   the bar is visible) and, when its panel is active, `panel`.
4. When it leaves the list, becomes `hidden`, `enabled` flips to `false`, or the
   toolbar unmounts: `api.signal` aborts, then the cleanup runs.

### Where `start()` sits relative to the first render

On the initial mount, `start()` runs **before** the first `compact`. The bar is gated
on a client-mount flag flipped in an effect, so the first commit renders no slots at
all and the lifecycle effects win the race.

That is a consequence of the mount gate, not a guarantee of the contract, and it does
not hold when an extension appears later — `enabled` flipping from `false` to `true`,
or `hidden` from `true` to `false`, renders the slot in the same commit whose effects
will call `start()`. So the rule for extension authors is unchanged and unconditional:
**anything a slot reads must exist by the time the factory returns.** Both orderings
are pinned by tests in `src/core/__tests__/lifecycle.test.tsx`.

### Extension objects must be referentially stable

`id` identifies an extension, but the *object* owns its lifecycle: `start()` was
called on one particular object, and whatever it created lives in that object's
closure. Rebuild the object and the bar renders a second one that owns nothing, while
the first keeps running unreachable.

Core cannot fix this — the identity is the consumer's — so it detects it. When an
already-started id turns up with a different `start` function reference, core warns
once for that id. The discriminator is deliberate: `{...ext, hidden: true}` keeps the
same `start` reference and stays quiet, while `extensions={[metrics()]}` written inline
gets a new closure every render and does not.

The first thing this caught was not a render loop at all. It was a Vite hot-module
reload of the playground's `extensions.tsx`, which re-evaluated the module, built a
second extension, and left the chips frozen while the first one carried on collecting.
The warning says so, and says to reload the page.

### Render-phase ref writes

Three sites write to a ref during render instead of in an effect, each carrying an
`oxlint-disable` (or `-next-line`) comment for `react/refs`. An effect always runs a
render behind the render that scheduled it; each of these three needs the value
current in the same commit that reads it, so an effect would be one render late. Two
of the three are pinned under `<StrictMode>` in `src/core/__tests__/strict-mode.test.tsx`,
which double-invokes render (not commit) and is exactly the thing that would expose a
stale or duplicated write.

The general hazard a render-phase write invites: React may render without
committing (a discarded speculative render, or `<StrictMode>`'s double-invoke in
development), so a write that only makes sense for a committed render can record
state for a render that never happened. Each site below is safe for a different
reason, stated as the invariant that has to keep holding for it to stay safe.

| Site | Records | Invariant that makes it safe |
| --- | --- | --- |
| `DevToolbar.tsx`, `extensionsRef` (`extensionsRef.current = extensions`) | The merged extension list, for `getCommands()`/`getDiagnostics()` to re-enumerate imperatively. | The write is a pure, unconditional overwrite of the previous value with a value derived only from this render's props/state. A discarded render's write is simply replaced by the next render's write before anything imperative reads the ref — nothing observes the intermediate value. |
| `Overflow.tsx`, `listRef` (`listRef.current = all`) | The current `[...startItems, ...endItems]`, so `recompute` (called from a `ResizeObserver` effect) reads the live list without depending on it and re-subscribing every render. | Same shape as `extensionsRef`: an unconditional overwrite of a value that is a pure function of this render's props. `recompute` only runs from the `ResizeObserver` callback and the layout effect below it, both of which fire after commit, so they only ever see the value from a render that committed. |
| `PanelHost.tsx`, `openedRef` (`opened.add(id)` / `opened.delete(id)`) | Which panel ids have ever been opened, so a closed `keepMounted` panel stays mounted. | Different shape from the other two: this mutates a persistent `Set` in place rather than overwriting the ref, so a discarded render's mutation is not automatically superseded by the next render the way a plain overwrite is. What keeps it safe is that `activePanelId` reaches this component only through `useSyncExternalStore` (`DevToolbar.tsx`, read ~line 151, passed down ~line 493), which opts store-derived props out of concurrent/deferred rendering, and core uses neither `startTransition` nor `useDeferredValue` — see below for what a hypothetical abandoned render would cost anyway. |

Pinning tests: `"keeps getCommands() current despite the doubled render-time ref
write"` (`extensionsRef`), `"keeps the render-time openedRef bookkeeping in
PanelHost correct"` (`openedRef`), both in `strict-mode.test.tsx`. `Overflow.tsx`'s
`listRef` has no dedicated StrictMode test; the overflow suite
(`src/core/__tests__/overflow.test.tsx`) exercises `recompute` reading through it but
not under `<StrictMode>`.

No render path in this codebase can actually produce an `openedRef` mutation ahead of
the committed render: `useSyncExternalStore` forces `activePanelId` to stay
synchronous with the store, and nothing under `src/core` calls `startTransition` or
`useDeferredValue` to defer it. Even in the hypothetical where a consumer's own
concurrent-mode usage produced an abandoned render anyway, the blast radius is small —
one `keepMounted` panel mounting a render early with `hidden={!isActive}`, which
self-corrects the next time that panel closes.

## 4. Style API

Three surfaces, in the order you should reach for them.

### 4.1 `--dtb-*` tokens

Set them on `[data-dev-toolbar]`, or on any ancestor. Unlayered CSS wins.

| Token | Default (light) | Purpose |
| --- | --- | --- |
| `--dtb-font-family` | system sans stack | Bar and panel text |
| `--dtb-font-mono` | system mono stack | Numeric values, error chips |
| `--dtb-font-size` | `11px` | Base size (`12px` when comfortable) |
| `--dtb-bar-height` | `30px` | Bar row height (`36px` when comfortable) |
| `--dtb-radius` | `4px` | Corner radius on triggers, menu, chips |
| `--dtb-gap` | `2px` | Gap between items; read back for collapse math |
| `--dtb-padding-x` | `6px` | Bar's horizontal padding |
| `--dtb-item-padding-x` | `6px` | Trigger padding (`8px` when comfortable) |
| `--dtb-z-index` | `2147483000` | Toolbar root stacking |
| `--dtb-bg` | `#f6f6f7` | Bar background |
| `--dtb-fg` | `#202124` | Foreground |
| `--dtb-muted` | `#6b6f76` | Secondary text |
| `--dtb-border` | `rgba(0,0,0,.12)` | Bar, panel and menu borders |
| `--dtb-accent` | `#5e6ad2` | Focus ring, resizer highlight |
| `--dtb-item-bg` | `transparent` | Trigger background |
| `--dtb-item-hover-bg` | `rgba(0,0,0,.06)` | Trigger hover |
| `--dtb-item-active-bg` | `rgba(94,106,210,.14)` | Trigger with its panel open |
| `--dtb-panel-bg` | `#ffffff` | Panel background |
| `--dtb-menu-bg` | `#ffffff` | `···` menu background |
| `--dtb-shadow` | `0 6px 24px rgba(0,0,0,.14)` | `···` menu shadow |
| `--dtb-danger` | `#c0392b` | Error chip text; "bad" severity |
| `--dtb-danger-bg` | `rgba(192,57,43,.12)` | Error chip background |
| `--dtb-ok` | `#1e8a54` | "ok" severity |
| `--dtb-ok-bg` | `rgba(30,138,84,.12)` | — |
| `--dtb-warn` | `#a8730c` | "warn" severity |
| `--dtb-warn-bg` | `rgba(168,115,12,.14)` | — |
| `--dtb-panel-height` | set per panel | Written by the panel host; read, do not set |

Dark values are applied for `[data-dtb-color-scheme="dark"]` and, under
`prefers-color-scheme: dark`, for anything not explicitly `"light"`.

Every rule — core's and the first-party extensions' alike — uses logical properties
(`inset-inline`, `inset-inline-end`, `margin-inline-start`, `padding-inline-start`,
`text-align: start`, and flexbox's own direction-aware `flex-end`) instead of
`left`/`right`, so the bar, the `···` popup and every extension's chips and panels
mirror correctly under `dir="rtl"` even though RTL is not otherwise tested. A
regression table test (`src/ext/__tests__/stylesheets.test.ts`) asserts every
exported CSS string contains no physical directional property; every extension
stylesheet except the overlays host-outline sheet, which is deliberately
unlayered, is wrapped in `@layer dev-toolbar` and scopes every rule under
`[data-dev-toolbar]`; core's
byte-identity check lives separately in `src/core/__tests__/css.test.ts`. Two
deliberate kinds of exception are whitelisted precisely where they occur:

- **Horizontal centring stays physical.** `/ext/command-menu`'s dialog and
  `/ext/overlays`' grid overlay and notice centre themselves with `left: 50%` plus
  `transform: translateX(-50%)`, which is already symmetric under `dir="rtl"` and
  needs no mirroring. `inset-inline-start: 50%` is *not* an equivalent: under
  `dir="rtl"` it resolves to the right edge landing at the midpoint, while
  `translateX(-50%)` — evaluated against the element's own physical box, not the
  logical one — still shifts left by half the width, so the element ends up a full
  width off-centre. `left`/`right` are correct here on purpose.
- **JS-measured geometry stays physical.** `/ext/overlays`' drawing surface also
  positions boxes and labels from `getBoundingClientRect()` — a physical,
  viewport-relative measurement — via inline `left`/`top` styles in `ui.tsx`, which
  stay physical because the coordinates they mirror are.

### 4.2 `data-dtb-part`

Every part carries a stable attribute. These are the supported selector hooks; class
names inside core are not.

| Part | Element | Notes |
| --- | --- | --- |
| `root` | portal root | Also `data-dev-toolbar`, `data-dtb-instance`, `data-dtb-position`, `data-dtb-density`, `data-dtb-color-scheme` |
| `bar` | the bar row | `role="toolbar"` |
| `region` | one align region | `data-dtb-align="start" \| "end"` |
| `item` | one extension's compact slot | `data-dtb-ext-id`, `data-dtb-align`, `data-dtb-overflowed`, `data-dtb-panel-open` |
| `trigger` | core's default button/label | Only when the extension supplies no `compact` |
| `overflow-button` | the `···` button | `aria-expanded`, `aria-controls` while open |
| `overflow-menu` | the `···` popover | `role="group"`, labelled, `tabindex="-1"` |
| `overflow-menu-item` | one collapsed item wrapper | `data-dtb-ext-id` |
| `overlay` | one extension's overlay slot | `data-dtb-ext-id` |
| `panel` | one panel | `data-dtb-ext-id`, `data-dtb-active`, `hidden` when inactive |
| `panel-resizer` | drag/keyboard handle | `role="separator"`, arrow keys resize |
| `panel-body` | scroll container | |
| `error-chip` | a crashed slot | `data-dtb-ext-id`, `data-dtb-slot="compact" \| "panel"` |
| `error-retry` | the chip's retry button | Absent in the `overlay` slot |
| `inset` | `<DevToolbarInset>` | `data-dtb-position` |

Core owns the unprefixed names; an extension that ships CSS **namespaces its parts by
kind** — a prefix fixed by the extension package, not by the `id` an individual
instance happens to carry — which is why `/ext/metrics` renders
`data-dtb-part="metrics-chip"` and not `data-dtb-part="chip"`. Without a prefix the
attribute stops being a stable hook the moment two extensions pick the same word.

By kind, not by id, on purpose: `metrics({ id: "metrics-api" })` and
`metrics({ id: "metrics-worker" })` are two instances of one thing, and a consumer
styling metrics chips wants one rule for both. The instance is already addressable —
`[data-dtb-ext-id="metrics-worker"]` sits on the surrounding item — so nothing is lost,
and `data-dtb-metric` narrows further to a single chip.

Core's `injectStyles` prop is a prop, so an extension cannot see it. An extension that
ships CSS therefore needs its own switch — `metrics({ injectStyles: false })`,
`environment({ injectStyles: false })` — and should export its stylesheet as a string
for consumers who deliver CSS themselves. Threading core's flag down would mean
extensions importing core's React context at runtime, which only works if both resolve
to the same module instance; see §7.

The *injection* itself is shared: `ensureStyleSheet(entry, css, doc?, nonce?)` in
`/runtime`. It keys on the `data-dev-toolbar-styles` attribute by comparing the
attribute directly rather than interpolating `entry` into a selector string, so an
`entry` containing a quote can't be mistaken for another entry's element or throw a
`SyntaxError`; the DOM rather than a module flag is the deduplication truth, so two
bundled copies still inject once. The optional `nonce` sets the element's `nonce`
property for hosts running a nonce-based CSP. It sits in `/runtime`
rather than core because importing core's injector would drag core's whole
stylesheet string into an extension's bundle — and extensions already import
`/runtime`, while core never does.

### 4.3 `classNames`

A narrow map, for when you want your own class on a part: `root`, `bar`, `region`,
`item`, `overflowButton`, `overflowMenu`, `overflowMenuItem`, `overlay`, `panel`,
`panelResizer`, `errorChip`.

It is deliberately not open-ended — adding a slot is a contract change, which is the
point.

### 4.4 CSS delivery

Styles are injected once per document, from inside a component, keyed on a
`style[data-dev-toolbar-styles]` element in `document.head`. The DOM is the
deduplication source of truth rather than a module flag, so two bundled copies of the
package still inject once. `injectStyles={false}` opts out; import
`@nejcm/dev-toolbar/styles.css` instead. `sideEffects: ["*.css"]` stays accurate
because nothing is injected at module scope.

`src/core/css.ts` is a hand-maintained byte-identical copy of `src/styles.css`,
enforced by `src/core/__tests__/css.test.ts` (which asserts the two are identical);
there is no generator. To change the styles, edit `src/styles.css` and paste its
contents into the template literal in `css.ts`. `src/styles.css` is excluded from the
formatter so the bytes stay identical.

## 5. Layout and overflow

`align` picks a region (`"start"` default, `"end"`), `order` sorts within it ascending,
and `priority` decides what collapses when the bar is too narrow — **lowest priority
collapses first**, ties break toward the later item.

The bar measures itself with a `ResizeObserver`, caches each item's natural width, and
recomputes on every resize. Cached widths are sticky, which is what lets a collapsed
item come back when the width returns even though it was not in the bar to be measured.
The gap and the `···` button width are read back out of the DOM, so overriding
`--dtb-gap` or restyling the button keeps the math honest. The width items may fill is
the bar's `clientWidth` less its own horizontal padding, and less a gap for each side
whose gap the item math does not already charge: one when the start region renders no
items, one when there are no end items at all. A region that renders empty still takes
its gap.

The `···` popup is a **disclosure, not an ARIA menu**. Its entries are extensions'
compact slots, which usually render their own buttons, and a `menuitem` may not contain
interactive content — the menu pattern would put the focusable thing *inside* the item
rather than being it. So the button carries `aria-expanded` and, while open,
`aria-controls`; the popup is a labelled `role="group"` with `tabindex="-1"`; opening it
moves focus to the first focusable element inside it, or to the popup itself when there
is none; `Tab` walks the entries as it walks the bar; `Escape` closes the popup and
returns focus to the button; a click outside closes it and leaves focus where the click
put it. Escape is handled on `document`, so an extension whose own surface closes on
Escape must call `stopPropagation()` — `/ext/command-menu` does.

Where there is no `ResizeObserver` (SSR, a bare jsdom), nothing collapses — the bar
renders everything rather than guessing. `@nejcm/dev-toolbar/testing` ships
`installToolbarLayout()` to make the collapse testable under jsdom; its fake
`ResizeObserver` hands every callback an empty entry array, so it only works for code
that re-measures from the element (`offsetWidth`, `getBoundingClientRect()`) rather
than reading `entries[0].contentRect` — which is what core itself does.

The `overlay` slot is exempt from all of this. It renders once, uncollapsed, for as
long as the extension is present, not hidden and the bar is visible — because a compact
item that has collapsed into the `···` menu is not in the DOM at all, so an extension
whose surface is a modal would lose it exactly when the window got narrow.

## 6. Failure isolation

`compact`, `panel` and `overlay` each render inside their own `ExtensionBoundary`. A
throw becomes an error chip carrying the extension's label, with the message as its
`title`; the bar and every other extension keep working. In the `compact` and `panel`
slots the chip's text is a retry button (`data-dtb-part="error-retry"`, accessible name
`Retry <label>`) that clears the caught error and re-renders the slot — without it a
slot that threw on transient state would stay a chip for the toolbar's lifetime, since
a panel only recovers by unmounting on close. The `overlay` chip has no retry: an
overlay has no dependable visible surface to click. A throw from `start()` or from
its cleanup is caught and logged, and does not take the toolbar down. A throw from
`commands()` or `diagnostics()` is contained the same way: core logs once and treats
that extension as contributing nothing to that aggregation.

This matters more here than in most libraries: extensions *are* the product surface,
and many of them will be somebody's afternoon experiment.

It is a safety net, not error handling. Do not rely on it.

## 7. Writing an extension

An extension is a plain object. Nothing needs to be imported from this package except
its types.

```tsx
import type { DevToolbarExtension } from "@nejcm/dev-toolbar";

interface QueueOptions {
  poll?: number;
}

export function jobQueue({ poll = 5000 }: QueueOptions = {}): DevToolbarExtension {
  // Module-local, per-factory-call state. No global registry, so calling the
  // factory twice gives two independent extensions — mind the ids if you do.
  let depth = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());

  return {
    id: "job-queue",
    label: "Queue",
    contractVersion: 1,   // core warns, once, if it does not match
    align: "end",
    order: 20,
    priority: 40,         // collapses before higher-priority neighbours
    keepMounted: true,    // the chart below survives closing the panel

    // Background work. Runs once, gets an AbortSignal and namespaced storage.
    start(api) {
      const tick = async () => {
        const response = await fetch("/api/queue/depth", { signal: api.signal });
        depth = (await response.json()).depth;
        api.storage.setItem("lastDepth", String(depth));
        emit();
      };
      void tick();
      const timer = setInterval(tick, poll);

      // Core reports visibility; it never pauses you. Decide for yourself.
      const stopWatching = api.subscribeVisibility((visible) => {
        if (!visible) console.debug("[job-queue] bar hidden, still polling");
      });

      return () => {
        clearInterval(timer);
        stopWatching();
      };
    },

    // Slot functions, not components: core hands down state you cannot
    // otherwise know.
    compact: ({ isOverflowed, isPanelOpen, togglePanel }) => (
      <button
        type="button"
        data-dtb-part="trigger"
        aria-expanded={isPanelOpen}
        onClick={togglePanel}
      >
        {isOverflowed ? "Queue depth" : "queue"} {depth}
      </button>
    ),

    panel: ({ height, close }) => <QueuePanel height={height} onClose={close} />,

    // Aggregated by core. Core renders no palette — /ext/command-menu does.
    commands: [
      {
        id: "queue.drain",
        label: "Drain the job queue",
        group: "Queue",
        run: () => fetch("/api/queue/drain", { method: "POST" }),
      },
    ],

    // Aggregated by core. Core renders no snapshot — /ext/diagnostics does.
    diagnostics: () => ({ depth }),
  };
}
```

Mount it:

```tsx
<DevToolbar extensions={[jobQueue({ poll: 2000 })]}>
  <App />
</DevToolbar>
```

Rules worth stating explicitly:

- **`id` is the identity.** It keys de-duplication, panel state, per-extension storage,
  `data-dtb-ext-id` and the error chip. Keep it stable and namespaced. Changing it is
  a breaking change for consumers who persisted state against it.
- **`hidden` is consumer-computed.** There is no `availability(ctx)` — core has no
  identity, session or capabilities to hand you. Whoever knows the actor computes the
  boolean.
- **Slot functions must be cheap.** They run on every toolbar render. Do the work in
  `start()`, or in a component the slot returns. A slot that needs to update faster
  than the bar re-renders should return a component that subscribes to its own store —
  that is what `createThrottledStore` in `/runtime` is for, and it is why the metrics
  chips can move without core knowing anything about it.
- **Build the object once, outside render.** See §3. Core warns when it catches you.
- **Import only types from this package, if you can.** `/ext/metrics` imports nothing
  but types from core, which erase at build time, so it is a genuinely external
  consumer of the same contract a stranger's package uses. The moment an extension
  imports a *value* — core's React context, say — it has to resolve to the same module
  instance as the host's copy of core, which the bundler will not guarantee for a
  first-party subpath bundled alongside it. This is why `api` carries `getCommands()`,
  `runCommand()` and `getDiagnostics()`: they are how an extension reads core's
  aggregations without importing one.
- **`commands` may be a function.** Return a fresh array from it whenever what you
  contribute depends on state that arrives after the factory ran. Keep it pure and
  cheap — core calls it during render, twice per render under StrictMode — and keep the
  order stable, or a palette's list reshuffles under the cursor. Identity is the `id`,
  not the object.
- **`diagnostics()` returns what belongs in a bug report.** Pure, cheap,
  JSON-serialisable, and already safe to leave the machine. The reader redacts it
  again on the way in; that is defence in depth, not a substitute for redacting at the
  source.
- **A modal belongs in `overlay`, not `compact`.**
- **Style with your own CSS.** Reuse core's `data-dtb-part="trigger"` to inherit the
  bar's look, or ignore it entirely and bring Tailwind. Both work — that is the point
  of the light DOM.
- **Register dynamically only for subtree-scoped tools.**
  `useDevToolbar().register(ext)` returns an unregister function; call it on unmount.

First-party extensions live one directory per extension under `src/ext/<name>/`, each
following the same file convention: `index.tsx` (the factory), `runtime.ts` (non-React
logic), `ui.tsx`, `types.ts`, `css.ts`, `__tests__/`. A new extension is a new
published subpath and must be added **explicitly** to both the `exports` map in
`package.json` and the `entry` / `dts.entry` maps in `tsup.config.ts` — never as a
wildcard. An entry missing from either is silently unpublishable or untyped. The one
thing under `src/ext/` that is not a subpath is shared React glue (`useExtensionSurface`
in `src/ext/shared/hooks.ts`), which lives outside the per-extension file layout. The
CJS build does not code-split, so it is inlined into every `dist/ext/*.cjs`; the ESM
build emits it as one shared chunk. Seven copies is why it is held to the extensions'
rules and one more: types only from core, values only from `src/runtime`, nothing from
a sibling `ext/<name>/`, no `[dev-toolbar/ext/…]` marker (the dist scan reads markers
as proof one bundle carries no other's code), and no module-level state, or each bundle
would own a different copy of it. The "shared extension glue" block in
`src/core/__tests__/boundary.test.ts` fails on the first four.

Testing it:

```tsx
import { renderWithToolbar, makeExtension } from "@nejcm/dev-toolbar/testing";

const { toolbar, unmount } = renderWithToolbar(<App />, {
  extensions: [jobQueue()],
  layout: { barWidth: 400, itemWidth: 90 },  // jsdom has no real layout
});

toolbar.openPanel("job-queue");
expect(toolbar.panel("job-queue")).not.toBeNull();

toolbar.resize(150);                          // drives the mocked ResizeObserver
expect(toolbar.overflowedIds()).toContain("job-queue");

// A collapsed item is not in the DOM until the menu opens, so ask about it
// with overflowedIds()/isOverflowed(); reach for item() once it is visible.
expect(toolbar.item("job-queue")).toBeNull();
toolbar.openOverflow();
expect(toolbar.item("job-queue")).not.toBeNull();
unmount();
```

`panel(id)` answers presence in the DOM, not openness: a `keepMounted` panel stays
mounted and `hidden` after `closePanel()`, so this idiom keeps passing for one even
while it is closed — ask `activePanelId()` when the question is really whether it is
open. Every state-changing method on `toolbar` is `act()`-wrapped, including
`runCommand(id)`, which is `async` (the command it runs may be) and so is awaited
rather than wrapped again: `await toolbar.runCommand("queue.drain")`. `rerender(ui)`,
on the object `renderWithToolbar()` returns, re-renders inside the same mounted
toolbar rather than replacing it — it overrides Testing Library's own `rerender`,
which has no `wrapper` here to spare the toolbar from being torn out.

`makeExtension()` builds throwaway extensions (including deliberately broken ones, via
`throwInCompact` / `throwInPanel` / `throwInStart`), and `createMockBus()` gives a
recording pub/sub bus whose `MockClock` stamps `event.at` and offers hand-cranked
`setTimeout`/`setInterval`. `BusLike` itself carries no clock — a collector that wants
one takes an injected *time reader* instead (`CollectorContext.now()` in
`/ext/metrics/types.ts`, supplied by `runtime.ts` and faked in
`network.test.ts` with a plain `() => clock.t`), which `clock.now` satisfies fine.
What nothing first-party accepts is an injected *timer*: `/ext/metrics`'s own polling
(`runtime.ts`'s `setInterval(publish, tickMs)`) and `createThrottledStore`
(`throttledStore.ts`'s `setTimeout`) both call the globals directly, so `MockClock`'s
`setTimeout`/`setInterval` cannot drive them — reach for `vi.useFakeTimers()` for
those instead.

`mountToolbar()` is `renderWithToolbar()` that remembers what it mounted, and
`cleanupToolbar()` unmounts all of it — newest first — and restores any fake layout
still installed. Together they replace the array-of-`unmount`s-plus-`afterEach` that
every multi-mount suite in this repo used to keep for itself; the repo's own
`vitest.setup.ts` calls `cleanupToolbar()` ahead of Testing Library's `cleanup()`. That
hook is not optional for a `mountToolbar()` user: the tracked list is ours and never
hears about RTL's auto-cleanup, so nothing else drains it.

The net is only a net. The fake layout patches `HTMLElement.prototype` and
`globalThis.ResizeObserver`, which are shared by the whole file, so two things make it
safe. First, `installToolbarLayout()` keeps a module-level *stack* of live installs
rather than each install remembering "the previous value" — the newest install
measures, the prototype is patched once when the stack fills and unpatched once when it
empties, and `restore()` is therefore idempotent and order-independent. (Per-install
capture was only correct in exact reverse order; drained in insertion order it put one
fake back on the prototype permanently.) Second, `renderWithToolbar({ layout })` owns
the teardown from *inside* the rendered tree, as an effect cleanup. Testing Library
exposes no hook into `cleanup()`, but it does unmount every tree it rendered — so
`cleanup()`, RTL auto-cleanup and `unmount()` all restore the prototype, whether or not
the test remembered to.

`@testing-library/react` is an optional peer that only `renderWithToolbar` needs, and
nothing on the subpath imports it statically — so `@nejcm/dev-toolbar/testing` imports
cleanly without it, and `renderWithToolbar()` throws an actionable message if it is
genuinely missing.

The load path differs by module system, deliberately. In an ESM runner it is a cached
dynamic `import()`, so `act` and `render` come from the host's own module graph — a
`createRequire()` would hand back a second copy whose `cleanup()` would not clean up
what this `render()` mounted. Inside Jest's sandbox `import()` never settles, so the
CommonJS build falls back to `module.require`, which *is* the runner's resolver and
returns the registry copy. That branch is dead in the ESM build, where `module` does
not exist. Failing both, `setTestingLibrary(module)` supplies it by hand —
`require("@testing-library/react")` under Jest, `await import(...)` in ESM. The
`test/fixtures/jest-consumer` fixture exists to exercise the CommonJS half.

## 8. SSR

`children` render in a fragment, untouched, on the server. The bar is client-only: a
`mounted` flag gates the portal, so the bar never appears in server HTML and there is
nothing to hydrate and nothing to mismatch. `<DevToolbarInset>` holds its defaults
(bottom, zero padding) until the same flag flips, so the server render and the first
client render always agree.

Built entries carry a `"use client"` banner, so a React Server Components app can
import them from a server component without a directive of its own.

### The banner's one sharp edge

That claim is about *importing and rendering*. It is not about **calling**, and the
difference is a build error rather than a runtime one.

`"use client"` makes each built entry a client module in its entirety. RSC permits a
server component to render a client component, and forbids it from invoking a function
exported by a client module — so a `layout.tsx` with no directive can render
`<DevToolbar>`, and the moment it also writes `metrics()` the build fails with
*"Attempted to call metrics() from the server but metrics is on the client."* Every
first-party extension is a factory, so every RSC consumer meets this on their first
attempt.

The fix is one small client module holding the extension array, which is where it
belongs anyway, because §3 requires the objects to be built once outside render. The
README shows the wrapper.

Verified in Next 16 app router, in `next dev` and in a production
`next build && next start` with `reactStrictMode: true`: the server HTML contains the
page and not one `data-dev-toolbar` or `data-dtb-part`, the bar mounts client-side, and
the console carries no hydration warning.

## 9. What is deliberately absent

| Not in core | Where it goes |
| --- | --- |
| Event bus, ring buffers, throttled store, `redact()` | `./runtime` |
| Metrics, environment, flags, overlays, diagnostics, theme editor | `./ext/*` |
| Any design system, colour model or palette generator | `./ext/theme-editor` edits the tokens *you* publish — core has no `ctx` and neither does it |
| Environment, build and session context, and any redaction of it | `./ext/environment` — core has no `ctx` to hand anybody |
| A command palette UI | `./ext/command-menu` — core aggregates and renders nothing |
| Any rendering of the diagnostics aggregation | `./ext/diagnostics` — core collects the roster and renders nothing, as with commands |
| Severity thresholds | The extension that owns the metric |
| Access control | The consumer, before rendering `<DevToolbar>` at all |
| Error capture (`window.onerror`) | Nowhere. Pass your existing reporter to `/ext/diagnostics` as a `sources` entry. |
| A global extension registry | Nowhere. See §2. |
| Visual overlays over the host page | `./ext/overlays` — core draws on nobody's application |

## 10. Known gaps in the contract

Recorded rather than fixed, in descending order of how likely they are to bite. None
is blocking; all were found by building an extension against the contract.

- **`contractVersion` is declarative and core cannot refuse.** It warns, once, and then
  renders and starts the extension anyway. An extension declaring `2` against a core
  implementing `1` gets everything a matching one gets. That is deliberate — core has
  no basis to decide what a mismatch means, and refusing to render would turn a warning
  into an outage — but it means the field is documentation rather than a gate.
  The policy question that follows from this is
  [ADR-003](./adr/ADR-003-contract-version-policy.md), and it is open.
- **An extension that needs to *state* the contract version must hand-maintain a copy
  of core's constant,** because §7 forbids importing a value from core.
  `src/ext/diagnostics/runtime.ts` keeps `TARGET_CONTRACT_VERSION` for exactly this
  reason, and the number is printed into every outbound bug report, so drift is a wrong
  fact in somebody's ticket. Tests are not subject to the no-values rule, so a one-line
  equality assertion against `CONTRACT_VERSION` closes it. Copy the assertion, not just
  the constant.
- **`ExtensionDiagnostics.data` crosses core unredacted.** Core cannot import
  `/runtime` (§2), so it cannot redact, and the reader does it instead. This is the
  right layering — the alternative inverts the architecture — but it means the
  aggregation itself is not a safe surface: a *second* reader that forgot to redact
  would ship raw contributions. This is why `/ext/diagnostics` redacts everything again
  even though the first-party contributors already have.
- **There is no invalidation signal for `commands` or `diagnostics`.** Both are pulled,
  never pushed. It costs nothing today because capture is on demand, but a reader that
  wanted to *watch* an aggregation would have to poll.
- **`ExtensionDiagnostics` splits `error` and `errorName` on purpose,** so each half can
  be matched by an anchored redactor. A reader that renders only `error` shows messages
  with no name in front of them; joining them is one template literal, after masking
  both halves.

Three hardening gaps of the form *a hostile host global makes a guarded path fail* are
known and deliberately unfixed, because each costs more than it buys:
`createThrottledStore`'s `write()` calls its injected `schedule` unguarded; the
`console.error` on a diagnostics failure path logs the raw thrown value (the
developer's own console, not the outbound document — but worth knowing before pasting a
console transcript into a ticket); and `renderJson` / `fence` describe a serialisation
failure with the engine's own message.
