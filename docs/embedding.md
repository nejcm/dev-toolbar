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
would anywhere else on your page. Core's sheet and the kit's live inside
`@layer dev-toolbar` and are keyed on `data-dtb-part` / `data-dtb-kind` attributes the
embedded tool never carries, so neither can reach into it. No wrapper resets fonts,
colours or box-sizing around the embedded subtree, and none should: a tool that looks
right on its own page will look right here, and one that does not is theirs to fix.

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
  `styleNonce`. The frame is a bare `<div data-dtb-part="embed-frame">` with
  `height: 100%` and `min-height: 240px` (or `minHeight`), so a tool that fills its
  container (`style={{ height: "100%" }}`) tracks the resizer without measuring, and
  one that sizes itself from an auto-height parent does not collapse to nothing. When
  the panel is dragged shorter than the floor, the panel body scrolls the frame rather
  than crushing the tool. A tool that wants a number gets `height` and sizes itself.
- **Lazy mount.** `render()` runs when the frame mounts, which core only does once the
  panel opens — not when the extension is built, not when the bar renders, not when
  core is deciding what to mount. With `keepMounted`, still not before the first open.
- **`keepMounted` as an option**, passed straight through to core.

It adds no containment (core's boundary is already around the slot), no stylesheet for
the embedded subtree, no wrapper with a class on it. The frame carries one attribute
and two inline sizes, and the tool's root is its only child.

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

## Why there is no `/ext/embed`

Embedding third-party panels inside this chrome makes the toolbar's perceived quality
the *minimum* over every tool anyone embeds, and turns their breaking changes into this
package's support burden. TanStack already ships `@tanstack/react-devtools` as a
unified host for Query, Router, Form and Pacer, and describes it as under active
development with possible breaking changes; let it host its own. A subpath here would
also have re-implemented the one thing worth having — containment — which
[architecture.md](./architecture.md#6-failure-isolation) shows core already does per
slot. What was left after that is the helper above, and a helper is not a subpath.

The package never names a third-party devtool, not even as an optional peer: the tool
is yours, injected, at whatever version you run. In the playground,
`@tanstack/react-query` and `@tanstack/react-query-devtools` are devDependencies of
`examples/playground/package.json` alone, and the package's `dependencies` stay empty.

---

[Documentation index](./README.md)
