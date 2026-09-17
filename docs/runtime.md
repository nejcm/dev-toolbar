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
  createDerivedStore,
  ensureStyleSheet,
  redact,
  redactProse,
  redactText,
  redactUrl,
  redactHeaders,
  describeError,
  formatError,
  writeClipboardText,
  instrumentFetch,
  instrumentXhr,
} from "@nejcm/dev-toolbar/runtime";
```

Also exported: `REDACTED` (the mask string), `UNREADABLE` (what `redactProse()` and
`describeError()` write for a value they could not read), `DEFAULT_SENSITIVE_KEYS`
and `isSensitiveKey()` for reusing the word list, `describeErrorUnmasked()`,
`STYLE_ATTRIBUTE` for finding an injected sheet, and `writeClipboardTextOrThrow()`.

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
- **`createDerivedStore(build, { intervalMs, ignorePaths })`** — builds initially
  with `build(0)` and returns the full `ThrottledStore` plus `read()` and
  `rebuild()`. `rebuild()` synchronously advances revision and writes
  `build(revision)`, even when the new build compares equal. `peek()` reflects that
  write immediately; the throttle compares the two *snapshots* at publication time
  with `snapshotEquals({ ignorePaths })`. So every field of the snapshot reaches the
  reader by default, and a runtime lists only what must **not** publish.
  `read()` builds at the current revision without advancing it or writing.
  Direct `set()` and `update()` retain their throttled-store behavior and do not
  advance revision. Polling, reconciliation and explicit `flush()` calls belong
  to the caller. Options accept the throttle's clock, scheduler and error handler;
  the store owns the comparison, so there is no `equals` to pass.
  - **`ignorePaths` is a list of key *paths* from the snapshot root, never bare
    names.** `[["revision"], ["at"], ["flags", "promotedLabel"]]` drops the
    per-build counters at the root and the promotion metadata on every element of
    `flags` — array indices are not path segments, so an array's elements share its
    path. "Ignore this name at any depth" would be a smaller thing to write and an
    unsafe one: flags' `adapterErrors` is keyed by flag name, so a global
    `revision` entry would silently swallow the adapter error for a flag called
    `revision` — the panel would keep showing a stale error — and a metric
    collector id may legally be `revision` or `at`, which would hide a whole
    custom view.
  - **A dictionary's *values* are not addressable.** Paths step through keys, and
    only arrays are transparent, so a snapshot holding `items: Record<id, Item>`
    cannot say "ignore `items.*.field`"; `["items", "field"]` would ignore a
    literal `field` key on `items` itself. Every first-party snapshot keeps its
    lists in arrays, where `["items", "field"]` reads as intended.
  - **`signature` remains an override and still wins when it is given**, with its
    old warning: a field omitted from `signature` can change without a
    notification, so cover every field the reader depends on. It is now optional,
    as is the options argument itself. Every existing *call* keeps compiling and
    behaving identically; code that reads `options.signature(snapshot)` off a value
    typed `CreateDerivedStoreOptions<T>` does not, because the property type is now
    `((snapshot: T) => string) | undefined`. That is a declaration-level change, not
    a purely additive one.
- **`snapshotEquals({ ignorePaths })`** — the structural comparison above, on its
  own, for a `createThrottledStore` caller that wants it (the throttled store's
  own default is still `Object.is`). Returns `(a, b) => boolean`. The rules:
  - `Object.is` first, so a shared unchanged reference costs one comparison, and
    `NaN` equals itself at every depth.
  - Arrays: equal length, then elementwise in order.
  - Plain objects, `Object.prototype` or `null` prototype alike, and equal to each
    other when their contents match: own enumerable **string** keys, with
    `undefined`-valued keys treated as absent — symmetrically, at every depth — so
    an optional field compares the way a reader experiences it. Own-property
    semantics throughout, so a key named `constructor` or `__proto__` is just data.
  - Everything else — functions, class instances, `Date` — by identity. Two equal
    `Date`s are therefore *not* equal here; snapshots hold plain data.
  - The limits, on purpose: supported input is acyclic plain data that nothing
    mutates after publication, so a cycle exhausts the stack rather than answering;
    symbol-keyed, non-enumerable and inherited properties are never compared, nor
    are extra properties hung on an array; an array hole reads as `undefined`; a
    getter or proxy trap runs as an ordinary read and its throw propagates to
    whoever published. `Object.is(0, -0)` is false, so a zero changing sign
    notifies where a string signature would not.
  - `ignorePaths` is captured when the comparator is created: mutating the array
    you passed afterwards cannot silently change what equality means.
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
  - **`redactText(text, options)` is the substring counterpart.** `redact()` is
    *anchored* — it masks a value that **is** a credential, never one with text
    in front of it — which is the right call for a header value or an object
    leaf. For prose and for multi-line text (a stack trace, an element's
    snippet) it is the wrong one, so `redactText()` scans for the same shapes
    *anywhere* inside the string, merges overlapping matches before replacing
    anything, and rewrites only the matched spans. It widens *where* a shape is
    looked for, not *which* shapes count, so an unknown shape still survives.
    Scheme separators can cross line breaks; a Digest match masks the remaining
    suffix, including later lines. These conservative rules retain masking of
    multiline credentials but can remove stack frames or place a mask on an
    innocent word after a newline.
    Pass `url: true` when the whole input is known to be a URL, including a
    relative one; embedded `scheme://…` runs are scanned either way. `redact()`
    keeps its anchored semantics — reach for `redactText()` deliberately.
  - **Which one, and why — the invariants, not the signatures.** Ask what the
    string *is*:
    - **A value** — a header, an object leaf, a query parameter, an error's
      `name` — is judged whole by **`redact()`**. It masks a value that *is* a
      credential and leaves a value that merely resembles one alone; it does
      not scan arbitrary prose for embedded credential shapes (a bare URL's
      query *is* rewritten, because the whole value is the URL). That exactness is why the
      extension contract hands over `error` and `errorName` unjoined: each half
      is a value until a reader joins them.
    - **Free text about to leave the page** — an error message, a failure
      summary, a console line, a status note — goes through
      **`redactProse(text)`**: the whole-value pass, then every `scheme://…` run
      inside the text through `redactUrl()`, so `failed for
      https://x/?token=abc` comes back `…?token=[redacted]` and `Unexpected
      token export` comes back untouched. It **never throws and never returns
      anything but a string** — a non-string where the type says string, or
      options that throw when read, come back as `UNREADABLE` — so a caller
      stops wrapping it. The first-party surfaces that emit prose use it —
      a11y, the diagnostics snapshot and console tail, the agent bridge — with
      one exception: `/ext/metrics`' network error column keeps its own
      URL-only scanner, because its sentence punctuation and quote-glued URL
      pairs (`"…?ok=1","https://y/?token=…"`) need a match that stops at a
      delimiter, which the whitespace-delimited sweep does not (see the limits
      below; both are pinned in its tests).
    - **A thrown value** — anything out of a `catch` — goes through
      **`describeError(error)`**, which returns `{ name?, message }` with each
      half masked by `redactProse()` **separately, never as a joined sentence**;
      `formatError()` joins them the way `Error.prototype.toString` does, after
      masking. It is duck-typed (an error from another realm, or a revoked
      `Proxy`, is described, not `instanceof`-tested), reads `name` and
      `message` **exactly once each**, guarded, and never calls the value's own
      `toString` — an object with no string `message` is named by its tag,
      `[object Object]`. `describeErrorUnmasked()` is the same extraction with
      no mask, for the developer's own console, where a failure path logs the
      raw thrown value by design (`architecture.md` §10); anything that leaves
      the page uses the masked one.
    - **Multi-line or structured text whose credentials sit inside longer
      runs** — a stack trace, an element's markup — is **`redactText()`**'s job,
      the substring scan above. It finds `Bearer …`, JWTs and Digest parameters
      mid-line, which `redactProse()` does not, and pays for that with its
      over-masking rules (a Digest match masks to the end of the text; three
      dotted runs of eight word characters look like a JWT, so a hostname like
      `frontend.production.internal` is masked). That trade is right for a
      stack and wrong for a status line, which is why the two exist.
  - **`redactProse()` is defence in depth for outbound text, not a guarantee.**
    It masks the shapes above and nothing else, and each limit is pinned by a
    test so a change is visible:
    - A credential in prose with **no URL and no assignment syntax** is not
      found: `auth failed: Bearer secret rejected`, `Authorization: hunter2`,
      `X-Api-Key: sk-test-…`, `password: hunter2` and `error: {"token":"abc"}`
      all come back unchanged. No text-only rule tells a secret from an
      identical English word, so this is a stated limit, not a heuristic to add.
    - **Adjacent URLs with no whitespace between them are one URL**:
      `"https://x/?ok=1","https://y/?token=abc"` is parsed as the first, whose
      `ok` value happens to contain the second, and `abc` survives.
    - **The sweep runs to the next whitespace**, so a closing `"`, `]`, `)` or
      `.` glued to a masked credential goes into the mask with it, and one
      after a later parameter survives, percent-encoded by the parser.
    - **Masking is per match.** A URL the parser rejects is rewritten as a raw
      query string, and that fallback percent-encodes the mask — so a mask
      `encodeURIComponent()` rejects (a lone surrogate) throws there, and that
      one URL is **handed back as written** while an earlier well-formed URL
      in the same text is masked. The output can be partially masked, and a
      caller who supplies an unencodable mask has opted out of the rewrite for
      unparseable URLs.
    - A JWT glued to punctuation (`eyJ…sig.`) is not a bare JWT and is not
      masked. The panel shows you the text before you share it; **you** are
      the last check.
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
- **`instrumentFetch(sink)` / `instrumentXhr(sink)`** — the package's one HTTP
  interceptor. Each takes a `NetworkSink` (`begin(method, url)` returning a token,
  `end(token, result)`) and returns an unsubscribe. **One wrapper, many sinks**: the
  first sink installs it, every later one joins the same wrapper, and the last one
  to leave restores `globalThis.fetch` — *by identity*, and never over somebody
  else's later patch, so a page that patched `fetch` after you keeps its own. A sink
  that throws is contained and logged; the host app's request is never affected by a
  recorder's bug. `method` and `url` arrive **raw** — redaction is the sink's job,
  because a sink filtering on the real URL cannot do it against a masked one. No
  request header and no body is ever read, and the single response header read is
  `content-length`, for the byte count a sink is handed. `/ext/metrics`' network
  collector is one sink on this; it imports it through the published specifier
  rather than relatively, so a CommonJS consumer using both gets one wrapper rather
  than two. A page that resolves *both* formats holds two patch states: they stack
  rather than conflict, but detaching inner-first strands the inner wrapper, and one
  more is stranded on every attach/detach cycle. A stranded wrapper records nothing,
  yet still forwards the call, chains a promise and reads `content-length`; enough
  of them overflow the stack. Resolve the package to one format. Where there is no
  `fetch` (or no `XMLHttpRequest`) attaching is a no-op returning a no-op.
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
