# Overflow

When the bar runs out of room, the shell collapses extensions into a `⋮`
menu — lowest `priority` first — and a collapsed extension stays fully usable
from inside that menu. One extension is one overflow unit, however many things
it renders into the bar.

## Sub-features

- `overflow-collapse` collapses in ascending `priority` as the bar narrows.
- `overflow-button` shows a `⋮` button named `More developer toolbar items`
  only while something is collapsed.
- `overflow-menu` lists the collapsed extensions and keeps them working.
- `overflow-dismiss` closes the menu on `Escape` (returning focus to the
  button) and on an outside click.
- `overflow-restore` puts everything back, and hides the button, as the bar
  widens again.

## How to get to it (user POV)

- Narrow the browser window until chips disappear from the bar.
- Click the `⋮` button, or focus it and press `Enter`.
- Use a collapsed extension from inside the menu.
- Press `Escape`, or click outside the menu.

## Driving it with the Browser pane

Preconditions:

- Baseline per [README](./README.md), at a viewport ≥ 1280 px wide.
- The Browser pane is displayed. With a pinned viewport the *layout* exists in
  a hidden pane, but the *collapse* does not happen: it runs off a
  `ResizeObserver`, and a hidden pane delivers no frames at all (see
  [shell.md](./shell.md) Gotchas). If you must drive it hidden, follow every
  `resize_window` with a `computer {"action":"screenshot"}` before reading,
  and say in the report that the check was screenshot-flushed — the observer
  then sees one coalesced size change rather than the stream a visible resize
  produces, so it is a weaker test of the oscillation guard below.

- **Nothing collapsed at full width.** Probe. `overflow.buttonVisible` is
  `false` and `bar` lists all twelve baseline ids.
- **Narrow the window.** `resize_window` with `{"width": 520, "height": 800}`,
  then re-read until it settles. Probe: `overflow.buttonVisible` is `true`,
  `overflow.buttonLabel` is `More developer toolbar items`, and `bar` is down
  to `environment`, `cmds`, `flags`, `command-menu`, `user`.
- **Collapse order.** The seven ids missing from `bar` are exactly
  `theme-editor`, `overlays`, `metrics`, `hydr`, `tw`, `boom`, `diagnostics` —
  everything below `flags`' priority of 80. Lowest priority goes first, so the
  order they leave the bar in as it narrows is `boom` (5), `diagnostics` (10),
  `hydr` (20), `metrics` (35), `theme-editor` (45), `overlays` (55), `tw` (70):
  `tw` is the last of the seven to collapse, not `theme-editor`. The
  priorities are in `examples/playground/src/extensions.tsx`; re-derive them
  there rather than trusting this list.
- **Open the menu.** Click `[data-dtb-part="overflow-button"]`. Probe:
  `overflow.menuOpen` is `true`, `overflow.expanded` is `"true"`, and
  `overflow.menuItems` lists those same seven ids in bar order.
- **A collapsed extension still works.** Click the `overlays` entry inside the
  menu (`[data-dtb-part="overflow-menu-item"][data-dtb-ext-id="overlays"] [data-dtb-part="trigger"]`)
  and drive it per [overlays.md](./overlays.md). The overlay turns on from
  inside the `⋮` menu.
- **Dismiss.** Press `Escape`. Probe: `overflow.menuOpen` is `false`; the
  active element is the `⋮` button. Reopen, then click the page body:
  the menu closes and focus stays where the click put it.
- **Restore.** `resize_window` with `{"preset": "desktop"}`, then re-read.
  Probe: `overflow.buttonVisible` is `false` and `bar` is back to twelve.
- **The collapse never loops.** *(Listener mechanics confirmed live; the
  stepping sequence itself not yet driven end to end.)* This is a claim about
  what does *not* happen while the bar is stressed, and the before/after
  pattern cannot carry it. The failure signal is an `ErrorEvent` on `window`
  reading `ResizeObserver loop completed with undelivered notifications`
  (Firefox words it `ResizeObserver loop limit exceeded`) — the browser
  reporting that an observer callback changed a size it was itself
  delivering — and it carries no `Error` object, so `read_console_messages`
  does not list it, `onlyErrors` or not. Install the listener **before** the
  first resize, in one `javascript_tool` call:
  `window.__dtbErrors = []; addEventListener("error", (e) => window.__dtbErrors.push(e.message))`.
  Then step the viewport — `resize_window` at 1280, 900, 700, 520, 400 and
  back up, a screenshot after each step if the pane is hidden — and read
  `window.__dtbErrors` at the end next to the probe. Empty is the pass; one
  entry is the failure, and the probe snapshot beside it says which layout
  it fired at. `console.error` and uncaught exceptions *do* reach
  `read_console_messages`, and the `boom` extension contributes two `[error]`
  entries on every load, so "no errors in the console" is neither the
  assertion nor achievable.
- **Proof.** Capture the narrow-width probe snapshot (with `menuItems`
  populated) and a screenshot at 520 px showing the `⋮` in the bar. For the
  loop check, capture the `__dtbErrors` array with the viewport sequence that
  produced it.

## Gotchas

- **A collapsed extension is removed from its region and re-rendered inside the
  menu.** So there is no "overflowed" flag on a bar item to wait for, and the
  probe publishes none. The `bar` list shrinking, and the id turning up in
  `overflow.menuItems`, is the signal.
- `menuItems` is empty until the menu is actually opened. An empty list with
  `buttonVisible: true` means "not opened yet", not "nothing collapsed".
- Collapse runs off a `ResizeObserver`, so a probe fired a few hundred
  milliseconds after `resize_window` can still show the old layout. Re-read
  until two snapshots agree — with a `computer {"action":"screenshot"}`
  between them when the pane is hidden. Without one no frame is ever
  delivered, the two reads agree trivially, and the "settled" layout is the
  old one: the false negative this feature is most exposed to.
- Item widths are cached per extension. On `main` as this was written they
  are measured once, so a chip that grows after mount (metrics as numbers
  arrive) keeps its mount-time width until the next resize. The pending PR
  stack #21–#28 (`fix(core): survive hydration, self-resizing chips …`) puts
  a `ResizeObserver` on every item host, so such a chip re-measures itself and
  can flip the collapsed set on its own — at most **four** item-driven flips,
  after which item resizes are ignored until the bar's own width changes
  (`MAX_ITEM_DRIVEN_FLIPS` in `src/core/Overflow.tsx`). Source-confirmed,
  not driven: that latch is the oscillation guard the loop check above
  stresses, and the count is a checksum to re-derive from the source, not a
  constant.
- `command-menu` collapses like anything else, and `⌘K` keeps working when it
  does — it lives in the overlay slot. Do not treat a missing `⌘K` chip as a
  broken palette.
- Viewport emulation persists on the tab across reloads until you send
  `{"preset": "desktop"}`. Leaving it set poisons every later recipe.
