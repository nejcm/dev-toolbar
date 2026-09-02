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
| `@nejcm/dev-toolbar/ext/overlays` | Layout boxes, a column grid, an element inspector and focus order — drawn over your page, never in the way of it. |
| `@nejcm/dev-toolbar/ext/diagnostics` | One snapshot for a bug report: the page, long tasks, and every other extension's own diagnostics. Reviewed before it is sent. |
| `@nejcm/dev-toolbar/ext/theme-editor` | Edit your design tokens live, see the before and after, hand the result to a designer. The tokens stay yours. |
| `@nejcm/dev-toolbar/testing` | `renderWithToolbar`, fake extensions, mock bus, fake layout. |
| `@nejcm/dev-toolbar/styles.css` | The stylesheet, if you would rather not inject it at runtime. |

> **Status:** complete. The shell (P0), `/runtime` and `/ext/metrics` (P1),
> `/ext/environment` / `/ext/flags` / `/ext/command-menu` (P2), `/ext/overlays` and
> `/ext/diagnostics` (P3) and `/ext/theme-editor` (P4) are all implemented. The
> contract has been through seven real consumers — the first moved it in four places,
> all listed in the [changelog](./CHANGELOG.md); the second did not move it at all;
> the third found one gap, in `commands`; the fourth closed that gap and added the
> `overlay` slot; the fifth drew over the host page and needed nothing new; the sixth
> either. Every change is additive, so `CONTRACT_VERSION` is still `1`. `0.1.0` is the
> first publish.

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

Every instance also publishes `--dev-toolbar-height-<instanceId>` — the `instanceId`
with anything outside `A-Za-z0-9_-` folded to `_` — and the unsuffixed name belongs to
the `"default"` instance alone. So two toolbars on one page never overwrite or remove
each other's value; inset by the suffixed name when you mount more than one.
`<DevToolbarInset>` already pads by its own instance's, falling back to the unsuffixed
one.

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

It fires wherever focus is, text fields included, but not for an auto-repeat, not
mid-IME-composition, and not when something else already called `preventDefault()`
— the listener is on `window`, so your own `document` handler wins the chord.

### The `···` menu

Items that do not fit the bar collapse into a `···` popup, lowest `priority` first. It is a
disclosure, not an ARIA menu: its entries are your own compact slots, buttons and all,
and a `menuitem` may not contain interactive content. So the `···` button carries
`aria-expanded` and, while open, `aria-controls`; the popup is a labelled
`role="group"`; opening it moves focus to the first focusable thing inside it — the
popup itself if there is none — and `Tab` walks the rest; `Escape` closes it and hands
focus back to the button; a click outside closes it and leaves focus where the click
put it.

### Other exports

`DevToolbar`, `DevToolbarInset`, `useDevToolbar` and `useToolbarCommands` are the
whole surface most apps touch. The rest of the root entry is a short list of escape
hatches; everything here is public and covered by the package's versioning.

| Export | What it is for |
| --- | --- |
| `runCommand(id, scope?)` | Runs an aggregated command from code with no React context — a hotkey, a console, a test. Resolves `false` when no mounted toolbar declares the id. `scope`, a `readonly ToolbarCommand[]`, is searched instead of the mounted toolbars. Inside components prefer `useDevToolbar().runCommand`. |
| `CONTRACT_VERSION` | The extension contract's version, currently `1`. See [ADR-003](./docs/adr/ADR-003-contract-version-policy.md). |
| `HEIGHT_VARIABLE` | The name of the CSS variable the shell publishes — `"--dev-toolbar-height"` — so a CSS-in-JS host need not retype the string. It is the `"default"` instance's; every instance also publishes `<HEIGHT_VARIABLE>-<instanceId>`. |
| `createLocalStorage()` | The default adapter: `localStorage`, but it never throws. Useful as the base of your own wrapper. |
| `createMemoryStorage(seed?)` | In-memory adapter for tests and non-browser hosts. `seed` is a plain key/value map of already-persisted JSON. |
| `createNullStorage()` | Swallows every write and reads `null` — what `storage={null}` installs. |
| `STORAGE_PREFIX` | `"dtb:v1"`, the first segment of every key the shell writes. Enough to find or clear persisted preferences from outside React; the key shapes are in [docs/architecture.md](./docs/architecture.md#3-state-storage-and-lifecycle). |
| `CORE_CSS` | Core's stylesheet as a string, for a host that injects CSS itself — a nonce-based CSP, or a `<style>` it controls. Same bytes as `@nejcm/dev-toolbar/styles.css`. |
| `ensureStyles(entry?, css?, doc?)` | Injects a stylesheet once per document, keyed on `entry`. Pass `doc` to reach a second document, which is what a `container` inside an iframe or a popped-out window needs. |
| `DEFAULT_SHORTCUT` | `"Mod+Shift+."`, so your own UI can show the binding it actually has. |
| `MIN_PANEL_HEIGHT` / `MAX_PANEL_HEIGHT` / `DEFAULT_PANEL_HEIGHT` | `160` / `800` / `320`. The range `defaultPanelHeight` and the resizer are clamped to. |

The aggregation helpers behind `getCommands()` and `getDiagnostics()` are **not**
exported. They only ever see an extension array the caller assembled by hand, which
is not the merged list the toolbar renders — read the aggregation through
`api.getCommands()` / `api.getDiagnostics()` in an extension, or
`useToolbarCommands()` / `useDevToolbar().getCommands()` in the host.

### Types

Every type the root entry exports. The slot props, `DevToolbarExtension`,
`ExtensionRuntimeApi`, `ToolbarCommand` and friends are described under
[the extension contract](#the-extension-contract).

| Type | What it types |
| --- | --- |
| `DevToolbarProps` / `DevToolbarInsetProps` | The two components' props. |
| `DevToolbarExtension` | One extension object. |
| `ToolbarCommand` / `ToolbarCommandsInput` | A command, and the array-or-function form `commands` accepts. |
| `ExtensionRuntimeApi` | What `start(api)` receives. |
| `CompactSlotProps` / `PanelSlotProps` / `OverlaySlotProps` | What each slot renders with. |
| `ExtensionDiagnostics` / `DiagnosticStatus` | One entry in the diagnostics roster, and its `"ok" \| "absent" \| "failed"` status. |
| `ToolbarStorage` | The three-method storage adapter. |
| `ToolbarAlign` / `ToolbarPosition` / `ToolbarDensity` / `ToolbarColorScheme` | `"start" \| "end"`, `"bottom" \| "top"`, `"compact" \| "comfortable"`, `"light" \| "dark" \| "system"`. |
| `DevToolbarClassNames` | The per-part class map the `classNames` prop takes. |
| `DevToolbarContextValue` | What `useDevToolbar()` returns. |
| `ToolbarState` | The store snapshot: `visible`, `position`, `activePanelId`, `panelHeight`. Its `registered` field is marked `@internal` — it holds only the dynamic registrations, so it is not the extension list; use `useDevToolbar().extensions` for that. |

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

`overlay` is for a surface the bar cannot host — a dialog, a picker, a layer drawn
over the page. It renders once,
inside the toolbar root, for as long as you are present, not hidden and the bar is
visible, and **overflow never collapses it**: a compact item that has collapsed into
the `···` menu is not in the DOM at all, which would cost an extension its modal (and
its key binding) exactly when the window got narrow. Most overlays render `null` most
of the time. `/ext/command-menu` is the worked example for a modal;
`/ext/overlays` for a persistent surface, where the trick worth stealing is
`z-index: -1`: the toolbar root is a stacking context above your app, so a negative-z
child of it paints over the page and under the bar, the panel and the palette.

Core keeps *reporting* visibility rather than acting on it, so `start()` keeps running
while the bar is hidden even though your overlay is not rendered. If yours is modal,
close it on `api.subscribeVisibility(false)` and gate any key binding on
`api.isVisible()` — otherwise it reappears, unasked, when the bar comes back. If it
observes the page, detach the observers there too: measuring for a surface that is
not rendered is pure waste.

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
working. In the `compact` and `panel` slots the chip is itself a retry button, so a slot
that threw on transient state can be brought back without reloading.
[docs/architecture.md](./docs/architecture.md#7-writing-an-extension).

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

Which environment am I in, what is deployed, and who am I acting as.

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

Feature-flag controls, including the promoted flag.

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

## `@nejcm/dev-toolbar/ext/overlays`

Visual overlays over the running application (§3G). Four, each toggled on its own,
each persisted, each with a command in the palette.

```tsx
import { overlays } from "@nejcm/dev-toolbar/ext/overlays";

// Once, at module scope. Not inside render.
const extensions = [overlays({ grid: { columns: 12, gutter: 24, maxWidth: 1100 } })];
```

| Overlay | What it answers | What it costs |
| --- | --- | --- |
| **Layout boxes** | where the boxes actually are, and which wrapper is adding the gap | one stylesheet; a repaint on toggle, and the only overlay whose cost grows with the document |
| **Column grid** | does this line up with the design's grid | free — one gradient-painted element |
| **Element inspector** | what is under the pointer, how big, what it is called | one rect and one `getComputedStyle` on **one element**, never the document, per frame in which the pointer moved, the page scrolled or the window resized |
| **Focus order** | what order `Tab` visits things in, and which have no accessible name | one narrow `querySelectorAll` per debounced *app* mutation burst, where names resolve too; then one rect per element per scroll frame; capped at 200 |

The cost column is also rendered in the panel, next to each switch — an overlay you
leave on while profiling should tell you what it is charging you.

Options: `defaults` (which overlays start on), `grid` (`columns` / `gutter` /
`maxWidth` / `baseline`), `focusLimit`, `mutationDebounceMs`, `persist`, plus the
usual `id` / `label` / `align` / `order` / `priority` / `hidden` / `keepMounted` /
`injectStyles`.

Because it draws over *your* application, what it refuses to do matters more than
what it draws:

- **It never intercepts a pointer event.** The surface and everything in it are
  `pointer-events: none !important`, so a click always lands on the page underneath.
  The `!important` is deliberate and it is the only one in this package: the rest of
  its CSS is layered so that *your* rules win, and a stray `div { pointer-events:
  auto }` would otherwise turn a viewport-sized overlay into a click trap. The
  inspector observes the pointer through a passive listener and `elementFromPoint`.
- **It draws below the toolbar.** The surface is a negative-z child of the toolbar
  root, whose stacking context is above your app — so overlays cover the page and
  never the bar, the panel or the `⌘K` palette. `z-index`, `position` and `inset`
  carry `!important` for the same reason as `pointer-events`.
- **It mutates none of your DOM.** No injected classes, no inline styles on your
  elements. The single exception is layout boxes, which is one `<style>` element in
  `document.head` — removed when you switch it off, when the bar is hidden, and on
  teardown. It uses `outline`, so it cannot reflow the layout it is describing.
- **It stops while the bar is hidden.** Every listener detaches and the stylesheet
  comes off; both return when the bar does.
- **A throw switches everything off.** Measurement runs in animation frames where
  nothing upstream could catch it and where it would recur every frame. The reason
  appears in the panel, and your stored toggles are left alone — a reload brings back
  what you had chosen.

The accessible-name check is a documented heuristic, not the full `accname`
algorithm — it skips `aria-hidden` subtrees the way `accname` does, so an icon-only
button is correctly reported as unnamed, but treat a flag as a prompt to check rather
than a verdict. Names are resolved when the DOM changes rather than on every frame,
and the observer watches text, `childList` and the attributes that carry a name, so a
label your app rewrites live is re-checked.

Nine of §3G's thirteen modes are deliberately absent, with reasons — re-render flash
every element in the document.

## `@nejcm/dev-toolbar/ext/diagnostics`

One snapshot for a bug report (§3J), with §3E's long-task and responsiveness data
in it. Everything it produces is text you are about to paste into a ticket, so the
whole extension is arranged around that.

```tsx
import { diagnostics } from "@nejcm/dev-toolbar/ext/diagnostics";

// Once, at module scope. Not inside render.
const extensions = [
  metrics(),
  flags({ readings, onOverride }),
  diagnostics({
    app: () => ({ release: __RELEASE__, userId: session.userId }),
    sources: [{ id: "router", label: "Router", read: () => router.state }],
  }),
];
```

**It aggregates; it does not re-collect.** §3J's shape lists flags, metrics and
session context — every one of which is already owned by an extension that knows
more about it than this one could. So core aggregates
`DevToolbarExtension.diagnostics()` the way it aggregates `commands`, and this
extension reads the roster. What it gathers for itself is only what nobody else
owns: the page's own facts, and the `PerformanceObserver` data.

**You review before you send.** The panel shows the exact text the Copy and
Download buttons produce — not a summary, the same string — and nothing leaves the
machine until you press one. Markdown for a ticket, JSON for a tool; the choice
persists.

**Omissions are visible.** An extension that throws, contributes nothing, or returns
something that will not serialise gets a status, a line in a top-level `omissions`
list, a banner in the panel and a heading in the Markdown. A snapshot that quietly
dropped the one failing extension would read as complete, and whoever picks up the
ticket would have no way to know it is not.

**It never reports a number it does not have.** `longtask` and `layout-shift` are
Chromium-only today and `event` is not universal either, so every count is `null`
rather than `0` when it could not be observed, with a note saying which. "No long
tasks" and "this browser cannot count long tasks" are opposite claims.

**Redaction happens on the way in.** The consumer's `app` context, every `source`,
every extension contribution, the page URL, a long task's container attribution and
another extension's error message are all redacted as the snapshot is built, and the
panel, the clipboard, the download and the commands read that one object. The number
of masked values is shown next to the buttons. It is still not a security boundary —
`redact()` matches key names and value shapes, so a secret under an innocent key with
no telltale shape survives, which is exactly why the text is on screen before you
send it.

**§3J's `recentErrors` is deliberately absent.** Shipping it would mean this extension
installing a global `window.onerror` handler — permanent instrumentation of your
application, duplicating the error reporter you already have, and liable to disagree
with it. `sources` is the answer instead, and it works today:

```tsx
diagnostics({
  sources: [{ id: "errors", label: "Recent errors", read: () => Sentry.lastEvents() }],
});
```

Options: `app` (object or getter), `sources`, `windowMs`, `slowInteractionMs`,
`historySize`, `recentSize`, `now`, `redactOptions`, plus the usual `id` / `label` /
`align` / `order` / `priority` / `hidden` / `keepMounted` / `injectStyles`.

Commands: `diagnostics.capture` (capture only — it deliberately does not copy),
`diagnostics.copy`, `diagnostics.copyJson`, `diagnostics.download`.

### Contributing to somebody else's snapshot

Any extension can. Add a `diagnostics()` to it:

```ts
export function jobQueue(): DevToolbarExtension {
  return {
    id: "job-queue",
    label: "Queue",
    // Pure, cheap, JSON-serialisable, and already safe to leave the machine.
    diagnostics: () => ({ depth, lastError }),
  };
}
```

Core calls it, contains a throw, and hands the result to whatever is reading. If
`/ext/diagnostics` is not mounted, nothing calls it and it costs nothing.

If it throws, core reports the error's message and its name **separately**, never
pre-joined — the reader has to mask the message before prefixing it, because the
redactors match value shapes anchored to the whole string and a message that *is* a
credential-carrying URL (what `fetch` and axios throw) stops being maskable the moment
`"Error: "` is in front of it.

## `@nejcm/dev-toolbar/ext/theme-editor`

Live design-token editing (§3H). Edit the custom properties your application already
publishes, see the application's own value next to your edit, and take the result away
as CSS, as a versioned recipe, as a design-tokens export or as a link.

```tsx
import { themeEditor } from "@nejcm/dev-toolbar/ext/theme-editor";

// Once, at module scope. Not inside render.
const extensions = [
  themeEditor({
    tokens: [
      { name: "--brand-500", label: "Brand", group: "Colour", type: "color" },
      { name: "--radius-md", group: "Shape", type: "length", defaultValue: "8px" },
      { name: "--type-scale", group: "Type", type: "number", defaultValue: "1" },
    ],
    // §3H's surface/subtree selection. Defaults to `:root` only.
    surfaces: [
      { id: "root", label: "Whole application", selector: ":root" },
      { id: "checkout", label: "Checkout only", selector: "[data-area=checkout]" },
    ],
  }),
];
```

**The tokens are yours.** This extension owns no design system and generates no
palette. `value` is optional: leave it out and the application's own value is read off
the surface with `getComputedStyle`, captured *before* the edit lands so the panel can
keep showing it. Supply `onApply` if you also want the edit mirrored into your own
theme provider; the live preview happens either way.

Types are `color`, `length`, `number` and `string`. A `number` or `length` that does not
parse is **refused with the draft kept**, never coerced — the `/ext/flags` rule. A
`color` gets a swatch, and a native picker when the current value is hex.

### It changes what your app looks like

So it behaves like `/ext/flags`, which changes what your app *does*:

- **Edits persist** under `dtb:v1:<instanceId>:ext:<id>:overrides` and are re-applied
  on the next mount. `readStoredThemeOverrides()` reads them before you render, if your
  own theme object needs to agree with the panel on the first paint.
- **There is a kill switch.** Any page loaded with `?dtb-theme=reset` drops every edit
  *before* any of them is applied, because the edit that makes the page unreadable is
  the one you cannot see the panel to remove.
- **Reset is exact.** The inline value each property held before the extension touched
  it — priority included — is restored, and a `style` attribute the extension created
  is removed rather than left empty. Same on teardown, unconditionally.
- **Preview: off** holds every edit back without discarding it, which is §3H's
  before/after comparison. Turning it back on re-applies through the same path.
- **An edit the catalogue no longer declares still gets a row.** It is still being
  written to your page, so it is shown, tagged and clearable.
- **Hiding the bar does not revert anything.** Deliberately unlike `/ext/overlays`: an
  edit is a state you chose, not a drawing.

### It cannot restyle the toolbar

The bar is styled from `--dtb-*` and publishes `--dev-toolbar-height`, and the default
surface `:root` is an ancestor of the portalled toolbar root — so those names are
**never written**, whatever you declare. A token that carries one gets a row saying
why. Restyling the bar is a supported thing to want; do it from your own stylesheet
([Styling](#styling)), which needs nothing from this extension.

A surface whose selector resolves inside a `[data-dev-toolbar]` subtree is refused for
the same reason.

### Sharing and importing

Four outputs, all built from one already-redacted snapshot:

| Format | For |
| --- | --- |
| CSS variables | Pasting into your stylesheet |
| Recipe JSON | Re-importing here, or committing |
| Design tokens (`$type`/`$value`) | Figma Variables and other W3C design-tokens importers |
| Share link | `?dtb-theme=<recipe>` on the current URL |

A pasted recipe, a `preset` you supply, and a link all go through the **same** filter:
only token names your current catalogue declares, and only values the editor itself
would accept — which is what keeps `url(...)` in somebody's link from making your page
fetch from their host. Anything dropped is counted and named.

Presets are `ThemeRecipe`s **you** compute, which is where a palette generator belongs:

```ts
themeEditor({
  tokens,
  presets: [
    { schemaVersion: 1, name: "High contrast", mode: "light", surface: "root",
      overrides: generateScale("#0b7285"), createdAt: new Date().toISOString() },
  ],
  // The app's own colour mode. Report-only without `set`.
  mode: { read: () => myTheme.mode, set: (next) => myTheme.setMode(next) },
});
```

### What it does with your data

Token values reach a clipboard, a file and a URL, so `redact()` runs on the way **in**
and the panel and every export read the same masked snapshot. Two rules are specific to
tokens:

- **A colour, a length and a number are never masked by their name.** Token names are
  descriptive English, so `--session-panel-bg` collides with the credential word list
  routinely — and masking it would hide the token you most need to see. Those types are
  matched on the *value's* shape only, which still masks a `Bearer …`, a JWT or a URL
  carrying a token in its query. A free `string` token is matched on its name as well,
  and `sensitive: true` masks anything.
- **A masked value never round-trips.** The editor starts empty with a placeholder
  rather than seeded, and the recipe and share link **omit** masked tokens with a stated
  count rather than carrying `[redacted]` into a document something is going to apply.

A token's `description` and its `group` are redacted the same way, once, so the panel
and the Figma export read the same strings — with the honest limit that `redact()`
matches value *shapes* anchored to the whole string, so a credential buried
mid-sentence in your own prose survives.

The recipe JSON and the share link are built by one function and carry the **raw**
values, masked ones omitted with a count. They deliberately do *not* get a second
key-matching pass: a token called `--sidebar-bg` or `--spinner-size` collides with the
credential word list by substring, and masking it in a document something is about to
apply is how a theme stops round-tripping.

Persisted edits are re-checked on load rather than trusted: `localStorage` is writable
by anything on the origin, and an unchecked custom-property value is accepted by the
CSSOM almost verbatim. Anything refused is dropped, counted in the panel, and removed
from storage. The surface selector is checked before it is printed into exported CSS,
for the same reason.

Use `redactOptions: { allowKeys: ["..."] }` if the default list is masking a token of
yours that is not a secret.

Options: `tokens`, `onApply`, `surfaces`, `presets`, `mode`, `pollMs`, `redactOptions`,
`themeParam`, `persist`, `now`, `document`, `createdBy`, plus the usual `id` / `label` /
`align` / `order` / `priority` / `hidden` / `keepMounted` / `injectStyles`.

Commands: `theme-editor.preset.<name>` (one per preset, enumerated live),
`theme-editor.reset`, `theme-editor.togglePreview`, `theme-editor.copyCss`,
`theme-editor.copyRecipe`, `theme-editor.copyFigma`, `theme-editor.copyLink`,
`theme-editor.refresh`.

panel.

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
`overlay`, `panel`, `panel-resizer`, `panel-body`, `error-chip`, `error-retry`,
`inset`.

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
[docs/architecture.md](./docs/architecture.md#4-style-api).

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
from a server component without adding a directive of its own.

**Build the extension array in a client module, though.** The banner makes each built
entry a *client* module, and RSC forbids a server component from **calling** a function
that lives in one — so `<DevToolbar>` renders fine from a server component, while
`metrics()` in the same file fails the build with *"Attempted to call metrics() from
the server but metrics is on the client"*. One small file with the directive fixes it,
and it is where the extension array should live anyway, since the contract requires the
objects to be built once outside render:

```tsx
// app/dev-tools.tsx
"use client";
import { DevToolbar } from "@nejcm/dev-toolbar";
import { metrics } from "@nejcm/dev-toolbar/ext/metrics";
import type { ReactNode } from "react";

const extensions = [metrics()];

export function DevTools({ children }: { children: ReactNode }) {
  return <DevToolbar extensions={extensions}>{children}</DevToolbar>;
}
```

```tsx
// app/layout.tsx — stays a server component
import { DevTools } from "./dev-tools";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DevTools>{children}</DevTools>
      </body>
    </html>
  );
}
```

Verified against Next 16 app router, `reactStrictMode: true`, in both `next dev` and a
production `next build && next start`: the server HTML contains the page and none of
the bar, and the browser console is clean — no hydration warning.

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
bun install
bun run typecheck
bun run lint
bun run format
bun run test
bun run build
bun run verify
```

`verify` runs format:check, typecheck, lint, knip, build, test and
check:package in sequence — the exact gate CI runs.

### Playground

`examples/playground` is a Vite app that links the package with `file:../..`. It is
not published (it is outside `files`) and its build output is gitignored. It exists
for the manual checks unit tests cannot make: overlay behaviour over a real `100vh`
layout, live overflow collapse, restyling, the Tailwind regression test, and — since
P4 — a real design-token set the page actually consumes, so an edit in
`/ext/theme-editor` visibly changes the app while the bar stays exactly where it was.

```bash
bun run playground:install   # once
bun run playground           # builds the package, then starts Vite on :5273
```

The dev server rebuilds `dist` first, because the playground consumes the package
through its `exports` map exactly as a real consumer does. After editing `src/`, run
`bun run build` (or `bun run dev` in a second terminal) and reload.

### CommonJS / Jest consumer fixture

`test/fixtures/jest-consumer` is a real Jest 29 + jsdom + Testing Library project
that consumes the **built** `dist/` the way a CommonJS user does. It exists because
the vitest suite runs in an ESM host and therefore only ever exercises one of the two
paths by which `/testing` loads its optional Testing Library peer — it can grep the
bundle for the shape of an import, but that is a canary, not proof.

```bash
bun run test:jest-consumer   # builds, then runs Jest against dist/
```

It is a standalone script on purpose, not part of `bun run test`: it needs a fresh
`dist/`, and a second runner inside the vitest run would confuse both. It is not
published. Before deleting it as redundant, read
[its README](./test/fixtures/jest-consumer/README.md) — this failure class has
already shipped twice.

## Changelog

[CHANGELOG.md](./CHANGELOG.md) — including the four places the extension contract
moved when the first real extension was written against it.

- [docs/architecture.md](./docs/architecture.md) — shell contract, boundary rationale,
  token table, extension-authoring guide, and the known gaps in the contract
- [docs/adr/](./docs/adr/) — decision records: why extensions are plain objects, why
  the bar is light DOM, and the open question about `CONTRACT_VERSION`
- [CONTRIBUTING.md](./CONTRIBUTING.md) — setup, commands, commit convention
- [src/core/contract.ts](./src/core/contract.ts) — the contract itself, and the source
  of truth for every type in it

## License

MIT
