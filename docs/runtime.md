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
  ensureStyleSheet,
  redact,
  redactUrl,
  redactHeaders,
  writeClipboardText,
} from "@nejcm/dev-toolbar/runtime";
```

Also exported: `REDACTED` (the mask string), `DEFAULT_SENSITIVE_KEYS` and
`isSensitiveKey()` for reusing the word list, `STYLE_ATTRIBUTE` for finding an
injected sheet, and `writeClipboardTextOrThrow()`.

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
  credentials on the way to a screenshot, a clipboard or a bug report. Hygiene,
  **not a security boundary**: it matches names and shapes, so a secret under
  `data` survives.
  - **By key name**, where a word-list entry matches one or more adjacent whole
    *segments* of the key — split on non-alphanumerics and on case and
    letter/digit boundaries — so `apikey` covers `apiKey` and `x-api-key` while
    `auth` does not cover `author`.
  - **By value shape**: `Bearer …`, bare JWTs, and URLs carrying a sensitive
    parameter (the OAuth-callback shape, where the secret is in the value and no
    key matching would find it).
  - **`allowKeys` is not the mirror of the word list.** An allow entry is matched
    against the key's *entire* canonicalised form, so `["sessionName"]` exempts
    `session-name` and `SESSION_NAME` but not `sessionNameV2`, and `["session"]`
    exempts `sessionName` not at all. Name the exact key you mean to keep.
  - **Inside a URL the mask is written literally** — `?token=[redacted]`, not
    `%5Bredacted%5D` — so the URL stays readable, still parses, and still
    contains the exported `REDACTED`. A custom `mask` carrying a URL delimiter
    (`&`, `=`, `%`, a space) or a non-ASCII character is percent-encoded there
    instead, since writing it literally would rewrite the URL rather than a
    value. A URL with nothing to mask comes back unchanged, so two identical
    dumps still diff as identical.
  - **Return type follows the input.** A string gives a string; a number,
    boolean, bigint, `null` or `undefined` comes back as itself, so masking a
    value before joining it into a sentence needs no cast. Anything else is
    `unknown` — a cycle, `maxDepth` (8), `maxArrayLength` (200) or a spent
    `maxNodes` budget (50,000 total nodes per call, which is what catches a
    shared reference walked once per path to it) yields a short tag string
    rather than the shape you handed in.
- **`writeClipboardText(text)` / `writeClipboardTextOrThrow(text, hint?)`** —
  a clipboard write that never throws on a sandboxed frame or a denied
  permission: the first resolves `false` when the write did not happen, the
  second throws a message naming the fallback. Every first-party *Copy* button
  goes through them.
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
