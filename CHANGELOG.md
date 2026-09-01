# Changelog

## 0.1.0 — unreleased

First publish. The shell (P0), the runtime primitives and the first extension (P1),
and the first P2 extension. `CONTRACT_VERSION` is `1`.

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
- `@nejcm/dev-toolbar/testing` — `renderWithToolbar`, `makeExtension`,
  `createMockBus`, `installToolbarLayout`.
- `ensureStyleSheet(entry, css)` in `/runtime` — the once-per-document style injector
  both extensions were writing privately. Keyed on a
  `style[data-dev-toolbar-styles]` element, so two bundled copies still inject once.

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
