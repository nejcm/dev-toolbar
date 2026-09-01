# Architecture — the `@nejcm/dev-toolbar` shell

This is the reference for the shipped core: what the shell guarantees, where its
boundaries are and why they sit there, the full styling surface, and how to write
an extension against it.

`plans/dev-bar.md` is the product design. `plans/implementation.md` is the accepted
delivery plan. This document describes what the code actually does.

- Contract version: **1** (`CONTRACT_VERSION`)
- Entry: `@nejcm/dev-toolbar` (root), `@nejcm/dev-toolbar/testing`, `@nejcm/dev-toolbar/styles.css`
- Runtime dependencies: **none**

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
   de-duplicated by `id`).
2. `start(api)` runs once. Its return value, if a function, is the cleanup.
3. It renders `compact` (in the bar or in the `···` menu) and, when its panel is
   active, `panel`.
4. When it leaves the list, `enabled` flips to `false`, or the toolbar unmounts:
   `api.signal` aborts, then the cleanup runs.

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
| `--dtb-danger` | `#c0392b` | Error chip text |
| `--dtb-danger-bg` | `rgba(192,57,43,.12)` | Error chip background |
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
    compact: ({ isOverflowed, isPanelOpen, openPanel, closePanel }) => (
      <button
        type="button"
        data-dtb-part="trigger"
        aria-expanded={isPanelOpen}
        onClick={() => (isPanelOpen ? closePanel() : openPanel())}
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
  `start()`, or in a component the slot returns.
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
