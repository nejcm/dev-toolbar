# `@nejcm/dev-toolbar/ext/overlays`

Visual overlays over the running application. Four, each toggled on its own,
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
`maxWidth` / `baseline`), `focusLimit`, `mutationDebounceMs`, `persist`,
`presentation` (see [Bar presentation](#bar-presentation)), plus the
usual `id` / `label` / `align` / `order` / `priority` / `hidden` / `keepMounted` /
`injectStyles` / `styleNonce`. `styleNonce` also stamps the layout-boxes sheet,
which is not gated on `injectStyles`.

The layout-boxes sheet is first-writer-wins, so unless the factory `styleNonce`
option is set it is inserted only once the overlay surface has mounted — that is
what tells the extension the `styleNonce` on `<DevToolbar>`. The surface mounts
with the bar, which is also the only time boxes draw, so nothing is lost.

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

Other overlay modes — a re-render flash, for one — are deliberately absent: each
would have to touch every element in the document.


## Bar presentation

```tsx
overlays({ presentation: { preset: "icon", icon: <LayersIcon /> } });
```

`presentation` changes how the bar control looks, never what it draws.
The four knobs — a preset, your own `ReactNode` icon, a `render` callback and an
accessible-name override — the preset-by-preset table and the rules every extension
shares are in [kit.md](../kit.md#presentation). Two of those rules are worth repeating
before the specifics: `"default"` is byte-identical to what shipped before the option
existed, and `presentation`, like every factory option, is **fixed when the factory is
called** — to change it at runtime, remount the toolbar or reload.

What is specific to this extension:

- **The short bar word is `overlays`**; `label` stays the `⋮` and accessible-name
  identity.
- **The icon lands in `data-dtb-part="ovl-icon"` and the word in `ovl-chip-label`** —
  not `ovl-label`, which was already taken by the element inspector's floating hover
  label, the one `css.ts` positions absolutely over your page. Two different elements
  cannot share a part name, and the older one is the one consumers have written CSS
  against.
- **`TView` is `OverlaysSnapshot`**, so `icon: (s) => (s.activeCount > 0 ? <On /> : <Off />)`
  paints the distinction `data-dtb-active` already carries.
- **The error tag is not yours to restyle.** It renders outside both the preset and
  `render`, under every preset including `"icon"`: a measurement that threw switched
  every overlay off, and that is state rather than presentation.

---

[Documentation index](../README.md) · [Extension contract](../extension-contract.md) · [Runtime](../runtime.md)
