# Changelog

## 0.1.0 — unreleased

First publish. The shell (P0), the runtime primitives and the first extension (P1),
and P2's three extensions. `CONTRACT_VERSION` is `1`.

### Added

- `@nejcm/dev-toolbar` — the shell: portal, bar with align/order/priority and
  `ResizeObserver`-driven overflow, single-panel host with a resizable persisted
  height, `--dtb-*` tokens and `data-dtb-part` hooks, injectable storage adapter,
  per-extension error boundaries, toggle shortcut, aggregated commands.
- `@nejcm/dev-toolbar/runtime` — opt-in, framework-free, never imported by core:
  `createEventBus`, `createRingBuffer` / `createNumericRing` / `createTimeSeries`
  (bounded and allocation-stable), `createThrottledStore`, and `redact` /
  `redactUrl` / `redactHeaders`.
- `@nejcm/dev-toolbar/ext/metrics` — memory, delay, jank and network as one
  extension, each degrading to `NA` where its platform API is missing. Instrument
  your own HTTP client through a `/runtime` bus, or let it wrap `fetch` and
  `XMLHttpRequest`.
- `@nejcm/dev-toolbar/ext/environment` — environment, build and authenticated-actor
  context (§3B). Every value is consumer-supplied: no `process.env`, no global, no
  guess from the hostname — supply nothing and it says `unknown`. Route, viewport and
  connection are read from the browser and tagged `detected` so they cannot be
  mistaken for a deploy fact. Production is marked conspicuously and impersonation is
  unmistakable in the bar and the panel.
- `@nejcm/dev-toolbar/ext/flags` — feature-flag controls (§3C) and the promoted flag
  (§7). The flags stay the consumer's: a reading in, an `onOverride` adapter out, and
  a read-only panel when no adapter is supplied. Every row shows the effective value,
  the application's own value and the default side by side, so an override is never
  mistaken for what the server sent. Overrides persist per instance, are re-applied
  through the adapter on the next mount, and `?dtb-flags=reset` drops them all before
  any of them is applied. Values are redacted on the way in, under their own flag
  key, and a masked value never round-trips through the editor. An override whose
  flag has left the catalogue still gets a row, because it is still being applied.
  Adapter failures are recorded per flag and shown on the row that failed. Editors
  refuse input they cannot parse instead of coercing it.
- `readStoredOverrides()` on `/ext/flags` — reads the persisted override map without
  mounting anything, so an app can seed its own store before the first paint.
- `@nejcm/dev-toolbar/ext/command-menu` — the `⌘K` palette over the commands core
  aggregates, and the only extension here that reads instead of contributing. Browses
  grouped with recents first, searches as one scored list, runs by id through core so
  a command that has gone says so, keeps itself open and shows the message when a
  command throws, and restores focus to whatever had it. A combobox over a listbox,
  with `aria-activedescendant`, trapped `Tab` and named groups. It lives in the new
  `overlay` slot, so the shortcut survives its chip collapsing into the `···` menu.
  Swap it for your team's own `cmdk` by leaving it out — core still aggregates.
- `@nejcm/dev-toolbar/testing` — `renderWithToolbar`, `makeExtension`,
  `createMockBus`, `installToolbarLayout`.
- `ensureStyleSheet(entry, css)` in `/runtime` — the once-per-document style injector
  both extensions were writing privately. Keyed on a
  `style[data-dev-toolbar-styles]` element, so two bundled copies still inject once.

### Fixed

- `redact()` in `/runtime` silently dropped an object key named `__proto__` — the
  rebuild assigned into a plain object, where `Object.prototype`'s setter swallows
  the write, so the key read back through the prototype and rendered as
  `"[object Object]"` with a spurious `masked` badge. Nothing was ever polluted.
  Both rebuild paths (`redact` and `redactHeaders`) now define the property. Affected
  `/ext/environment` as well as `/ext/flags`.

### Contract changes from building the palette

Building `/ext/command-menu` moved it in two more places, both additive, and settled
the limitation `/ext/flags` had deferred. Full rationale in
[plans/architecture.md §13](./plans/architecture.md).

`CONTRACT_VERSION` stays `1`. Every extension written against the earlier contract
still *behaves* identically, and every one that only ever *receives* an
`ExtensionRuntimeApi` — which is what an extension does — still type-checks. The
qualification: `getCommands` and `runCommand` are required members, so code that
**constructs** that type by hand breaks. That is real — the three api fakes in this
repo's own tests needed updating — but it is test-harness code rather than the
extension-facing contract `contractVersion` describes, and nothing has been
published. Extension authors constructing an api for their own tests should reach for
`/testing` instead.

- **`commands` may be a function.**
  `commands?: ToolbarCommand[] | (() => ToolbarCommand[])`, called by core on each
  aggregation pass. A static array stays valid and unchanged, so `/ext/metrics` and
  `/ext/environment` needed no edit. This closes the gap recorded in §12.2: an
  extension can now contribute a command that only exists after mount.
  `/ext/flags` enumerates per flag live, and a flag that appears later gets a working
  toggle command with no reload. The function must be a pure, cheap enumeration — it
  runs during render — and core fails closed around it: a throw, a non-array return
  or an unrunnable entry means that extension contributes nothing, logged once per id.
  Because core has no invalidation signal, `useToolbarCommands()` remains the stable
  snapshot as of the last extension-list change, and `useDevToolbar().getCommands()`
  re-enumerates on demand; `runCommand(id)` always resolves against a fresh
  aggregation.
- **A third slot, `overlay`.** Rendered once per extension inside the toolbar root
  while the extension is present, not hidden and the bar is visible, and never
  collapsed by overflow. For dialogs and pickers: a panel would evict whatever else
  was open, and a compact item that collapses into the `···` menu is not in the DOM,
  which would take an extension's modal and key binding with it. Errors are contained
  like any other slot (`data-dtb-slot="overlay"`), and the wrapper is
  `display: contents`, so a rendered overlay adds nothing to the root's layout or to
  `--dev-toolbar-height` — the one exception being a *throwing* overlay, whose error
  chip becomes a flex child of the root's column and does add a row.
- **`ExtensionRuntimeApi` gains `getCommands()` and `runCommand(id)`**, so an
  extension can read the aggregation without importing a value from core — which §7
  forbids, and which `useToolbarCommands()` would have required.
- `/testing` follows: `makeExtension({ overlay, throwInOverlay })`,
  `toolbar.overlay(id)` and `toolbar.getCommands()`.

### Contract changes from building the first extension

Building `/ext/metrics` against the P0 contract moved it in four places. All are
additive or semantic corrections and version 1 has never shipped, so
`CONTRACT_VERSION` stays `1`. Full rationale in
[plans/architecture.md §10](./plans/architecture.md).

- **`hidden` now means absent, not unpainted.** A hidden extension is never
  `start()`ed and is torn down if it becomes hidden while running; its panel is
  unmounted (`keepMounted` included) and `activePanelId` cleared; and it contributes
  no commands to `useToolbarCommands()` or `runCommand()`. Previously only the bar
  render honoured the flag, so a hidden collector kept `fetch` patched, its panel
  kept rendering, and `runCommand("metrics.copy")` still worked. This is a behaviour
  change for any extension that relied on running while hidden.
- **`CompactSlotProps` gains `togglePanel()`.** Every trigger was reimplementing
  core's own single-panel invariant by hand.
- **New tokens `--dtb-ok`, `--dtb-ok-bg`, `--dtb-warn`, `--dtb-warn-bg`**, so
  severity colours restyle with the rest of the bar. Extensions namespace their
  `data-dtb-part` names with their extension id; core owns the unprefixed ones.
- **Core warns once per id when a started extension object is rebuilt.** The object
  identity is the lifecycle; a rebuilt object leaves the bar rendering something that
  owns nothing. A hot-module reload triggers this too.

### Also

- `ToolbarEventMap` reserves `hydration` and `hydration-error` now, ahead of the
  collector that will consume them, so the shared vocabulary does not grow a name per
  release.
- `redact()` masks credentials inside URL-shaped *values*, not only by key name — the
  OAuth-callback shape (`?access_token=…`) hides in the value, where key matching
  cannot see it. A URL value with nothing to mask comes back byte-for-byte unchanged,
  so `redact()` never normalises an innocent URL out from under a diff.
  `redactUrl()`, whose caller has explicitly said "this is a URL", still returns the
  `URL.toString()` form. Neither throws `URIError` on a malformed percent-escape any
  more; both are reachable synchronously inside the patched `fetch`.
- `/ext/metrics` runs the page URL through `redactUrl()` before it enters a
  diagnostics dump, and contains any error thrown by a recorder — or by a
  consumer-supplied `network.filter` — so instrumenting a request can never fail it.

### How `/ext/environment` treats your data

§6 of the design is guidance rather than something core implements, and this is the
extension where the guidance bites:

- **Redaction happens on the way in, not on the way out.** Every supplied value goes
  through `redact()`, and email addresses are masked on top of it. The panel, both
  copy buttons and the aggregated commands read the same redacted snapshot; the raw
  context never reaches a renderable object. A copy path that re-derives from raw
  input is one refactor away from being the only path that forgets, and
  `runCommand("environment.copy")` is a second front door onto the same data.
- **Masking is visible.** A masked row is tagged `masked` in the panel and the count
  sits beside the copy buttons. Silent masking looks exactly like a value nobody
  supplied, and those are different problems.
- **A restricted view is a supported shape.** `fields: [...]` is an allowlist and
  drops everything else outright — `extra` entries, named `extra:<key>`, included;
  for an actor who should not see the extension at all, leave it out of the
  `extensions` array rather than passing `hidden: true`.
- **Reading your context fails closed.** A getter that throws — on the context object
  or nested inside `extra` — degrades to a snapshot that says the context could not be
  read, and logs. It cannot escape: the first build happens at factory time, before
  core has an error boundary to contain it, and later ones run inside a timer.
- **Structured values are redacted as objects, then serialised.** `redact()` finds
  sensitive keys by walking a graph, so a value serialised first would hide its own
  inner keys from it.

The contract did not move. `/ext/environment` needed nothing that P1 had not already
added, which is the first evidence that version 1 is stable rather than merely
young — see [plans/architecture.md §11](./plans/architecture.md).
