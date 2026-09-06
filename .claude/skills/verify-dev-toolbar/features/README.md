# dev-toolbar verification map

The maintained source for verifying the user-facing behavior of
`@nejcm/dev-toolbar` through `examples/playground`. Read this index before
driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Start the playground through the Browser pane: `preview_start` with
  `{"name": "playground"}`. It serves `http://localhost:5273` and rebuilds
  `dist/` first.
- Run `sh .claude/skills/verify-dev-toolbar/doctor.sh` and require exit 0.
  If the preview was already running when you arrived, also require the page
  read's `loadedAt` to be later than the `dist/ built` stamp doctor printed;
  otherwise `navigate` to `http://localhost:5273/` first. A rebuild reaches a
  running tab through HMR and a remount, not a reload, so only `loadedAt`
  says which build the document was loaded over (SKILL.md, Launch).
- Require a clean store: `localStorage.clear()` then reload, so no
  `dtb:v1:playground:*` key survives from an earlier run. The page read's
  `storage` is `{}` at that point — but only at that point. Ordinary driving
  writes keys that no recipe declares: running any palette command writes
  `dtb:v1:playground:ext:command-menu:recent` (the palette's own recents), and
  turning an overlay on writes
  `dtb:v1:playground:ext:overlays:enabled`. Later recipes in a sequence must
  therefore assert on the *keys they are about*, never on `storage` equalling
  a whole object — or re-clear and reload first.
- Require the **roster of thirteen** — twelve extensions plus the bridge's own
  `agent` — as `diagnostics` (`curl -s localhost:5273/__dev-toolbar/state | jq
  '.diagnostics|length'` → `13`, 7 `ok` and 6 `absent` at baseline). The roster
  is the fixed number; `shell.bar` is **not**. `shell.bar` is only what still
  fits, so it depends on the viewport: measured at the mandated 1280×800 it is
  **8** — `environment`, `cmds`, `flags`, `theme-editor`, `overlays`, `tw`,
  `command-menu`, `user` — with `shell.overflow.present: true` and `agent`,
  `metrics`, `diagnostics`, `hydr`, `boom` collapsed. (Cross-checked the same
  moment against the DOM: `[data-dtb-part="region"] > [data-dtb-part="item"]`
  lists those same eight at `innerWidth: 1280`.) `agent` has the lowest
  `priority` (`-1`), so it is the first to leave the bar as the window narrows.
  Never assert a bar count you did not measure at a viewport you pinned.
- Require the bridge itself: `window.__DEV_TOOLBAR__.instances["playground"]`
  exists, `read().allowRun` is `true` (the playground opts in), and
  `read().diagnostics` carries a `status: "ok"` entry for each of `flags`,
  `metrics`, `environment`, `overlays`, `command-menu`, `theme-editor` and
  `diagnostics`. A `"failed"` entry is a finding before any recipe runs; an
  `"absent"` one means that extension publishes nothing and every state
  assertion about it below is unreachable.
- Pin the viewport: `resize_window` with `{"width": 1280, "height": 800}`.
  This is not optional — a hidden Browser pane otherwise reports a zero-sized
  viewport and every measurement reads `0`. Reset it with `{"preset":
  "desktop"}` in cleanup.
- For any keyboard step, the Browser pane must be **displayed**: `computer`
  `{"action":"key"}` delivers nothing to the page while it is hidden, silently.
  `left_click` and `type` are unaffected. `tabs_context` reports which it is.
- A hidden pane also delivers **no frames**: `requestAnimationFrame` never
  ticks and `ResizeObserver` callbacks are never delivered until something
  forces a compositor frame, and only `computer {"action":"screenshot"}`
  does — `wait` does not. Any frame-driven step (the overflow collapse first
  of all) is therefore *act → screenshot → read* while hidden, and a report
  from a hidden pane says so (see [shell.md](./shell.md) Gotchas).
- Start the run's artifact directory once with `capture.sh --new-run`; every
  later `capture.sh` call reuses the id it recorded. Exporting `VERIFY_RUN_ID`
  does not work — shell state does not survive between Bash tool calls.
- Never drive an instance this run did not start.

## Driving conventions

- Start every recipe from the baseline unless its preconditions say otherwise.
- Read state with `curl -s localhost:5273/__dev-toolbar/state` and a `jq`
  projection — no browser call needed for any value (SKILL.md,
  [Read](../SKILL.md#read--with-curl-not-a-browser)). The in-page
  `window.__DEV_TOOLBAR__.instances["playground"].read()` returns the same
  snapshot and is the right tool when the pane is already open, or when the
  route says `connected: false`. Use the page read (SKILL.md, Drive) only for
  geometry, computed style, `localStorage`, `loadedAt`, the error chips and the
  app's own readouts.
- Never assert an extension's state through a selector. If you cannot make the
  assertion from `read().diagnostics`, the extension is under-publishing and
  the fix is in `src/ext/<name>`.
- For *input*, prefer a command id, then ARIA role + name, then
  `data-dtb-part` / `data-dtb-ext-id`. The playground's `data-testid` handles
  belong to the app, not the library — use them to reach a state, never as the
  thing being proven.
- Treat every selector, key name and query string here as literal.
- Send `Enter`, never `Return`.
- Re-read after a resize or a context mutation instead of asserting on the
  first snapshot — with a screenshot between the reads when the pane is
  hidden, or they agree for the wrong reason.
- Restore the baseline after a mutation. Cleanup never touches
  `.verify-artifacts/`.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- Every mutation proof includes its side effect: the `dtb:v1:playground:*`
  key, `shell.heightVariable`, or the app's own readout (`flag-readout`,
  `theme-swatches`). Not `height-readout` — it reads the *unsuffixed*
  variable and so always shows `(unset)` for this instance (see
  [shell.md](./shell.md)); citing it proves nothing.
- Prove persistence by reloading, never by reading back the store you wrote.
- Pair a screenshot with a bridge read asserting the same fact in text;
  screenshots do not survive the run.
- Record the feature ID and the entry point used with every artifact, and
  pass the feature *file's* name as `capture.sh`'s `<feature>` — `overflow`,
  not `c1-per-item-width`. The script warns on stderr when the name matches
  no file here; the artifact tree is only greppable against this map when
  they agree.
- A claim that something *never* happened during a stress needs a `window`
  `error` listener installed before the stress, not a console read after it:
  `read_console_messages` does not see the `ResizeObserver loop …`
  `ErrorEvent`. [overflow.md](./overflow.md) has the recipe.
- Report an unreachable path with the attempted call and the unmet
  precondition. A path you skipped is not verified by a different path.

## What the seeding run actually drove

Recipes here are grounded in the source and in the state the extensions really
publish, but only some were executed end to end when this map was written.

**Re-read this before quoting a "driven and confirmed" below.** The list is
from the seeding run, which read state through a DOM scraper that no longer
exists. The *behaviour* those runs proved still stands; the *assertions* below
were rewritten against `read()` and its `diagnostics` payload and have not all
been re-driven since. Treat a mismatch between a recipe and what the bridge
actually returns as a finding about the recipe, and fix it here.

- **Driven and confirmed:** the shell (mount, panel hosting and eviction,
  position, the height variable and inset, the keyboard toggle, reload
  persistence, the `boom` error chip), overflow (collapse at 520 px, the `⋮`
  menu contents, a collapsed extension still working), flags (boolean
  override, the app resolving it, storage, reload persistence, masking, the
  promoted switch, `?dtb-flags=reset`), the command menu (open, enumerate,
  filter, run, `Escape`), environment redaction (all four secrets masked, no
  leak anywhere in the snapshot), and overlays (on via `⌘K`, stacking below the
  bar, click-through).
- **Not driven — verify before reporting:** the flags text/number editors and
  their `rejected` state, every `flags.set` and `theme-editor.setToken` step
  (contract v2's input-carrying commands — written from the source and the
  unit tests, never driven in a browser), the `⌘K`-skips-input assertion in
  [command-menu.md](./command-menu.md), clipboard assertions anywhere, the
  environment impersonation and empty-context fixtures, the focus-order
  overlay's markings, the overflow loop check's stepping sequence, and every
  feature listed as unmapped below.
- **Not verifiable from the playground as it stands:** core's `styleNonce`
  prop (arriving with the pending PR stack #21–#28 — it sets the `nonce`
  *property* on core's injected `<style>` so a `style-src 'nonce-…'` policy
  keeps the sheet). `App.tsx` never passes it and has no `?dtb-nonce=` hatch
  the way it has `?dtb-flags=reset`, and this skill forbids editing the app
  to verify; report it as not driven until the playground grows one. Likewise
  the flags read-only branch ([flags.md](./flags.md)) and the focus-order
  `aria-hidden` badge ([overlays.md](./overlays.md)) — both need a fixture
  the playground lacks.

## Feature entry contract

Each file opens with an H1 and one paragraph of user-visible behavior, then
exactly four H2s in order: `Sub-features`, `How to get to it (user POV)`,
`Driving it with the Browser pane`, `Gotchas`. Name only user paths, stable
handles, required state, calls and observable proof.

## Features

- [Metrics](./metrics.md) — consumer collectors in chips, tabs, persistence, agent reads and diagnostics capture.
- [The shell](./shell.md) — the bar, panel hosting, position, density,
  visibility, the inset, the height variable, and what survives a reload.
- [Overflow](./overflow.md) — collapsing into `⋮` in priority order, and
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
raises. Add them here before claiming them. All three extensions now publish
state through the bridge — `ext("theme-editor").overrides` (edited tokens and
their values), `ext("metrics").metrics` (per metric: numeric `value`, `unit`,
`severity`, `status`), `ext("diagnostics")` (`captured`, `revision`,
`capturedAt`, `generatedAt`, `gathered`, `contributionCount`, `omissionCount`,
`omissions`, `format`, and `console` — `{status, errors, warnings, dropped,
watching}` for the §1B console tail) — so a map for
them is now mostly writing down assertions, not building a way to read them.
`/ext/diagnostics` publishes a **summary**, never the snapshot: the snapshot is
built from the roster, so embedding it would put one snapshot inside the next.
Reach the full object through `diagnostics.copyJson` / `diagnostics.download`. Three of those surfaces move with
the pending PR stack #21–#28, source-confirmed there and not driven — the
metrics tabs gain `id`, `aria-controls`, a roving `tabindex` and
Arrow/Home/End keys, with the `tabpanel` `aria-labelledby` the active tab;
the theme-editor chip's `aria-label` becomes `Theme, 1 edited` once a token
is edited; the diagnostics chip's becomes `Diagnostics, 1 missing` once a
snapshot has omissions — so a `find` by role `button` and the bare label
stops matching in exactly the states worth verifying. Map them with those
names, not the resting ones.

The diagnostics chip has a third state on top of those: the console tail's
badge, `[data-dtb-part="diag-errors"]` inside the chip, carrying the combined
count with `data-dtb-errors` / `data-dtb-warnings` beside it, and the
`aria-label` growing to `Diagnostics, 1 error, 1 warning`. The playground's
**Drive the console tail** card drives every source of it —
`[data-testid="console-error"]`, `console-warn`, `console-repeat`,
`console-throw`, `console-reject`, and `console-log`, the last of which must
move nothing, because `console.log` is never patched. The tail itself is
readable without pixels through `runCommand("diagnostics.console.export")`
(and cleared with `diagnostics.console.clear`); `console-error` deliberately
logs a `sessionToken` and a URL carrying an `access_token`, and neither may
appear in that command's result or in a captured snapshot. Also unmapped, and
worth an assertion when diagnostics is mapped: the `boom` extension's crash is
logged by core's `ExtensionBoundary` through `console.error`, so it appears in
the tail exactly once.
