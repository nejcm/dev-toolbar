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
  covering bar *plus* open panel, and `DevToolbarInset` pads by it.
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

- Baseline per [README](./README.md); probe `storage` is `{}`.
- A viewport is pinned: `resize_window` with `{"width": 1280, "height": 800}`.
  Without it, a hidden Browser pane reports a zero-sized viewport (see
  Gotchas).
- The Browser pane is **displayed** for the keyboard steps. `computer`
  `{"action":"key"}` delivers nothing at all while it is hidden.

- **Mount.** Probe. `mounted` is `true`, `shell.instance` is `"playground"`,
  `shell.barLabel` is `Developer toolbar`, and `bar` lists the twelve baseline
  ids in the README's order.
- **Open a panel.** Click the flags chip: `find` for role `button` name
  `Flags`, then click the ref. Probe: `panel.extension` is `"flags"`,
  `panel.label` is `Flags`, the matching `bar` entry has `panelOpen: true`, and
  `storage["dtb:v1:playground:activePanel"]` is `"\"flags\""`.
- **One panel at a time.** Click the environment chip, by CSS selector:
  `[data-dtb-ext-id="environment"] [data-dtb-part="trigger"]`. It has no
  `aria-label`, so `find` by role `button` name `Environment` matches nothing —
  its accessible name is its text content, `envstaging`. Probe:
  `panel.extension` is `"environment"` and no other item reports `panelOpen`.
- **Height and inset follow the panel.** Probe before and after opening a
  panel. `heightVariable.value` grows from `30px` to the bar-plus-panel height
  (`350px` at the default panel height) and `inset.paddingBottom` equals it
  exactly. `heightVariable.unsuffixed` stays `null` — the unsuffixed name
  belongs to `instanceId: "default"` and this app is `"playground"`.
- **Move the bar.** Click `[data-testid="toggle-position"]`. Probe:
  `shell.position` and `inset.position` are `"top"`, `inset.paddingTop` carries
  the height and `paddingBottom` is `0px`, and
  `storage["dtb:v1:playground:position"]` is `"\"top\""`.
- **Keyboard toggle.** Click the page body once so the document has focus, then
  `computer {"action":"key","text":"cmd+shift+."}`. Probe: `mounted` is
  `false` — a hidden bar is removed from the DOM, not just visually hidden —
  and `storage["dtb:v1:playground:visible"]` is `"false"`.
- **Mod is exclusive.** Send `ctrl+shift+.` on macOS. Nothing changes:
  `mounted` and the stored `visible` are unchanged.
- **Persistence.** With position `top`, visibility `false` and an active panel
  stored, `navigate` to `http://localhost:5273/`. Probe: the same three
  `dtb:v1:playground:*` values come back, the header readouts agree
  (`position: top`, `visible: false`), and re-showing the bar reopens the
  stored panel.
- **Error isolation.** Probe at baseline. `errorChips` contains exactly
  `{extension: "boom", slot: "compact"}`, and `bar` still lists all twelve
  ids — one extension throwing from both slots costs one chip and nothing else.
- **Proof.** Capture the before/after probe snapshots around the panel open and
  the position change, plus a screenshot with the bar at `top` and the app
  content visibly padded above it.

## Gotchas

- **A hidden Browser pane breaks two things, differently.** Geometry:
  `innerWidth`, `getBoundingClientRect()` and the published height variable all
  read `0`, so every measurement here silently "fails" — fix it by pinning a
  viewport with `resize_window` (`{"width": 1280, "height": 800}`), which works
  whether or not the pane is on screen, and reset it in cleanup. Keyboard:
  `computer {"action":"key"}` reaches the page not at all — not even a plain
  letter raises a `keydown` — while `left_click` and `type` keep working. There
  is no workaround for that one; `tabs_context` reports whether the pane is
  displayed, so check it and ask the user to show the pane before the keyboard
  steps rather than reporting a shortcut as broken.
- The height variable is instance-scoped: `--dev-toolbar-height-playground`.
  The playground's own `height-readout` control reads the *unsuffixed* name and
  therefore always shows `(unset)`; that readout is stale, not a regression.
- Position, visibility and the active panel are store state, not props.
  Re-rendering `<DevToolbar>` with a different `defaultPosition` will not move
  a bar that already has a stored position.
- `padding` on the inset lags the height variable by a frame after a position
  change. Re-read rather than asserting on the first snapshot.
- `enabled: false` unmounts everything, storage included — use it to prove the
  kill switch, never as a way to reach a clean baseline.
- The playground's `data-testid` header buttons drive the *app's* props. They
  are fixtures for reaching a state; the library behavior under proof is what
  happens after.
