# Command menu

`/ext/command-menu` is a palette over core's command aggregation, and it is an
ordinary extension — core aggregates commands and renders no palette of its
own. It re-enumerates on every open, so a command an extension added after
mount is there; it runs commands by id through core, so a removed command
reports itself gone instead of firing a stale closure; and a command that
throws is caught and shown in the palette rather than reaching the app.

## Sub-features

- `cmd-open` opens from the bar chip and from `Mod+K`.
- `cmd-enumerate` lists every command every visible extension contributes,
  grouped by extension.
- `cmd-filter` narrows the list as you type and shows an empty state.
- `cmd-run` runs the selected command and closes.
- `cmd-keys` moves with `↑`/`↓`/`Home`/`End` and dismisses with `Escape`.
- `cmd-late` sees a command added after mount, with no reload.
- `cmd-error` keeps the palette open and shows the message when a command
  throws.

## How to get to it (user POV)

- Click the `⌘K` chip at the end of the bar.
- Press `Cmd+K` (macOS) or `Ctrl+K` elsewhere, with focus outside a text field.
- Both still work when the chip has collapsed into `⋮`.
- The playground's `cmds` panel lists the same commands as plain buttons — the
  declarative snapshot core exposes, plus a `Re-enumerate` button.

## Driving it with the Browser pane

Preconditions:

- Baseline per [README](./README.md), viewport pinned to 1280×800.
- The Browser pane is displayed — every step here is keyboard-driven.

- **Open with the keyboard.** Click the page body, then `computer`
  `{"action":"key","text":"cmd+k"}`. Probe: `commandMenu.open` is `true`,
  `commandMenu.inputValue` is `""`, `commandMenu.options` has 29 entries at
  baseline, and the first option is selected.
- **Enumeration.** The option labels are the real command labels, e.g.
  `Capture a diagnostic snapshot`, `Copy environment summary`,
  `Clear all local flag overrides`, `Reset performance metrics`,
  `Show overlay: Column grid`, `Turn every overlay off`,
  `Reset every theme edit`. With an empty query the palette is *browsing*, so
  the grouping is in the section headings, not on the options:
  `commandMenu.sections` is `Diagnostics`, `Environment`, `Flags`, `Overlays`,
  `Theme`, `Metrics`, and every option's `group` is `null` — the group is
  rendered per option (`[data-dtb-part="cmd-option-group"]`) only for a
  section with no heading of its own, which is what *searching* produces. Once
  you type, `sections` is empty and each option carries its extension in
  `group` instead (`Show overlay: Column grid` → `Overlays`).
- **Filter.** `computer` `{"action":"type","text":"grid"}`. Probe:
  `commandMenu.options` narrows to four, led by `Show overlay: Column grid`,
  selected. Type `zzzz` instead and `commandMenu.empty` carries the empty
  message as a `status`.
- **Run.** With `Show overlay: Column grid` selected, send
  `{"action":"key","text":"Enter"}`. Probe: `commandMenu` is `null` (closed)
  and the `overlays` chip reads `overlays1 on`. Continue in
  [overlays.md](./overlays.md).
- **Dismiss.** Reopen, send `Escape`. Probe: `commandMenu` is `null` and no
  `cmd-scrim` remains in the DOM.
- **Added after mount.** Click `[data-testid="flag-add"]`, which adds a flag to
  the app's catalogue with no reload. **Wait one flags poll (400 ms)** before
  reopening: the flags extension re-reads the app's catalogue on that poll and
  its per-flag toggle commands come off that snapshot, so a palette reopened
  immediately can legitimately still be a poll behind. Then reopen and filter
  for `runtime-`: the new flag's toggle command is listed — proof the palette
  re-enumerates rather than rendering a captured list.
- **Proof.** Capture the probe snapshot with the filtered option list, the
  snapshot after running the command showing the overlay on, and a screenshot
  of the open dialog.

## Gotchas

- **Send `Enter`, not `Return`.** The dialog's handler is a
  `switch (event.key)` with `case "Enter"`, so a key delivered as `Return`
  matches nothing and the palette sits there looking unresponsive.
- **The filter is per word, ANDed, not a substring match over the whole
  label.** The query is split on whitespace and a command survives only if
  *every* term matches something (label, group, keywords), each term scored by
  prefix / word-start / infix / subsequence. So typing more only ever narrows:
  `grid` leaves four options, `Column grid` narrows to exactly
  `Show overlay: Column grid`. A term that matches nothing empties the list,
  however good the other terms are — `grid zzzz` is empty, not "grid".
- `Tab` is swallowed on purpose — the input is the only focusable thing inside
  an `aria-modal` dialog. Do not use it to move between options.
- The palette lives in the `overlay` slot, not a panel, so opening it does not
  evict an open panel and it survives its own chip collapsing into `⋮`.
  A missing `⌘K` chip at a narrow viewport is not a broken palette.
- It contributes no commands of its own; if the list is empty, the fault is in
  the extensions, not here.
- With focus inside a text field, `Cmd+K` may be consumed by the field.
- `29` is the baseline count for the playground's extension set. It moves the
  moment an extension gains or loses a command — treat it as a checksum to
  re-derive, not a constant.
