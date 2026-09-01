# @nejcm/dev-toolbar

An extensible, low-overhead in-app developer toolbar for React — a bottom bar that
hosts *your* tools.

The package is a **shell**: chrome plus hosting. It renders a fixed bar, sorts and
collapses the items you give it, hosts one panel at a time, persists your preferences
and isolates failures. It ships no metrics, no flag adapters and no opinions about
what a number means — those are extensions, and the first-party ones arrive on their
own subpath exports.

- Zero runtime dependencies
- Light DOM, so Tailwind and CSS-in-JS work inside extensions
- Restyleable from your own CSS without `!important`
- SSR-safe: your app server-renders untouched, the bar is client-only

Subpaths, each opt-in and each with its own bundle:

| Entry | What it is |
| --- | --- |
| `@nejcm/dev-toolbar` | The shell. Chrome plus hosting. |
| `@nejcm/dev-toolbar/runtime` | Event bus, ring buffers, throttled store, `redact()`. For extensions that measure. Core never imports it. |
| `@nejcm/dev-toolbar/ext/metrics` | Memory, delay, jank and network, as one extension. |
| `@nejcm/dev-toolbar/ext/environment` | Environment, build and actor context — all of it supplied by you, all of it redacted. |
| `@nejcm/dev-toolbar/ext/flags` | Feature-flag list, local overrides and the promoted flag. The flags stay yours. |
| `@nejcm/dev-toolbar/ext/command-menu` | `⌘K` palette over the commands core aggregates. Replaceable with your own. |
| `@nejcm/dev-toolbar/testing` | `renderWithToolbar`, fake extensions, mock bus, fake layout. |
| `@nejcm/dev-toolbar/styles.css` | The stylesheet, if you would rather not inject it at runtime. |

> **Status:** the shell (P0), `/runtime` and `/ext/metrics` (P1) are implemented, and
> `/ext/environment`, `/ext/flags` and `/ext/command-menu` complete P2. The contract
> has been through four real consumers — the first moved it in four places, all listed
> in the [changelog](./CHANGELOG.md); the second did not move it at all; the third
> found one gap, in `commands`; the fourth closed that gap and added the `overlay`
> slot ([plans/architecture.md §13](./plans/architecture.md)). Every change so far is
> additive, so `CONTRACT_VERSION` is still `1`. `0.1.0` is the first publish.

## Install

```bash
npm install @nejcm/dev-toolbar
```

React 18 or 19 as a peer. `@testing-library/react` is an optional peer, needed only
by `@nejcm/dev-toolbar/testing`.

## Use

```tsx
import { DevToolbar } from "@nejcm/dev-toolbar";

export function Root() {
  return (
    <DevToolbar extensions={[env, flags]}>
      <App />
    </DevToolbar>
  );
}
```

It reads like wrapping, but it isn't: `children` render in a fragment, untouched. The
bar portals to `document.body` and is `position: fixed`, so an app that owns its own
`100vh` layout keeps it. If you would rather pad your content out of the way, opt in:

```tsx
import { DevToolbarInset } from "@nejcm/dev-toolbar";

<DevToolbarInset>
  <App />
</DevToolbarInset>;
```

The shell also publishes `--dev-toolbar-height` on `<html>` — the whole toolbar, bar
*plus* any open panel — so you can inset by hand:

```css
.my-layout { padding-bottom: var(--dev-toolbar-height, 0px); }
```

### Props

| Prop | Default | Notes |
| --- | --- | --- |
| `extensions` | `[]` | Source of truth for the item list |
| `enabled` | `true` | `false` renders children only — no portal, no lifecycle |
| `instanceId` | `"default"` | Namespaces persisted preferences. **Mount-time only** |
| `storage` | `localStorage` | Adapter, or `null` to disable. **Mount-time only** |
| `density` | `"compact"` | `"compact" \| "comfortable"` |
| `colorScheme` | `"system"` | `"light" \| "dark" \| "system"` |
| `defaultVisible` / `defaultPosition` / `defaultPanelHeight` | — | Used only when nothing is persisted yet |
| `shortcut` | `"Mod+Shift+."` | `null` disables it |
| `injectStyles` | `true` | `false` → import `@nejcm/dev-toolbar/styles.css` yourself |
| `classNames` | — | Per-part class map |
| `container` | `document.body` | Portal target |

`instanceId` and `storage` are read **once, on mount**, so the store and everything
derived from it can never disagree about where preferences live. Changing either
prop later is ignored; remount the toolbar (`key={instanceId}`) to move it.

### Toggle shortcut

The default is `Mod+Shift+.` — and `Mod` is **exclusive**, not "either modifier":

- **macOS: `Cmd+Shift+.` only.** `Ctrl+Shift+.` does nothing there.
- Everywhere else: `Ctrl+Shift+.`.

Pass your own (`shortcut="Ctrl+Alt+D"`) or `shortcut={null}` to disable. Matching is
by `key` or by physical `code`, so a shifted punctuation key works on any layout.

## The extension contract

An extension is a plain object.

```ts
interface DevToolbarExtension {
  id: string;                    // identity: dedupe, panel state, storage scope
  label: string;
  contractVersion?: number;      // core warns once on a mismatch
  align?: "start" | "end";       // default "start"
  order?: number;                // ascending, within the region
  priority?: number;             // lowest collapses into ··· first
  hidden?: boolean;              // you compute this — core has no ctx
  keepMounted?: boolean;         // panel state survives closing
  compact?: (props: CompactSlotProps) => React.ReactNode;
  panel?: (props: PanelSlotProps) => React.ReactNode;
  overlay?: (props: OverlaySlotProps) => React.ReactNode;   // modal; never collapsed
  // Core aggregates; it renders no palette. A function is re-enumerated on
  // every pass, so a command that only exists later is still reachable.
  commands?: ToolbarCommand[] | (() => ToolbarCommand[]);
  start?(api: ExtensionRuntimeApi): void | (() => void);
}
```

`compact` and `panel` are render *functions*, not components, so core can hand down
state you cannot otherwise know:

```ts
interface CompactSlotProps {
  isOverflowed: boolean;         // rendered in the ··· menu rather than the bar
  isPanelOpen: boolean;
  density: "compact" | "comfortable";
  openPanel(): void;
  closePanel(): void;
  togglePanel(): void;           // the one every trigger actually wants
}

interface PanelSlotProps {
  isActive: boolean;             // false only for keepMounted panels
  density: "compact" | "comfortable";
  height: number;
  close(): void;
}

interface OverlaySlotProps {
  density: "compact" | "comfortable";
  position: "bottom" | "top";
}
```

`overlay` is for a surface the bar cannot host — a dialog, a picker. It renders once,
inside the toolbar root, for as long as you are present, not hidden and the bar is
visible, and **overflow never collapses it**: a compact item that has collapsed into
the `···` menu is not in the DOM at all, which would cost an extension its modal (and
its key binding) exactly when the window got narrow. Most overlays render `null` most
of the time. `/ext/command-menu` is the worked example.

Core keeps *reporting* visibility rather than acting on it, so `start()` keeps running
while the bar is hidden even though your overlay is not rendered. If yours is modal,
close it on `api.subscribeVisibility(false)` and gate any key binding on
`api.isVisible()` — otherwise it reappears, unasked, when the bar comes back.

`start(api)` runs once per mount, for background work:

```ts
interface ExtensionRuntimeApi {
  signal: AbortSignal;                                  // aborts on teardown
  isVisible(): boolean;
  subscribeVisibility(cb: (visible: boolean) => void): () => void;
  storage: ToolbarStorage;                              // scoped to this extension
  getCommands(): readonly ToolbarCommand[];             // the live aggregation
  runCommand(id: string): Promise<boolean>;             // false = nothing declares it
}
```

`getCommands()` / `runCommand()` are how an extension reads the aggregation without
importing a *value* from core — `useToolbarCommands()` is for the host application.
Both re-enumerate on call, so they are never behind.

Core **reports** visibility and never pauses you on your own behalf — a cumulative
counter that silently stops counting is worse than one that keeps going.

Two lifecycle rules the metrics extension paid for, so you do not have to:

- **`hidden` is not "unpainted", it is "does not exist here".** A hidden extension is
  never `start()`ed and is torn down if it becomes hidden; its panel is unmounted and
  closed; and it contributes no commands, so `runCommand()` and P2's palette cannot
  reach it either. Anything less and hiding a collector would leave `fetch` patched,
  its request table on screen, and a copy-to-clipboard command one keystroke away for
  a user not allowed to see any of it. To merely collapse an item out of sight, use
  `priority`.
- **Build your extension once, at module scope.** The object identity *is* the
  lifecycle: `start()` belongs to the object core first saw, so rebuilding it inside
  render leaves the bar rendering a second object that owns nothing. Core warns once
  per id when it detects this. A hot-module reload of the module that builds your
  extensions does the same thing; reload the page.

A minimal one:

```tsx
const build: DevToolbarExtension = {
  id: "build-info",
  label: "Build",
  align: "end",
  priority: 90,
  compact: ({ openPanel }) => (
    <button type="button" data-dtb-part="trigger" onClick={openPanel}>
      {import.meta.env.VITE_COMMIT?.slice(0, 7) ?? "dev"}
    </button>
  ),
  panel: () => <BuildDetails />,
};
```

For subtree-scoped tools, register from inside the tree instead:

```tsx
const { register } = useDevToolbar();
useEffect(() => register(routeTool), [register]);
```

There is no global registry — it would break SSR, break two toolbars on one page,
and leak between tests.

A slot that throws degrades to an error chip. The bar and every other extension keep
working.

Full authoring guide, with a worked example:
[plans/architecture.md](./plans/architecture.md#7-writing-an-extension).

## `@nejcm/dev-toolbar/runtime`

Opt-in machinery for extensions that measure something over time. Core never imports
it, so a toolbar that is three buttons never pays for it. Nothing in it imports React
either, so a collector can run in a worker.

```ts
import {
  createEventBus,
  createRingBuffer,
  createNumericRing,
  createTimeSeries,
  createThrottledStore,
  redact,
  redactUrl,
  redactHeaders,
} from "@nejcm/dev-toolbar/runtime";
```

- **`createEventBus<Events>()`** — typed pub/sub, one per instance (never a
  singleton). `on(type, handler, { signal })` unsubscribes on the `AbortSignal`
  `start(api)` already gave you. A throwing handler is contained, not propagated into
  whatever emitted.
- **`createRingBuffer<T>(n)` / `createNumericRing(n)` / `createTimeSeries(n)`** —
  bounded and *allocation-stable*: storage is allocated once, `push` writes into a
  slot that already exists, and every read that could allocate takes a caller-owned
  destination. `createNumericRing` is a `Float64Array` underneath; that is what the
  sparklines read.
- **`createThrottledStore(initial, { intervalMs })`** — accepts every write,
  publishes at most once per interval, leading edge first and trailing edge after.
  `getSnapshot` stays stable between notifications, which is what
  `useSyncExternalStore` requires. A 60 Hz sampler becomes a 4 Hz re-render.
- **`redact(value)` / `redactUrl(url)` / `redactHeaders(headers)`** — masks
  credentials by key name, plus `Bearer …`, bare JWTs, and URL values carrying a
  sensitive parameter (the OAuth-callback shape, where the secret is in the value and
  no key matching will find it). A URL with nothing to mask is returned unchanged, so
  two dumps that are identical still diff as identical. This is hygiene for anything
  headed to a screenshot or a clipboard, **not** a security boundary: it matches
  names, so a secret under `data` survives.
- **`ensureStyleSheet(entry, css)`** — injects a stylesheet once per document, keyed
  on a `style[data-dev-toolbar-styles]` element rather than a module flag, so two
  bundled copies of your package still inject once. Core's `injectStyles` is a prop
  and extensions cannot see it, so an extension that ships CSS needs its own switch
  and its own injector; this is the injector.

## `@nejcm/dev-toolbar/ext/metrics`

Memory, delay, jank and network in one extension.

```tsx
import { DevToolbar } from "@nejcm/dev-toolbar";
import { metrics } from "@nejcm/dev-toolbar/ext/metrics";

// Once, at module scope. Not inside render.
const extensions = [metrics()];

export function Root({ children }) {
  return <DevToolbar extensions={extensions}>{children}</DevToolbar>;
}
```

| Chip | Shows | Thresholds (default, all configurable) |
| --- | --- | --- |
| `mem` | Used JS heap, and whether it has climbed on every sample for a minute | 50% / 75% of the heap limit |
| `delay` | The *worst* interaction in a rolling 30 s window, not the latest | 200 ms / 500 ms, per INP guidance |
| `jank` | Dropped frames over expected frames, across 5 s of *active* frames | 2% / 5% |
| `net` | Requests in flight; the panel lists recent ones | any slow → warn, any failed → bad |

Every one degrades on its own. `performance.memory` is Chromium-only, Event Timing is
not everywhere, and `requestAnimationFrame` may not exist at all: each missing API
turns its chip into `NA` with a sentence in the panel saying why. None of them throws,
and one missing API never breaks the others.

```ts
metrics({
  only: ["memory", "network"],       // which collectors run, in bar order
  updateHz: 2,                       // aggregation rate; §5 caps compact at 4 Hz
  memory: { thresholds: { warn: 0.4, bad: 0.7 } },
  jank: false,                       // switch one off entirely
  network: { slowMs: 400, filter: ({ url }) => !url.startsWith("/telemetry") },
});
```

**Instrument your own client instead of being patched.** By default the network
collector wraps `fetch` and `XMLHttpRequest` — once globally, feeding every live
collector, and restoring the originals when the last one leaves. If you would rather
report from your own HTTP client, hand it a bus:

```ts
import { createEventBus } from "@nejcm/dev-toolbar/runtime";
import type { ToolbarEventMap } from "@nejcm/dev-toolbar/runtime";

export const bus = createEventBus<ToolbarEventMap>();

const extensions = [
  metrics({ network: { bus, patchFetch: false, patchXhr: false } }),
];

// then, from your client:
bus.emit("network-start", { requestId, method, url });
bus.emit("network-end", { requestId, ok, status, duration, bytes });
```

URLs are run through `redactUrl()` before they are retained, and headers and bodies
are never read at all. "Copy diagnostic data" passes the whole dump through
`redact()` on the way to the clipboard.

The extension ships its own stylesheet, injected once per document. If you set
`injectStyles={false}` on `<DevToolbar>`, set `metrics({ injectStyles: false })` too
and deliver `METRICS_CSS` yourself — core's flag is a prop, and extensions cannot see
props.

## `@nejcm/dev-toolbar/ext/environment`

Which environment am I in, what is deployed, and who am I acting as — the context
block from `plans/dev-bar.md` §3B.

**Everything it shows is supplied by you.** Core has no `ctx`, this extension invents
none, it reads no `process.env` and looks for no global. Supply nothing and the chip
says `unknown` — not `local`, and nothing guessed from the hostname.

```tsx
import { environment } from "@nejcm/dev-toolbar/ext/environment";

// Once, at module scope. Not inside render.
const extensions = [
  environment({
    context: {
      environment: "production",        // local | preview | staging | production | your own
      release: __RELEASE__,
      commit: __COMMIT__,
      branch: __BRANCH__,
      deployment: process.env.VERCEL_DEPLOYMENT_ID,
      region: "ap-southeast-1",
      apiEndpoint: API_BASE,
      builtAt: __BUILT_AT__,            // ISO string, epoch ms or a Date
      userId: user.id,
      workspaceId: workspace.id,
      internal: user.isStaff,
      impersonating: session.impersonating,   // true, or { actor, subject }
      roles: user.roles,
      syncStatus: connection.state,
      extra: { tenantTier: plan },      // anything else worth a row
    },
  }),
];
```

Pass a **function** instead of an object for anything that changes — a sync status, a
switched workspace — and it is re-read every `pollMs` (default 4 s), plus on
`online`/`offline`, `resize`, `popstate` and `hashchange`. The same timer runs
whenever `detect` is on even with a static object, because `history.pushState` — how
every SPA router navigates — fires no event anyone can listen for, and the Route row
would otherwise be stale indefinitely.

The compact slot is a dot and the environment name; production is red on purpose, and
an active impersonation says so in the bar. The panel is the detail table, with three
rows the browser answers for itself — route, viewport, connection — tagged `detected`
so they are never read as something the deployment asserted. A field nobody supplied
says *not supplied* rather than being quietly absent.

### What it does with your data

Session context is the most sensitive thing a toolbar puts on a screen, so:

- every value goes through [`redact()`](#nejcmdev-toolbarruntime) on the way *in*, and
  email addresses are masked on top of it (`n***@example.com`). The panel, "Copy
  summary", "Copy JSON" and the aggregated commands all read that same redacted
  snapshot — there is no path that reaches the raw context;
- the masking is **visible**: a masked row is tagged `masked`, and the count sits next
  to the copy buttons. A redaction nobody can see is indistinguishable from a value
  that was never supplied;
- `fields: ["environment", "release"]` is an allowlist for a restricted view —
  everything else is *dropped*, not hidden, and that includes `extra` entries, which
  are named `extra:<key>`. For an actor who should not see the extension at all,
  leave it out of the `extensions` array (§6 of the design is guidance for you, not
  something core enforces);
- structured `extra` values are redacted **as objects** and serialised afterwards, so
  a credential nested inside one (`extra: { user: { authToken } }`) is masked like a
  top-level one. `redact()` matches key names by walking a graph; handing it a JSON
  string instead would hide every inner key from it.

```ts
environment({
  context: () => ({ environment: "staging", syncStatus: connection.state }),
  pollMs: 2000,
  fields: ["environment", "release", "extra:tier"],  // restricted view
  detect: false,                                 // no route/viewport/connection
  maskPii: false,                                // stop masking email addresses
  redactOptions: { extraKeys: ["tenantcode"] },  // mask more key names
});
```

Commands aggregated into `useToolbarCommands()`: `environment.copy`,
`environment.copyJson`, `environment.refresh`. Like `/ext/metrics`, it ships its own
stylesheet — pair `injectStyles={false}` on `<DevToolbar>` with
`environment({ injectStyles: false })` and deliver `ENVIRONMENT_CSS` yourself.

## `@nejcm/dev-toolbar/ext/flags`

Feature-flag controls — `plans/dev-bar.md` §3C — including §7's promoted flag.

**The flags are yours.** This extension owns no flag store, integrates no provider
and reaches for no global. You hand it what your application resolved and, if you
want the panel to do more than read, a typed adapter it calls when somebody asks for
a local override.

```tsx
import { flags } from "@nejcm/dev-toolbar/ext/flags";

// Once, at module scope. Not inside render.
const extensions = [
  flags({
    flags: () =>
      catalogue.map((definition) => ({
        ...definition,                  // key, label, type, defaultValue, owner…
        value: base[definition.key],    // BEFORE local overrides — see below
        source: "server-rule",
      })),
    onOverride: (key, value) => {
      // `value === undefined` means "no local override any more".
      if (value === undefined) delete overrides[key];
      else overrides[key] = value;
      republish();
    },
    promoted: { flagKey: "ui-facelift", label: "UI Facelift 2026", icon: "◈" },
  }),
];
```

Your app then reads `overrides[key] ?? base[key]`, which is §3C's precedence table.
Keeping the two maps apart is the whole integration contract: the extension needs
the value *before* the override to be able to show both. If you do fold them into
one store nothing breaks — the override badge comes from the extension's own map,
never from comparing values.

**Omit `onOverride` and the panel is read-only**: it lists, searches and copies, and
changes nothing. That is the honest answer for a consumer with nowhere to put an
override.

Each row shows the effective value, **the application's own value** and the default
side by side, plus the evaluation source, the owner, an expiry and a project link.
Booleans get a switch, variants a `<select>`, strings and numbers an input (Enter or
blur commits). Per-flag `clear`, one **Clear all overrides** button, and a *Copy
recipe* for sharing.

### It changes what your app does

Everything else in this package observes. This one mutates, and the mutation
outlives the tab — so:

- **Overrides persist** under `dtb:v1:<instanceId>:ext:<id>:overrides` and are
  re-applied through your adapter on the next mount. That happens in an effect, so
  the first paint after a reload is un-overridden. Seed your own store earlier if
  that matters:

  ```ts
  import { readStoredOverrides } from "@nejcm/dev-toolbar/ext/flags";
  const overrides = readStoredOverrides({ instanceId: "app" });
  ```

- **`?dtb-flags=reset` is the kill switch.** Loading any page with it drops every
  stored override *before* any of them is applied — the override that breaks the app
  is the one you cannot reach the panel to remove. `=clear` and `=off` do the same
  thing. `readStoredOverrides()` honours it too. `resetParam: null` disables it,
  `resetParam: "my-flags"` renames it.
- **A renamed flag does not leave a ghost.** An override whose key is no longer in
  your catalogue is still being applied to your app, so it still gets a row — tagged
  *no longer in the catalogue*, counted, and clearable.
- **Reload behaviour is per flag.** `reloadBehavior: "full-reload"` on a definition
  means an override on it is labelled *reload required*, with a reload button.
- **A throwing adapter is shown, not swallowed, per flag.** The failing row is
  tagged *override not applied* and keeps that tag until that same flag applies
  successfully — a later success on a different flag does not clear it. The bar
  stays up.
- **Bad input is refused, not coerced.** Typing something that is not a value of the
  flag's type marks the row and applies nothing.

### What it does with your data

Flag keys and values reach a clipboard, so the `/ext/environment` rule applies:
every value goes through [`redact()`](#nejcmdev-toolbarruntime) on the way *in*,
once, and the panel, *Copy recipe* and the copy commands read the same redacted
snapshot. Each value is redacted under its own flag key, so `checkout.apiToken`
masks by key and an innocent key holding `Bearer …` masks by value; booleans and
numbers are left readable, since they cannot carry a credential. `sensitive: true`
on a definition masks it whatever it looks like. A masked value never round-trips
through the editor — the input takes a new value instead.

Commands aggregated into `useToolbarCommands()`: one `flags.toggle.<key>` per
boolean flag — re-enumerated on every aggregation pass, so a flag that appears after
mount gets its command as soon as the extension's next poll sees it, with no reload —
plus `flags.clearOverrides`, `flags.copyRecipe`,
`flags.copyJson` and `flags.refresh`. Like the other extensions it ships its own
stylesheet — pair `injectStyles={false}` on `<DevToolbar>` with
`flags({ injectStyles: false })` and deliver `FLAGS_CSS` yourself.

## `@nejcm/dev-toolbar/ext/command-menu`

The palette over the commands core has been aggregating all along. It contributes
none of its own — it is the only extension here that reads instead of adding.

```tsx
import { commandMenu } from "@nejcm/dev-toolbar/ext/command-menu";

// Once, at module scope. Not inside render.
const extensions = [commandMenu(), flags({ … }), metrics()];
```

`Mod+K` opens it; type to filter; `↑`/`↓` move, `↵` runs, `esc` dismisses. With no
query it browses — recently run commands first, then everything else grouped by
extension; with a query it is one flat list ordered by match quality. Options:
`shortcut` (`null` binds no key), `placeholder`, `emptyMessage`, `rememberRecent`,
plus the usual `id` / `label` / `align` / `order` / `priority` / `hidden` /
`injectStyles`.

Four things worth knowing:

- **It re-enumerates every time it opens.** `commands` may be a function, so an
  extension can begin contributing one after mount. The palette asks again rather
  than rendering a list it captured.
- **It runs by `id`, through core.** A command that was listed and has since gone
  says *no longer available* instead of firing a stale closure, and a `hidden`
  extension is as unreachable here as everywhere else.
- **A failing command keeps the palette open** and shows the message where you can
  read it. It is running your code; the throw never reaches your app.
- **It lives in the `overlay` slot, not a panel.** A panel would evict whatever you
  opened the palette to act on, and a collapsed compact item would take the shortcut
  with it. The bar chip is a convenience — the key binding is bound in `start()`.
  Hiding the toolbar (`Mod+Shift+.`) dismisses an open palette and disables the
  shortcut until the bar is back.

Replacing it with your team's own `cmdk` is one line: leave it out and write your own
over `useToolbarCommands()` (stable snapshot) or `useDevToolbar().getCommands()`
(re-enumerates now). That is what core aggregating and rendering nothing is for.

## Styling

**1. `--dtb-*` tokens.** Set them anywhere above the bar:

```css
[data-dev-toolbar] {
  --dtb-bg: #120b1f;
  --dtb-fg: #f4e9ff;
  --dtb-accent: #ff7ac6;
  --dtb-bar-height: 40px;
}
```

**2. `data-dtb-part` attributes.** Every part carries one — `root`, `bar`, `region`,
`item`, `trigger`, `overflow-button`, `overflow-menu`, `overflow-menu-item`,
`overlay`, `panel`, `panel-resizer`, `panel-body`, `error-chip`, `inset`.

Core owns the unprefixed names. An extension that ships its own CSS namespaces its
parts *by kind* — `/ext/metrics` uses `metrics-chip`, `metrics-panel` and so on for
every instance, whatever `id` you give it, so one rule styles them all. To reach a
single instance, use the `data-dtb-ext-id` on the surrounding item. Severity colours
come from `--dtb-ok`, `--dtb-warn` and `--dtb-danger`, so overriding one token
restyles every extension's severity at once.

**3. `classNames`.** A narrow map for putting your own class on a part:

```tsx
<DevToolbar classNames={{ bar: "my-bar", panel: "my-panel" }} extensions={…} />
```

None of it needs `!important`. Core's stylesheet lives entirely inside
`@layer dev-toolbar`, and unlayered author CSS beats any layered rule regardless of
specificity — a one-class selector of yours overrides core's two-attribute selector.

Because the bar is light DOM, an extension can also just use Tailwind, styled
components, or your design system, and it renders the way it does everywhere else.

The full token table is in
[plans/architecture.md](./plans/architecture.md#4-style-api).

## Keeping it out of production

No build magic, no bundler plugin. Two documented recipes; pick one.

**Runtime flag** — the toolbar renders nothing, but its code is still in the bundle:

```tsx
<DevToolbar enabled={process.env.NODE_ENV !== "production"} extensions={…}>
  <App />
</DevToolbar>
```

**Lazy import** — the code is dropped from the production bundle by the dead-code
elimination every bundler already does, because the dynamic `import()` sits behind a
condition that statically folds to `false`:

```tsx
import { lazy, Suspense } from "react";

const Toolbar =
  process.env.NODE_ENV === "production"
    ? null
    : lazy(() => import("./DevTools"));   // ./DevTools imports @nejcm/dev-toolbar

export function Root() {
  return (
    <>
      <App />
      {Toolbar ? (
        <Suspense fallback={null}>
          <Toolbar />
        </Suspense>
      ) : null}
    </>
  );
}
```

Keeping the toolbar in production is a legitimate choice too — it is what makes an
internal tool useful on staging and for support. If you do, gate it on your own
authorization, before rendering `<DevToolbar>` at all: core has no identity and no
session, so any check inside it would be theatre.

## SSR

Safe by construction. `children` server-render untouched; the bar is client-only and
never appears in server HTML, so there is nothing to hydrate and nothing to mismatch.
`<DevToolbarInset>` holds its defaults until the client has mounted, so the first
client render always agrees with the server.

Built entries carry a `"use client"` banner, so an app-router page can import them
from a server component without adding a directive.

Persisted preferences (visibility, position, active panel, panel height) are read on
the client only. If you inject your own `storage` adapter on the server, make it a
no-op — or pass `storage={null}`.

## Testing extensions

`renderWithToolbar` needs `@testing-library/react`, an **optional** peer — nothing
else on the subpath does, and nothing imports it statically, so
`@nejcm/dev-toolbar/testing` imports cleanly without it. Calling
`renderWithToolbar()` without it throws a message telling you what to install.

```bash
npm install --save-dev @testing-library/react
```

```tsx
import { makeExtension, renderWithToolbar } from "@nejcm/dev-toolbar/testing";

const { toolbar, unmount } = renderWithToolbar(<App />, {
  extensions: [myExtension],
  layout: { barWidth: 600, itemWidth: 80 },   // jsdom reports every box as 0×0
});

toolbar.openPanel("my-extension");
expect(toolbar.panel("my-extension")).not.toBeNull();

toolbar.resize(160);
expect(toolbar.overflowedIds()).toContain("my-extension");
unmount();
```

`overflowedIds()` and `isOverflowed()` answer *whether* an item collapsed and work
with the `···` menu closed. A collapsed item is not rendered at all until the menu
opens, so `item(id)` returns `null` for one until you call `toolbar.openOverflow()`.

`@nejcm/dev-toolbar/testing` also ships `makeExtension()` for throwaway extensions
(including deliberately broken ones), `createMockBus()` for a pub/sub bus with a
hand-cranked clock, and `installToolbarLayout()` if you would rather drive the fake
layout yourself. Storage defaults to a fresh in-memory adapter, so tests never leak
preferences into each other.

One caveat on the fake layout: it patches `HTMLElement.prototype.offsetWidth` and
`clientWidth` globally for the duration of the test, so it will fight a test that
stubs those for its own components — `unmount()` restores them, and
`installToolbarLayout().restore()` does the same when you drive it yourself.

**Jest.** Inside Jest's sandbox a dynamic `import()` never settles, so Testing Library
is loaded through the runner's own `require` instead — which returns the copy already
in Jest's registry, not a second one. It works out of the box; no configuration.

If a runner defeats both paths, hand the module over yourself, in the form that runner
supports:

```js
// Jest / CommonJS — put this in your setupFilesAfterEnv file
const { setTestingLibrary } = require("@nejcm/dev-toolbar/testing");
setTestingLibrary(require("@testing-library/react"));
```

```ts
// ESM
import { setTestingLibrary } from "@nejcm/dev-toolbar/testing";
setTestingLibrary(await import("@testing-library/react"));
```

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

### Playground

`examples/playground` is a Vite app that links the package with `file:../..`. It is
not published (it is outside `files`) and its build output is gitignored. It exists
for the manual checks unit tests cannot make: overlay behaviour over a real `100vh`
layout, live overflow collapse, restyling, and the Tailwind regression test.

```bash
npm run playground:install   # once
npm run playground           # builds the package, then starts Vite on :5273
```

The dev server rebuilds `dist` first, because the playground consumes the package
through its `exports` map exactly as a real consumer does. After editing `src/`, run
`npm run build` (or `npm run dev` in a second terminal) and reload.

### CommonJS / Jest consumer fixture

`test/fixtures/jest-consumer` is a real Jest 29 + jsdom + Testing Library project
that consumes the **built** `dist/` the way a CommonJS user does. It exists because
the vitest suite runs in an ESM host and therefore only ever exercises one of the two
paths by which `/testing` loads its optional Testing Library peer — it can grep the
bundle for the shape of an import, but that is a canary, not proof.

```bash
npm run test:jest-consumer   # builds, then runs Jest against dist/
```

It is a standalone script on purpose, not part of `npm test`: it needs a fresh
`dist/`, and a second runner inside the vitest run would confuse both. It is not
published. Before deleting it as redundant, read
[its README](./test/fixtures/jest-consumer/README.md) — this failure class has
already shipped twice.

## Changelog

[CHANGELOG.md](./CHANGELOG.md) — including the four places the extension contract
moved when the first real extension was written against it.

## Documents

- [plans/architecture.md](./plans/architecture.md) — shell contract, boundary
  rationale, token table, extension-authoring guide, and what each extension found
- [plans/implementation.md](./plans/implementation.md) — the accepted delivery plan
- [plans/dev-bar.md](./plans/dev-bar.md) — the product design and the extension
  catalogue

## License

MIT
