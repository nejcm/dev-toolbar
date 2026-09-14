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
| `net` | Requests in flight, or `paused` when recording is off; the panel lists recent ones | any slow → warn, any failed → bad |

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
  presentation: "icon-value",        // see Bar presentation, below
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
[`examples/playground/src/collectors`](https://github.com/nejcm/dev-toolbar/blob/main/examples/playground/src/collectors).
They add no factory exports or dependencies to `/ext/metrics`.

- [`reactProfiler.ts`](https://github.com/nejcm/dev-toolbar/blob/main/examples/playground/src/collectors/reactProfiler.ts)
  returns `{ collector, onRender }`. The playground registers the collector fifth
  and wraps its app content in `<Profiler onRender={reactProfiler.onRender}>`.
  Each commit writes `actualDuration` and `baseDuration` into paired, bounded
  `TimeSeries` histories; the chip and sparkline use actual duration. The toolbar
  sits outside that subtree to avoid measuring its own updates. React's ordinary
  production build disables profiling; use a profiling build to collect there.
  [React Profiler reference](https://react.dev/reference/react/Profiler).
- [`webVitals.ts`](https://github.com/nejcm/dev-toolbar/blob/main/examples/playground/src/collectors/webVitals.ts) registers
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

## The network commands

Four commands ride on the network collector, and only when it is running — with
`network: false`, or a `only` list that leaves it out, they are not contributed at
all rather than contributed and throwing. Every id is prefixed with the extension's
own `id`, so a second metrics group gets its own set.

| Command | Input | What it does |
| --- | --- | --- |
| `metrics.network.export` | `{ limit?, copy? }` | Returns the retained tail as JSON — `{ generatedAt, url, count, retained, truncated, requests }`, at most 200 requests — for an agent or a bug report. `copy: true` also writes it to the clipboard. |
| `metrics.network.copyAsCurl` | `{ id?, copy? }` | Copies one request as a `curl` line: the one whose `id` you pass, or the most recent. Returns the line; `copy: false` skips the clipboard. |
| `metrics.network.clear` | — | Drops the retained requests and the network counters. Only this collector — `metrics.reset` clears them all. |
| `metrics.network.pause` | `{ paused? }` | Stops recording new requests; omit `paused` to toggle. Returns `{ paused }`. |

```ts
const { result } = await api.invokeCommand("metrics.network.export", { limit: 20 });
// result.requests[0] → { id, method, url, startedAt, duration, status, state, bytes, error }
await api.invokeCommand("metrics.network.copyAsCurl", { id: result.requests[0].id });
// curl --globoff -X 'POST' 'https://api.test/v1/orders?access_token=[redacted]&page=2'
```

Three of the four declare an `input` schema, so [`/ext/command-menu`](./command-menu.md)
skips them the way it skips `flags.set` — `⌘K` lists `metrics.network.clear` and
nothing else of this set, and the other three are reached from
[`/ext/agent`](./agent.md), a console or a hotkey through `invokeCommand`. Every
field of every schema is optional: each command has a sensible zero-argument
meaning (the whole tail, the most recent request, toggle), so a caller that passes
nothing still gets the obvious thing.

`export` hands back **the panel's own entries** — the runtime's snapshot objects, in
the panel's order and through the same `redactUrl()` pass, not a second mapping of
the collector — so what an agent reads and what a developer sees cannot disagree
about redaction, ordering or shape. They are the same entries, not the same count:
the panel's table renders the newest 30 rows, and the export returns the newest 200.

That 200 is a **bound, not a default**, and it is there because of the bridge.
[`/ext/agent`](./agent.md) runs `redact()` over a command result on the way out, and
`redact()` cuts an array at 200 entries and pushes a `"[+N more]"` *string* onto it —
so an unbounded export reached an agent as an array whose last element was not a
request, under a `count` that disagreed with its length. The command caps at the same
200 instead, and reports what that left behind: `count` is always `requests.length`,
`retained` is how many the collector is holding (`historySize`, 100 by default), and
`truncated` is `true` when older retained requests were not returned. There is no
paging past them; a `historySize` above 200 is a retention setting for the panel, not
a bigger export. `limit` only shortens the result further, by slicing the newest N off
the front.

`copyAsCurl` emits **method and URL, nothing else**: no raw header value, body or cookie
is captured anywhere in this extension — a recorder reports a numeric byte count and
nothing else, whether it read `content-length` off a patched response or was handed
`bytes` over the bus — so the line identifies a request rather than replaying it.

What the line shows is the **normalised, redacted** request, not the panel's string
byte for byte. `fetch()` accepts a great deal that a URL parser tidies up on the way
to the wire — a leading space, a tab inside the scheme or the host, a backslash where
a `/` belongs — and the collector retains what the app passed, not what the browser
sent; curl's URL parser is stricter than a browser's and answers those with
`curl: (3) URL rejected`. So the URL goes through `URL` first, exactly as the platform
would, and then through `redactUrl()`. Where the two strings differ, the curl line is
the one that runs. Pass `absolute: false` to `formatCurl` to keep the recorded string
instead — the panel's view rather than its exact bytes, since control characters are
still percent-encoded for curl to parse the line at all — at the cost of a line curl
may refuse.

One class of URL survives parsing and curl still refuses it. WHATWG allows characters
in a hostname that curl does not, so the fifteen printable ASCII characters
``!"$&'()*+,;=`{}`` reach the line verbatim inside a host and make curl answer
`curl: (3) URL rejected: Bad hostname`. This is a divergence between the two parsers,
not something the line can encode around — curl percent-decodes a host before it
validates it, so `a%21b.test` fails exactly as `a!b.test` does, and rewriting the host
would point the line at a different server. A hostname like that has no address in a
browser either, so curl's error is the honest one; the failure is loud, never silent.

Normalising *before* redacting is also what keeps the mask readable: it is written
after the parser, so `[redacted]` reaches the line literally rather than as
`%5Bredacted%5D`. `redactUrl()` masks `user:pass@` userinfo and credential-shaped
query and fragment parameters, so none of them can reach the clipboard; a relative
path is resolved against the page so the line runs; and everything interpolated is
single-quoted for `sh` and handed to curl with `--globoff` — curl runs its own glob
syntax over a URL, where `[redacted]` is a bad range and every masked line would fail
to parse. The same `formatCurl(request, { redact })` is exported if you would rather
render the line yourself. Where the clipboard is unavailable — an insecure origin, a denied
permission — the command throws rather than reporting a copy that did not happen;
the line is still its return value.

`pause` stops the *recording*, never the interceptor: the `fetch`/`XMLHttpRequest`
wrapper is shared with everything else observing requests, so dropping it would
blind them and hand the global to whatever patched later. A paused collector says so
— the chip reads `paused`, the panel gets a `Recording` row, and `diagnostics()`
carries `paused: true` — because a recorder that has quietly stopped is a trap.
Requests recorded before the pause stay readable and exportable.

**Instrument your own client instead of being patched.** With no bus, the network
collector wraps `fetch` and `XMLHttpRequest` through
[`/runtime`'s shared interceptor](../runtime.md) — once globally, feeding every live
collector, and restoring the originals by identity when the last one leaves. If you would rather
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
are never read at all — not as an option either. A `captureBodies` switch with a byte
cap would still be a buffer full of credentials one config mistake away from a
clipboard, and request waterfalls, initiators and replay are what DevTools is for.
"Copy diagnostic data" passes the whole dump through `redact()` on the way to the
clipboard.

The extension ships its own stylesheet, injected once per document. If you set
`injectStyles={false}` on `<DevToolbar>`, set `metrics({ injectStyles: false })` too
and deliver `METRICS_CSS` yourself — core's flag is a prop, and extensions cannot see
props. `styleNonce` on `<DevToolbar>` is forwarded to the sheet via the slot;
`metrics({ styleNonce })` overrides it.

## Bar presentation

```tsx
metrics({ presentation: { preset: "icon-value", icon: (m) => ICONS[m.id] } });
```

`presentation` changes how the bar control looks, never what it measures.
The four knobs — a preset, your own `ReactNode` icon, a `render` callback and an
accessible-name override — the preset-by-preset table and the rules every extension
shares are in [kit.md](../kit.md#presentation). Two of those rules are worth repeating
before the specifics: `"default"` is byte-identical to what shipped before the option
existed, and `presentation`, like every factory option, is **fixed when the factory is
called** — to change it at runtime, remount the toolbar or reload.

What is specific to this extension:

- **It renders N controls, and the option is resolved once per control.** `TView` is
  `MetricView` — the display type each collector's `read(now)` returns — so `icon` and
  `render` are invoked per metric with the metric in hand. That is why no
  `icons: Record<CollectorId, ReactNode>` map is needed: `icon: (m) => ICONS[m.id]`.
- **The two texts are the metric's own**: `view.label` is the short bar word (`mem`) and
  `view.title` is the full one the `⋮` menu paints (`Memory`). The icon lands in
  `data-dtb-part="metrics-icon"`, a new part; the word keeps `metrics-label`.
- **Sharp edge: `preset: "icon"` drops the number from the `⋮` menu.** The overflow rule
  forces the *text* on, never the value, so a menu row reads `Memory` where the default
  reads `Memory 53 MB`. Use `"icon-value"` to keep the number in both places.
- **`data-dtb-metric`, `data-dtb-severity` and the chip's dot never depend on the
  preset** — nor on a `render` callback, in the bar and in the `⋮` menu alike. A
  callback supplies the chip's *children*; the row's value span sits outside the chip so
  the dot and the state attributes stay out of its reach, but `render` still owns icon,
  text **and** value in both places — the row drops the span when a callback painted, so
  `render: (m) => <b>{m.display} used</b>` does not read `48 MB used48 MB` there. It is
  still the preset's to drop. A preset changes text, not state.
- **The accessible-name override is per control, and it reaches the `⋮` rows.** The bar
  button is one control naming N metrics, so it resolves `name` against the first metric
  in bar order; each `⋮` row is one metric and resolves against its own. A row with no
  usable override keeps no `aria-label` at all — those rows are named by their content
  today.

## The bar button's accessible name, and where the numbers go

The bar trigger is named after the extension **plus the short words it paints**, built
from each switched-on collector's `view.label` in bar order. `metrics()` runs all four
built-in collectors unless you narrow `only`, so the name you get by default is
`Metrics: mem, delay, jank, net`. With `only: ["memory"]` it is `Metrics: mem`, and with
no metrics at all (`only: []`) it is the `label` alone.

Two reasons for that exact shape:

- **WCAG 2.5.3 Label in Name.** The chip paints `mem`; a speech-input user says "mem".
  A name of `Metrics` contained no such word, so nothing matched. It was
  `Metrics` before; it is `Metrics: mem, delay, jank, net` now.
- **It does not churn.** Every collector hardcodes its `label` — `mem`, `delay`, `jank`,
  `net`, and a custom collector falls back to its own id (`react-profiler` names itself
  `react-profiler`) — so the name is a function of your configuration, never of the
  readout. A name built from `view.display` would re-speak on every focus.

The numbers are therefore **not** in the name, and `aria-label` replaces content, so
they would go unannounced. They arrive as a description instead: each painted label span
and value span carries an `id`, and the button's `aria-describedby` lists them **in
pairs** — label, then value, one pair per metric, in bar order. `aria-describedby` joins
each target's computed name with a space, so the chip announces its name and then one
word-then-number pair per metric. Measured in Chromium over the real DOM
(`Accessibility.getPartialAXTree`) against `examples/playground`'s bar with the kit
stylesheet loaded — six collectors, the built-in four plus the playground's own `react`
and `LCP`:

> *"Metrics: mem, delay, jank, net, react, LCP, button"* — *"mem 22 MB delay — jank — net
> 0 react 1 ms LCP 348 ms"*

Every figure there belongs to that run in that browser: a heap reading and a timing
reading are both environment-specific, and so are the two markers, which are **not**
interchangeable. `—` is what a *supported* collector paints before its first sample —
Chromium does support Event Timing, so `delay` reads `—` until an interaction lands and a
real number (`64 ms`, in one such run) seconds later. `NA` is the separate *unsupported*
marker (`NOT_AVAILABLE`, `src/ext/metrics/format.ts`), and it is what the same chip paints
for `delay` under the unit tests, where jsdom has no Event Timing at all. So do not read a
pinned test literal as a browser measurement: the `48 MB` this page uses elsewhere to
illustrate a heap readout is the jsdom fixture's value, not a figure a browser reported.

The pairing is the decision, and it costs saying the words twice. Pointing at the
**value spans alone** is shorter — *"22 MB — — 0 1 ms 348 ms"* — and the name does state
the same words, in the same order, immediately before; but attributing a run of numbers
to a list stated earlier in one utterance is a working-memory task, and a `—` or an `NA`
cannot be placed at all. Pointing at the **chips** instead needs no extra ids and
announces *the same utterance*: a chip is a flex container, and accname puts a space
between flex-item children, so *"mem 22 MB delay — jank — net 0 react 1 ms LCP 348 ms"* is
what both options produce (the same measurement as above; an earlier
round recorded *"mem48 MB"* here, which was an unstyled fixture). The pairs win on
behaviour rather than on wording: a chip is whatever the preset or a `render` callback
painted, so pointing at it would describe a consumer's own markup, and it would not be
gated by the value span the way the pairs are. Neither option repeats the readout — which
is the thing [the "never say it twice" rule](../styling.md#the-name-carries-the-word-title-carries-the-readout)
is about.

The ids come from React's `useId()`, which is what keeps two `<DevToolbar>` instances on
one page from colliding; do not select on them. A span contributes only when it actually
painted: the attribute is omitted entirely when no value is painted — a preset that
paints none (`"icon"`, `"icon-label"`, `"label"`), or a `render` callback that replaced
the span — and `"icon-value"`, which paints a glyph and the number but no word, falls
back to the unpaired *"22 MB — — 0 1 ms 348 ms"* because there is no word on the bar to
point at.
With no `aria-describedby` at all a browser describes the button by its `title`
(*"Runtime performance — click for details"*), which is why the attribute's absence is
never silence — and it is also why **this is the only first-party chip with an
`aria-describedby` at all.** A description *replaces* the title rather than adding to it,
and every other chip's title already states its readout with more context than the value
span has (`Feature flags: 6 · 0 locally overridden` against a bare `6`). This one's does
not, which is what earns it the override. See
[styling.md](../styling.md#the-name-carries-the-word-title-carries-the-readout).

The `⋮` rows get **no** description: each row is one metric and is already named by its
own content (*"Memory 48 MB"*), so a description would repeat it.

`presentation.name` still overrides the whole name, and a whitespace-only override is
still ignored.

---

[Documentation index](../README.md) · [Extension contract](../extension-contract.md) · [Runtime](../runtime.md)
