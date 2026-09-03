# dev-toolbar verification map

The maintained source for verifying the user-facing behavior of
`@nejcm/dev-toolbar` through `examples/playground`. Read this index before
driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Start the playground through the Browser pane: `preview_start` with
  `{"name": "playground"}`. It serves `http://localhost:5273` and rebuilds
  `dist/` first.
- Run `sh .claude/skills/verify-dev-toolbar/doctor.sh` and require exit 0.
- Require a clean store: `localStorage.clear()` then reload, so no
  `dtb:v1:playground:*` key survives from an earlier run. The probe's
  `storage` is `{}` at that point — but only at that point. Ordinary driving
  writes keys that no recipe declares: running any palette command writes
  `dtb:v1:playground:ext:command-menu:recent` (the palette's own recents), and
  turning an overlay on writes
  `dtb:v1:playground:ext:overlays:enabled`. Later recipes in a sequence must
  therefore assert on the *keys they are about*, never on `storage` equalling
  a whole object — or re-clear and reload first.
- Require the twelve-item bar in this order — `environment`, `cmds`, `flags`,
  `theme-editor`, `overlays`, `metrics`, `hydr`, `tw`, `boom` (start) and
  `command-menu`, `user`, `diagnostics` (end).
- Pin the viewport: `resize_window` with `{"width": 1280, "height": 800}`.
  This is not optional — a hidden Browser pane otherwise reports a zero-sized
  viewport and every measurement reads `0`. Reset it with `{"preset":
  "desktop"}` in cleanup.
- For any keyboard step, the Browser pane must be **displayed**: `computer`
  `{"action":"key"}` delivers nothing to the page while it is hidden, silently.
  `left_click` and `type` are unaffected. `tabs_context` reports which it is.
- Start the run's artifact directory once with `capture.sh --new-run`; every
  later `capture.sh` call reuses the id it recorded. Exporting `VERIFY_RUN_ID`
  does not work — shell state does not survive between Bash tool calls.
- Never drive an instance this run did not start.

## Driving conventions

- Start every recipe from the baseline unless its preconditions say otherwise.
- Read state with `probe.js`; project the fields you need in the same call.
- Prefer `data-dtb-part` and `data-dtb-ext-id`, then ARIA role + name. The
  playground's `data-testid` handles belong to the app, not the library —
  use them to reach a state, never as the thing being proven.
- Treat every selector, key name and query string here as literal.
- Send `Enter`, never `Return`.
- Re-read after a resize or a context mutation instead of asserting on the
  first snapshot.
- Restore the baseline after a mutation. Cleanup never touches
  `.verify-artifacts/`.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- Every mutation proof includes its side effect: the `dtb:v1:playground:*`
  key, the `--dev-toolbar-height-playground` property, or the app's own
  readout (`flag-readout`, `theme-swatches`). Not `height-readout` — it reads
  the *unsuffixed* variable and so always shows `(unset)` for this instance
  (see [shell.md](./shell.md)); citing it proves nothing.
- Prove persistence by reloading, never by reading back the store you wrote.
- Pair a screenshot with a probe snapshot asserting the same fact in text;
  screenshots do not survive the run.
- Record the feature ID and the entry point used with every artifact.
- Report an unreachable path with the attempted call and the unmet
  precondition. A path you skipped is not verified by a different path.

## What the seeding run actually drove

Recipes here are grounded in the source and in the handles the app really
publishes, but only some were executed end to end when this map was written:

- **Driven and confirmed:** the shell (mount, panel hosting and eviction,
  position, the height variable and inset, the keyboard toggle, reload
  persistence, the `boom` error chip), overflow (collapse at 520 px, the `···`
  menu contents, a collapsed extension still working), flags (boolean
  override, the app resolving it, storage, reload persistence, masking, the
  promoted switch, `?dtb-flags=reset`), the command menu (open, enumerate,
  filter, run, `Escape`), environment redaction (all four secrets masked, no
  leak anywhere in the snapshot), and overlays (on via `⌘K`, stacking below the
  bar, click-through).
- **Not driven — verify before reporting:** the flags text/number editors and
  their `rejected` state, clipboard assertions anywhere, the environment
  impersonation and empty-context fixtures, the focus-order overlay's markings,
  and every feature listed as unmapped below.

## Feature entry contract

Each file opens with an H1 and one paragraph of user-visible behavior, then
exactly four H2s in order: `Sub-features`, `How to get to it (user POV)`,
`Driving it with the Browser pane`, `Gotchas`. Name only user paths, stable
handles, required state, calls and observable proof.

## Features

- [The shell](./shell.md) — the bar, panel hosting, position, density,
  visibility, the inset, the height variable, and what survives a reload.
- [Overflow](./overflow.md) — collapsing into `···` in priority order, and
  reaching a collapsed extension from the menu.
- [Feature flags](./flags.md) — overriding, persistence, masking, the promoted
  flag in the bar, and the `?dtb-flags=reset` escape hatch.
- [Command menu](./command-menu.md) — `⌘K`, re-enumeration, filtering, running
  a command, and a failing command staying in place.
- [Environment redaction](./environment.md) — the four secrets in the
  playground's context that must never reach the screen or the clipboard.
- [Overlays](./overlays.md) — drawing over the page, never over the toolbar,
  and passing clicks through.

Not yet mapped, and therefore not yet verified: `theme-editor` (token editing,
reserved `--dtb-*` names refused, `?dtb-theme=reset`, the four export formats),
`metrics` (the `LoadControls` buttons drive it), `diagnostics` (snapshot
capture and download), and the error-isolation chip the `boom` extension
raises. Add them here before claiming them.
