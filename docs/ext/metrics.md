# `@nejcm/dev-toolbar/ext/metrics`

Memory, delay, jank and network in one extension.

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

**Instrument your own client instead of being patched.** By default the network
collector wraps `fetch` and `XMLHttpRequest` — once globally, feeding every live
collector, and restoring the originals when the last one leaves. If you would rather
report from your own HTTP client, hand it a bus:

```ts
import { createEventBus } from "@nejcm/dev-toolbar/runtime";
import type { ToolbarEventMap } from "@nejcm/dev-toolbar/runtime";

export const bus = createEventBus<ToolbarEventMap>();

const extensions = [
  metrics({ network: { bus, patchFetch: false, patchXhr: false } }),
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
props.

---

[Documentation index](../README.md) · [Extension contract](../extension-contract.md) · [Runtime](../runtime.md)
