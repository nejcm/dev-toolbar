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

Throughout, `menu` is `read().diagnostics.find(d => d.id === "command-menu").data`
— `{open, query, ready, activeIndex, activeId, commandCount, resultCount,
running, error, recent, shortcut}`.

- **Open with the keyboard.** Click the page body, then `computer`
  `{"action":"key","text":"cmd+k"}`. Read: `menu.open` is `true`, `menu.query`
  is `""`, `menu.resultCount` equals `menu.commandCount` at baseline (an empty query filters nothing), `menu.activeIndex` is `0` and
  `menu.activeId` names the first command.
- **Enumeration.** While the palette is open, `menu.commandCount` equals
  `read().commands.length` **minus the commands that declare an `input`
  schema** — the palette skips those, because it has no form to collect input
  with (contract v2). So the identity to assert, while open, is:

  ```js
  const s = window.__DEV_TOOLBAR__.instances["playground"].read();
  const menu = s.diagnostics.find((d) => d.id === "command-menu").data;
  const withInput = s.commands.filter((c) => c.input !== undefined);
  menu.commandCount === s.commands.length - withInput.length   // must hold
  ```

  `withInput` is `flags.set` and `theme-editor.setToken` in the playground
  today — derive it, never hard-code the two. That identity failing *while
  open* is the finding. Assert it **while open**: `close()` resets `query`,
  `results`, `activeIndex` and `error` but deliberately leaves `commands`
  alone, so a closed palette still reports the last enumeration
  (`resultCount: 0`, `activeIndex: -1`, `commandCount` unchanged). A non-zero
  `commandCount` after `Escape` is the resting state, not a captured list
  being served — re-enumeration is what `cmd-late` proves, and it proves it by
  a command *appearing* on the next open, never by a count falling to zero in
  between.
- **A command with input is never offered here.** Open the palette and type
  `set`. Two assertions, neither of them on a filtered list — the palette
  publishes counts and the active id, never the rows (see Gotchas):
  - the DOM: `[data-dtb-part="cmd-option-label"]` texts contain no
    `Set a feature flag override` and no `Set a design token`;
  - the state: `menu.query` is `"set"` and `menu.resultCount` equals the
    number of rows the DOM just showed — so a row is not merely unrendered.

  Both commands are live and reachable: `read().commands` lists them with
  their `input` schema, and `runCommand("flags.set", {key, value})` runs one.
  That is the point — the palette skips what it cannot supply input for rather
  than offering a row that fails when pressed. See [flags.md](./flags.md) for
  driving them.
  `read().commands` carries every command's `id`, `label` and `group`, e.g.
  `diagnostics.capture` / `Capture a diagnostic snapshot`,
  `flags.clearOverrides` / `Clear all local flag overrides`,
  `overlays.toggle.grid` / `Show overlay: Column grid` — read those instead of
  scraping option labels. The **grouping** is a rendering, not state: with an
  empty query the palette browses and puts the group in section headings
  (`[data-dtb-part="cmd-section"]`: `Diagnostics`, `Environment`, `Flags`,
  `Overlays`, `Theme`, `Metrics`), and once you type it drops the headings and
  puts the group on each option instead. Assert that half with a screenshot,
  or with a DOM read that says out loud it is checking markup.
- **Filter.** `computer` `{"action":"type","text":"grid"}`. Read: `menu.query`
  is `"grid"`, `menu.resultCount` is `4`, and `menu.activeId` is
  `overlays.toggle.grid` — the leader, selected. Type `zzzz` instead and
  `menu.resultCount` is `0` (the empty message is the rendering of that).
- **Run.** With `overlays.toggle.grid` active, send
  `{"action":"key","text":"Enter"}`. Read: `menu.open` is `false`, `menu.error`
  is `null`, and `ext("overlays").on` is `["grid"]`. Continue in
  [overlays.md](./overlays.md).
- **Dismiss.** Reopen, send `Escape`. Read: `menu.open` is `false`, and no
  `cmd-scrim` remains in the DOM (a rendering check — the state one is
  `menu.open`).
- **Added after mount.** Click `[data-testid="flag-add"]`, which adds a flag to
  the app's catalogue with no reload. **Wait one flags poll (400 ms)** before
  reopening: the flags extension re-reads the app's catalogue on that poll and
  its per-flag toggle commands come off that snapshot, so a palette reopened
  immediately can legitimately still be a poll behind. `listCommands()` now
  carries `flags.toggle.runtime-…`; reopen and filter for `runtime-` and
  `menu.resultCount` is non-zero — proof the palette re-enumerates rather than
  rendering a captured list.
- **A failing command.** Run one that throws and read `menu.error`: the
  palette stays `open: true` and carries the message. Through the bridge the
  same throw comes back as a value —
  `{ok: false, reason: "threw", error: "…"}` — which is the same failure seen
  from the other side, not a substitute for it.
- **Proof.** Capture the read with the filtered `resultCount`/`activeId`, the
  read after running the command showing `ext("overlays").on`, and a
  screenshot of the open dialog.

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
  the extensions, not here. `menu.commandCount` and `read().commands.length`
  come from the same `getCommands()` and differ only by the `input`-carrying
  commands the palette drops — an unexplained gap between them is the finding.
- The palette publishes counts and the active id, not the filtered list.
  That is deliberate: the roster is already in `read().commands`, and
  repeating it inside a diagnostics contribution would put the biggest thing
  in a bug-report snapshot inside one of its own sections.
- With focus inside a text field, `Cmd+K` may be consumed by the field.
- Any absolute count in this file is a checksum for one playground extension
  set at one moment, not a constant. It moved when contract v2 added
  `flags.set` and `theme-editor.setToken`, and it moves again the moment an
  extension gains or loses a command. Re-derive `read().commands.length` and
  `menu.commandCount` in the run, and assert the *relationship* between them
  above rather than either number.
