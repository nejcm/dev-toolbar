# `@nejcm/dev-toolbar/runtime`

Opt-in machinery for extensions that measure something over time. Core never imports
it, so a toolbar that is three buttons never pays for it. Nothing in it imports React
either, so a collector can run in a worker.

```ts
import {
  createEventBus,
  createRingBuffer,
  createNumericRing,
  createTimeSeries,
  createThrottledStore,
  redact,
  redactUrl,
  redactHeaders,
} from "@nejcm/dev-toolbar/runtime";
```

- **`createEventBus<Events>()`** — typed pub/sub, one per instance (never a
  singleton). `on(type, handler, { signal })` unsubscribes on the `AbortSignal`
  `start(api)` already gave you. A throwing handler is contained, not propagated into
  whatever emitted; pass `onError` to replace the default `console.error`. Where the
  library asks *you* for a bus — `metrics`' `network.bus` — the option is typed
  `BusLike<ToolbarEventMap>`: emit and subscribe, nothing else. So a hand-rolled
  adapter over your own emitter, or `createMockBus()` from `/testing`, goes wherever a
  bus is wanted; you do not have to hold a whole `EventBus`.
- **`createRingBuffer<T>(n)` / `createNumericRing(n)` / `createTimeSeries(n)`** —
  bounded and *allocation-stable*: storage is allocated once, `push` writes into a
  slot that already exists, and every read that could allocate takes a caller-owned
  destination. `createNumericRing` is a `Float64Array` underneath; that is what the
  sparklines read. `n` is clamped to 1…16,777,216 slots, so a zero, negative,
  fractional, or non-finite capacity never throws and never silently swallows
  every sample.
- **`createThrottledStore(initial, { intervalMs })`** — accepts every write,
  publishes at most once per interval, leading edge first and trailing edge after.
  `getSnapshot` stays stable between notifications, which is what
  `useSyncExternalStore` requires. A 60 Hz sampler becomes a 4 Hz re-render.
  `destroy()` drops a pending trailing write by default; pass
  `destroy({ flush: true })` to publish it first. A throwing listener is
  contained, not propagated into whatever published; pass `onError` to
  replace the default `console.error`, same as `createEventBus`.
- **`redact(value)` / `redactUrl(url)` / `redactHeaders(headers)`** — masks
  credentials by key name — an entry of the word list matches one or more adjacent
  whole *segments* of the key, splitting on every non-alphanumeric character and on
  case and letter/digit boundaries, so `apikey` covers `apiKey` and `x-api-key` while
  `auth` does **not** cover `author` — plus `Bearer …`, bare JWTs, and URL values carrying a
  sensitive parameter (the OAuth-callback shape, where the secret is in the value and
  no key matching will find it). `allowKeys` is not the mirror image of that word list:
  an allow entry is checked against the key's *entire* canonicalised form, not a run
  inside it, so `allowKeys: ["sessionName"]` exempts `session-name` and `SESSION_NAME`
  but not `sessionNameV2`, and `allowKeys: ["session"]` does not exempt `sessionName` at
  all — name the exact key you mean to keep, not the word that would otherwise redact it.
  A URL with nothing to mask is returned unchanged, so
  two dumps that are identical still diff as identical. Inside a URL the mask is
  written literally — `?token=[redacted]`, not `%5Bredacted%5D` — so a masked URL
  stays readable, still parses, and still contains the exported `REDACTED`; a custom
  `mask` carrying a URL delimiter (`&`, `=`, `%`, a space) is percent-encoded there
  instead, because writing it literally would rewrite the URL rather than a value, and
  so is one carrying a non-ASCII character (`██`), which `new URL` re-encodes anyway. This is hygiene for anything
  headed to a screenshot or a clipboard, **not** a security boundary: it matches
  names, so a secret under `data` survives. A string in gives a string back and a
  number, boolean, bigint, `null` or `undefined` comes back as itself — masking a
  value before you join it into a sentence needs no cast. Anything else is
  `unknown`, because a cycle, a depth limit, a spent `maxNodes` budget (default
  50,000 — bounds the total nodes one call walks, including a shared reference
  walked once per path to it, which neither `maxDepth` nor `maxArrayLength`
  catches) or an unwalkable object comes back as a short tag string rather than
  the shape you handed in.
- **`ensureStyleSheet(entry, css, doc?, nonce?)`** — injects a stylesheet once per
  document, keyed on a `style[data-dev-toolbar-styles]` element rather than a module
  flag, so two bundled copies of your package still inject once. Core's
  `injectStyles` is a prop and extensions cannot see it, so an extension that ships
  CSS needs its own switch and its own injector; this is the injector. The optional
  `nonce` sets the `style` element's `nonce` property, for a host with a
  `style-src 'self' 'nonce-…'` CSP that would otherwise block the injected sheet
  with no diagnosable failure.


---

[Documentation index](./README.md)
