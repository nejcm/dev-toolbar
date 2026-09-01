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

> **Status:** the shell (P0) is implemented. `0.1.0` publishes after `/runtime` and
> `/ext/metrics` land — a contract nobody has built against is wrong in ways its
> author cannot see. The public API may still move until then.

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
  commands?: ToolbarCommand[];   // core aggregates; it renders no palette
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
}

interface PanelSlotProps {
  isActive: boolean;             // false only for keepMounted panels
  density: "compact" | "comfortable";
  height: number;
  close(): void;
}
```

`start(api)` runs once per mount, for background work:

```ts
interface ExtensionRuntimeApi {
  signal: AbortSignal;                                  // aborts on teardown
  isVisible(): boolean;
  subscribeVisibility(cb: (visible: boolean) => void): () => void;
  storage: ToolbarStorage;                              // scoped to this extension
}
```

Core **reports** visibility and never pauses you on your own behalf — a cumulative
counter that silently stops counting is worse than one that keeps going.

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

## Styling

Three surfaces, in order of preference.

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
`item`, `trigger`, `overflow-button`, `overflow-menu`, `overflow-menu-item`, `panel`,
`panel-resizer`, `panel-body`, `error-chip`, `inset`.

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

## Documents

- [plans/architecture.md](./plans/architecture.md) — shell contract, boundary
  rationale, token table, extension-authoring guide
- [plans/implementation.md](./plans/implementation.md) — the accepted delivery plan
- [plans/dev-bar.md](./plans/dev-bar.md) — the product design and the extension
  catalogue

## License

MIT
