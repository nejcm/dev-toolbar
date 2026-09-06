# `@nejcm/dev-toolbar/ext/metrics`

Memory, delay, jank, network and consumer-supplied collectors in one extension.

```tsx
import { DevToolbar } from "@nejcm/dev-toolbar";
import { metrics } from "@nejcm/dev-toolbar/ext/metrics";

// Once, at module scope. Not inside render.
const extensions = [metrics()];

export function Root({ children }) {
  return <DevToolbar extensions={extensions}>{children}</DevToolbar>;
}
```

| Chip | Shows | Thresholds (default, all configurable) |
| --- | --- | --- |
| `mem` | Used JS heap, and whether its *floor* rose across the last minute by a material amount — a leak is a sawtooth with a rising floor, not a monotonic climb | 50% / 75% of the heap limit |
| `delay` | The *worst* interaction in a rolling 30 s window, not the latest. Event Timing entries are grouped by `interactionId` the way INP does, so one tap is one interaction; hover and other non-interaction entries are skipped unless `includeNonInteractions` is set | 200 ms / 500 ms, per INP guidance |
| `jank` | Dropped frames over expected frames, across 5 s of *active* frames. The frame spanning a tab switch is discarded. A visible gap between 1 s and 30 s is a *stall*: counted and shown as "Longest stall", kept out of the ratio and out of "Worst frame", and a debugger pause or modal dialog counts as one. Gaps over 30 s (`stallCeilingMs`) are treated as absent | 2% / 5% |
| `net` | Requests in flight; the panel lists recent ones | any slow → warn, any failed → bad |

Every one degrades on its own. `performance.memory` is Chromium-only, Event Timing is
not everywhere, and `requestAnimationFrame` may not exist at all: each missing API
turns its chip into `NA` with a sentence in the panel saying why. None of them throws,
and one missing API never breaks the others.

Two platform limits the panel names rather than hides. Chromium rounds
`performance.memory` and refreshes it only every 20 minutes unless the renderer is
locked to one site (desktop Chrome usually is, Android mostly is not); when samples
stop moving the `mem` panel says `Sampling: rate-limited` and stops reporting change or
growth instead of printing a zero. Event Timing rounds every duration to 8 ms, so
`delay` shows 248 ms or 256 ms, never 250.

```ts
metrics({
  only: ["memory", "network"],       // which collectors run, in bar order
  updateHz: 2,                       // aggregation rate; compact chips cap at 4 Hz
  memory: { thresholds: { warn: 0.4, bad: 0.7 } },
  jank: false,                       // switch one off entirely
  network: { slowMs: 400, filter: ({ url }) => !url.startsWith("/telemetry") },
});
```

## Custom collectors

Pass `collectors?: readonly Collector[]` to append consumer-owned metrics after the
four built-ins, in registration order. `only?: readonly CollectorId[]` selects and
orders either kind. An explicit `only` excludes every unlisted collector; duplicate
IDs in `only` run once. Built-in `false` options still take precedence over `only`.

```ts
import { metrics } from "@nejcm/dev-toolbar/ext/metrics";
import type { Collector } from "@nejcm/dev-toolbar/ext/metrics";
import { createTimeSeries } from "@nejcm/dev-toolbar/runtime";

const series = createTimeSeries(120);
const queue: Collector = {
  id: "queue-depth",
  supported: true,
  estimatedCost: "minimal",
  series,
  start({ signal, now, invalidate }) {
    const timer = setInterval(() => {
      series.push(now(), readQueueDepth()); // Your application's getter.
      invalidate();
    }, 1000);
    signal.addEventListener("abort", () => clearInterval(timer), { once: true });
  },
  read() {
    const value = series.last();
    return {
      id: "queue-depth", label: "queue", title: "Queue depth",
      status: series.size ? "ok" : "pending", severity: "unknown",
      display: series.size ? String(value) : "NA", value, unit: "jobs",
      hint: "Jobs waiting in the application queue.", detail: [],
    };
  },
  reset() { series.clear(); },
  diagnostics() { return { depth: Number.isFinite(series.last()) ? series.last() : null }; },
};

const extensions = [metrics({ collectors: [queue], only: ["memory", "queue-depth"] })];
```

`metrics()` throws immediately for IDs outside `/^[A-Za-z0-9_-]+$/`, duplicate
custom registrations, a custom ID matching any built-in, or an unknown ID in
`only`. Registration validation applies even to excluded collectors and disabled
built-ins. IDs are case-sensitive. The same ID identifies the chip, panel tab,
persisted selection and diagnostic row; keep it stable for the collector's lifetime.

`Collector`, `CollectorContext` and `MetricView` are exported types from this
subpath. `TimeSeries` and `createTimeSeries` come from `/runtime`.

| Collector member | Contract |
| --- | --- |
| `id: CollectorId` | Stable identity; `read().id` must match. |
| `supported`, `unsupportedReason?` | Report platform support without installing observers in the factory. Unsupported collectors still render, but are never started. |
| `estimatedCost` | `"minimal"`, `"moderate"` or `"high"`, shown in the panel. |
| `start(context): void` | Begin collection. `context.signal` aborts on teardown; detach every observer, listener and timer. Support restart with a fresh signal for StrictMode. No cleanup return value. |
| `context.now()` | Monotonic sample clock, with a wall-clock fallback where Performance is absent. |
| `context.invalidate()` | Request an early read, coalesced and throttled. Call after changing samples or details. |
| `read(now): MetricView` | Cheap, side-effect-free view, including before `start()` and when unsupported. Supply label, title, status, severity, display, numeric value, unit, hint and formatted detail pairs. |
| `series: TimeSeries` | Bounded numeric history for the sparkline. Push via `series.push(at, value)`. |
| `reset(): void` | Clear retained samples and aggregates. Keep active subscriptions running. |
| `diagnostics(now): unknown` | JSON-safe summary. Redact sensitive data before retaining it; the combined dump is redacted again before export. |
| `entries?(now)` | Existing network request-table hook. Custom collectors use `detail` for panel rows and `diagnostics` for other data. |

Construct collectors and the extension once, outside render. Use a separate collector
instance for each metrics extension. `read`, `reset` and `diagnostics` must not throw;
`start` errors are logged per collector so the others can start.

`MetricId` remains exactly `"memory" | "delay" | "jank" | "network"`.
The new `CollectorId = MetricId | (string & {})` admits consumer IDs without
opening the built-in record. `MetricsSnapshot.views` still requires all four
built-in keys, including switched-off placeholders. Custom views live in
`MetricsSnapshot.custom: Readonly<Record<string, MetricView>>`; snapshot and runtime
`order` are `readonly CollectorId[]`. `MetricView.id` and `Collector.id` also use
`CollectorId`. Code constructing snapshots must now provide `custom`, usually `{}`.

The diagnostics dump's `metrics` array includes custom numeric summaries, so
`/ext/agent` and `/ext/diagnostics` read them automatically. Built-in detail dumps
keep their existing top-level keys. Custom dumps live under `custom[id]`, avoiding
collisions with `metrics`, `url` and other metadata. With no custom collectors the
diagnostics shape is unchanged.

## Playground examples

Both examples live **outside the published package**, in
[`examples/playground/src/collectors`](../../examples/playground/src/collectors).
They add no factory exports or dependencies to `/ext/metrics`.

- [`reactProfiler.ts`](../../examples/playground/src/collectors/reactProfiler.ts)
  returns `{ collector, onRender }`. The playground registers the collector fifth
  and wraps its app content in `<Profiler onRender={reactProfiler.onRender}>`.
  Each commit writes `actualDuration` and `baseDuration` into paired, bounded
  `TimeSeries` histories; the chip and sparkline use actual duration. The toolbar
  sits outside that subtree to avoid measuring its own updates. React's ordinary
  production build disables profiling; use a profiling build to collect there.
  [React Profiler reference](https://react.dev/reference/react/Profiler).
- [`webVitals.ts`](../../examples/playground/src/collectors/webVitals.ts) registers
  sixth. Three buffered `PerformanceObserver` calls observe LCP, layout shifts
  and events. TTFB comes from Navigation Timing. The chip shows LCP; the panel and
  diagnostics also report CLS session maxima and an INP estimate grouped by
  interaction ID. It retains ten slow interactions and uses `interactionCount`
  to discard one outlier per fifty interactions; where that count is unavailable
  it reports the worst observed interaction. This is a live page estimate, not a
  field-reporting SDK: no attribution, iframe aggregation, visibility finalization
  or bfcache/prerender lifecycle handling. Reset starts a new observation window
  but retains the page's TTFB. Consumers needing full Web Vitals semantics or
  attribution should inject their own collector.
  [INP definition](https://web.dev/articles/inp).

**Instrument your own client instead of being patched.** With no bus, the network
collector wraps `fetch` and `XMLHttpRequest` — once globally, feeding every live
collector, and restoring the originals when the last one leaves. If you would rather
report from your own HTTP client, hand it a bus: that turns both patches off, so the
same request is never recorded twice under two unrelated ids.

```ts
import { createEventBus } from "@nejcm/dev-toolbar/runtime";
import type { ToolbarEventMap } from "@nejcm/dev-toolbar/runtime";

export const bus = createEventBus<ToolbarEventMap>();

const extensions = [
  metrics({ network: { bus } }),   // patchFetch/patchXhr default to false with a bus
];

// then, from your client:
bus.emit("network-start", { requestId, method, url });
bus.emit("network-end", { requestId, ok, status, duration, bytes });
```

In a test, hand it `createMockBus()` from `@nejcm/dev-toolbar/testing` instead and
drive the two events by hand — no `fetch` to stub, and a clock you control.

URLs are run through `redactUrl()` before they are retained, and headers and bodies
are never read at all. "Copy diagnostic data" passes the whole dump through
`redact()` on the way to the clipboard.

The extension ships its own stylesheet, injected once per document. If you set
`injectStyles={false}` on `<DevToolbar>`, set `metrics({ injectStyles: false })` too
and deliver `METRICS_CSS` yourself — core's flag is a prop, and extensions cannot see
props. `styleNonce` on `<DevToolbar>` is forwarded to the sheet via the slot;
`metrics({ styleNonce })` overrides it.

---

[Documentation index](../README.md) · [Extension contract](../extension-contract.md) · [Runtime](../runtime.md)
