# Metrics collectors

One chip strip shows a live readout per collector; clicking it toggles a
tabbed panel with a tab per collector, and the selected tab survives a reload.
The playground registers seven collectors: the five built-ins `memory`, `fps`,
`delay`, `jank`, `network`, then the app-owned `react-profiler` and
`web-vitals` (from `examples/playground/src/collectors`).

## Sub-features

- `metrics-roster` publishes every collector in `data.metrics`, an array of
  `{id, status, severity, value, unit}`, plus one key per built-in, `custom`
  (the two app summaries), `generatedAt`, `userAgent` and `url`.
- `metrics-tabs` is a `tablist` named `Metrics` with a roving `tabindex`
  (Arrow/Home/End) and a `tabpanel` labelled by the active tab.
- `metrics-persist` stores the selected tab as the raw string at
  `dtb:v1:playground:ext:metrics:tab`.
- `metrics-network` counts the app's *3 requests (404)* button as three
  failed requests: it fetches `/__status/404`, which the playground's
  `plugins/statusRoutes.ts` answers with a real `404` (a made-up path would
  get Vite's SPA fallback, `index.html` with `200`).
- `metrics-fps` tracks the playground's *Animate something* card.
- `metrics-commands`: `metrics.reset`, `metrics.copy`, and while `network` is
  enabled `metrics.network.{export,copyAsCurl,clear,pause}` (`export`,
  `copyAsCurl` and `pause` take input, so they are not in `⌘K`).

## How to get to it (user POV)

- At 1280×800 `metrics` is collapsed: open `⋮` and click any of its rows.
  In the menu it spells out one `metrics-overflow-row` button per metric
  (`Memory 52 MB`, `Network 0`, …) instead of the bar's single trigger. Every
  row only toggles the panel — it does not pick the clicked metric's tab.
- Pick a tab; reload; reopen.
- Drive the app's Allocate/Release buttons and the *Animate something* card.

## Driving it with the Browser pane

Preconditions: baseline per [README](./README.md), viewport pinned.

- **Roster.** `curl -s localhost:5273/__dev-toolbar/state | jq
  '.extensions.metrics.metrics|map(.id)'` →
  `["memory","fps","delay","jank","network","react-profiler","web-vitals"]`,
  and the `metrics` roster entry is `ok`.
- **Tabs and persistence.** Open the panel (above), click `find` role `tab`
  name `Network`. Page read: `localStorage["dtb:v1:playground:ext:metrics:tab"]`
  is `"network"`. `navigate` to the page: `shell.activePanel` is `"metrics"`
  and the `aria-selected="true"` tab is `Network` (driven 2026-10-02). Only the
  selected tab has `tabIndex` 0. Focus a tab: ArrowRight/ArrowLeft move and
  select with wrap-around, Home/End jump to the first/last, and each move
  writes the tab key.
- **Failed requests.** Note `data.network.totals.failed`, click *3 requests
  (404)*: it rises by 3, and `data.network.recent` holds three
  `/__status/404?access_token=…` entries with `status: 404`, `state:
  "failed"` and the token masked.
- **React Profiler.** Select its tab and drive Allocate/Release. Actual
  duration, base duration and commit count update;
  `data.custom["react-profiler"].commits` holds paired numeric samples with
  commit timestamps.
- **Web vitals.** LCP is the chip value; CLS, INP estimate and TTFB are panel
  rows. Unsupported APIs report NA; INP stays pending until an interaction.
- **Capture.** `diagnostics.capture` through the bridge returns a snapshot
  whose metrics contribution carries both custom summaries and their detail.
- **Frame rate.** Pick *smooth*, then *heavy*, waiting at least 6 s after each
  (a rolling 5 s window, readout batched every 500 ms). Settled,
  `data.fps.fps` tracks the card's `[data-testid="anim-fps"]` within rounding;
  *heavy* turns the `fps` metric's severity `bad`; `data.fps.refreshHz` stays
  the display's rate.
- **Reset.** `POST /commands/metrics.reset` → `{ok: true}`. Profiler history
  clears, then resumes on the next app commit; custom collectors stay
  registered.

## Gotchas

- A hidden pane suspends `requestAnimationFrame`, so `data.fps.fps` reads
  near `1` there (seen 2026-10-02) — the frame-rate step needs a displayed
  pane or a visible headless Chromium.
- `src/ext/metrics/__tests__/custom.test.tsx` covers `only` selection and
  ordering, excluded collectors staying stopped and duplicate/invalid ids;
  `types.test.ts` (under `bun run typecheck`) rejects a widened `MetricId`.
- `examples/playground/e2e/metrics.spec.ts` covers failed requests, tab
  roving and the tab restored after a reload.
- Driven 2026-10-02: roster, tabs, persistence and reset. The frame-rate step
  was driven 2026-09-29 (README run log); the Profiler, Web vitals and capture
  steps are written from source and not recorded as driven.
