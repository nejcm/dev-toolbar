# `ext/overlays`

Layout boxes, a column grid, an element inspector and focus order — drawn over
your page, never intercepting a click. Four overlays ship; each is toggled and
persisted independently.

- **Subpath:** `@nejcm/dev-toolbar/ext/overlays`
- **Factory:** `overlays(options?)` → `DevToolbarExtension`
- **Full documentation:** [docs/ext/overlays.md](../../../docs/ext/overlays.md)

```tsx
const extensions = [overlays({ grid: { columns: 12, maxWidth: 1200 } })];
```

## Files

| File | What is in it |
| --- | --- |
| `index.tsx` | The factory and the per-overlay toggle commands |
| `runtime.ts` | Measurement, observers, persistence and the draw model |
| `ui.tsx` / `css.ts` | The chip, the panel and the overlay surface |
| `types.ts` | `OverlayId`, the overlay metadata, and why the other nine were left out |

## The constraints matter as much as the features

As the first extension drawing over the host app:

- **Never intercepts a pointer event.** The surface and everything in it is
  `pointer-events: none !important`, so clicks always reach the page. The
  inspector only *observes* the pointer, through a passive capturing listener
  and `elementFromPoint`.
- **Draws below the toolbar, never over it** — `z-index: -1 !important` inside
  the toolbar root's stacking context, so overlays sit over the page but under
  the bar, panel and command palette.
- **Mutates no host DOM node.** No injected classes or inline styles; geometry
  comes from `getBoundingClientRect`, `getComputedStyle` and a
  `MutationObserver`. The sole exception is the layout-boxes stylesheet, one
  `<style>` in `document.head`, removed on toggle-off, on hide and on teardown.
- **Observes nothing it is not drawing for.** Listeners are per-overlay and all
  come off while the bar is hidden — this extension decides "hidden" for itself;
  core never pauses anybody.
- **A throw switches everything off.** Measurement runs inside animation frames
  and a `MutationObserver`, where nothing upstream could catch it.

`OverlayId` in `types.ts` records why the other overlays in the original plan
are absent: a re-render flash needs React internals, and stacking-context or
scroll-container overlays need `getComputedStyle` on every element in the
document.

## Commands

`<id>.toggle.<overlayId>` for each of `boxes`, `grid`, `inspect`, `focus`, plus
`<id>.disableAll`. The toggles use the function form of `commands`, since the
Show/Hide label depends on live state.

## Options that change behaviour

`defaults`, `grid`, `persist`, `focusLimit`, `mutationDebounceMs`,
`deferOutlinesUntilStyleNonce`.

## Tests

`__tests__/runtime.test.ts` for measurement, observers and persistence;
`overlays.test.tsx` for the panel, the chip and the toggle commands.
