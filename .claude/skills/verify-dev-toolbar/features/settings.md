# Viewer settings

A cog at the end of the bar opens the viewer's own Settings menu: position,
density and colour scheme (in that order) for the whole bar, then one row per present
extension with a "shown in bar" checkbox and, for the seven extensions that
declare `presets`, a presentation preset. Every change is written to the
toolbar's storage — except picking the consumer's own default, which removes
the key instead — so it survives a reload, and **Reset toolbar settings**
returns all of it to the consumer's defaults without touching the open panel,
the panel height or any extension's own data.

## Sub-features

- `settings-button` is a `⚙` button named `Toolbar settings`, rendered after
  the `⋮` and never collapsed. `settings={false}` removes it.
- `settings-menu` is a popover (role `group`, same name) with the shared
  disclosure rules: focus moves in on open, `Escape` and an outside click
  close it, and opening it closes the `⋮` menu and vice versa.
- `settings-toolbar` changes density (`compact`/`comfortable`), colour scheme
  (`system`/`light`/`dark`) and position (`top`/`bottom`).
- `settings-shown` hides an extension from the bar and the `⋮` only; it keeps
  running, its commands stay in `⌘K`, and it stays in `read().diagnostics`.
- `settings-preset` replaces the extension's factory `preset` with the
  viewer's; `Extension default` clears it. `agent` and `command-menu` have no
  preset row. Rows are named by label, with the id added only when two present
  extensions share one (`Commands (cmds) shown in bar`).
- `settings-persist` writes `density`, `colorScheme`, `position` and
  `extensionSettings` under `dtb:v1:playground:` and re-applies them on load.
- `settings-reset` removes exactly those four keys. The button is sticky at
  the bottom of the scrolling menu, so it stays in view.

## How to get to it (user POV)

- Click the `⚙` at the right-hand end of the bar.
- Pick a density or colour scheme, untick an extension's "shown in bar", or
  pick a preset from its select.
- Reload: the bar comes back the way you left it.
- Open the menu again and click **Reset toolbar settings**.

## Driving it with the Browser pane

Preconditions:

- Baseline per [README](./README.md), viewport 2600×800 for the preset step
  so `metrics` is seated in the bar rather than the `⋮`.
- Storage starts clean (a fresh `:5274` context in e2e; on `:5273` run the
  Reset step first).

Everything here is `read().shell` plus `storage()`: `settings`
(`{present, open}`), `density`, `colorScheme`, `bar` and `overflow`.

- **At rest.** Read: `shell.settings` is `{present: true, open: false}`,
  `density` `"compact"`, `colorScheme` `"system"`.
- **Open.** Click `[data-dtb-part="settings-button"]`. Read:
  `shell.settings.open` is `true`.
- **Toolbar section.** Check the `Comfortable` and `Dark` radios. Read:
  `shell.density` is `"comfortable"`, `shell.colorScheme` is `"dark"`;
  `storage()` has `density: "\"comfortable\""` and
  `colorScheme: "\"dark\""`.
- **Preset.** Measure the `metrics` item's width
  (`[data-dtb-part="item"][data-dtb-ext-id="metrics"]`), then choose `Label`
  in the `Metrics presentation preset` select. The item is narrower — its
  values are gone — and `storage().extensionSettings` has
  `metrics: {preset: "label"}`. Width is the proof here: the bridge does not
  publish which preset a control painted.
- **Shown in bar.** Untick `Overlays shown in bar`. Read: `overlays` is in
  neither `shell.bar` nor, once the `⋮` is open, `shell.overflow.items`, but
  is still in `read().diagnostics`; `extensionSettings` has
  `overlays: {shown: false}`.
- **Reload.** `navigate` to the same URL and wait for the bridge. Every read
  above holds again and `shell.settings.open` is back to `false`.
- **Reset.** Open the menu and click **Reset toolbar settings**. Read:
  `density` `"compact"`, `colorScheme` `"system"`, `overlays` reachable
  again, the `metrics` item back to its default width, and `storage()` has no
  `density`, `colorScheme` or `extensionSettings` key.
- **Charged width.** At several widths from 1280 px down the bar's `scrollWidth`
  equals its `clientWidth` and the cog's box is inside the bar's: the collapse
  machine counts the cog before seating items.
- **Keyboard.** Focus the `⋮` and press `Tab`: the active element is
  `[data-dtb-part="settings-button"]` (a DOM read — focus is not published).
- **Proof.** The before/after bridge reads with `storage()`, and a screenshot
  of the open menu at 1280 px and at 375 px.

`examples/playground/e2e/settings.spec.ts` runs every step above.

## Gotchas

- The menu and the `⋮` share one coordination event on the bar element, so
  opening either closes the other. The event does not reach `document`.
- `/?geometry` passes `settings={false}`: its thresholds are exact sums of
  item widths and gaps, and a cog would shift every one of them.
- The playground's header **Density** toggle changes the consumer's default,
  not the Setting. A stored density wins over it until Reset.
- A stored preset an extension no longer lists is ignored, not an error — the
  select shows `Extension default`.
- Reset leaves `visible`, `activePanel` and `panelHeight` alone; an open panel
  stays open through it.
