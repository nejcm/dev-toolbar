# Changelog

## 0.1.0 — unreleased

First publish. The shell (P0), the runtime primitives and the first extension (P1),
P2's three extensions, and P3's two. `CONTRACT_VERSION` is `1`.

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
- `@nejcm/dev-toolbar/ext/environment` — environment, build and authenticated-actor
  context (§3B). Every value is consumer-supplied: no `process.env`, no global, no
  guess from the hostname — supply nothing and it says `unknown`. Route, viewport and
  connection are read from the browser and tagged `detected` so they cannot be
  mistaken for a deploy fact. Production is marked conspicuously and impersonation is
  unmistakable in the bar and the panel.
- `@nejcm/dev-toolbar/ext/flags` — feature-flag controls (§3C) and the promoted flag
  (§7). The flags stay the consumer's: a reading in, an `onOverride` adapter out, and
  a read-only panel when no adapter is supplied. Every row shows the effective value,
  the application's own value and the default side by side, so an override is never
  mistaken for what the server sent. Overrides persist per instance, are re-applied
  through the adapter on the next mount, and `?dtb-flags=reset` drops them all before
  any of them is applied. Values are redacted on the way in, under their own flag
  key, and a masked value never round-trips through the editor. An override whose
  flag has left the catalogue still gets a row, because it is still being applied.
  Adapter failures are recorded per flag and shown on the row that failed. Editors
  refuse input they cannot parse instead of coercing it.
- `readStoredOverrides()` on `/ext/flags` — reads the persisted override map without
  mounting anything, so an app can seed its own store before the first paint.
- `@nejcm/dev-toolbar/ext/command-menu` — the `⌘K` palette over the commands core
  aggregates, and the only extension here that reads instead of contributing. Browses
  grouped with recents first, searches as one scored list, runs by id through core so
  a command that has gone says so, keeps itself open and shows the message when a
  command throws, and restores focus to whatever had it. A combobox over a listbox,
  with `aria-activedescendant`, trapped `Tab` and named groups. It lives in the new
  `overlay` slot, so the shortcut survives its chip collapsing into the `···` menu.
  Swap it for your team's own `cmdk` by leaving it out — core still aggregates.
- `@nejcm/dev-toolbar/ext/overlays` — visual overlays over the running application
  (§3G): layout boxes, a column grid, a pointer-following element inspector and a
  focus-order overlay that flags controls with no accessible name. Each toggles on
  its own, persists per instance and contributes a command to the palette. It is the
  first extension that draws over the host page, so: nothing it draws takes a pointer
  event (`pointer-events: none !important` on the surface and every descendant — the
  one place in this package that needs `!important`, because layered CSS is designed
  to lose to unlayered app CSS and a guard must not), it
  paints below the bar and the palette and above the application, it mutates no host
  DOM node — geometry is read, never written — and every listener detaches while the
  bar is hidden. The one thing it adds to a document it does not own is a single
  outline stylesheet, removed on toggle-off, on hide and on teardown, and using
  `outline` so it cannot reflow the layout it describes. A measurement that throws
  switches every overlay off rather than recurring every frame. Each overlay's cost
  is stated in the panel next to its switch.
- `@nejcm/dev-toolbar/ext/diagnostics` — the diagnostic snapshot (§3J) with §3E's
  long-task and responsiveness data in it. It **aggregates** rather than
  re-collecting: core now aggregates `DevToolbarExtension.diagnostics()` the way it
  aggregates `commands`, and this extension reads the roster, so flags, metrics and
  environment each report themselves rather than being guessed at a second time. It
  gathers for itself only what no other extension owns — the page's own facts, and a
  `PerformanceObserver` over `longtask`, `event` and `layout-shift`. Every count is
  `null` rather than `0` where the browser cannot observe it, with a note saying
  which of the two it is: `longtask` and `layout-shift` are Chromium-only today, and
  "no long tasks" is the opposite claim to "this browser cannot count them". The
  panel shows the exact text the Copy and Download buttons produce, before either is
  pressed — Markdown for a ticket, JSON for a tool, the choice persisted — because
  the entire output is data headed off the machine. Everything foreign is redacted on
  the way *in*, once, so the panel, the clipboard, the download and the four commands
  read one object and no path re-derives from a raw value; the masked count is shown
  next to the buttons. Omission is a first-class outcome: a contributor that throws,
  returns nothing, or returns something that will not serialise gets a status, a line
  in a top-level `omissions` list, a banner in the panel and a heading in the
  Markdown — a snapshot that silently dropped the failing extension would read as
  complete.
- `@nejcm/dev-toolbar/testing` — `renderWithToolbar`, `makeExtension`,
  `createMockBus`, `installToolbarLayout`.
- `ensureStyleSheet(entry, css)` in `/runtime` — the once-per-document style injector
  both extensions were writing privately. Keyed on a
  `style[data-dev-toolbar-styles]` element, so two bundled copies still inject once.
- `writeClipboardText(text)` in `/runtime` — the same story one layer up. Three
  extensions had hand-rolled the same feature-detect-call-map-two-outcomes block and
  `/ext/diagnostics` would have been the fourth. Resolves `false` rather than throwing
  or pretending, because a missing API and a rejected write are the same answer to a
  copy button, and a "Copied" badge over an empty clipboard is the same class of lie
  as a "masked" badge over an unmasked value. `/ext/metrics`, `/ext/environment` and
  `/ext/flags` now call it from their panels; their panel behaviour is unchanged.
- `writeClipboardTextOrThrow(text, hint?)` in `/runtime`, and a **fix** the move
  exposed. A panel button can render "clipboard unavailable"; an aggregated
  `ToolbarCommand` returns `void` and can only speak through the palette, which
  reports a command that throws and closes over one that resolves. All five
  first-party copy commands were `await navigator?.clipboard?.writeText?.(text)` —
  which on an insecure origin or an unfocused document copies nothing and resolves,
  so the palette closed as though it had worked. `metrics.copy`,
  `environment.copy`, `environment.copyJson`, `flags.copyRecipe` and `flags.copyJson`
  now fail loudly. `/ext/diagnostics` does the same for its download command.

### Fixed

- `redact()` in `/runtime` silently dropped an object key named `__proto__` — the
  rebuild assigned into a plain object, where `Object.prototype`'s setter swallows
  the write, so the key read back through the prototype and rendered as
  `"[object Object]"` with a spurious `masked` badge. Nothing was ever polluted.
  Both rebuild paths (`redact` and `redactHeaders`) now define the property. Affected
  `/ext/environment` as well as `/ext/flags`.

### Contract changes from building the palette

Building `/ext/command-menu` moved it in two more places, both additive, and settled
the limitation `/ext/flags` had deferred. Full rationale in
[plans/architecture.md §13](./plans/architecture.md).

`CONTRACT_VERSION` stays `1`. Every extension written against the earlier contract
still *behaves* identically, and every one that only ever *receives* an
`ExtensionRuntimeApi` — which is what an extension does — still type-checks. The
qualification: `getCommands` and `runCommand` are required members, so code that
**constructs** that type by hand breaks. That is real — the three api fakes in this
repo's own tests needed updating — but it is test-harness code rather than the
extension-facing contract `contractVersion` describes, and nothing has been
published. Extension authors constructing an api for their own tests should reach for
`/testing` instead.

- **`commands` may be a function.**
  `commands?: ToolbarCommand[] | (() => ToolbarCommand[])`, called by core on each
  aggregation pass. A static array stays valid and unchanged, so `/ext/metrics` and
  `/ext/environment` needed no edit. This closes the gap recorded in §12.2: an
  extension can now contribute a command that only exists after mount.
  `/ext/flags` enumerates per flag live, and a flag that appears later gets a working
  toggle command with no reload. The function must be a pure, cheap enumeration — it
  runs during render — and core fails closed around it: a throw, a non-array return
  or an unrunnable entry means that extension contributes nothing, logged once per id.
  Because core has no invalidation signal, `useToolbarCommands()` remains the stable
  snapshot as of the last extension-list change, and `useDevToolbar().getCommands()`
  re-enumerates on demand; `runCommand(id)` always resolves against a fresh
  aggregation.
- **A third slot, `overlay`.** Rendered once per extension inside the toolbar root
  while the extension is present, not hidden and the bar is visible, and never
  collapsed by overflow. For dialogs and pickers: a panel would evict whatever else
  was open, and a compact item that collapses into the `···` menu is not in the DOM,
  which would take an extension's modal and key binding with it. Errors are contained
  like any other slot (`data-dtb-slot="overlay"`), and the wrapper is
  `display: contents`, so a rendered overlay adds nothing to the root's layout or to
  `--dev-toolbar-height` — the one exception being a *throwing* overlay, whose error
  chip becomes a flex child of the root's column and does add a row.
- **`ExtensionRuntimeApi` gains `getCommands()` and `runCommand(id)`**, so an
  extension can read the aggregation without importing a value from core — which §7
  forbids, and which `useToolbarCommands()` would have required.
- `/testing` follows: `makeExtension({ overlay, throwInOverlay })`,
  `toolbar.overlay(id)` and `toolbar.getCommands()`.

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

### How `/ext/environment` treats your data

§6 of the design is guidance rather than something core implements, and this is the
extension where the guidance bites:

- **Redaction happens on the way in, not on the way out.** Every supplied value goes
  through `redact()`, and email addresses are masked on top of it. The panel, both
  copy buttons and the aggregated commands read the same redacted snapshot; the raw
  context never reaches a renderable object. A copy path that re-derives from raw
  input is one refactor away from being the only path that forgets, and
  `runCommand("environment.copy")` is a second front door onto the same data.
- **Masking is visible.** A masked row is tagged `masked` in the panel and the count
  sits beside the copy buttons. Silent masking looks exactly like a value nobody
  supplied, and those are different problems.
- **A restricted view is a supported shape.** `fields: [...]` is an allowlist and
  drops everything else outright — `extra` entries, named `extra:<key>`, included;
  for an actor who should not see the extension at all, leave it out of the
  `extensions` array rather than passing `hidden: true`.
- **Reading your context fails closed.** A getter that throws — on the context object
  or nested inside `extra` — degrades to a snapshot that says the context could not be
  read, and logs. It cannot escape: the first build happens at factory time, before
  core has an error boundary to contain it, and later ones run inside a timer.
- **Structured values are redacted as objects, then serialised.** `redact()` finds
  sensitive keys by walking a graph, so a value serialised first would hide its own
  inner keys from it.

The contract did not move. `/ext/environment` needed nothing that P1 had not already
added, which is the first evidence that version 1 is stable rather than merely
young — see [plans/architecture.md §11](./plans/architecture.md).

### The one contract change from building the snapshot

`/ext/diagnostics` is the second extension whose job is to *read* what the others
produce, and it hit §13.3's problem in a new place: several extensions already had a
`diagnostics()` on their runtime object, and nothing in the contract could reach it.
So the aggregation core already ran for `commands` was extended, in the two matching
places. Full rationale in [plans/architecture.md §15](./plans/architecture.md).

- **`DevToolbarExtension.diagnostics?: () => unknown`.** Optional, so every existing
  extension is unchanged and contributes an explicit *"present, nothing to say"*
  rather than silently vanishing from a snapshot. Core calls it, contains a throw,
  and renders nothing.
- **`ExtensionRuntimeApi.getDiagnostics()`.** One entry per present, non-hidden
  extension — `ok` with data, `absent`, or `failed` with the message. This is how an
  extension on its own subpath reads the aggregation without importing a *value* from
  core, exactly as `getCommands()` is.
- A `failed` entry carries `error` (**the message alone**) and `errorName`
  separately, never pre-joined. Core cannot redact — it may not import `/runtime` —
  and the redactors match value shapes anchored to the whole string, so a joined
  `"Error: https://…?token=…"` is unmaskable while the bare message is not. Core does
  the one thing that keeps redaction possible downstream: it declines to make it
  impossible.
- `/ext/metrics`, `/ext/environment` and `/ext/flags` each declare `diagnostics`,
  wired to the redacted builder their own copy commands already used. No new data is
  exposed anywhere: a third front door onto the same masked view.

`CONTRACT_VERSION` stays `1`. Both additions are additive and every extension written
against the earlier contract behaves identically; the same qualification as P2's
applies, which is that `getDiagnostics` is a required member of `ExtensionRuntimeApi`,
so code that **constructs** that type by hand needs a line. That is test-harness code
— four api fakes in this repo needed it — not the extension-facing contract
`contractVersion` describes, and nothing has been published.

Two things were deliberately *not* added. `getDiagnostics` is **not** on
`DevToolbarContextValue`, so there is no `useToolbarDiagnostics()`: `commands` are on
the context because the host application runs them, while a snapshot has exactly one
reader and giving it a second, host-facing door would widen the surface for nobody.
And `/ext/diagnostics` declares no `diagnostics()` of its own — it would make the
snapshot contain itself, and the reentrancy guard would become load-bearing rather
than a safety net.

### How `/ext/diagnostics` treats your data

The same §11.3 rules as `/ext/environment`, at the severity a document that is
*entirely* outbound deserves:

- **Everything foreign is redacted on the way in, and objects reach `redact()` as
  objects.** Serialising first would turn every nested key into characters inside a
  value, which is the leak that shipped in the first cut of `/ext/environment`.
- **One object feeds every output.** Panel, clipboard, download and all four commands
  render the same redacted snapshot. There is no path from raw data to any of them.
- **Each contribution is proved serialisable on its own.** A `BigInt` survives
  `redact()` and throws in `JSON.stringify`; one extension must not cost you the
  whole snapshot, so that becomes an `unserialisable` status next to the id that
  caused it.
- **Every failure is a status, not a swallowed exception.** A getter that throws while
  `redact()` walks it, a `diagnostics()` that throws, a `source` that throws, a
  build that fails outright — each degrades to a snapshot that says so. And the
  failure path may not fail the way the happy path can: the timestamp, the
  responsiveness read and the store's clock on that path are all guarded, because a
  host with a patched `Date` or a hostile `performance.now` would otherwise turn "the
  capture failed" into a throw out of a click handler.
- **An error description is a join, and joins happen before redaction.** Five paths
  put a thrown error into the report as `` `${error.name}: ${error.message}` `` and
  then ran the anchored redaction pass over the result — so a message that *is* a
  credential-carrying URL, which is what `fetch`, undici and axios all throw, arrived
  in the ticket verbatim behind its own `"Error: "` prefix. A sixth,
  `failedSnapshot`'s omission reason, was not redacted at all. All six redact the
  message first and prefix afterwards. A credential the consumer buried in prose is
  genuinely beyond an anchored matcher; one this package hid behind its own prefix
  never was. The same rule applies to the prefix: `error.name` is a *writable* own
  property, not a class identifier the runtime guarantees, so it is redacted too.
  **Both halves of a join this package performs are foreign until proven otherwise.**
- **§3E has a fifth support state, `"stopped"`.** Teardown used to leave the entry
  types marked `"supported"`, so a report taken afterwards claimed live observation
  over counts that had stopped moving. A type that was never available is not
  promoted — "unavailable" and "we stopped asking" are different facts.
- **Masking is visible**, counted next to the buttons — and the count is derived from
  the *snapshot*, never from the rendered text. Two browser-found bugs are the same
  bug twice: the Markdown footer says ``masked as `[redacted]` ``, so counting the
  rendered text counted its own sentence (the toolbar said 6 where the footer said
  5); and counting only the *literal* mask missed one written into a URL query, where
  `URLSearchParams.set` percent-encodes it to `%5Bredacted%5D`. That second one is
  the OAuth-callback shape, so a page whose only secret was a token in the address
  bar masked it correctly and then reported "No values were masked". Both encodings
  are counted, from one canonical source.
- **§3J's `recentErrors` is not implemented, on purpose.** It is the one field in the
  spec's shape with no owner, and the only way to fill it would be a global
  `window.onerror` listener — permanent instrumentation of the host application,
  duplicating the error reporter it already has. `sources` covers it without this
  package reaching into anybody's runtime. Reasoning and the cost of the omission in
  [plans/architecture.md §15.8](./plans/architecture.md).
- **It is still not a security boundary.** `redact()` matches key names and value
  shapes. A secret under an innocent key with no telltale shape survives, and the
  test suite pins that limit deliberately rather than only demonstrating successes.
  You are the last check, which is why the text is on screen before you send it.
