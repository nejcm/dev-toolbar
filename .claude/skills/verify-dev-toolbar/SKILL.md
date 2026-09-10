---
name: verify-dev-toolbar
description: Prove that @nejcm/dev-toolbar's shell and first-party extensions behave for a user — reading state over HTTP from the playground's /__dev-toolbar routes with curl, and driving a real browser only for what genuinely needs pixels. Use when a change to src/core, src/runtime or src/ext needs evidence beyond vitest — panels, overflow, overlays, flag overrides, redaction, ⌘K — or when asked to verify, demo or screenshot the toolbar.
---

# Verify @nejcm/dev-toolbar

This package is a React library, so there is no app to run — except one. Its
single user-facing surface is `examples/playground`, a Vite app that consumes
the built `dist/` through `file:../..` exactly as a published consumer does. It
mounts the real shell with the real first-party extensions and gives every one
of them something to measure. Driving the playground is the only way to prove
user-visible behavior here; `vitest` runs in jsdom and cannot see layout,
stacking, pointer events, or a reload.

**Two channels, and they are not interchangeable.** State — every value any
extension publishes, the command registry, the shell's own facts — comes over
HTTP from the running dev server with `curl`, no browser call involved
([Read](#read--with-curl-not-a-browser)). Pixels — layout, stacking, pointer
events, a real click or keypress, a reload — need the browser
([Drive](#drive)). Reaching for a screenshot to learn a number is the mistake
this skill exists to stop.

The feature map in [`features/`](./features/README.md) is the maintained
source for what to drive. Read its README before driving anything, then use the
matching feature file as the recipe.

Secondary surfaces, out of scope for this skill: `bun run test:jest-consumer`
(a real CommonJS consumer of `dist/`), `bun run test:vite-consumer` (the packed
tarball through a default Vite dev server, in Chromium), `bun run check:package`,
and `bun run size`. They are commands, not apps — run them directly.

## Run the suite first

Most of the feature map below is already encoded as Playwright specs in
[`examples/playground/e2e/`](../../../examples/playground/e2e/README.md), one
file per recipe. Before driving anything by hand:

```bash
bun run test:e2e     # repo root: builds dist/, starts its own Vite on :5274, runs Chromium
```

Green means the *specs' assertions* hold at 1280×800 over the current `src/` —
the specs are organised by recipe, but each encodes a subset of its recipe's
steps, not all of them (the `Mod`-exclusivity check and the top-position inset,
for instance, are still manual). Read the spec before treating a step as
covered; the feature map's *not driven* list is history, not a coverage map. A
red test keeps its trace and screenshot under
`examples/playground/e2e-results/`. Drive the browser by hand for what a spec
does not assert, for pixels a reviewer wants to see, or to investigate a red
test. A spec marked `test.fail(...)` is a known library bug kept visible on
purpose — read its comment before reporting it as new.

## Launch

The playground is the `playground` entry in [`.claude/launch.json`](../../launch.json).
Start it through the Browser pane, never through Bash:

- `mcp__Claude_Browser__preview_start` with `{"name": "playground"}`.
- Its `predev` script runs `bun run build` at the repo root first, so a
  **fresh** `preview_start` serves the current `src/` — and that is the only
  moment the guarantee holds (see the next two bullets). The build takes a few
  seconds; the server is ready when `preview_logs` prints
  `VITE v8 ready in <n> ms` and `Local: http://localhost:5273/`.
- Keep the `tabId` from the result and pass it to every later browser call.
- Editing `src/` does **not** reach the tab — the playground imports `dist/`,
  so rebuild with `bun run build` (or run `bun run dev`, tsup watch, in the
  background alongside the preview). A rebuild while the preview is running
  reaches the tab through Vite **HMR, not a reload**: `preview_logs` shows
  `hmr update` / `hmr invalidate … Could not Fast Refresh` lines bubbling up
  to `/src/App.tsx`, the toolbar remounts from the re-imported module (a
  stashed reference to the old `[data-dtb-part="root"]` reads
  `isConnected: false`), `performance.timeOrigin` does not move, and every
  in-memory extension state is reset by the remount rather than by a page
  load. The mounted toolbar is therefore *usually* the new build — but
  nothing in the DOM says which build a given node came from, which is how
  one review ended up reasoning about a module twenty minutes stale.
- To **know** which build a tab serves, `navigate` to `http://localhost:5273/`
  and compare `new Date(performance.timeOrigin).toISOString()` (the page read
  below reports it as `loadedAt`) with the `dist/ built` stamp `doctor.sh`
  prints (both UTC ISO): `loadedAt` later than the stamp means the document
  was loaded over the current `dist/`; earlier means it was not, whatever HMR
  did in between. If `navigate` is refused, stop your own preview and start it
  again — `predev` rebuilds and the new tab loads fresh.

Isolation: the port (`5273`) and the `localStorage` namespace
(`dtb:v1:playground:*`) are both fixed, so **two runs cannot share this
machine**. If `doctor.sh` reports `:5273` held by something outside this
checkout, stop and say so — do not drive an instance you did not start.

Teardown is in [Cleanup](#cleanup).

## Doctor

```bash
sh .claude/skills/verify-dev-toolbar/doctor.sh
```

Read-only. Exit 0 means the checkout is worth driving; it checks the repo
identity, that `dist/` exists and is not older than `src/`, that the
playground's dependencies are installed, and who owns `:5273`. Run it first
whenever anything looks off, and before blaming the library for a blank page.

The other half of the doctor needs no browser call at all — the playground's
Vite plugin holds whatever the page last reported:

```bash
curl -s localhost:5273/__dev-toolbar/state \
  | jq '{connection, mounted: .shell.mounted, roster: (.diagnostics|length), bar: (.shell.bar|length), overflow: .shell.overflow.present}'
```

A healthy instance is `connection.connected: true`, `shell.mounted: true`,
`instanceId: "playground"`, and a `diagnostics` roster of **13** — every
extension the playground mounts, including the bridge's own `agent`, whatever
the bar looks like (7 `ok` and 6 `absent` in the baseline run).

`shell.bar` is **not** the roster and is not a fixed number: it is only what is
still *in* the bar at the current width. Measured at a `resize_window` of
1280×800 with the pane hidden: 8 items — `environment`, `cmds`, `flags`,
`theme-editor`, `overlays`, `tw`, `command-menu`, `user` — with
`shell.overflow.present: true` and the other five collapsed into `···`. Assert
on the roster, or on a specific id, never on a bar count you did not just
measure at a viewport you pinned.

A `loadedAt` later than the `dist/ built` stamp above is one that has actually
loaded the current build — that one is a page read (see [Launch](#launch)).

## Read — with `curl`, not a browser

The playground's Vite config installs
[`plugins/devToolbarAgent.ts`](../../../examples/playground/plugins/devToolbarAgent.ts),
which holds the snapshot the agent bridge reports and serves it over HTTP.
**Every state question is answered from a shell**, with no browser call, no
screenshot and no tokens spent on a page dump:

```
GET  /__dev-toolbar/state         the latest snapshot, plus how old it is
GET  /__dev-toolbar/commands      the command registry with descriptions and input schemas
POST /__dev-toolbar/commands/:id  runs it on the open page, returns the result
```

```bash
# Is the override applied?
curl -s localhost:5273/__dev-toolbar/state | jq '.extensions.flags.flags[] | select(.key == "search.rank")'
# {"key":"search.rank","source":"local-override","overridden":true,"effective":9,"base":2,"default":1,"tags":["override","reload"], …}

# The whole roster of what each extension publishes
curl -s localhost:5273/__dev-toolbar/state | jq '.extensions | keys'
# ["agent","boom","cmds","command-menu","diagnostics","environment","flags","hydr","metrics","overlays","theme-editor","tw","user"]

# The command registry, as ids
curl -s localhost:5273/__dev-toolbar/commands | jq -r '.commands[] | "\(.id)  —  \(.label)"'

# Reach a state in one call — same command ids, same input schemas as the bridge
curl -s -X POST localhost:5273/__dev-toolbar/commands/flags.set \
  -H 'content-type: application/json' -d '{"key":"search.rank","value":9}'
# {"ok": true, "command": "flags.set", "waitedMs": 785}
```

`.extensions.<id>` is each extension's own `diagnostics()` output — `flags`
publishes `flags`, `overriddenCount`, `maskedCount`, `writable`, `reloadPending`;
`environment` publishes `fields`, `maskedCount`, `severity`, `impersonating`;
`metrics` publishes `metrics`, `jank`, `network`, `memory`, `delay`; `overlays` publishes
`on`, `active`, `activeCount`; `command-menu` publishes `open`, `query`,
`resultCount`, `commandCount`; `theme-editor` publishes `overrides`, `mode`,
`surface`, `refusedCount`; `diagnostics` publishes its capture *summary*. `null`
means that extension published nothing — the unabridged roster, including
`status: "failed"` and the error, is still in `.diagnostics`.

**Three things this route will not do, and says so rather than hanging:**

- Nothing has ever reported, or the last check-in is older than 3 s: `503
  no-page-connected`, immediately (`0.0007 s` measured), with `connection.ageMs`.
- No page picks a queued command up: `504 timeout` after 10 s with
  `pickedUp: false`, rather than an open socket.
- A command that refuses its input: `422` with the extension's own message,
  e.g. `{"ok": false, "reason": "threw", "error": "\"new-header\" is a boolean
  flag; \"yes\" is not a valid boolean value."}`. Unknown id is `404
  unknown-command`; a bridge built without `allowRun` is `403 run-not-allowed`.

**Check `connection` before believing a snapshot.** The page checks in on a
timer, and browsers clamp timers in a hidden tab: with the Browser pane hidden
the 500 ms poll was measured at 1 000 ms, and one hidden stretch went 10 s with
no check-in at all, so `connected` went `false`. Front the tab or take one
screenshot and the check-ins resume within a second. A `reportedAt` that is not
moving is this, far more often than it is a regression.

**One tab at a time, and `connection` says when that is broken.** The
middleware holds a single slot, so two playground tabs overwrite each other
every ~500 ms and a `POST` may run in the tab whose snapshot you are *not*
reading. Each page reports its own `reporterId`, so
`connection.reporters` counts the distinct pages seen inside `staleMs` and
`connection.ambiguous` goes `true` above one — and a command result names the
tab that ran it in `ranIn`. **`ambiguous: true` invalidates the read**: close
the extra tab and take it again. This skill opens tabs, so check it.

**What still needs the browser:** layout and geometry, stacking and pointer
events, a real click or keypress, a reload, `localStorage`, the playground app's
own readouts, and anything visual. Those are [Drive](#drive). If you are opening
a browser to learn a *value*, stop — `curl` has it.

## Drive

Two tools do the input: `mcp__Claude_Browser__computer` for user input, and
`mcp__Claude_Browser__javascript_tool` for the page facts no route can publish.
Batch them with `mcp__Claude_Browser__browser_batch` when the next step is
predictable. For anything that is a *value*, use [`curl`](#read--with-curl-not-a-browser) first.

**The same state, from inside the page,** when the pane is already open and a
round trip is cheaper than a shell call. The playground mounts
`@nejcm/dev-toolbar/ext/agent`, so the toolbar publishes its own state — no
scraper, no selectors, nothing to keep in sync with markup. One
`javascript_tool` call:

```js
window.__DEV_TOOLBAR__.instances["playground"].read()
```

It returns `{ instanceId, contractVersion, visible, allowRun, commands, shell,
diagnostics }`, already redacted. `shell` is the chrome — `mounted`,
`position`, `density`, `colorScheme`, `heightVariable`, `bar`, `overflow`,
`activePanel`. `diagnostics` is one entry per present, non-hidden extension,
each `{ id, label, status, data }`; `status: "absent"` means *had nothing to
say*, `"failed"` means *blew up*, and the difference matters — a roster you
only half read looks like a clean run.

The whole snapshot is large, so project in the same call:

```js
const s = window.__DEV_TOOLBAR__.instances["playground"].read();
const ext = (id) => s.diagnostics.find((d) => d.id === id)?.data ?? null;
({ shell: s.shell, flags: ext("flags").flags, env: ext("environment").fields })
```

The playground passes `allowRun: true`, so `runCommand(id, input?)` is available
and resolves a value rather than throwing:
`await window.__DEV_TOOLBAR__.instances["playground"].runCommand("overlays.disableAll")`
→ `{ok: true}` or `{ok: false, reason: "unknown-command"}`. Use it to *reach* a
state and to prove the command registry itself; a claim about a chip, a switch
or a panel still needs the click (see [Evidence](#evidence)).
`listCommands()` is the command roster with ids, labels, groups and — since
contract v2 — each command's `description` and `input` schema. Read it instead
of scraping option labels out of the palette.

**Commands with input, and commands that answer back** (contract v2). A command
may declare an `input` schema and return a value:

```js
const h = window.__DEV_TOOLBAR__.instances["playground"];
await h.runCommand("flags.set", { key: "search.rank", value: 9 });   // {ok: true}
await h.runCommand("flags.set", { key: "search.rank" });             // clears it
(await h.runCommand("diagnostics.capture")).result;                  // the snapshot itself
```

Three consequences worth holding on to:

- `runCommand` resolves `{ok: true, result}` when the command returned
  something, and plain `{ok: true}` when it did not. `result` is redacted on
  the way out like every other read.
- A command that **refuses its input throws**, and the bridge turns that into
  `{ok: false, reason: "threw", error}` — a value to assert on, not a
  rejection. `flags.set` refuses an unknown key or a value of the wrong type
  rather than coercing it.
- **`⌘K` does not list a command that declares `input`**, because it has no
  form to collect one with. So `flags.set` and `theme-editor.setToken` are
  reachable through the bridge and never through the palette; `read().commands`
  and `listCommands()` are the unfiltered roster, and the palette's own
  `commandCount` is the shorter, runnable one.

**Read the page only for what the toolbar cannot say about itself.** Geometry,
computed style, stacking, `localStorage` and the playground app's own readouts
are not toolbar state, and there is no bridge field for them by design. One
read-only call covers all of them:

```js
const part = (n) => document.querySelector(`[data-dtb-part="${n}"]`);
const txt = (el) => el?.textContent?.replace(/\s+/g, " ").trim() ?? null;
({
  loadedAt: new Date(performance.timeOrigin).toISOString(),
  barRect: part("bar")?.getBoundingClientRect().toJSON() ?? null,
  inset: (() => {
    const el = part("inset");
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { position: el.dataset.dtbPosition, top: cs.paddingTop, bottom: cs.paddingBottom };
  })(),
  // The overlay host is `display: contents`, so its own computed
  // `pointer-events` is always `auto` and proves nothing. The layer is the
  // child: its presence is the on/off signal, its computed `pointer-events`
  // the click-through one.
  overlayLayers: [...document.querySelectorAll('[data-dtb-part="overlay"]')].map((el) => ({
    extension: el.dataset.dtbExtId,
    children: el.children.length,
    childPointerEvents: el.firstElementChild
      ? getComputedStyle(el.firstElementChild).pointerEvents
      : null,
  })),
  // Core's own isolation chip. A slot that threw renders no state to publish.
  errorChips: [...document.querySelectorAll('[data-dtb-part="error-chip"]')].map((el) => ({
    extension: el.dataset.dtbExtId,
    slot: el.dataset.dtbSlot,
    text: txt(el),
  })),
  storage: Object.fromEntries(
    Object.keys(localStorage)
      .filter((k) => k.startsWith("dtb:v1:"))
      .sort()
      .map((k) => [k, localStorage.getItem(k)]),
  ),
  // The *app's* readouts, not the library's — the half that proves an override
  // reached the application rather than only the panel.
  appFlags: [...document.querySelectorAll('[data-testid="flag-readout"] li')].map(txt),
  appTheme: [...document.querySelectorAll('[data-testid="theme-swatches"] .pg-theme-swatch')].map(txt),
})
```

If you find yourself adding an extension's own state to that call — a flag
value, an overlay's on/off, what is typed in the palette — stop: the extension
is under-publishing, and the fix is in `src/ext/<name>`'s `diagnostics()`, not
here.

**Prefer stable handles over coordinates** for *input*. In rough order of
preference:

| Handle | Where it comes from | Example |
| --- | --- | --- |
| a command id | `listCommands()` / `runCommand()` | `flags.toggle.new-header`, `overlays.disableAll`, `flags.set` (takes `{key, value?}`) |
| ARIA role + name | the accessible surface | `toolbar` "Developer toolbar", `switch` "Toggle new-header", `dialog` "Commands" |
| `data-dtb-part` | core and every first-party extension | `[data-dtb-part="bar"]`, `panel`, `overflow-button`, `cmd-input` |
| `data-dtb-ext-id` | a discriminator, not a unique id: the same value sits on the extension's bar item, `⋮` menu entry, panel, overlay and error chip — always pair it with `data-dtb-part` | `[data-dtb-part="panel"][data-dtb-ext-id="flags"]` |
| `data-testid` | the playground's own controls only | `toggle-position`, `load-block`, `flag-readout`, `overlay-click-through` |
| pixel coordinates | last resort | — |

Use `mcp__Claude_Browser__find` to turn a role and name into a `ref_N`, then
click the ref. Never click a coordinate you have not just screenshotted.

**Input delivery is not guaranteed.** While the Browser pane is hidden,
`computer {"action":"key"}` reaches the page not at all — not even a plain
letter raises a `keydown` — and a `left_click` is occasionally dropped too;
`type` and state reads keep working. So: pin a viewport with `resize_window`
(`{"width": 1280, "height": 800}`) before measuring anything, check
`mcp__Claude_Browser__tabs_context` (it reports whether the pane is displayed)
before a keyboard step, and after every input **assert the effect landed**
before moving on. A step that changed nothing is far more likely to be a
dropped event than a regression — retry it once, and only then report it.

**A hidden pane renders no frames.** While `tabs_context` says the pane is
hidden, the document reports `visibilityState: "hidden"` and the browser
suspends the rendering pipeline outright: `requestAnimationFrame` never ticks
and `ResizeObserver` callbacks are never delivered — not throttled, not late,
not even the initial notification `observe()` owes (3.5 s, zero of either,
in the run that established this). Timers, `getBoundingClientRect()`,
`resize_window` (`innerWidth` updates synchronously) and React commits all
keep working, which is what makes it dangerous: the DOM reads as live and
consistent while still showing the layout from before the last frame-driven
step. `computer {"action":"screenshot"}` forces a compositor frame and
flushes the queue — a burst of about four rAF ticks and one *coalesced*
`ResizeObserver` delivery per screenshot; `computer {"action":"wait"}` does
not. So for anything frame-driven — the bar's overflow collapse above all —
the pattern in a hidden pane is **act → screenshot → read**, and the report
says the check ran screenshot-flushed: the observer then sees one coalesced
size change instead of the stream a visible resize produces, which makes it
a weaker test of anything that guards against oscillation.

**Keys.** Send `Enter`, not `Return` — `Return` reaches the page as a key the
palette's `switch (event.key)` does not match, so it silently does nothing.
`cmd+k` opens the palette on this platform (`Mod` is exclusive: on macOS
`ctrl+shift+.` does not toggle the bar, `cmd+shift+.` does).

**Waiting.** The bar's overflow runs off a `ResizeObserver` and the environment
extension polls every 500 ms, so a read immediately after a resize or a
context mutation can catch the previous frame. Re-read until the value settles
rather than asserting on the first snapshot — and in a hidden pane, take a
screenshot between the two reads, or the `ResizeObserver` half never settles
because no frame is ever delivered: two identical snapshots there prove the
pane was hidden, not that the layout held.

## Evidence

Persist each artifact with [`capture.sh`](./capture.sh), which writes under
`.verify-artifacts/<run id>/<feature>/` at the repo root (git-ignored) and
prints the path:

```bash
.claude/skills/verify-dev-toolbar/capture.sh --new-run   # once, at the start
.claude/skills/verify-dev-toolbar/capture.sh flags 02-override-applied.json <<'EOF'
{ "flags": [ { "key": "new-header", "effective": false, "base": true, "tags": ["override"] } ],
  "storage": { "…": "…" } }
EOF
```

`capture.sh` persists the run id in `.verify-artifacts/.current-run` and reuses
it, so every later call lands in the same run directory. Do **not** try to hold
it in an exported variable: shell state does not survive between Bash tool
calls, so `export VERIFY_RUN_ID=…` is gone by the next call and each capture
would mint its own second-resolution directory. `--new-run` starts a fresh run
deliberately; `VERIFY_RUN_ID` in the environment of a single call still wins
when you want to write into a named run. Re-using a filename is refused
(exit 3) rather than silently overwriting proof — pass `--force` if the
overwrite is what you meant, and it says so on stderr. `<feature>` is the
feature file's name — `flags`, `overflow`, `shell`, … — because
`.verify-artifacts/<run>/<feature>/` is only greppable against the map when
the two agree; a name with no `features/<feature>.md` gets a warning on
stderr, and the write still goes ahead, since the evidence matters more than
its label.

Proof standards for this repo:

- **Drive the real user path for a user-path claim.** A claim about the
  switch, the chip or the panel needs the click. `useDevToolbar()` setters and
  the playground's own buttons are fixtures for reaching a state, never the
  thing under proof — and neither is `runCommand()`, *except* when the command
  registry is itself what is being proven: every command has a real user path
  through `⌘K`, so `runCommand("overlays.toggle.grid")` proves the command and
  the palette's `Enter` proves the palette. Say which one the artifact used.
- **Capture the action and the resulting state**, not just the end screen: the
  read before, the input you sent, the read after. A `curl` of
  `/__dev-toolbar/state` pipes straight into `capture.sh`, which is the cheapest
  artifact in this skill:

  ```bash
  curl -s localhost:5273/__dev-toolbar/state \
    | jq '{connection, flags: .extensions.flags}' \
    | .claude/skills/verify-dev-toolbar/capture.sh flags 02-override-applied.json
  ```

  Keep `connection` in the artifact. A snapshot with no `reportedAt` next to it
  is a claim about an unknown moment.
- **Verify the side effect too.** Nearly everything here has one, and it is the
  half that regresses: the `dtb:v1:playground:*` `localStorage` keys, the
  `--dev-toolbar-height-playground` custom property on `<html>`, the
  `padding` the inset derives from it, and the app's own `flag-readout` /
  `theme-swatches` readouts. A chip that changed while storage did not is a
  failure, not a pass.
- **Prove persistence by reloading**, not by reading the store you just wrote.
- **A "never happens" claim needs a listener installed before the stress, not
  a log read after it.** `read_console_messages` sees `console.*` calls and
  uncaught exceptions; it does not see an `ErrorEvent` with no `Error` object
  behind it, and the one this repo cares about —
  `ResizeObserver loop completed with undelivered notifications` — is exactly
  that kind (confirmed: three fired on `window`, the tool listed none). Push
  `window.addEventListener("error", …)` messages into an array on `window`
  first, drive, then read the array back in a `javascript_tool` call;
  [overflow.md](./features/overflow.md) has the recipe. And a pane that never
  delivered a frame never ran the observer, so an empty array from a hidden
  pane without screenshots between the steps is not evidence.
- **No mocks.** Every extension in the playground is the real published module
  measuring the real page. The only fakes are the app's own flag backend and
  environment context — the production boundaries the contract already puts on
  the consumer's side.
- **A screenshot is a supplement.** `computer {"action":"screenshot"}` lands in
  the transcript, not on disk; the bridge JSON is the artifact that survives.
  Take a screenshot when the claim is visual (stacking, overlays, restyling)
  and pair it with the read that states the same fact in text.
- **A state claim that needs a selector is a bug in an extension.** Everything
  an extension knows about itself reaches you through `.extensions.<id>` over
  HTTP, or `read().diagnostics` in the page. If a recipe here cannot make its
  assertion without querying the extension's markup, the extension is
  under-publishing — fix its `diagnostics()` and update the recipe, rather than
  growing a scraper back.
- **A state claim that needed a browser is worth a second look.** The routes
  answer everything the bridge answers. If you opened a tab to read a value,
  say why in the report — it is usually a habit, occasionally a gap worth
  filing.

## Cleanup

In this order:

1. Restore the app's baseline **through the app**: `localStorage.clear()` plus
   a reload resets every core preference and extension override at once, and
   the escape hatches (`?dtb-flags=reset`, `?dtb-theme=reset`) prove the
   documented recovery path while they do it.
2. Reset viewport emulation if you changed it: `resize_window` with
   `{"preset": "desktop"}`. It otherwise persists on the tab across reloads.
3. Stop only what you started: `mcp__Claude_Browser__preview_stop` with the
   `serverId` from your own `preview_start` result. Never `pkill vite` — a
   name-matched kill takes the user's own dev servers with it.
4. Leave `.verify-artifacts/` alone. Confirm the paths `capture.sh` printed
   still exist, and report them.

`dist/` is a build output, not scratch state; leave it built.

## Helpers

| File | Run it as | Does |
| --- | --- | --- |
| [`doctor.sh`](./doctor.sh) | `sh .claude/skills/verify-dev-toolbar/doctor.sh` | Read-only preflight; exit 0 = drive it |
| [`capture.sh`](./capture.sh) | `capture.sh <feature> <filename> <<'EOF' … EOF` | Writes an artifact under the current run in `.verify-artifacts/` and prints its path; `--new-run` starts a run; warns when `<feature>` is not a `features/*.md` name |

## Maintenance

The feature map goes stale the moment an extension renames a field it
publishes or a command id changes, and a recipe that asserts something the
source no longer produces fails silently — the step "passes" by never running.
So when you change `src/` in a way this map describes, re-check the matching
file in [`features/`](./features/README.md) in the same change: the
`diagnostics()` field names, the command ids, the ARIA names, the storage keys
and the counts. Anything you cannot confirm against the source or a live check
belongs in the file marked unverified, the way the existing entries do — never
as a claim.

The map used to depend on ~40 `data-dtb-*` attributes through a 183-line
private scraper, with nothing in CI protecting any of them. That is gone: the
state assertions now read the extensions' own `diagnostics()` through
`@nejcm/dev-toolbar/ext/agent`, which is covered by
`src/ext/agent/__tests__/phase1.test.tsx`. Markup handles survive here only
for *input* and for the few facts that are genuinely pixels — geometry,
computed style, stacking, `localStorage`, and the playground app's own
readouts.

The HTTP routes are two files: the page half is the bridge's `report` option
(`src/ext/agent/report.ts`, tested in `__tests__/phase3.test.tsx`) and the
server half is `examples/playground/plugins/devToolbarAgent.ts`. Neither is
part of the published package — there is no `./vite` subpath — so a consumer
copies the plugin. If a route's shape changes, this file and the README's
`/ext/agent` section change with it.
