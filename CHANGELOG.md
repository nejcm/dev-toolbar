# Changelog

## 0.1.0 — unreleased

First publish. The shell (P0) plus the runtime primitives and the first extension
(P1). `CONTRACT_VERSION` is `1`.

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
- `@nejcm/dev-toolbar/testing` — `renderWithToolbar`, `makeExtension`,
  `createMockBus`, `installToolbarLayout`.

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
