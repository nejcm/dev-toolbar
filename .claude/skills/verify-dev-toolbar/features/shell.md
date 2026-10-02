# The shell

The shell is the part of the package that ships no opinions: it renders one
fixed bar of extension chips, hosts at most one panel at a time, publishes its
own height so the app can inset around it, and brings visibility, position and
the open panel back after a reload.

## Sub-features

- `shell-mount` mounts a `toolbar` named `Developer toolbar` with every
  extension the app passed, in `order` within its `align` region.
- `shell-panel` opens one panel at a time; opening a second evicts the first.
- `shell-position` moves the bar between `bottom` and `top` after mount.
- `shell-visible` hides and shows the bar, including from the keyboard.
- `shell-height` publishes `--dev-toolbar-height-playground` on `<html>`,
  covering bar *plus* open panel, and `DevToolbarInset` pads by it. As the only
  toolbar on the page it publishes the unsuffixed `--dev-toolbar-height` too.
- `shell-persist` restores position, visibility, active panel and panel height
  from `dtb:v1:playground:*` after a reload.
- `shell-isolate` keeps a throwing extension (`boom`) inside one error chip.

## How to get to it (user POV)

- Click any chip in the bar to open its panel; click it again to close.
- Drag the `separator` named `Resize developer toolbar panel` to resize a panel.
- Press `Cmd+Shift+.` (macOS) or `Ctrl+Shift+.` elsewhere to toggle the bar.
- Use the playground's own header controls to change what the *app* passes:
  `toggle-position`, `toggle-visible`, `toggle-density`, `toggle-inset`,
  `toggle-enabled`.
- Reload the page.

## Driving it with the Browser pane

Preconditions:

- Baseline per [README](./README.md); the page read's `storage` is `{}`.
- A viewport is pinned: `resize_window` with `{"width": 1280, "height": 800}`.
  Without it, a hidden Browser pane reports a zero-sized viewport (see
  Gotchas).
- Every keyboard step asserts its effect. Key delivery to a hidden pane has
  been measured both ways (none at all in an earlier run; every key landed on
  2026-10-02 with `tabs_context` reporting the pane hidden), so a key that
  changed nothing is a dropped event until a retry says otherwise.
- If it is hidden anyway, every frame-driven step below — the height variable
  and inset after a panel opens, anything the bar re-lays out — is *act →
  `computer {"action":"screenshot"}` → read*, and the report says so (see
  Gotchas).

- **Mount.** State read (`curl … /state`, or the bridge in-page). `instanceId`
  is `"playground"`, `shell.mounted` is `true`, and `diagnostics` carries the
  seventeen-entry roster. `shell.bar` is the *width-dependent* subset — 9
  ids at the mandated 1280×800 on 2026-10-02, see the README — so assert on the ids you care
  about, not on a count.
  The bar's accessible name is not published state — check it with `find` for
  role `toolbar` name `Developer toolbar`.
- **Open a panel.** Click the flags chip: `find` for role `button` name
  `Flags`, then click the ref. Bridge read: `shell.activePanel` is `"flags"`,
  the matching `shell.bar` entry has `panelOpen: true`, and (page read)
  `storage["dtb:v1:playground:activePanel"]` is `"\"flags\""`.
- **One panel at a time.** Click the environment chip, by CSS selector:
  `find` role `button` name `Environment, staging` (its `aria-label`; it
  gains `, impersonating` while impersonation is on), or
  `[data-dtb-part="item"][data-dtb-ext-id="environment"] [data-dtb-part="trigger"]`. Bridge read:
  `shell.activePanel` is `"environment"` and no other `shell.bar` entry reports
  `panelOpen`.
- **Height and inset follow the panel.** Read before and after opening a panel.
  `shell.heightVariable` is
  `{name: "--dev-toolbar-height-playground", value: "32px"}` at rest (compact
  density) and grows to the bar-plus-panel height (`352px` at the default
  panel height, measured 2026-10-02); the page read's `inset.bottom` equals it
  exactly. The bridge reports only the instance-scoped name; the unsuffixed
  `--dev-toolbar-height` is published as well because this is the page's only
  toolbar — read it with
  `getComputedStyle(document.documentElement).getPropertyValue("--dev-toolbar-height")`,
  which should equal the bridge value. The playground has no on-page readout
  of either.
- **Move the bar.** Click `[data-testid="toggle-position"]`. Bridge read:
  `shell.position` is `"top"`. Page read: `inset.position` is `"top"`,
  `inset.top` carries the height, `inset.bottom` is `0px`, and
  `storage["dtb:v1:playground:position"]` is `"\"top\""`.
- **Keyboard toggle.** Click the page body once so the document has focus, then
  `computer {"action":"key","text":"cmd+shift+."}` on macOS, `ctrl+shift+.`
  elsewhere — the literal `.`; `ctrl+shift+period` reaches the page as some
  other key and toggles nothing. Bridge read: `visible` is
  `false` and `shell.mounted` is `false` — a hidden bar is removed from the
  DOM, not just visually hidden. The handle keeps answering throughout: core
  reports visibility and never pauses an extension on its behalf, so nothing
  is torn down and only the *rendered* shell goes. Page read:
  `storage["dtb:v1:playground:visible"]` is `"false"`.
- **Mod is exclusive.** Send `ctrl+shift+.` on macOS. Nothing changes:
  `visible` and the stored `visible` are unchanged.
- **Persistence.** With position `top`, visibility `false` and an active panel
  stored, `navigate` to `http://localhost:5273/`. The same three
  `dtb:v1:playground:*` values come back, the header readouts agree
  (`position: top`, `visible: false`), and re-showing the bar reopens the
  stored panel (`shell.activePanel`).
- **Error isolation.** Page read at baseline. `errorChips` contains exactly
  `{extension: "boom", slot: "compact"}` (with `role="status"`) — but only
  while `boom` is rendered: at 1280×800 it is collapsed, so open the `⋮` menu
  first. `diagnostics` still carries all seventeen roster entries and every other extension is still reachable in
  `shell.bar` or `shell.overflow` — one extension throwing from both slots
  costs one chip and nothing else. This is the one extension fact still read from markup, and
  deliberately: a slot that threw rendered nothing and has no state to
  publish. `read().diagnostics` will list `boom` as `absent`, which is a
  different claim.
- **Proof.** Capture the before/after bridge reads around the panel open and
  the position change, plus a screenshot with the bar at `top` and the app
  content visibly padded above it.

## Gotchas

- **A hidden Browser pane breaks three things, differently.** Geometry:
  `innerWidth`, `getBoundingClientRect()` and the published height variable all
  read `0`, so every measurement here silently "fails" — fix it by pinning a
  viewport with `resize_window` (`{"width": 1280, "height": 800}`), which works
  whether or not the pane is on screen, and reset it in cleanup. Keyboard:
  one run saw `computer {"action":"key"}` reach the page not at all while
  hidden; the 2026-10-02 run saw `ctrl+k`, `Enter`, `Escape` and
  `ctrl+shift+.` all land with `tabs_context` reporting the pane hidden. Assert
  every key's effect, retry once, and only then ask the user to show the pane
  rather than reporting a shortcut as broken. Frames: while the pane is
  hidden the document is `visibilityState: "hidden"` and the browser suspends
  the rendering pipeline outright — `requestAnimationFrame` never ticks and
  `ResizeObserver` callbacks are never delivered, not even the initial
  notification `observe()` owes (measured: 3.5 s, zero of either). This is
  suspension, not throttling, and the pinned viewport does not lift it:
  timers, `getBoundingClientRect()` and `resize_window` keep working, so the
  DOM reads as live and consistent while still showing the layout from before
  the last frame-driven step. The one call that forces a compositor frame, and
  flushes the pending observer deliveries with it, is
  `computer {"action":"screenshot"}` — about four rAF ticks and one coalesced
  `ResizeObserver` delivery per screenshot; `computer {"action":"wait"}`
  forces nothing. Act, screenshot, then read, and say in the report that the
  check ran screenshot-flushed: the observer then sees one coalesced size
  change instead of the stream a visible resize produces, so it is a weaker
  test of anything that guards against oscillation.
- `shell.heightVariable.name` reports the instance-scoped
  `--dev-toolbar-height-playground`. The *unsuffixed* name is also published
  while this is the only instance, and is absent while the toolbar is disabled
  or a second instance is mounted.
- Position, visibility and the active panel are store state, not props.
  Re-rendering `<DevToolbar>` with a different `defaultPosition` will not move
  a bar that already has a stored position.
- `padding` on the inset lags the height variable by a frame after a position
  change. Re-read rather than asserting on the first snapshot — and in a
  hidden pane, screenshot first, because that frame otherwise never arrives.
- `shell` is the one thing the bridge reads off the DOM, because the shell is
  core and core has no extension to publish through `diagnostics()`. So it
  reports what is *rendered*: with the bar hidden, `shell.mounted` is `false`
  and every other `shell` field is `null` or empty — use `visible` beside it
  to tell "hidden" from "never mounted".
- `enabled: false` unmounts everything, storage included — use it to prove the
  kill switch, never as a way to reach a clean baseline.
- The playground's `data-testid` header buttons drive the *app's* props. They
  are fixtures for reaching a state; the library behavior under proof is what
  happens after.
