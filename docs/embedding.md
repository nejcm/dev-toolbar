# Embedding a third-party devtool

TanStack Query's devtools, React Hook Form's, Jotai's, a Redux monitor — a panel
somebody else already built, on the bar next to your flags. There is no `/ext/embed`
subpath and none is planned. There is nothing for one to add: the extension contract
is already public, and it is already enough.

## The recipe

Four lines, against [the contract](./extension-contract.md), importing nothing from
this package but a type:

```tsx
import type { DevToolbarExtension } from "@nejcm/dev-toolbar";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";

const queryDevtools: DevToolbarExtension = {
  id: "tanstack-query",
  label: "Query",
  panel: ({ close }) => (
    <ReactQueryDevtoolsPanel client={queryClient} style={{ height: "100%" }} onClose={close} />
  ),
};
```

Put it in the `extensions` array and it works today. (`height: 100%` fills the panel
body, whose height core owns; a tool that wants a number reads `height` from the same
props.) Core supplies everything an embedded panel needs:

- **A trigger.** With no `compact` slot, core renders a plain labelled button that
  toggles the panel.
- **One panel at a time**, the resizer, the persisted height, and `close()`.
- **Lazy mount.** The `panel` slot is a render function, and core does not call it
  until the panel is active — the devtools are not created, not even touched, until
  the chip is first clicked.
- **`keepMounted`.** Add `keepMounted: true` and a closed panel stays in the DOM,
  hidden, so the tool's own state — the selected query, a filter — survives the
  close. Without it, closing unmounts, as for every other extension.
- **Containment.** `compact`, `panel` and `overlay` each render inside their own error
  boundary (`src/core/ExtensionBoundary.tsx`). A panel that throws on first render
  degrades to an error chip carrying the extension's label; the bar and every other
  extension keep working, and the chip is itself a **retry button** that re-renders
  the slot. `onExtensionError` receives the error and the slot. This is core's, not
  something an embed layer adds — and `src/kit/__tests__/embed.test.tsx` asserts it
  for an embedded panel specifically, so a regression there fails the suite.

Build the object once, at module scope, like every extension: the identity is the
lifecycle ([the contract](./extension-contract.md), *Two lifecycle rules*).

## The stylesheet rule: theirs is theirs

An embedded tool brings its own CSS, and **the toolbar does not scope, reset or
restyle it.** The bar renders in the light DOM ([ADR-002](./adr/ADR-002-light-dom.md)),
so a stylesheet the tool injects into `document.head` reaches its own DOM exactly as it
would anywhere else on your page. Nothing wraps the embedded subtree with a reset of
fonts, colours or box-sizing, and nothing should: a tool that looks right on its own
page will look right here, and one that does not is theirs to fix.

That takes one attribute to be true, and it is worth knowing why. The kit's sheet is
keyed on `data-dtb-kind`, which the embedded tool never carries, so it cannot reach in.
Core's sheet is mostly keyed on `data-dtb-part` — but core also states a handful of
**element-level defaults for every descendant of the root**, so a first-party panel
looks the same in an app with a reset and an app without: `box-sizing: border-box` on
`*`, zero margins on headings, paragraphs and lists, a flat button face
(`[data-dev-toolbar] :where(button) { padding: 0; border: 0; background: transparent;
font: inherit }`), field geometry on `input`, `select` and `textarea`, and one
focus ring. Left alone, those would land on the embedded tool's buttons and inputs
too — overridable by the tool's own CSS, but not absent.

So core owns an opt-out: **`data-dtb-embed`**. Every one of those descendant rules is
guarded with `:where(:not([data-dtb-embed] *))`, and a subtree under an element
carrying the attribute gets none of them — the tool arrives with the UA's defaults,
exactly as it would anywhere else on the page. The `embed()` frame below carries it.
The four-line recipe above does not, so add it to the root you render:

```tsx
panel: ({ close }) => (
  <div data-dtb-embed="" style={{ height: "100%" }}>
    <ReactQueryDevtoolsPanel client={queryClient} style={{ height: "100%" }} onClose={close} />
  </div>
),
```

Without it, the recipe still works and the tool's own stylesheet still wins every
conflict — the difference is only what a vendor element *without* a rule of its own
looks like: ours, or the browser's.

Two tests keep the guard and this page from drifting apart, and they prove different
halves of it:

- **The guard works.** `src/kit/__tests__/embed.test.tsx` mounts a real toolbar around a
  vendor DOM containing one of each element core's defaults name, walks every rule in
  core's sheet and the kit's against it, and fails on the first that matches — with the
  focus rules exercised on a focused link and a focused field, and a negative control
  that removes the attribute and checks each rule matches again. What it does *not*
  prove is coverage: a new unguarded rule naming an element that fixture happens not to
  contain would pass it.
- **The guard is applied everywhere.** `src/core/__tests__/css.test.ts` reads core's
  stylesheet itself, with no fixture and no element list, and rejects any rule that
  styles a descendant of the root by element rather than by a `data-dtb-*` attribute the
  *selected* element must itself carry, unless it carries the guard, naming the selector.
  Mandatory and positive: a `data-dtb-*` token inside a `:not()`, in only one branch of
  an `:is()`, or inside a quoted attribute value does not exempt a rule. Adding one — a bare
  `[data-dev-toolbar] :where(table)`, or a `p` under a part — fails it.

What the attribute does **not** stop is inheritance, and it should not: the frame sits
inside the panel, so the panel's `font-family`, `font-size`, `line-height`, `color` and
`color-scheme` reach the tool's root the way any parent's do. A tool that sets its own
root typography — TanStack Query's devtools do — is unaffected; one that leans on the
page's `body` font gets the toolbar's instead, and fixes that with one rule on its own
root, as it would inside any styled container.

Two consequences worth knowing:

- **A host reset is unlayered and hits the tool as it hits everything else.**
  Tailwind's Preflight flattens the toolbar's own controls too; the remedy in
  [styling.md](./styling.md#under-a-host-reset) is for the toolbar's parts and does
  not reach into an embedded tool — that stays between the tool and your reset,
  exactly as it would without the toolbar.
- **Under a nonce CSP, pass the nonce to the tool, not to us.** `styleNonce` on
  `<DevToolbar>` covers the sheets *this package* injects. A tool that injects its
  own — TanStack Query's devtools do — needs it through its own option
  (`styleNonce` there too, as it happens).

## `embed()` — the frame around it

For the parts that are fiddly rather than hard, [`/kit`](./kit.md) exports one helper:

```tsx
import { embed } from "@nejcm/dev-toolbar/kit";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";

const queryDevtools = embed({
  id: "tanstack-query",
  label: "query",
  keepMounted: true,
  render: ({ close }) => (
    <ReactQueryDevtoolsPanel client={queryClient} style={{ height: "100%" }} onClose={close} />
  ),
});
```

```ts
function embed(options: EmbedOptions): DevToolbarExtension;

interface EmbedOptions {
  id: string;
  label: string;
  render: (props: PanelSlotProps) => ReactNode;   // called only once the panel first opens
  value?: ReactNode;                              // shown beside the label on the default chip
  compact?: (props: CompactSlotProps) => ReactNode;   // replaces the default chip
  keepMounted?: boolean;                          // default false
  minHeight?: number;                             // the frame's floor, px — default 240
  align?: ToolbarAlign; order?: number; priority?: number; hidden?: boolean;
  injectStyles?: boolean;                         // the kit sheet, for the chip — default true
  styleNonce?: string;                            // for that sheet; wins over the slot prop
}
```

What it does, and all it does:

- **A native-looking chip.** A `data-dtb-part="trigger"` button with `aria-expanded`,
  wrapping the kit's [`Chip`](./kit.md#chip): a dot, the label, and `value` if you
  give one. For a live value, pass an element that subscribes to the tool's own state
  — `examples/playground/src/embedDemo.tsx` shows the query-cache count. It ensures
  the kit stylesheet for that chip, through its own `injectStyles` switch like every
  first-party extension; that is the only sheet it touches. Pass `compact` to replace
  the chip entirely.
- **`height` handed through, with a floor.** `render` receives the live
  `PanelSlotProps` — `height` in pixels, `close()`, `isActive`, `density`,
  `styleNonce`. The frame is a bare `<div data-dtb-part="embed-frame" data-dtb-embed>`
  with `height: 100%` and `min-height: 240px` (or `minHeight`), so a tool that fills its
  container (`style={{ height: "100%" }}`) tracks the resizer without measuring, and
  one that sizes itself from an auto-height parent does not collapse to nothing. When
  the panel is dragged shorter than the floor, the panel body scrolls the frame rather
  than crushing the tool. A tool that wants a number gets `height` and sizes itself.
- **Lazy mount.** `render()` runs when the frame mounts, which core only does once the
  panel opens — not when the extension is built, not when the bar renders, not when
  core is deciding what to mount. With `keepMounted`, still not before the first open.
- **`keepMounted` as an option**, passed straight through to core.

It adds no containment (core's boundary is already around the slot), no stylesheet for
the embedded subtree, no wrapper with a class on it. The frame carries two attributes —
its part name and the `data-dtb-embed` opt-out above — and two inline sizes, and the
tool's root is its only child.

## Loading the tool lazily too

Lazy *mount* keeps the devtools uncreated until the first open. To keep their code
out of the bundle until then as well, pair `render` with `React.lazy`:

```tsx
import { Suspense, lazy } from "react";

const QueryPanel = lazy(() =>
  import("@tanstack/react-query-devtools").then((m) => ({ default: m.ReactQueryDevtoolsPanel })),
);

const queryDevtools = embed({
  id: "tanstack-query",
  label: "query",
  render: ({ close }) => (
    <Suspense fallback={null}>
      <QueryPanel client={queryClient} style={{ height: "100%" }} onClose={close} />
    </Suspense>
  ),
});
```

The dynamic `import()` runs the first time `render()` does — the first open — so
neither the module nor the panel exists before the chip is clicked.

## One chip for a whole devtools suite

Some devtools are not one panel but a shell of their own: TanStack Devtools
(`@tanstack/react-devtools`) hosts Query, Router, Form and Pacer as plugins behind a
single floating trigger, with its own tabs, settings and persistence. Embedding that
shell is not possible — it renders a fixed, viewport-docked panel and has no inline
mode — and embedding its plugins one by one gives you a chip per tool when what you
wanted was TanStack's UI, whole. The third recipe is a **remote control**: one chip that
opens their shell and otherwise stays out of the way. The toolbar renders none of the
devtools UI; it contributes a trigger.

The shell hides its own button with `triggerHidden`, and the chip drives it over the
shell's event bus. TanStack's trigger emits `trigger-toggled { isOpen }` on the client
from `@tanstack/devtools-client`, and the shell listens for that same event, so an emit
from outside opens or closes it, and a subscription mirrors what the hotkey or the
panel's own close button did:

```tsx
import { useEffect, useSyncExternalStore } from "react";
import type { DevToolbarExtension } from "@nejcm/dev-toolbar";
import { Chip, ensureKitStyles } from "@nejcm/dev-toolbar/kit";
import { devtoolsEventClient } from "@tanstack/devtools-client";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";

// Module scope, not a hook: a chip collapsed into `⋮` is unmounted and must not miss a toggle.
let open = false;
const listeners = new Set<() => void>();
devtoolsEventClient.on("trigger-toggled", ({ payload }) => {
  open = payload.isOpen;
  listeners.forEach((notify) => notify());
});
const subscribe = (notify: () => void) => (listeners.add(notify), () => listeners.delete(notify));

function ShellChip({ styleNonce }: { styleNonce?: string }) {
  const isOpen = useSyncExternalStore(subscribe, () => open, () => false);
  useEffect(() => ensureKitStyles(undefined, styleNonce), [styleNonce]);
  return (
    <button
      type="button"
      data-dtb-part="trigger"
      aria-expanded={isOpen}
      onClick={() => devtoolsEventClient.emit("trigger-toggled", { isOpen: !open })}
    >
      <Chip label="tanstack" value={isOpen ? "open" : "closed"} />
    </button>
  );
}

// No `panel` slot: the surface it opens is TanStack's, outside the toolbar.
export const tanstackDevtools: DevToolbarExtension = {
  id: "tanstack",
  label: "TanStack Devtools",
  compact: ({ styleNonce }) => <ShellChip styleNonce={styleNonce} />,
};

// Mount once, beside <DevToolbar>. `plugins` at module scope: the shell re-registers on identity change.
const plugins = [
  { id: "tanstack-query", name: "TanStack Query", render: <ReactQueryDevtoolsPanel style={{ height: "100%" }} /> },
];
export const TanStackShell = () => (
  <TanStackDevtools config={{ triggerHidden: true }} plugins={plugins} />
);
```

Add every TanStack tool you use to `plugins` exactly as their setup guide shows — the
shell is theirs, so a new tool is a new plugin there, never a change here. The playground
runs this recipe as `examples/playground/src/tanstackDemo.tsx`, next to the `embed()` one:
its `tanstack` chip opens the shell hosting the same Query panel the `query` chip embeds.

Four things to know before you ship it:

- **It opens over the bar, not inside it.** The shell is TanStack's fixed overlay,
  docked to the bottom of the viewport by default (`panelLocation`), rising from the
  same edge as the bar, and it paints at `z-index: 99999`. Core's default
  `--dtb-z-index` is far higher, which would leave the bar and any open toolbar panel
  sitting over the shell. Lower the token on the toolbar root to let the shell win
  while it is open (the playground sets `--dtb-z-index: 99990` in its stylesheet; the
  chip is covered only then, and the shell's own close button and hotkey remain). Set
  `panelLocation: "top"` if you would rather the two never meet at all. Core's panel host,
  resizer and error boundary play no part — which is the point.
- **Seed the chip from the shell's storage.** The shell restores its open state on load
  from `localStorage["tanstack_devtools_state"].persistOpen` and announces nothing when
  it does, so read that key once at module init or the chip says `closed` over an open
  shell after a reload. The playground shows the defensive read.
- **The event is client wiring, not a documented "open" API.** `trigger-toggled` is
  exported and typed on `@tanstack/devtools-client`'s event map and it is what their own
  trigger uses, but TanStack describes the shell as under active development. Verified
  against `@tanstack/react-devtools` 0.10 and `@tanstack/devtools` 0.14; if the name
  moves, the chip stops working until the recipe is updated, and nothing in this package
  breaks with it.
- **Development only, by their design.** `@tanstack/devtools-event-client`'s root export
  is a no-op outside `NODE_ENV=development`, so in a production bundle the chip emits into
  the void — the same bundle in which the shell renders nothing. If you ship the toolbar
  to production, `hidden` the extension there too.

## Why there is no `/ext/embed`

Embedding third-party panels inside this chrome makes the toolbar's perceived quality
the *minimum* over every tool anyone embeds, and turns their breaking changes into this
package's support burden. TanStack already ships `@tanstack/react-devtools` as a
unified host for Query, Router, Form and Pacer, and describes it as under active
development with possible breaking changes; let it host its own — the
[one-chip recipe above](#one-chip-for-a-whole-devtools-suite) does exactly that. A subpath here would
also have re-implemented the one thing worth having — containment — which
[architecture.md](./architecture.md#6-failure-isolation) shows core already does per
slot. What was left after that is the helper above, and a helper is not a subpath.

The package never names a third-party devtool, not even as an optional peer: the tool
is yours, injected, at whatever version you run. In the playground,
`@tanstack/react-query` and `@tanstack/react-query-devtools` are devDependencies of
`examples/playground/package.json` alone, and the package's `dependencies` stay empty.

---

[Documentation index](./README.md)
