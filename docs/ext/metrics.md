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
| `mem` | Used JS heap, and whether it has risen on most samples without falling, by a material amount, over a minute | 50% / 75% of the heap limit |
| `delay` | The *worst* interaction in a rolling 30 s window, not the latest | 200 ms / 500 ms, per INP guidance |
| `jank` | Dropped frames over expected frames, across 5 s of *active* frames | 2% / 5% |
| `net` | Requests in flight; the panel lists recent ones | any slow → warn, any failed → bad |

Every one degrades on its own. `performance.memory` is Chromium-only, Event Timing is
not everywhere, and `requestAnimationFrame` may not exist at all: each missing API
turns its chip into `NA` with a sentence in the panel saying why. None of them throws,
and one missing API never breaks the others.

```ts
metrics({
  only: ["memory", "network"],       // which collectors run, in bar order
  updateHz: 2,                       // aggregation rate; compact chips cap at 4 Hz
  memory: { thresholds: { warn: 0.4, bad: 0.7 } },
  jank: false,                       // switch one off entirely
  network: { slowMs: 400, filter: ({ url }) => !url.startsWith("/telemetry") },
});
```

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
props.

---

[Documentation index](../README.md) · [Extension contract](../extension-contract.md) · [Runtime](../runtime.md)
