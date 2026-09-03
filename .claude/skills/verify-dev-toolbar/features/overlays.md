# Overlays

`/ext/overlays` draws diagnostic layers — layout boxes, a column grid, an
element inspector, focus order — over the page. Three properties matter and all
three are invisible to jsdom: the layers sit above the app, they never sit
above the toolbar's own surfaces, and they take no pointer events, so the page
underneath stays usable while one is on.

## Sub-features

- `overlay-toggle` turns each of the four overlays on and off independently.
- `overlay-draw` renders over the app's content.
- `overlay-under-chrome` stays below the bar, the panel and the palette.
- `overlay-click-through` passes clicks to whatever is underneath.
- `overlay-flags` marks controls with no accessible name and a positive
  `tabindex` in focus order (and, with the pending PR stack, `aria-hidden`
  focusables — see Gotchas).
- `overlay-clear` leaves no trace once every overlay is off.

## How to get to it (user POV)

- Click the `overlays` chip to open its panel, then turn one on.
- Run `Show overlay: <name>` or `Turn every overlay off` from `⌘K`.
- Both work from inside the `⋮` menu when the bar is narrow.

## Driving it with the Browser pane

Preconditions:

- Baseline per [README](./README.md), viewport pinned to 1280×800.
- The `overlays` chip reads `overlaysoff` and every probe `overlays[]` entry
  reads `children: 0` (`childPointerEvents: null`, since there is no layer).

- **Turn one on.** Open `⌘K`, type `Column grid`, send `Enter` (see
  [command-menu.md](./command-menu.md)). Probe: the `overlays` chip reads
  `overlays1 on` and the `overlays` entry of `overlays[]` reads `children: 1` —
  the layer, inside the host. The `command-menu` entry is back to `children: 0`
  once the palette has closed.
- **It covers the page.** Read the overlay child's rect
  (`document.querySelector('[data-dtb-part="overlay"][data-dtb-ext-id="overlays"]').firstElementChild`):
  it spans the full viewport — `top: 0`, `bottom: 800` at the pinned 1280×800.
  A screenshot shows the column guides over the playground's tiles.
- **It is not above the toolbar.** Compute
  `document.elementFromPoint(shell.barRect.left + 20, shell.barRect.top + shell.barRect.height / 2)`
  from the probe's own `shell.barRect` (which carries `left` and `width`
  alongside `top`/`bottom`/`height`). The result is inside the bar — at
  baseline, the environment chip's `env-label` — never the overlay. Assert the
  stacking, not the geometry: the layer's rect *does* extend across the bar's
  coordinates, and it is `pointer-events: none` plus the root's
  `z-index: 2147483000` that keep the bar on top. Close the palette first: its
  own `cmd-scrim` is over the bar while it is open, and `elementFromPoint`
  will say so.
- **Clicks pass through.** `computer` `scroll_to` then `left_click` the
  playground's `[data-testid="overlay-click-through"]` button, with the overlay
  still on. Its label goes from `Click-through test: 0` to
  `Click-through test: 1`, and `document.elementFromPoint` over the button
  returns the button, not the overlay. In the probe, the `overlays` entry's
  `childPointerEvents` is `none` — that is the layer's computed style, read
  from the child rather than the host.
- **Focus order flags the bad controls.** Turn on `Show overlay: Focus order`.
  The playground deliberately ships `[data-testid="overlay-unnamed"]` (an
  icon-only button with `aria-hidden` content), `[data-testid="overlay-unnamed-input"]`
  and `[data-testid="overlay-tabindex"]` (`tabIndex={1}`); the overlay marks
  them.
- **Turn everything off.** Run `Turn every overlay off` from `⌘K`. Probe: the
  chip reads `overlaysoff`, every `overlays[]` entry is back to `children: 0`,
  and the page's own DOM carries nothing the extension added. The
  `dtb:v1:playground:ext:overlays:enabled` key stays behind with every flag
  `false` — that is the persisted preference, not a leftover layer.
- **Proof.** Capture the probe snapshot with the overlay on, the click-through
  counter before and after, and a screenshot with the guides drawn and the bar
  unobscured.

## Gotchas

- Every extension has an overlay host in the DOM at all times — `command-menu`
  and `overlays` both appear in the probe's `overlays[]` at baseline.
  `children` is the on/off signal, not the host's presence. (`command-menu`
  reads `children: 2` whenever the palette is open: the scrim and the dialog.)
- The host is `display: contents`, so *its* computed `pointer-events` and
  `z-index` are always `auto` no matter what the extension does — reading them
  proves nothing, which is why the probe reports the child's instead. The
  layer inside is the `pointer-events: none` one (`childPointerEvents`), and
  the stacking comes from the toolbar root's own `z-index`, so use
  `elementFromPoint` for that rather than any `z-index` comparison.
- The four overlays are independent. `overlays1 on` after two commands means
  one of them did not take.
- An overlay is drawn from measurements taken when it turned on; scrolling or
  resizing with it on can leave guides where the content no longer is. Toggle
  it off and on after moving the page.
- These are the assertions least suited to jsdom and most likely to be
  hand-waved. A screenshot alone is not proof of click-through — pair it with
  the counter.
- The focus-order scan changes with the pending PR stack #21–#28
  (`fix(ext/overlays): keep geometry current …`): an `aria-hidden="true"`
  element that is still a Tab stop is no longer skipped but badged, with a
  `[data-dtb-part="ovl-tag"]` inside its badge reading `aria-hidden` (a
  screen reader cannot see it, a keyboard user still lands on it), and
  anything inside an `inert` ancestor is skipped via `closest("[inert]")`
  rather than the element's own attribute. Source-confirmed, not driven: the
  playground ships no `aria-hidden` *focusable* — `overlay-unnamed` hides only
  its icon span — so the badge is unverifiable here until a fixture exists.
