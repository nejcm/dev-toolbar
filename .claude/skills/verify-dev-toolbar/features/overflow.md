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

Everything here is `read().shell` — `bar` (what is still in the regions) and
`overflow` (`{present, open, items}`).

- **Nothing collapsed at full width.** Read. `shell.overflow.present` is
  `false` and `shell.bar` lists all sixteen roster ids. **1280×800 is not
  wide enough for this** — measured there, `overflow.present` is already `true`
  with 8 items in the bar. Widen until `present` flips to `false` and say in
  the report what width that took, or treat this step as unrun.
- **Narrow the window.** `resize_window` with `{"width": 520, "height": 800}`,
  then re-read until it settles. Read: `shell.overflow.present` is `true` and
  `shell.bar` is down to the highest-priority chips — `environment`, `cmds`,
  `command-menu`, `user` (measured 2026-09-08; `flags` collapsed too once the
  playground grew its TanStack chips, so assert on containment and order,
  never on this exact list). The `⋮` button's accessible name is not published state — `find`
  role `button` name `More developer toolbar items` if you want to assert it.
- **Collapse order.** The ids missing from `bar` are `agent`, `theme-editor`,
  `overlays`, `metrics`, `hydr`, `tw`, `boom`, `diagnostics` — everything below
  `flags`' priority of 80. Lowest priority goes first, so the order they leave
  the bar in as it narrows is `agent` (-1), `boom` (5), `diagnostics` (10),
  `hydr` (20), `metrics` (35), `theme-editor` (45), `overlays` (55), `tw` (70):
  `tw` is the last of them to collapse, not `theme-editor`. The
  priorities are in `examples/playground/src/extensions.tsx`; re-derive them
  there rather than trusting this list.
- **Open the menu.** Click `[data-dtb-part="overflow-button"]`. Read:
  `shell.overflow.open` is `true` and `shell.overflow.items` lists those same
  ids in bar order — ascending `order`, **not** priority (`metrics`, order 30,
  comes before `kit-demo`, order 40, despite the lower priority); `agent` keeps
  the default `order: 90` and so renders last. `items` is `[]` while the menu
  is closed; read it only after opening. The rows are
  `flex-shrink: 0`, so a menu taller than its 50vh cap scrolls rather than
  letting a tall row (the metrics list) paint over its neighbours —
  `e2e/overflow.spec.ts` guards this.
- **A collapsed extension still works.** Click the `overlays` entry inside the
  menu (`[data-dtb-part="overflow-menu-item"][data-dtb-ext-id="overlays"] [data-dtb-part="trigger"]`)
  and drive it per [overlays.md](./overlays.md). The overlay turns on from
  inside the `⋮` menu.
- **Dismiss.** Press `Escape`. Read: `shell.overflow.open` is `false`; the
  active element is the `⋮` button (a DOM read — focus is not published).
  Reopen, then click the page body: the menu closes and focus stays where the
  click put it.
- **Restore.** `resize_window` with `{"preset": "desktop"}`, then re-read.
  Read: `shell.bar` is back to whatever the un-emulated pane fits — which is
  `overflow.present: false` and sixteen ids only if the pane is wide enough,
  the same caveat as the first step.
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
  `window.__dtbErrors` at the end next to a bridge read. Empty is the pass;
  one entry is the failure, and `shell.bar` beside it says which layout
  it fired at. `console.error` and uncaught exceptions *do* reach
  `read_console_messages`, and the `boom` extension contributes two `[error]`
  entries on every load, so "no errors in the console" is neither the
  assertion nor achievable.
- **Proof.** Capture the narrow-width bridge read (with
  `shell.overflow.items` populated) and a screenshot at 520 px showing the `⋮`
  in the bar. For the loop check, capture the `__dtbErrors` array with the viewport sequence that
  produced it.

## Isolated geometry proof

`/?geometry` mounts three fixed-width hosts and the real agent bridge, without live
metrics that could trigger unrelated reads. `e2e/overflow.spec.ts` proves:

- Viewport 320 → 299 → 320 px collapses `low` and restores it.
- At 500 px, clicking `Grow chip` changes only the chip's own React state and width,
  collapsing `low` while the bar's box stays unchanged. `Shrink chip` leaves it
  collapsed: the cycle latch refuses the previously seen decision. A resize to
  501 px restores it.
- Chromium 153, viewport 320×800: changing only `--dtb-item-gap` from 10 to
  40 or 140 px delivers an item observer callback as the Bridge host shrinks,
  but no bar observer callback. All three ids remain in the bar, with no `⋮`,
  throughout a 1-second observation with active animation frames.
- At 140 px gap, `low` reaches x=330 in the 320 px bar and overlaps Bridge.
  `overflow: hidden` clips the chip, with no menu to reach it. This is a
  latent defect, pinned without a behavior fix.
- Resizing to 319 px delivers a bar callback and recovers: 40 px gap collapses
  `low`; 140 px gap collapses `low` and `agent`. The menu appears and clipping ends.
- On a fresh page, changing only horizontal padding from 10 to 30 px per side
  leaves gap at 10 px and the bar's outer width at 320 px. The bar observer reports
  content width 300 → 260 px; `low` collapses and `⋮` appears within the observation.

The item signal is incidental to core's `max-width: 100%` item cap within
`min-width: 0` regions; a gap change need not deliver any observer callback if
no observed box resizes. Item callbacks supply widths only. In these cases the
smaller widths fit under the cached gap, so collapse does not change, `sync()`
does not run, and no commit from that callback refreshes gap.

Reachability is low: first-party extensions do not change this gap at runtime,
and the theme editor rejects toolbar tokens. Initial CSS and density prop changes
are read on commits. The stale decision heals on the next commit involving
`OverflowBar`, including a panel toggle, or bar resize. The 40 px gap did not clip;
the 140 px gap on a 320 px viewport did. This latent defect does not block merging
this docs and tests change. See `docs/architecture.md` §5 for the mechanism.

Successful runs attach before/after bridge state, native observer callback logs,
geometry and screenshots. The geometry page does not install the app's HTTP
reporter, so these tests use its in-page agent bridge. Native `ResizeObserver`
callbacks are wrapped before mount and forwarded unchanged. The negative gap
observation is bounded to one second; it does not prove that no later event can
recover the bar.

## Gotchas

- **A collapsed extension is removed from its region and re-rendered inside the
  menu.** So there is no "overflowed" flag on a bar item to wait for.
  `shell.bar` shrinking, and the id turning up in `shell.overflow.items`, is
  the signal.
- `shell.overflow.items` is empty until the menu is actually opened — core
  renders its contents on open. An empty list with `present: true` means "not
  opened yet", not "nothing collapsed". Diffing `shell.bar` against
  `read().diagnostics` happens to give the collapsed set today **while
  `shell.mounted` is `true`**, because both lists are "present and not hidden"
  — every extension gets a bar item, even one with no `compact` and no `panel`
  (core falls back to a `<span>` of its label). Check `shell.mounted` first:
  core removes the root rather than hiding it, so a hidden bar (`visible:
  false`) reports `shell.bar: []` while the roster is still full, and the diff
  then reads "everything collapsed" when nothing is. Even mounted, those are
  two independent filters in two files, so treat the diff as a cross-check,
  not the assertion: `present` says *something* collapsed, and opening the menu
  says *what*.
- The `agent` extension collapses first (`priority: -1`), so at any narrow
  width it is in the menu rather than the bar. Its handle is unaffected — the
  bridge is not its chip.
- Collapse runs off a `ResizeObserver`, so a read fired a few hundred
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
