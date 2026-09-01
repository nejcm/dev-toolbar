# Architecture — the `@nejcm/dev-toolbar` shell

This is the reference for the shipped core: what the shell guarantees, where its
boundaries are and why they sit there, the full styling surface, and how to write
an extension against it.

`plans/dev-bar.md` is the product design. `plans/implementation.md` is the accepted
delivery plan. This document describes what the code actually does.

- Contract version: **1** (`CONTRACT_VERSION`)
- Entries: `@nejcm/dev-toolbar` (root), `/runtime`, `/ext/metrics`, `/testing`,
  `/styles.css`
- Runtime dependencies: **none**

P1 built `/ext/metrics` strictly as an outside consumer of this contract, which was
the point of building it. It moved the contract in four places; all four are marked
**P1** below and collected in [§10](#10-what-p1-changed-and-why). `CONTRACT_VERSION`
stays `1`: every change is additive or a semantic correction, and version 1 has never
been published, so there is nothing in the wild to break.

## 1. What the shell is

The root entry is chrome plus hosting, and nothing else. It:

- renders a fixed bar at the top or bottom of the viewport, in a portal on
  `document.body`;
- sorts the extensions it is given by `align`, then `order`;
- collapses the lowest-`priority` items into a `···` menu when the bar runs out of
  width, and lets them back out when the width returns;
- hosts at most one panel at a time, resizable and persisted;
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
3. It renders `compact` (in the bar or in the `···` menu) and, when its panel is
   active, `panel`.
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
that ships CSS therefore needs its own switch — `metrics({ injectStyles: false })` —
and should export its stylesheet as a string for consumers who deliver CSS
themselves. Threading core's flag down would mean extensions importing core's React
context at runtime, which only works if both resolve to the same module instance; see
§7.

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
| Metrics, flags, environment, overlays, diagnostics, theme editor | `./ext/*` (P1–P4) |
| A command palette UI | `./ext/command-menu` (P2) |
| Severity thresholds | The extension that owns the metric |
| Access control | The consumer, before rendering `<DevToolbar>` at all |
| A global extension registry | Nowhere. See §2. |


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
