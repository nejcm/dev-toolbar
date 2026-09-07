# Metrics collectors

Use the existing playground session. The metrics extension registers six collectors:
`memory`, `delay`, `jank`, `network`, `react-profiler`, `web-vitals`. The last two
are app-owned examples, imported from `examples/playground/src/collectors`.

1. Read `window.__DEV_TOOLBAR__.instances.playground.read()`. Its `metrics`
   diagnostics entry must be `ok`; `data.metrics` lists all six IDs. If metrics
   has collapsed, open `⋮`; otherwise inspect its bar chips.
2. Click a metric to open the panel. Select the React Profiler tab. Interact
   with the app's Allocate/Release buttons. Actual duration, base duration and
   commit count update; `data.custom["react-profiler"].commits` contains paired
   numeric samples with commit timestamps.
3. Reload with that tab selected. Reopen metrics and confirm React Profiler
   is still selected. The stored selection is
   `dtb:v1:playground:ext:metrics:tab = react-profiler`.
4. Select Web vitals. LCP is the chip value; CLS, INP estimate and TTFB are
   panel rows. Unsupported APIs report NA. INP remains pending until interaction.
5. Invoke `diagnostics.capture` through the agent handle. The returned snapshot's
   metrics contribution contains both custom summaries and their detail dumps.
6. Run `metrics.reset`. Profiler history clears, then resumes on the next app
   commit. Custom collectors remain registered.

`src/ext/metrics/__tests__/custom.test.tsx` separately exercises `only` selecting
and ordering custom IDs, excluded collectors staying stopped, duplicate/invalid IDs,
and the exact playground Profiler reaching the five required destinations.
`types.test.ts` runs under `bun run typecheck` and rejects a widened `MetricId`
or a built-in view record missing `network`.

These are verification instructions, not a record of a browser run.
