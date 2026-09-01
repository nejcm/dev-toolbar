# Architecture — the `@nejcm/dev-toolbar` shell

This is the reference for the shipped core: what the shell guarantees, where its
boundaries are and why they sit there, the full styling surface, and how to write
an extension against it.

`plans/dev-bar.md` is the product design. `plans/implementation.md` is the accepted
delivery plan. This document describes what the code actually does.

- Contract version: **1** (`CONTRACT_VERSION`)
- Entries: `@nejcm/dev-toolbar` (root), `/runtime`, `/ext/metrics`,
  `/ext/environment`, `/ext/flags`, `/ext/command-menu`, `/ext/overlays`,
  `/testing`, `/styles.css`
- Runtime dependencies: **none**

P1 built `/ext/metrics` strictly as an outside consumer of this contract, which was
the point of building it. It moved the contract in four places; all four are marked
**P1** below and collected in [§10](#10-what-p1-changed-and-why). `CONTRACT_VERSION`
stays `1`: every change is additive or a semantic correction, and version 1 has never
been published, so there is nothing in the wild to break.

P2's first extension, `/ext/environment`, moved it in **no** places — see
[§11](#11-what-p2s-first-extension-found). The one thing it changed is a duplication
it refused to repeat: the per-extension style injector now lives in `/runtime`.

P2's second, `/ext/flags`, found one gap and deferred it ([§12](#12-what-p2s-second-extension-found)).
P2's third, `/ext/command-menu`, is the consumer that gap was deferred to, and it
settled it and found one more — `commands` may now be a **function**, and there is a
third slot, `overlay`, for the surfaces the bar cannot host. Both are additive and
both are collected in [§13](#13-what-p2s-third-extension-found). `CONTRACT_VERSION`
stays `1`.

P3's first extension, `/ext/overlays`, is the first that **draws over the host
application**. It moved the contract in **no** places — the `overlay` slot P2 added
for a modal turned out to be exactly the right surface for a persistent one — but it
is the first consumer whose safety story is mostly about what it refuses to do, and
that is collected in [§14](#14-what-p3s-first-extension-found). `CONTRACT_VERSION`
stays `1`.

## 1. What the shell is

The root entry is chrome plus hosting, and nothing else. It:

- renders a fixed bar at the top or bottom of the viewport, in a portal on
  `document.body`;
- sorts the extensions it is given by `align`, then `order`;
- collapses the lowest-`priority` items into a `···` menu when the bar runs out of
  width, and lets them back out when the width returns;
- hosts at most one panel at a time, resizable and persisted;
- renders every extension's `overlay` slot, uncollapsed, for modal surfaces;
- publishes `--dev-toolbar-height` and ships an opt-in `<DevToolbarInset>`;
- owns the token set, the `data-dtb-part` attributes and the `classNames` map;
- persists visibility, position, active panel and panel height through an
  injectable storage adapter;
- wraps every extension slot in its own error boundary;
- runs `start(api)` once per extension and *reports* visibility to it;
- aggregates extension-declared commands and exposes them — it renders no palette.

It does **not** know what a metric is, what a flag is, what "healthy" means, who the
user is, or what may be shown to them. Every one of those is an extension's job.

## 2. Boundary rationale

### Light DOM, not Shadow DOM

The obvious way to keep a dev toolbar from colliding with its host app is a shadow
root. We deliberately do not do that, and this reverses an earlier recommendation in
`plans/dev-bar.md`.

Extensions are **user code**. Inside a shadow root:

- Tailwind, and every other utility framework, stops working — its rules live in
  `document.head` and do not cross the boundary;
- most CSS-in-JS runtimes inject into `document.head` too, so styled components
  render unstyled;
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

### No global registry

Extensions arrive as a prop (`extensions={[…]}`), plus `useDevToolbar().register()`
for anything scoped to a mounted subtree. There is no module-level registry, because
one would:

- break SSR — module state is shared across requests on a warm server;
- break two toolbars on one page — a second root would see the first one's items;
- leak between tests — registration would outlive the test that did it;
- make ordering depend on import order, which nobody controls.

The one module-level structure in core is the command *host* set in
`core/commands.ts`. It is not a registry: entries are added on mount and removed on
unmount, and it exists only so the context-free `runCommand(id)` can reach a mounted
toolbar. Inside React, prefer `useDevToolbar().runCommand`.

### Core never imports `runtime/` or `ext/`

An event bus, ring buffers and a throttled store are what a *collector* needs, not
what chrome needs. Putting them in core would mean every consumer downloads the
machinery for measurement even when their toolbar is three buttons. They ship as an
opt-in `./runtime` subpath (P1), which core never imports — a rule the build enforces
by keeping the entries separate and checkable, not just by convention.

The same applies in reverse to `./testing`: it imports from `core/` only, so it stays
usable before `/runtime` exists.

### `enabled`, not build magic

There is no bundler plugin and no `__DEV__` global. `enabled={false}` renders
`children` and nothing else: no portal, no lifecycle, no listeners, and any running
extension is torn down. For byte-level stripping, the consumer does it with tools
they already have — see the recipe in the README.

### Visibility is reported, never acted on

`start(api)` gets `isVisible()` and `subscribeVisibility()`. Core never pauses an
extension on its behalf. A cumulative counter that silently stops counting when the
bar is closed is worse than one that keeps going, and only the extension knows which
of its work is cumulative.

`isVisible()` is about **the bar**, not the document. Whether the tab is backgrounded
is `document.visibilityState`, it is not core's to report, and it is a different
question with different consequences — `/ext/metrics` reads both, and only the second
one makes it throw frames away.

### `hidden` is not visibility — **P1**

`hidden` is the consumer saying *this extension does not exist for this actor*. Core
therefore treats it as absent everywhere, not merely unpainted. That is not a
contradiction of the rule above: that rule is about the bar being closed, which says
nothing about who is looking at it.

Concretely, a hidden extension:

| | |
| --- | --- |
| does not render in the bar or the `···` menu | `Bar.tsx` / `sortExtensions` |
| is never `start()`ed, and is torn down if it becomes hidden while running | `DevToolbar.tsx` |
| has no panel mounted, `keepMounted` included | `PanelHost.tsx` |
| has its `activePanelId` cleared on the transition | `DevToolbar.tsx` |
| contributes no commands to `useToolbarCommands()` or `runCommand(id)` | `commands.ts` |

Building the metrics extension made every row concrete, and getting only the first
two right is worse than getting none, because it *looks* enforced. A hidden collector
that still ran would keep `fetch` patched, keep retaining request URLs and keep a
`requestAnimationFrame` loop alive for somebody not permitted to see any of it. A
panel left mounted keeps the request table on screen. A command left in the aggregate
means `runCommand("metrics.copy")` still puts that table on the clipboard — a
front-door bypass of the whole thing.

The `activePanelId` clear is narrow on purpose: only a *present and hidden* extension
closes its panel. An id that is merely absent is left alone, which is what lets a
persisted `activePanelId` survive until the extension that owns it registers.

That distinction is also the answer for a consumer still waiting on the permissions
that decide `hidden`: **leave the extension out of the array while you do not know,
rather than passing `hidden: true`.** Absent preserves the persisted panel; a
transient `hidden: true` closes it, because as far as core can tell you have just
said this actor may not see it.

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

### Extension objects must be referentially stable — **P1**

`id` identifies an extension, but the *object* owns its lifecycle: `start()` was
called on one particular object, and whatever it created lives in that object's
closure. Rebuild the object and the bar renders a second one that owns nothing, while
the first keeps running unreachable.

Core cannot fix this — the identity is the consumer's — so it detects it. When an
already-started id turns up with a different `start` function reference, core warns
once for that id. The discriminator is deliberate: `{...ext, hidden: true}` keeps the
same `start` reference and stays quiet, while `extensions={[metrics()]}` written
inline gets a new closure every render and does not.

The first thing this caught was not a render-loop at all. It was a Vite hot-module
reload of the playground's `extensions.tsx`, which re-evaluated the module, built a
second extension, and left the chips frozen while the first one carried on
collecting. The warning says so, and says to reload the page.

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
| `--dtb-ok` | `#1e8a54` | "ok" severity — **P1** |
| `--dtb-ok-bg` | `rgba(30,138,84,.12)` | — |
| `--dtb-warn` | `#a8730c` | "warn" severity — **P1** |
| `--dtb-warn-bg` | `rgba(168,115,12,.14)` | — |
| `--dtb-panel-height` | set per panel | Written by the panel host; read, do not set |

Dark values are applied for `[data-dtb-color-scheme="dark"]` and, under
`prefers-color-scheme: dark`, for anything not explicitly `"light"`.

### 4.2 `data-dtb-part`

Every part carries a stable attribute. These are the supported selector hooks;
class names inside core are not.

| Part | Element | Notes |
| --- | --- | --- |
| `root` | portal root | Also `data-dev-toolbar`, `data-dtb-instance`, `data-dtb-position`, `data-dtb-density`, `data-dtb-color-scheme` |
| `bar` | the bar row | `role="toolbar"` |
| `region` | one align region | `data-dtb-align="start" \| "end"` |
| `item` | one extension's compact slot | `data-dtb-ext-id`, `data-dtb-align`, `data-dtb-overflowed`, `data-dtb-panel-open` |
| `trigger` | core's default button/label | Only when the extension supplies no `compact` |
| `overflow-button` | the `···` button | |
| `overflow-menu` | the `···` popover | `role="menu"` |
| `overflow-menu-item` | one collapsed item wrapper | `data-dtb-ext-id`, `role="menuitem"` |
| `panel` | one panel | `data-dtb-ext-id`, `data-dtb-active`, `hidden` when inactive |
| `panel-resizer` | drag/keyboard handle | `role="separator"`, arrow keys resize |
| `panel-body` | scroll container | |
| `error-chip` | a crashed slot | `data-dtb-ext-id`, `data-dtb-slot="compact" \| "panel"` |
| `inset` | `<DevToolbarInset>` | `data-dtb-position` |

Core owns the unprefixed names; an extension that ships CSS **namespaces its parts
by kind** — a prefix fixed by the extension package, not by the `id` an individual
instance happens to carry — which is why `/ext/metrics` renders
`data-dtb-part="metrics-chip"` and not `data-dtb-part="chip"`. Without a prefix the
attribute stops being a stable hook the moment two extensions pick the same word.

By kind, not by id, on purpose: `metrics({ id: "metrics-api" })` and
`metrics({ id: "metrics-worker" })` are two instances of one thing, and a consumer
styling metrics chips wants one rule for both. The instance is already addressable —
`[data-dtb-ext-id="metrics-worker"]` sits on the surrounding item — so nothing is
lost, and `data-dtb-metric` narrows further to a single chip.

Core's `injectStyles` prop is a prop, so an extension cannot see it. An extension
that ships CSS therefore needs its own switch — `metrics({ injectStyles: false })`,
`environment({ injectStyles: false })` — and should export its stylesheet as a string
for consumers who deliver CSS themselves. Threading core's flag down would mean
extensions importing core's React context at runtime, which only works if both
resolve to the same module instance; see §7.

The *injection* itself is shared: `ensureStyleSheet(entry, css)` in `/runtime`
(**P2**). It keys on a `style[data-dev-toolbar-styles="<entry>"]` element, so the DOM
rather than a module flag is the deduplication truth and two bundled copies still
inject once. It sits in `/runtime` rather than core because importing core's injector
would drag core's whole stylesheet string into an extension's bundle — and extensions
already import `/runtime`, while core never does.

### 4.3 `classNames`

A narrow map, for when you want your own class on a part:
`root`, `bar`, `region`, `item`, `overflowButton`, `overflowMenu`,
`overflowMenuItem`, `panel`, `panelResizer`, `errorChip`.

It is deliberately not open-ended — adding a slot is a contract change, which is the
point.

### 4.4 CSS delivery

Styles are injected once per document, from inside a component, keyed on a
`style[data-dev-toolbar-styles]` element in `document.head`. The DOM is the
deduplication source of truth rather than a module flag, so two bundled copies of the
package still inject once. `injectStyles={false}` opts out; import
`@nejcm/dev-toolbar/styles.css` instead. `sideEffects: ["*.css"]` stays accurate
because nothing is injected at module scope.

## 5. Layout and overflow

`align` picks a region (`"start"` default, `"end"`), `order` sorts within it
ascending, and `priority` decides what collapses when the bar is too narrow —
**lowest priority collapses first**, ties break toward the later item.

The bar measures itself with a `ResizeObserver`, caches each item's natural width, and
recomputes on every resize. Cached widths are sticky, which is what lets a collapsed
item come back when the width returns even though it was not in the bar to be
measured. The gap and the `···` button width are read back out of the DOM, so
overriding `--dtb-gap` or restyling the button keeps the math honest.

Where there is no `ResizeObserver` (SSR, a bare jsdom), nothing collapses — the bar
renders everything rather than guessing. `@nejcm/dev-toolbar/testing` ships
`installToolbarLayout()` to make the collapse testable under jsdom.

## 6. Failure isolation

`compact` and `panel` each render inside their own `ExtensionBoundary`. A throw
becomes an error chip carrying the extension's label, with the message as its
`title`; the bar and every other extension keep working. A throw from `start()` or
from its cleanup is caught and logged, and does not take the toolbar down.

This matters more here than in most libraries: extensions *are* the product surface,
and many of them will be somebody's afternoon experiment.

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

    // Aggregated by core. Core renders no palette — /ext/command-menu will.
    commands: [
      {
        id: "queue.drain",
        label: "Drain the job queue",
        group: "Queue",
        run: () => fetch("/api/queue/drain", { method: "POST" }),
      },
    ],
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

- **`id` is the identity.** It keys de-duplication, panel state, per-extension
  storage, `data-dtb-ext-id` and the error chip. Keep it stable and namespaced.
- **`hidden` is consumer-computed.** There is no `availability(ctx)` — core has no
  identity, session or capabilities to hand you. Whoever knows the actor computes the
  boolean.
- **Slot functions must be cheap.** They run on every toolbar render. Do the work in
  `start()`, or in a component the slot returns. A slot that needs to update faster
  than the bar re-renders should return a component that subscribes to its own store —
  that is what `createThrottledStore` in `/runtime` is for, and it is why the metrics
  chips can move without core knowing anything about it.
- **Build the object once, outside render.** See §2. Core warns when it catches you.
- **Import only types from this package, if you can.** `/ext/metrics` imports nothing
  but types from core, which erase at build time, so it is a genuinely external
  consumer of the same contract a stranger's package uses. The moment an extension
  imports a *value* — core's React context, say — it has to resolve to the same module
  instance as the host's copy of core, which the bundler will not guarantee for a
  first-party subpath bundled alongside it.
- **Style with your own CSS.** Reuse core's `data-dtb-part="trigger"` to inherit the
  bar's look, or ignore it entirely and bring Tailwind. Both work — that is the point
  of the light DOM.
- **`commands` may be a function.** Return a fresh array from it whenever what you
  contribute depends on state that arrives after the factory ran. Keep it pure and
  cheap — core calls it during render — and keep the order stable. See §13.1.
- **A modal belongs in `overlay`, not `compact`.** The overlay slot renders once,
  uncollapsed, for as long as you are present and the bar is visible. See §13.2.
- **Register dynamically only for subtree-scoped tools.**
  `useDevToolbar().register(ext)` returns an unregister function; call it on unmount.

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

`makeExtension()` builds throwaway extensions (including deliberately broken ones,
via `throwInCompact` / `throwInPanel` / `throwInStart`), and `createMockBus()` gives a
pub/sub bus with a hand-cranked clock for collectors that poll or sample.

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
`require("@testing-library/react")` under Jest, `await import(...)` in ESM.

## 8. SSR

`children` render in a fragment, untouched, on the server. The bar is client-only: a
`mounted` flag gates the portal, so the bar never appears in server HTML and there is
nothing to hydrate and nothing to mismatch. `<DevToolbarInset>` holds its defaults
(bottom, zero padding) until the same flag flips, so the server render and the first
client render always agree.

Built entries carry a `"use client"` banner, so a React Server Components app can
import them from a server component without a directive of its own.

## 9. What is deliberately absent

| Not in core | Where it goes |
| --- | --- |
| Event bus, ring buffers, throttled store, `redact()` | `./runtime` (P1) |
| Metrics, environment, flags, overlays, diagnostics, theme editor | `./ext/*` (P1–P4) |
| Environment, build and session context, and any redaction of it | `./ext/environment` (P2) — core has no `ctx` to hand anybody |
| A command palette UI | `./ext/command-menu` (P2) — core aggregates and renders nothing |
| Severity thresholds | The extension that owns the metric |
| Access control | The consumer, before rendering `<DevToolbar>` at all |
| A global extension registry | Nowhere. See §2. |
| Visual overlays over the host page | `./ext/overlays` (P3) — core draws on nobody's application |


## 10. What P1 changed, and why

`/ext/metrics` was built as an outside consumer of the P0 contract, deliberately, to
find out where the contract was wrong. Four things, in descending order of how much
they mattered.

### 10.1 `hidden` extensions no longer start — *semantic correction*

P0 filtered `hidden` extensions out of the bar and did nothing else with the flag:
it started them, mounted their panels and aggregated their commands. That is
defensible for a chip and indefensible for a collector. `hidden` now means absent
across all five surfaces — bar, lifecycle, panel, active-panel state and commands.
The table in §2 lists them, and getting a subset right is the failure mode worth
naming: an enforcement that covers the visible surfaces and not the reachable ones
reads as complete and is not.

Behaviour change, not a type change. Any extension whose `start()` was previously
running while hidden now stops — which is the point.

### 10.2 `CompactSlotProps.togglePanel()` — *additive*

Every extension that rendered a trigger was writing
`isPanelOpen ? closePanel() : openPanel()`. Core already owns the single-active-panel
invariant and already exposes `togglePanel(id)` internally; not handing it to the slot
was an oversight that made every author reimplement it. `openPanel`/`closePanel` stay.

### 10.3 `--dtb-ok` / `--dtb-warn` (and their `-bg` pairs) — *additive*

§3D's whole design is green/yellow/red severity, and P0 shipped only `--dtb-danger`.
Extensions were left inventing hex codes, which meant a consumer who restyled the bar
got a bar in their palette with severity colours in ours. Now overriding one token
restyles every extension's severity at once.

Alongside it, a rule rather than an API: **core owns unprefixed `data-dtb-part`
names, extensions namespace theirs with their extension id.** See §4.2.

### 10.4 A warning for rebuilt extension objects — *additive, diagnostic*

Nothing in P0 said the extension object had to be referentially stable, and nothing
detected it when it was not. The failure is silent and total — the bar renders an
object that owns nothing — and the first real instance of it was a Vite hot reload,
not a coding mistake. Core now warns once per id. See §2.

### 10.5 Not changed, and why

Three things looked like contract gaps and were not:

- **Slot functions cannot re-render themselves.** They do not need to: a slot returns
  a component, and the component subscribes to whatever store the extension owns. Core
  re-rendering the bar at a collector's sampling rate would be the wrong fix.
- **`api.storage` is only available from `start()`.** On the initial mount `start()`
  runs before the first slot render anyway (§3), and the general rule — build state in
  the factory — covers the cases where it does not.
- **A multi-chip extension is a single overflow unit.** `/ext/metrics` renders four
  chips inside one item, so all four collapse together. Sub-item overflow granularity
  would mean core understanding the inside of a slot. The escape hatch is already
  there: call `metrics({ id, only })` more than once.

### 10.6 Two bugs the browser found that jsdom could not

Neither is a contract change; both are recorded because a unit test suite passing is
not the same as the thing working.

- **A `fetch` patch guarded by "am I already installed?" made every later collector
  blind.** With two live collectors — two toolbars, or an HMR reload — the first owned
  the wrapper and the rest recorded nothing while still reporting themselves as
  instrumented. The wrapper is now installed once, globally, and fans out to a set of
  sinks; it is removed when the last one leaves, and never removed over somebody
  else's later patch.
- **A page loading both the ESM and the CJS build gets two `fetch` wrappers.** The
  patch bookkeeping is module state, so the dual-package hazard applies. They stack
  rather than conflict and both record correctly, but the app pays twice; resolving
  the package to one format, which every bundler does by default, avoids it.
- **Destroying the extension's store in its `start()` cleanup froze the UI.** React
  StrictMode runs mount → cleanup → mount; the cleanup destroyed the store, dropping
  React's subscription and turning every subsequent write into a no-op, so the chips
  sat at their mount-time values while the collectors happily kept collecting. The
  store belongs to the extension object, not to one start/stop cycle. Both now have
  regression tests that fail against the old code.

## 11. What P2's first extension found

`/ext/environment` is §3B — environment, build and authenticated-actor context — and
it is the first extension whose subject matter is *the consumer's own data* rather
than something it can measure for itself. It needed no contract change.

### 11.1 The contract held

Four things that could have been gaps and were not:

- **No `ctx` was missed.** The Decisions table dropped `availability(ctx)` on the
  grounds that core has no identity to hand anybody. An extension whose entire subject
  is identity confirms it from the other side: the consumer passes what it knows into
  the extension's own factory, which is a narrower, typed, per-extension surface, and
  core stays out of it. `hidden` and the `fields` allowlist cover the restricted-view
  case without core knowing what a role is.
- **A store in the factory, again.** Same rule as `/ext/metrics`: the snapshot is
  built by `environment()`, not by `start(api)`, because the chip renders before any
  effect runs. Nothing new, but it is now twice in a row that the *first* thing an
  extension author must know is this one.
- **Visibility stayed reported, not enforced.** The extension re-reads on the bar
  becoming visible and otherwise polls; core pausing it would have been wrong for
  exactly the reason §2 gives.
- **Slot-level severity needed nothing from core** beyond `--dtb-ok` / `--dtb-warn` /
  `--dtb-danger`, which P1 added. Production renders in the danger colour and an
  impersonation overrides everything — an extension-level judgement, made with core's
  tokens, so a restyled bar restyles it.

### 11.2 The one change: `ensureStyleSheet` moves to `/runtime`

`/ext/metrics` wrote a private near-copy of core's style injector, with a comment
explaining why it could not import core's. `/ext/environment` was about to write the
same twenty lines a second time. Two is the point at which the duplication is the
design, so it moved to `/runtime` and both extensions call it. Behaviour is unchanged
and both keep their own `injectStyles` option; see §4.2.

### 11.3 Redaction as a UI concern, not just a clipboard one

§6 says to mask credentials and PII *in copied snapshots*. Building the panel made a
stronger rule obvious: redact on the way **in**, so the snapshot the panel renders and
the snapshot the clipboard receives are the same object. A "copy" path that re-derives
from raw context is one refactor away from being the only path that forgets, and the
aggregated command is a second front door onto the same data — `runCommand(
"environment.copy")` must not be able to fetch what the panel would not show.

The trap underneath that rule is **order of operations**, and it is silent. `redact()`
finds sensitive keys by *walking an object graph*; a value serialised before it gets
there is a string, and every key inside it is now just characters in a value. Review
caught exactly this in the first cut of `/ext/environment`: `extra` entries were
`JSON.stringify`d before redaction, so `extra: { user: { authToken } }` put the token
in the panel and on the clipboard — and the row still displayed its `masked` tag,
because a sibling email had been masked by the PII pass. A leak under a badge that
says "masked" is worse than a plain one. Redact first, serialise second, and derive
the `masked` flag by comparing the two *rendered* forms so it cannot be set by a
formatting difference.

The third is that **reading the consumer's data must fail closed**. Redaction walks
the graph with `Object.entries`, which invokes getters, so a getter that throws —
anywhere in the context, at any depth — throws from the snapshot build. The first
build runs inside the extension's *factory*, before core has mounted anything, so it
would take down the host application's render rather than degrading to an error chip;
the later ones run inside a `setInterval`, where nobody can catch them at all. §6's
failure isolation is the shell's promise about *slots*; this is the same promise an
extension has to keep for itself about everything it does outside one. The build is
wrapped, and a context it cannot read becomes a snapshot that says so.

The second rule is that **masking is visible**. A masked row is tagged in the panel
and counted next to the copy buttons. Silent masking and a value that was never
supplied look identical, and a developer debugging "why is my user id wrong" deserves
to be told which one they are looking at.

Neither is a contract change. Both are what a snapshot-shaped extension should do, and
they are recorded here because the next one — `/ext/diagnostics` — has the same shape.

## 12. What P2's second extension found

`/ext/flags` is §3C plus §7's promoted flag, and it is the first extension that
**changes what the application does**. Metrics and environment observe; this one
mutates, persists the mutation, and applies it by calling *consumer* code. Three
findings, one of which is a genuine gap in the contract.

### 12.1 The consumer-owned-state pattern held a second time

`/ext/environment` established it: the extension's subject matter belongs to the
consumer, who passes it into the extension's own typed factory rather than into
some `ctx` core would have to invent. Flags work the same way — a `flags` reading
in, an `onOverride` adapter out — and the shape survived contact with a subject that
is *writable*. Omitting the adapter degrades to a read-only panel, which is the
honest answer for a consumer with nowhere to put an override, and is one boolean on
the snapshot rather than a second extension.

The one thing worth stating for the next author: **the reading's `value` is the
value before the toolbar's override**, and the override badge is driven by the
extension's own map, never by comparing `value` against the override. A consumer
who folds overrides back into the store they read `value` from makes the two equal;
comparing would have silently un-marked every override for exactly the integrations
most likely to exist.

### 12.2 The contract gap: `commands` cannot change

`DevToolbarExtension.commands` is a static array on an object that must be
referentially stable (§3). `/ext/flags` contributes one toggle command per boolean
flag, and it can only enumerate the flags it can see **at factory time**. A flag
that appears later gets a panel row and no command until the page reloads.

This is a real limitation and it is recorded rather than fixed, because fixing it
means choosing between two things P2's third extension is better placed to judge:

- making `commands` a function core calls on each aggregation pass — cheap, but it
  turns command identity into something that can churn on every render; or
- an imperative `api.setCommands()` on `ExtensionRuntimeApi`, which is precise but
  adds a second, effect-time path into state core currently derives.

`/ext/command-menu` is the consumer that will actually feel the difference. It
decides, and `CONTRACT_VERSION` stays `1` either way — nothing has shipped.

**Settled by P2's third extension: the function form.** See [§13.1](#131-commands-may-be-a-function--the-deferred-decision).

### 12.3 The promoted flag is inside the extension's one overflow unit

§7 says the promoted item should carry "a high `priority` so overflow never eats
it", and `priority` is per *extension*. `/ext/metrics` already settled that one
extension is one overflow unit — core collapses items, not the parts inside them —
so a promoted flag cannot outrank the panel trigger it ships alongside. The
alternatives were both worse: returning two extension objects from `flags()` means
two ids, two storage scopes and two stores for one feature, and core has no notion
of a linked pair to keep them together.

So the promoted control lives in the same compact slot as the flags chip, and the
mitigation is that **collapsing costs its position, never its capability**: the
`···` menu renders the same working switch. The default `priority` is `60`, above
the metrics chips, so it survives a narrowing window longer than a memory readout.

### 12.4 Mutating the app needs an escape hatch that works without the app

Everything else in this repo degrades to "the panel shows less". An override
degrades to "the application behaves differently, and it still will after a
reload". That changes what failure isolation has to mean:

- **The failure is shown, not swallowed, and it is per key.** A throwing
  `onOverride` is caught — it runs inside a click handler and inside `start()` —
  and the failure is recorded *against that flag*, cleared only by that flag's own
  later success. Review caught the first cut holding one global slot: overriding
  `a` threw and raised the banner, overriding `b` succeeded and erased it, and row
  `a` went on claiming to be overridden with no warning anywhere. Same defect on
  the `start()` re-apply loop, on exactly the load where it matters. A panel that
  says *overridden* while the app never heard about it is the same lie as
  `/ext/environment`'s "masked" badge over an unmasked value, so the row itself now
  carries *override not applied* and grades `bad`.
- **An override whose flag no longer exists still gets a row.** The re-apply loop
  applies every *stored* override, but the snapshot was built only from the current
  catalogue — so a renamed flag left an override that the application kept
  receiving while the toolbar counted zero and disabled its own *Clear all* button.
  The only way out was the URL kill switch, which nobody reaches for when the UI
  says nothing is wrong. Orphans are rendered, tagged *no longer in the catalogue*,
  counted, and clearable. They grade `warn` rather than the override accent: stale
  state to clean up is not a deliberate override, and colouring them the same hides
  the only difference that matters. The general lesson for a snapshot-shaped
  extension that writes: **anything you apply must appear in what you display**, or
  the display is a subset pretending to be the whole.
- **The application's own value stays on screen.** Every row shows effective, app
  and default side by side, so nobody debugs against a value the server never sent.
- **`?dtb-flags=reset` clears every override before any of them is applied.** The
  override that breaks the page also breaks the toolbar you would use to remove it,
  and "clear your localStorage" is not something you talk a colleague through.
  `readStoredOverrides()` honours it too, so an app that hydrates its own store
  early does not resurrect what the URL just dropped.
- **Reload behaviour is per flag.** §3C's `reloadBehavior`; a non-`live` flag that
  is overridden is marked *reload required* and the banner offers the reload.

An editor adds one more: **refuse input rather than coercing it**. The number
editor used `Number(raw)` with a `0` fallback, so Enter on an empty or unparseable
field pinned the flag to zero, persisted it and applied it. `parseValue` now returns
`undefined` for anything that is not a value of that type, the row says *not a
number*, and the draft survives so it can be fixed. The number editor is a `text`
input with `inputMode="decimal"` on purpose: `type="number"` silently discards what
it cannot parse, which turns a rejected keystroke into an empty field with no
explanation.

### 12.5 Two shapes that only a writing extension exposes

Both were found by review, both are one line, and both are the kind of thing that
survives indefinitely in a read-only extension.

**A null prototype must not cross a public API.** The persisted override map is a
null-prototype object so that a key literally called `__proto__` round-trips as data
rather than being swallowed by the prototype's setter. Returning that map from
`readStoredOverrides()` made `result.hasOwnProperty("a")` throw for every consumer.
The internal representation stays; the public function returns a spread copy.

**`redact()` dropped a `__proto__` key, and that is a `/runtime` bug.** `walk()`
rebuilt objects with `output[key] = …`, which for `__proto__` invokes
`Object.prototype`'s setter and writes nothing — so the key read back through the
prototype and rendered as `"[object Object]"`, *with* a `masked` badge, because the
before and after forms differed. Nothing was polluted (the value is a string and the
setter ignores it), but a value silently replaced by a lie is precisely what a
redactor must not do, and `/ext/environment` shared the defect. Both rebuild paths
now use `Object.defineProperty`. `/ext/flags` did not cause this; writing flag keys
straight through the redactor is simply the first thing that made it visible — which
is the argument for `/runtime` owning shared primitives in the first place (§11.2).

### 12.6 Redaction, again, with one new wrinkle

Same rule as §11.3 — `redact()` on the way in, one snapshot for the panel and the
clipboard — with one addition a value *editor* forces: a masked value must not
round-trip through the input. The text editor starts empty with a "masked — type a
new value" placeholder rather than being seeded with the current value, because
seeding it is the one place the redacted snapshot would leak back onto the screen.

Each value is redacted **under its own flag key**, so `checkout.apiToken` masks by
key while an innocent key holding `Bearer …` masks by value. Booleans and numbers
are left readable whatever their key: they cannot carry a credential, and masking
them would make a flag called `session.newLogin` unreadable for nothing.


## 13. What P2's third extension found

`/ext/command-menu` is the palette over the aggregation core has been building since
P0, and it is the odd one out in this repo: the other three *produce* commands and it
is the first that only **reads**. It moved the contract in two places, both additive,
and both are things only a reader could have found.

`CONTRACT_VERSION` stays `1`. Every change here widens an existing optional field or
adds a new optional one; every extension written against the P0–P2 contract still
type-checks and still behaves identically. Version 1 has never been published, so
even a breaking change would have had nothing to break — but it did not need one, and
bumping on an additive change would spend the signal that a bump is supposed to carry.

### 13.1 `commands` may be a function — the deferred decision

`commands?: ToolbarCommand[] | (() => ToolbarCommand[])`. Core calls the function on
each aggregation pass. §12.2 deferred the choice between this and an imperative
`api.setCommands()`, and the function form won on three grounds.

**Command identity is the `id`, not the object.** That was the objection to the
function form — churn — and it does not survive contact with the code. `/ext/flags`
already closes over its runtime and resolves the flag live inside `run`, so a
re-enumerated command with the same `id` is behaviourally identical to the one it
replaced. Core dedupes by `id`, the palette keys and diffs by `id`, and nothing
anywhere holds a command object across a pass. Rebuilding the objects costs an array
allocation on a list that is tens of items long, at moments a human initiated.

**`setCommands()` would have been a second write path into state core derives.**
Everything else about an extension is declarative and read from the object; commands
would have become the one thing pushed in from an effect, with StrictMode's
double-invoke, teardown ordering, and "who wins if both a static array and a
`setCommands()` call exist" all to specify. And every extension wanting live commands
would have had to subscribe to its own state and re-push — plumbing the function form
gets for free.

**It degrades to what already existed.** A static array is a constant function, so
`/ext/metrics` and `/ext/environment` changed by exactly zero lines.

Four things had to be settled to make it safe:

- **How often core calls it, and where.** On the *declarative* path, once per change
  of the extension list, inside the `useMemo` that feeds `useToolbarCommands()` —
  which is a render-phase call of extension code, and twice per render under
  StrictMode. On the *imperative* path — `getCommands()`, `runCommand(id)`,
  `api.getCommands()` — once per call. The contract states the requirement this puts
  on an extension: `commands()` must be a pure, cheap enumeration.
- **A throwing `commands()` cannot reach the host app.** A render-phase throw is not
  contained by the per-slot error boundaries, which sit *below* the toolbar's own
  render — it would take down the application, which is the one failure mode this
  package exists not to have. So core wraps every call: the extension contributes
  nothing, exactly as if it were `hidden`, and core logs once per id rather than once
  per render. A non-array return, and entries that are not runnable commands, are
  dropped the same way. Fail-closed, and quiet enough to be readable.
- **Recursion.** `api.getCommands()` aggregates, and an extension could call it from
  inside its own `commands()`. A module-level guard makes the nested call return
  nothing and log, rather than recursing until the stack ends inside a render.
- **`hidden` still wins.** A hidden extension's enumerator is not called at all —
  not called and then filtered, which would let an extension observe the traffic of
  a state that is supposed to mean it does not exist.

The one real cost, stated plainly: **core has no invalidation signal.** An extension
whose command list grew does not tell anybody, so `useToolbarCommands()` — which must
stay referentially stable to be usable in a dependency array — is a snapshot as of
the last extension-list change, and can be behind. That is why the context also
exposes `getCommands()`, why `runCommand(id)` re-enumerates instead of reading the
snapshot, and why the palette re-enumerates every time it opens. Anything that must
be current asks; anything that must be stable subscribes.

`/ext/flags` now enumerates per flag from its own store on every pass, and a flag
that appears after mount has a working toggle command as soon as the extension's next
poll sees it. It reads `peek()` rather than `getSnapshot()`, because the store
coalesces publishes at 4 Hz for the chip's benefit and "the flag is in the panel but
not in the palette" should not be a timing question.

### 13.2 The bar is not a place to hang a modal — the `overlay` slot

The palette is a dialog. Three surfaces existed and none of them fits one.

A **panel** is wrong twice over: core hosts one panel at a time, so opening the
palette would evict whatever you opened it to act on, and a panel is a resizable
drawer pinned to the bar, not a centred modal with a scrim.

The **compact** slot is wrong for a subtler and more serious reason. A collapsed item
is not rendered at all until the `···` menu is opened — so an extension that hosts
its dialog *and its key binding* in `compact` loses both exactly when the window gets
narrow. §12.3 established the rule that collapsing costs an item its position, never
its capability; for a palette, the shortcut **is** the capability.

So core gained a third slot: `overlay?: (props) => ReactNode`, rendered once per
extension, inside the toolbar root, for as long as the extension is present and not
hidden and the bar is visible. It is never collapsed — overflow is about horizontal
space and an overlay occupies none — and there is no single-active invariant, because
an overlay is the extension's own modal and only it knows whether it is showing
anything. Most render `null` most of the time.

Inside the root rather than a portal of its own, deliberately: it inherits the
`--dtb-*` tokens, the density and colour-scheme attributes and the `@layer` scoping,
and the root sets no containing block, so a `position: fixed` overlay still covers the
viewport rather than the 30px bar. The wrapper is `display: contents`, so it adds
nothing to the root's layout or to `--dev-toolbar-height`. Slot errors are contained
like any other, with `data-dtb-slot="overlay"` on the chip.

The one limit worth stating: an overlay renders only while the bar is visible. Core
does not stop an extension when the bar is hidden — visibility is *reported*, never
acted on (§2) — so `start()` keeps running and a key binding registered there keeps
firing. Left alone, that is a trap rather than a limit: review caught the palette
opening its store while hidden, painting nothing, and then appearing uninvited the
moment the bar came back. Hiding the bar does not turn an overlay off by itself; the
extension has to decide what "hidden" means for it. `/ext/command-menu` closes on
`subscribeVisibility(false)` and ignores its shortcut while `isVisible()` is false,
which is the behaviour the api exists to make possible. An extension whose overlay is
not modal may reasonably choose otherwise.

The other thing not to claim too broadly: the wrapper is `display: contents`, so a
*rendered* overlay adds nothing to the root's layout or to `--dev-toolbar-height`.
The error path is the exception. A throwing overlay degrades to core's error chip,
and with the wrapper out of the layout that chip becomes a flex child of the root,
which is a column — so in a real browser it lands as a row between the bar and the
panel and does add height. That is arguably the right failure (a broken extension
should be visible, not silently absent), but it is the one case where "an overlay
adds no layout" is untrue, and it is pinned by a test rather than left to be
rediscovered.

### 13.3 An extension had no way to read the aggregation

`useToolbarCommands()` is a *value* exported from core, and §7's rule is that an
extension imports only types, because a first-party subpath bundled beside the host's
copy of core is not guaranteed to resolve to the same module instance. Core had built
an aggregation that the one extension needing it could not legally reach.

So `ExtensionRuntimeApi` — the object core already hands an extension, which is how
storage and visibility reach it without an import — gained `getCommands()` and
`runCommand(id)`. The palette holds the `api` from `start()` and asks it. That also
gives the right failure semantics for free: running by `id` through core means a
command that was listed and has since gone reports *no longer available* instead of
firing a stale closure, and a `hidden` extension's commands are unreachable from the
palette for exactly the same reason they are unreachable everywhere else.

### 13.4 A reader has its own version of failing closed

`/ext/flags` (§12.4) had to keep an override honest. A palette's equivalent is that
it runs **somebody else's code, chosen by id, at a moment the user is watching**:

- **A failed run keeps the palette open** and shows the message in place. Closing
  over a failure would leave a user who pressed Enter with a command that silently
  did nothing, which is the same lie as a badge that says *overridden* over an
  application that never heard about it.
- **"Gone" and "broken" are different messages.** `runCommand` resolving `false` is a
  command that is no longer in the aggregation; a throw is a command that ran and
  failed. Collapsing them would hide a stale palette behind an apparent bug in
  somebody's command.
- **The aggregation itself is caught.** Core already contains a throwing
  `commands()`, so this is unreachable — but the palette is a reader, and a reader
  that lets a failure in what it reads escape takes the toolbar down with it.
- **Focus is restored to what had it**, on both ways out, and only if that element is
  still in the document: a command may well have unmounted whatever was focused.
- **One command runs at a time.** `Enter` repeats and a pointer lands on a row that
  is already busy, so a slow async command could be started twice concurrently while
  `aria-busy` was the only thing suggesting otherwise. The guard is on the state, not
  on the markup.

### 13.5 The hotkey parser is duplicated once, on purpose

Core's `parseShortcut`/`matchesShortcut` are values, so the palette carries its own
~50-line copy with the same semantics (`Mod` is Meta on Apple platforms and Ctrl
elsewhere, exclusively; modifiers match exactly in both directions; a shifted
punctuation key falls back to `event.code`). This is the *first* duplication. If a
second extension needs one it moves to `/runtime`, the way `ensureStyleSheet` did in
§11.2 — two is the point at which the duplication is the design, and one is not.

### 13.6 Accessibility is the design, not a pass over it

A command palette is a combobox over a listbox, and the pattern dictates the markup
rather than the other way round: focus never leaves the text field, the active row is
named by `aria-activedescendant` rather than focused, `Tab` is trapped because
`aria-modal="true"` claims it is, groups carry accessible names, and `Escape` stops
propagating so core's `···` menu does not also close underneath it. Two of these
looked fine and were not until a test forced them: asserting `document.activeElement`
after `Tab` passes in jsdom whether or not the handler exists, because jsdom
implements no sequential focus navigation — the assertion that means something is on
`defaultPrevented`; and `Enter` has to be ignored while an IME is composing, or the
palette runs a command when a Japanese or Chinese typist commits a candidate.

The searching/browsing split is an accessibility decision too. With no query the list
is grouped by extension with headings; with a query it is one flat scored list with
no headings, because a heading that a score order keeps re-splitting is noise a screen
reader has to read out. Ordering is total and deterministic in both modes — score,
then recency, then aggregation order — so the row under the cursor never moves because
an unrelated pass re-enumerated.


## 14. What P3's first extension found

`/ext/overlays` (§3G) is the first extension that paints over the application rather
than describing it in the bar. It changed the contract in **no** places, which is the
headline: the `overlay` slot added in §13.2 for a *modal* turned out to be exactly
right for a *persistent* surface, and nothing else had to move.

`CONTRACT_VERSION` stays `1`. Nothing was added, widened or corrected. A bump here
would be pure noise, and the one signal a version number carries is worth more than
the appearance of progress.

### 14.1 The `overlay` slot generalised without being touched

§13.2 justified the slot with a command palette: rendered once, never collapsed,
inside the root so it inherits the tokens, `position: fixed` reaching the viewport
because the root sets no containing block. Every one of those properties is what a
drawing surface needs too, and one of them turned out to matter more than it did for
the palette:

**`z-index: -1` inside the root is the layer an overlay wants.** The root establishes
a stacking context at `--dtb-z-index`, so a negative-z child paints *below the bar
and the panel* while the whole context still paints *above the application*. Over the
page, under the tool — with no coordination between the two, and no way for an
overlay to cover the palette (`z-index: 1`/`2` in the same context) by accident.

The slot's one limit (§13.2) also proved to be the right default rather than a
nuisance: an overlay renders only while the bar is visible, so this extension detaches
every listener and removes its stylesheet on `subscribeVisibility(false)`. Measuring
for a surface that is not rendered is waste; leaving outlines on a page whose toolbar
has just disappeared is worse than waste.

### 14.2 Drawing over an application is mostly a list of refusals

Four rules, each of which is a bug this extension could have been:

- **It never intercepts a pointer event.** The surface and every descendant are
  `pointer-events: none` **in CSS**, not in JavaScript, so it cannot be forgotten by
  a later addition, and the inspector *observes* the pointer through a passive,
  capturing `pointermove` listener plus `elementFromPoint` rather than consuming it.
  A debugging overlay that eats the button you were trying to press is the one
  failure that would make the whole feature untrustworthy — which is why that
  declaration, and three others, carry `!important`. See §14.7: putting a guard in a
  layer designed to lose was a real defect, not a stylistic one.
- **It mutates no host node.** No injected classes, no inline styles, no wrappers.
  Geometry is read with `getBoundingClientRect`, `getComputedStyle` and a
  `MutationObserver`. The test that pins this compares the application's own markup
  before, during and after — not "no obvious change", byte equality. The observer
  also ignores mutation records whose targets are all inside a toolbar, so the
  badges it draws while you scroll do not schedule rescans of their own.
- **Everything drawn is React in the `overlay` slot.** So teardown is not a procedure
  that could be got wrong; it is an unmount. A hot reload cannot leave a ghost
  because there is no imperative surface to leave behind.
- **A throw switches every overlay off.** Measurement runs inside animation frames
  and a `MutationObserver`, where nothing upstream catches it and where it recurs
  sixty times a second. Off, once, with the reason in the panel — and *not*
  persisted: one transient failure should not cost a developer the toggles they
  chose on every future load, so memory says off while storage still says what they
  picked, and a reload puts it back.

### 14.3 The one thing it does touch, and why that is the honest trade

Outlining every element is worth an entry in this document because it is the single
place the extension reaches outside its own surface: one `<style>` element in
`document.head`.

The alternative was measuring every element and drawing a box per element in our own
layer, which is thousands of rects per scroll frame on a real application — the exact
cost profile §3G warns against — to avoid one stylesheet. So the stylesheet wins, and
it is made safe by being *exactly reversible* rather than by being small:

- it is inserted through `/runtime`'s `ensureStyleSheet`, so two bundled copies still
  insert one;
- it is removed by **querying the document** for the attribute rather than by holding
  the node, so a runtime that lost its reference still cannot leave one behind;
- it is **reference-counted on the element itself** (`data-dtb-refs`), because two
  toolbars on one page — or two bundled copies of this extension — are separate
  closures that share one `document.head`. Removing it unconditionally on teardown
  meant one instance unmounting silently un-outlined another instance whose flag,
  chip and panel all still said the overlay was on. The DOM is the truth here for
  the same reason it is the truth for style deduplication (§4.4);
- removal happens on toggle-off, on the bar being hidden, on `api.signal` and on the
  returned cleanup — and the teardown path calls it unconditionally rather than
  checking a flag;
- it uses `outline`, never `border` or `box-shadow`, so it **cannot reflow** the
  layout it is describing.

It is also the one stylesheet in this package that is deliberately **unlayered**.
Everything else ships inside `@layer dev-toolbar` so that consumer CSS wins without
`!important` (§4.1); this one has the opposite job — a debugging instrument that has
to be visible over the app's own styles. It is still not `!important`, so a
sufficiently specific app rule beats it, and the panel says so rather than hiding it.

### 14.4 Choosing four of thirteen, and saying what the others cost

§3G lists thirteen overlay modes. Shipping four is a judgement, so the reasoning is
in the code (`OverlayId` in `ext/overlays/types.ts`) and the cost of each shipped one
is rendered **in the panel**, next to its switch:

| | Cost, honestly |
| --- | --- |
| Layout boxes | One stylesheet. No measurement, but a full repaint on toggle and more paint work per frame after — the only one whose cost grows with document size. |
| Column grid | Free. One gradient-painted element. |
| Element inspector | One rect and one `getComputedStyle` on **one element**, never the document, per frame in which the pointer moved, the page scrolled or the window resized. |
| Focus order | One narrow `querySelectorAll` per debounced *application* mutation burst — which is also where accessible names are resolved, once — then one rect per element per scroll frame and nothing else. Capped at 200. |

Three were left out for reasons worth recording. **Re-render and slow-commit flash**
is not observable from outside React: it needs the DevTools hook or a `Profiler` the
application renders, and installing ourselves into a host's React internals is
precisely the irreversible mutation the rest of this section is about. **Component
boundaries, token violations, feature ownership and experiment variant** all need
per-element metadata only the application can attach (§3F) — with that attached,
`boxes` is one CSS rule away, which is the argument for shipping the mechanism rather
than guessing the metadata. **Stacking contexts and scroll containers** need
`getComputedStyle` on every element in the document on every mutation, and no
question they answer is worth that before somebody asks for it.

The cost line is not documentation politeness. It is in the panel because a developer
deciding whether to leave an overlay on while they profile something needs to know
which one is charging them, and an extension that hides that is the reason people
distrust dev tooling. Review caught the first drift between line and code: the focus
overlay resolved an accessible name **per element per scroll frame** — a subtree text
walk and a `getElementById`, up to two hundred times a frame — while its cost line
claimed one rect per badge. Names now resolve at scan time. The rule that falls out:
when the line and the code disagree, the code moves first, and the line moves too.

Caching them moved a correctness burden onto the observer, which is worth stating
because the follow-up review found it there. The safe claim is **not** "a name cannot
change without a DOM mutation" — that is true and useless. It is "every mutation that
can change a name is observed", which was false as configured: React updates
`<button>{label}</button>` by writing `nodeValue` on the existing Text node, a
`characterData` record the observer had not asked for. Before the cache, that
self-healed on the next scroll frame; with it, an emptied button label left a badge
claiming the control was named, indefinitely. The observer now watches
`characterData` as well as `childList` and one list of attributes that deliberately
merges *what makes an element tabbable* with *what gives it a name* — those two sets
together are the whole definition of "a record that could change what is drawn", and
keeping them apart is how one of them falls behind. A cache is only ever as honest as
its invalidation, and the invalidation is the thing to review.

One §3G recommendation is knowingly unimplemented — *disable overlays before
screenshots unless requested*. There is no capture facility in this package to hook,
and inventing one to satisfy the line would be worse than leaving it; `disableAll()`
and its command are the manual equivalent, and a future capture feature should call
it.

### 14.5 A name-checker has to be honest about being a heuristic

The focus overlay flags controls with no accessible name, which means it computes
one. The full `accname` algorithm is long and needs the whole tree; this implements
the branches that actually produce unnamed controls in application code, in the
spec's priority order, and says so in the panel.

One case is not optional, though, and it is the reason the check earns its place: an
icon-only button is usually `<button><span aria-hidden="true">×</span></button>`, and
`textContent` on that returns `×`. A name check built on `textContent` therefore
calls the single most common unnamed control *named* — the opposite of the truth,
about the exact case the overlay exists to catch. So the text walk skips
`aria-hidden` and `hidden` subtrees the way `accname` does.

The same honesty applies to the numbering: positive `tabindex` jumps the queue, so
the badges do too, and a badge shows the `tabindex` that moved it. An overlay that
numbered elements in document order would be describing a tab sequence the user does
not have.

The same reasoning removed `aria-disabled` from the scan's exclusions. It is a
promise to assistive technology, not a change to focus behaviour — an `aria-disabled`
button is still a real `Tab` stop — so skipping it described a sequence with missing
stops, which is the same error in the other direction. The `disabled` *attribute* is
still excluded, but only on the elements where it actually removes tabbability, and
so is everything inside a disabled `<fieldset>` — with the spec's one exception,
controls in the fieldset's first `<legend>`, which stay tabbable so a switched-off
section can be switched back on.

### 14.6 What the browser found that jsdom could not

Two things, in the same spirit as §10.6.

**`document.elementFromPoint` does not exist in jsdom at all.** The inspector's first
version called it unguarded, which in a browser is fine and in a test environment
turns a platform difference into "every overlay switched itself off". Reading no
element is the correct answer where there is no layout; throwing is not.

**An occluded tab produces no animation frames.** Everything driven by
`requestAnimationFrame` — the inspector and the focus badges — simply stops when the
tab is not being painted, and resumes when it is. That is the correct behaviour and
it costs nothing, but it makes browser verification misleading unless a frame is
forced between changing something and reading it back. Worth knowing before
concluding that an overlay is broken.

### 14.7 A guard does not belong in a layer designed to lose

The defect review found, and the one worth remembering, is that this extension put a
**safety** rule in the cascade layer §4.1 built to be overridable.

`@layer dev-toolbar` exists so that a consumer can restyle the bar from their own
stylesheet without `!important`: unlayered author declarations beat layered ones at
any specificity. That is exactly right for colour, spacing and type — and exactly
wrong for `pointer-events: none` on a surface that covers the viewport. A single
unlayered `div { pointer-events: auto }`, specificity (0,0,1), the kind of rule that
appears in resets and drag-and-drop libraries, re-enabled pointer events on the
overlay and turned it into a click trap over the whole page. `z-index: -1` had the
same exposure: `div { z-index: 0 }` would have lifted the surface to bar level.

Four declarations — `pointer-events` (on the surface and on every descendant),
`z-index`, `position` and `inset` — now carry `!important`. That is sufficient in
both directions, because the cascade reverses layer order for important
declarations: author-important beats every unlayered normal declaration, and a
*layered* important declaration beats an unlayered important one. Everything else in
the extension's stylesheet stays layered and overridable, which keeps the intent
legible: the things you may restyle, and the two or three that are load-bearing.

The generalisation for anyone writing an extension for this shell:

> Layered CSS is a promise that the consumer wins. Do not make that promise about a
> declaration whose failure mode is swallowing the user's clicks.

There is a second lesson underneath it, about the test. The original test asserted
the *text* of the stylesheet with a regular expression, and it passed happily while
the guarantee was defeated by one line of app CSS. A rule that is only ever compared
to itself is not tested. Its replacement injects a hostile rule and reads
`getComputedStyle` off the real surface, so it fails if the cascade — not the string
— stops behaving. It fails against the pre-fix stylesheet, which is the only way to
know a regression test regresses.
