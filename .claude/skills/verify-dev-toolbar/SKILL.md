---
name: verify-dev-toolbar
description: Drive the @nejcm/dev-toolbar playground in a real browser and capture proof that the shell and its first-party extensions behave for a user. Use when a change to src/core, src/runtime or src/ext needs evidence beyond vitest — panels, overflow, overlays, flag overrides, redaction, ⌘K — or when asked to verify, demo or screenshot the toolbar.
---

# Verify @nejcm/dev-toolbar

This package is a React library, so there is no app to run — except one. Its
single user-facing surface is `examples/playground`, a Vite app that consumes
the built `dist/` through `file:../..` exactly as a published consumer does. It
mounts the real shell with the real first-party extensions and gives every one
of them something to measure. Driving the playground is the only way to prove
user-visible behavior here; `vitest` runs in jsdom and cannot see layout,
stacking, pointer events, or a reload.

The feature map in [`features/`](./features/README.md) is the maintained
source for what to drive. Read its README before driving anything, then use the
matching feature file as the recipe.

Secondary surfaces, out of scope for this skill: `bun run test:jest-consumer`
(a real CommonJS consumer of `dist/`), `bun run check:package`, and
`bun run size`. They are commands, not apps — run them directly.

## Launch

The playground is the `playground` entry in [`.claude/launch.json`](../../launch.json).
Start it through the Browser pane, never through Bash:

- `mcp__Claude_Browser__preview_start` with `{"name": "playground"}`.
- Its `predev` script runs `bun run build` at the repo root first, so the tab
  always serves the current `src/`. The build takes a few seconds; the server
  is ready when `preview_logs` prints `VITE v8 ready in <n> ms` and
  `Local: http://localhost:5273/`.
- Keep the `tabId` from the result and pass it to every later browser call.
- Editing `src/` does **not** hot-reload the tab — the playground imports
  `dist/`. Rebuild with `bun run build` and reload the tab, or run
  `bun run dev` (tsup watch) in the background alongside the preview.

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

The browser half of the doctor is the probe below: `mounted: true`,
`shell.instance: "playground"`, and a `bar` list of twelve extensions is a
healthy instance.

## Drive

Two tools do all the work: `mcp__Claude_Browser__computer` for user input, and
`mcp__Claude_Browser__javascript_tool` for reading state. Batch them with
`mcp__Claude_Browser__browser_batch` when the next step is predictable.

**Read state with the probe.** [`probe.js`](./probe.js) returns one
JSON-serialisable snapshot of every stable handle the shell and the extensions
publish. Load it into the page from Vite's `/@fs` route — the playground's
`server.fs.allow` already covers the repo root:

```bash
echo "eval(await (await fetch(\"/@fs$(git rev-parse --show-toplevel)/.claude/skills/verify-dev-toolbar/probe.js\")).text())"
```

Paste that line as the `text` of a `javascript_tool` call. It is read-only.
The full snapshot is large, so narrow it in the same call rather than dumping
it — assign and project:

```js
const s = eval(await (await fetch("/@fs/…/probe.js")).text());
({ chip: s.flags.chip, storage: s.storage })
```

**Prefer stable handles over coordinates.** In rough order of preference:

| Handle | Where it comes from | Example |
| --- | --- | --- |
| `data-dtb-part` | core and every first-party extension | `[data-dtb-part="bar"]`, `panel`, `overflow-button`, `cmd-input`, `flag-row`, `env-row-value` |
| `data-dtb-ext-id` | one per extension, on its bar item, panel and overlay | `[data-dtb-ext-id="flags"]` |
| ARIA role + name | the accessible surface | `toolbar` "Developer toolbar", `switch` "Toggle new-header", `dialog` "Commands" |
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

**Keys.** Send `Enter`, not `Return` — `Return` reaches the page as a key the
palette's `switch (event.key)` does not match, so it silently does nothing.
`cmd+k` opens the palette on this platform (`Mod` is exclusive: on macOS
`ctrl+shift+.` does not toggle the bar, `cmd+shift+.` does).

**Waiting.** The bar's overflow runs off a `ResizeObserver` and the environment
extension polls every 500 ms, so a read immediately after a resize or a
context mutation can catch the previous frame. Re-read until the value settles
rather than asserting on the first snapshot.

## Evidence

Persist each artifact with [`capture.sh`](./capture.sh), which writes under
`.verify-artifacts/<run id>/<feature>/` at the repo root (git-ignored) and
prints the path:

```bash
.claude/skills/verify-dev-toolbar/capture.sh --new-run   # once, at the start
.claude/skills/verify-dev-toolbar/capture.sh flags 02-override-applied.json <<'EOF'
{ "chip": "flags1 overridden", "storage": { "…": "…" } }
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
overwrite is what you meant, and it says so on stderr.

Proof standards for this repo:

- **Drive the real user path.** Click the chip, the switch, the palette option.
  `useDevToolbar()` setters and `runCommand()` exist, and the playground even
  exposes some as buttons — they are fixtures for reaching a state, never the
  thing under proof.
- **Capture the action and the resulting state**, not just the end screen: the
  probe snapshot before, the input you sent, the snapshot after.
- **Verify the side effect too.** Nearly everything here has one, and it is the
  half that regresses: the `dtb:v1:playground:*` `localStorage` keys, the
  `--dev-toolbar-height-playground` custom property on `<html>`, the
  `padding` the inset derives from it, and the app's own `flag-readout` /
  `theme-swatches` readouts. A chip that changed while storage did not is a
  failure, not a pass.
- **Prove persistence by reloading**, not by reading the store you just wrote.
- **No mocks.** Every extension in the playground is the real published module
  measuring the real page. The only fakes are the app's own flag backend and
  environment context — the production boundaries the contract already puts on
  the consumer's side.
- **A screenshot is a supplement.** `computer {"action":"screenshot"}` lands in
  the transcript, not on disk; the probe JSON is the artifact that survives.
  Take a screenshot when the claim is visual (stacking, overlays, restyling)
  and pair it with the snapshot that states the same fact in text.

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
| [`probe.js`](./probe.js) | `eval(await (await fetch("/@fs<repo>/.claude/skills/verify-dev-toolbar/probe.js")).text())` in `javascript_tool` | One read-only snapshot of shell + extension state |
| [`capture.sh`](./capture.sh) | `capture.sh <feature> <filename> <<'EOF' … EOF` | Writes an artifact under the current run in `.verify-artifacts/` and prints its path; `--new-run` starts a run |

## Maintenance

The feature map goes stale the moment an extension gains a panel row or a
`data-dtb-part` is renamed, and a recipe that asserts a handle the source no
longer publishes fails silently — the step "passes" by never running. So when
you change `src/` in a way this map describes, re-check the matching file in
[`features/`](./features/README.md) in the same change: the selectors, the
ARIA names, the storage keys, the counts, and the probe fields each step reads.
Anything you cannot confirm against the source or a live check belongs in the
file marked unverified, the way the existing entries do — never as a claim.
