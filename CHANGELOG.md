# Changelog

<!--
  release-please inserts each generated release section immediately below this
  comment and above the section that follows, newest first. It finds that spot
  with its default `versionHeaderRegex` (`\n###? v?[0-9[]`) — the first `##` or
  `###` heading whose text starts with a digit. The `## 0.1.0` heading below is
  what anchors it, so do not retitle that heading to something non-numeric and
  do not remove the `# Changelog` H1.

  Everything under `## 0.1.0` is hand-written prose and predates the automation.
  It is kept verbatim on purpose: it documents the initial surface far better
  than grouped commit subjects would, and no generator will reproduce it. The
  style break at the boundary is accepted, not an oversight.
-->

## [0.8.1](https://github.com/nejcm/dev-toolbar/compare/v0.8.0...v0.8.1) (2026-09-09)


### Bug Fixes

* **core:** observe the regions, so a gap change reaches the decision ([#92](https://github.com/nejcm/dev-toolbar/issues/92)) ([4762ab5](https://github.com/nejcm/dev-toolbar/commit/4762ab5d4f2bd0a793ab8650af4badfb051468f1))
* **ext:** keep theme edits a restart cannot read from storage ([#91](https://github.com/nejcm/dev-toolbar/issues/91)) ([4560ada](https://github.com/nejcm/dev-toolbar/commit/4560adaa5704257665140ac6d220d9ff631114ca))
* **testing:** finish tearing down when an unmount throws ([#93](https://github.com/nejcm/dev-toolbar/issues/93)) ([d11ebcb](https://github.com/nejcm/dev-toolbar/commit/d11ebcb5d72f1e5861035e94023d0a0922394e76))

## [0.8.0](https://github.com/nejcm/dev-toolbar/compare/v0.7.1...v0.8.0) (2026-09-09)


### ⚠ BREAKING CHANGES

* **testing:** `installToolbarLayout()` no longer patches `HTMLElement.prototype.offsetWidth` or `clientWidth`, `getBoundingClientRect`, or `getComputedStyle`. A test that measured a toolbar element through those getters, or that relied on the fake's values reaching its own components, must read through the toolbar's own API instead. Delivered `ResizeObserverEntry.contentRect` is unchanged, and `ResizeObserver` is still provided.

### Bug Fixes

* **ext:** survive a theme editor consumer whose options throw on read ([#82](https://github.com/nejcm/dev-toolbar/issues/82)) ([8278b7e](https://github.com/nejcm/dev-toolbar/commit/8278b7e7b09135c3045bb8872e73477d42b9c06d))


### Code Refactoring

* **testing:** measure through core's measurer slot instead of patching the DOM ([#88](https://github.com/nejcm/dev-toolbar/issues/88)) ([4d57c73](https://github.com/nejcm/dev-toolbar/commit/4d57c73328dd248a78ce6b82a9e3f6a049ec376d))

## [0.7.1](https://github.com/nejcm/dev-toolbar/compare/v0.7.0...v0.7.1) (2026-09-09)


### Bug Fixes

* **ext:** publish the flag snapshot when an adapter fails ([#81](https://github.com/nejcm/dev-toolbar/issues/81)) ([5e1ac89](https://github.com/nejcm/dev-toolbar/commit/5e1ac89f43f8332617f604b6ad12b7f9f8f8cd03))

## [0.7.0](https://github.com/nejcm/dev-toolbar/compare/v0.6.0...v0.7.0) (2026-09-09)


### Features

* **kit:** a named, validated, persisted preference ([#76](https://github.com/nejcm/dev-toolbar/issues/76)) ([777d0e6](https://github.com/nejcm/dev-toolbar/commit/777d0e6ecf56ba49560d3ae415073f48804e2ff6))
* **runtime:** one owner for masking prose and describing a thrown value ([#72](https://github.com/nejcm/dev-toolbar/issues/72)) ([c642e7e](https://github.com/nejcm/dev-toolbar/commit/c642e7e1bfe94577b93161318fde278079edac27))


### Bug Fixes

* **core:** settle the collapse decision on a state that fits ([#78](https://github.com/nejcm/dev-toolbar/issues/78)) ([745f6c3](https://github.com/nejcm/dev-toolbar/commit/745f6c3d6e43d09c7ea0469583c50bc25564653a))
* **ext:** guard the paths a throwing host can break ([#71](https://github.com/nejcm/dev-toolbar/issues/71)) ([25330d7](https://github.com/nejcm/dev-toolbar/commit/25330d702831d0984996baa9d07e5b5aaa715bd1))
* **ext:** mask a thrown error before it leaves the extension ([#74](https://github.com/nejcm/dev-toolbar/issues/74)) ([2a3f0ce](https://github.com/nejcm/dev-toolbar/commit/2a3f0ce5d201eb08bcfcb13cc031ab1db2178ce1))

## [0.6.0](https://github.com/nejcm/dev-toolbar/compare/v0.5.0...v0.6.0) (2026-09-08)


### ⚠ BREAKING CHANGES

* make the toolbar readable and drivable by agents ([#35](https://github.com/nejcm/dev-toolbar/issues/35))

### Features

* **a11y:** put the page's own violations on the bar ([#61](https://github.com/nejcm/dev-toolbar/issues/61)) ([f0f8918](https://github.com/nejcm/dev-toolbar/commit/f0f8918a7d284487c6ff432b74e48fce0b07d46b))
* bind command shortcuts when a host asks for it ([24a1cac](https://github.com/nejcm/dev-toolbar/commit/24a1cace3926e15cf3eead7cf5eb11eac2448e4d))
* **core:** a spacing system for panels, menus and form controls ([#33](https://github.com/nejcm/dev-toolbar/issues/33)) ([873f152](https://github.com/nejcm/dev-toolbar/commit/873f152c542fe76763121d8a96e503c38aa233b0))
* **core:** flush the ··· popup, divide the bar, darken the selected item ([0113465](https://github.com/nejcm/dev-toolbar/commit/011346599dfaa9132850650ffea19765e377de27))
* **core:** space the bar so its items read as separate readouts ([6d22091](https://github.com/nejcm/dev-toolbar/commit/6d22091c2a43eaa67e2f597c17e0be4bd9cf1a83))
* **core:** vertical ellipsis, softer popup shadow, and the bar's edge back ([91fa0d6](https://github.com/nejcm/dev-toolbar/commit/91fa0d6b25e802b40381dd9d9e8b526deca86619))
* **diagnostics:** keep what went wrong on the way here ([#60](https://github.com/nejcm/dev-toolbar/issues/60)) ([249c809](https://github.com/nejcm/dev-toolbar/commit/249c80931b6b69fa9538e8a32f43d0b33db6187e))
* **kit:** add @nejcm/dev-toolbar/kit, a shared package for extension authors ([#42](https://github.com/nejcm/dev-toolbar/issues/42)) ([1827c21](https://github.com/nejcm/dev-toolbar/commit/1827c212877e78286f6e3de8957934541b57868a))
* **kit:** frame an embedded third-party panel ([#56](https://github.com/nejcm/dev-toolbar/issues/56)) ([314df8c](https://github.com/nejcm/dev-toolbar/commit/314df8c4741e0a77df48cba312edddc242da1699))
* let hosts control visibility and position, and observe both ([1720439](https://github.com/nejcm/dev-toolbar/commit/17204398fffc96c73b53c57cfb2deeb774ff0fcd))
* make the toolbar readable and drivable by agents ([#35](https://github.com/nejcm/dev-toolbar/issues/35)) ([91436e7](https://github.com/nejcm/dev-toolbar/commit/91436e7e38fb7b1cbf7f5f18237b8995d4b9149c))
* **metrics:** accept consumer-supplied collectors ([#55](https://github.com/nejcm/dev-toolbar/issues/55)) ([a97e54f](https://github.com/nejcm/dev-toolbar/commit/a97e54f581479e9d4a8144adbbcfa7c955d8f3e6))
* **metrics:** commands over the requests already recorded ([#57](https://github.com/nejcm/dev-toolbar/issues/57)) ([482cdd3](https://github.com/nejcm/dev-toolbar/commit/482cdd3b870b43f66f8bc9bbff5c98dfb17720ff))
* **playground:** give the bar real media to measure ([#64](https://github.com/nejcm/dev-toolbar/issues/64)) ([64fea46](https://github.com/nejcm/dev-toolbar/commit/64fea46b6d8a5caab89555626847608a57d84ca3))
* **playground:** open TanStack's devtools shell from one chip ([#67](https://github.com/nejcm/dev-toolbar/issues/67)) ([070780b](https://github.com/nejcm/dev-toolbar/commit/070780bb02a17091a7a24e81417d3c26fffee49f))
* **playground:** prove the toolbar in a real browser with Playwright ([#68](https://github.com/nejcm/dev-toolbar/issues/68)) ([004f6e4](https://github.com/nejcm/dev-toolbar/commit/004f6e4bdc80d9493d0700804d6e7346b0d97a5a))
* report extension crashes to the host through onExtensionError ([39def47](https://github.com/nejcm/dev-toolbar/commit/39def4702c9afd9af90616800895f2f19956fed0))
* **testing:** let the fake layout fake padding and gap ([#48](https://github.com/nejcm/dev-toolbar/issues/48)) ([1fc7a86](https://github.com/nejcm/dev-toolbar/commit/1fc7a8604bc55a25ef75f4c77bd2060c98efe2e0))


### Bug Fixes

* close the review findings on controlled state, shortcuts and the overlays nonce ([1efcba4](https://github.com/nejcm/dev-toolbar/commit/1efcba4aec1cc0e13885443d15639f9ebfbbae99))
* close three findings from a security review of the repo ([#53](https://github.com/nejcm/dev-toolbar/issues/53)) ([2251ed4](https://github.com/nejcm/dev-toolbar/commit/2251ed42e1bf6b1e8a29a6fc692bb2a606f0044a))
* **core:** describe a diagnostics error without trusting its getters ([#45](https://github.com/nejcm/dev-toolbar/issues/45)) ([2e19483](https://github.com/nejcm/dev-toolbar/commit/2e194830239800349fc009b952fec60e7aca0648))
* **core:** put the bar on one font family so it sits on one baseline ([8577b92](https://github.com/nejcm/dev-toolbar/commit/8577b929fbffb8401e7948b0885624afdb7fbbf2))
* **ext/flags:** include variants in the snapshot signature ([#43](https://github.com/nejcm/dev-toolbar/issues/43)) ([a234d40](https://github.com/nejcm/dev-toolbar/commit/a234d400428a33c88e9e6820417099f6bffbb6e8))
* **ext/flags:** include variants in the snapshot signature ([#44](https://github.com/nejcm/dev-toolbar/issues/44)) ([cebfc6e](https://github.com/nejcm/dev-toolbar/commit/cebfc6e57163e533323c2c95dfa707c520fef177))
* **ext:** make jank, memory, delay and diagnostics report what they claim ([#37](https://github.com/nejcm/dev-toolbar/issues/37)) ([30ad520](https://github.com/nejcm/dev-toolbar/commit/30ad520ba6789b8f07598d8c70fed20523288cc5))
* **kit:** give a hand-built panel the spacing first-party panels hardcode ([#65](https://github.com/nejcm/dev-toolbar/issues/65)) ([f9fd10d](https://github.com/nejcm/dev-toolbar/commit/f9fd10d0ae677cc9d740a9c15523738c6996bf11))
* **playground:** make a second playground install work ([#59](https://github.com/nejcm/dev-toolbar/issues/59)) ([494cf8a](https://github.com/nejcm/dev-toolbar/commit/494cf8a844440ef6dfd1dbb61a6c48ba0328a09a))
* **redact:** mask credentials inside longer strings, not only whole values ([#62](https://github.com/nejcm/dev-toolbar/issues/62)) ([72a7480](https://github.com/nejcm/dev-toolbar/commit/72a748048e0e85e2d05ec167cb3de1f8852ef919))
* **testing:** track targets in the fake ResizeObserver and scope handles to their toolbar ([#46](https://github.com/nejcm/dev-toolbar/issues/46)) ([3e93bea](https://github.com/nejcm/dev-toolbar/commit/3e93bea56e6cbb2bf3954feca51ed7b8be4e029c))
* thread styleNonce through to every first-party stylesheet ([0cdfaf6](https://github.com/nejcm/dev-toolbar/commit/0cdfaf621b7971f6feb8da1c016455412adbf7de))

## [0.5.0](https://github.com/nejcm/dev-toolbar/compare/v0.4.1...v0.5.0) (2026-09-03)


### ⚠ BREAKING CHANGES

* **ext/metrics:** `metrics({ network: { bus } })` now disables the fetch and XMLHttpRequest patches by default, because a bus and a patch recorded the same request twice under unrelated ids — patched requests were keyed `r${sequence}` and bus requests by `payload.requestId`, with nothing correlating them. Pass `patchFetch: true` and/or `patchXhr: true` alongside `bus` to keep patching. Consumers already passing `patchFetch: false, patchXhr: false` (the README recipe) are unaffected.

### Features

* **runtime:** widen and correct the redaction passes ([#21](https://github.com/nejcm/dev-toolbar/issues/21)) ([bec1cb5](https://github.com/nejcm/dev-toolbar/commit/bec1cb53e712adbae989ebb11bc2da25a0388210))


### Bug Fixes

* **core:** survive hydration, self-resizing chips and hostile throws ([#25](https://github.com/nejcm/dev-toolbar/issues/25)) ([64cc80d](https://github.com/nejcm/dev-toolbar/commit/64cc80dd887662c9c623d15c702b00c4b901b274))
* **ext/metrics:** report what was measured, not when it was delivered ([#27](https://github.com/nejcm/dev-toolbar/issues/27)) ([e918e2d](https://github.com/nejcm/dev-toolbar/commit/e918e2d10430c663fa2ec62b1f687d6d1c87386e))
* **ext/overlays:** keep geometry current and stop re-walking the hovered subtree ([#26](https://github.com/nejcm/dev-toolbar/issues/26)) ([36c397b](https://github.com/nejcm/dev-toolbar/commit/36c397b787c7ce25f60bf6f91e7b5016684d66a8))
* **ext:** redact URL-shaped fields before they reach the clipboard ([#22](https://github.com/nejcm/dev-toolbar/issues/22)) ([0a1b32a](https://github.com/nejcm/dev-toolbar/commit/0a1b32a17f763f3a2bbb391e436febefb61dddfe))
* **ext:** stop trusting unvetted overrides and unguarded storage reads ([#24](https://github.com/nejcm/dev-toolbar/issues/24)) ([24f4a77](https://github.com/nejcm/dev-toolbar/commit/24f4a77c8955e6a551506a044ec34cef13c43b9e))

## [0.4.1](https://github.com/nejcm/dev-toolbar/compare/v0.4.0...v0.4.1) (2026-09-03)


### Bug Fixes

* **command-menu:** match shifted punctuation and honour defaultPrevented/isComposing ([#17](https://github.com/nejcm/dev-toolbar/issues/17)) ([db121cc](https://github.com/nejcm/dev-toolbar/commit/db121cc197b81755133e96de6ce4da45786d3d70))

## [0.4.0](https://github.com/nejcm/dev-toolbar/compare/v0.3.0...v0.4.0) (2026-09-03)


### ⚠ BREAKING CHANGES

* **runtime:** sensitive-key matching is by word segment, so keys that only matched as a substring of a longer word are no longer redacted, and `DEFAULT_SENSITIVE_KEYS` gains 15 entries. `redactUrl` returns unmasked input verbatim and writes the mask literally inside URLs.

### Bug Fixes

* **runtime:** fix the runtime review findings and match sensitive keys by segment ([#11](https://github.com/nejcm/dev-toolbar/issues/11)) ([855bd8f](https://github.com/nejcm/dev-toolbar/commit/855bd8f50370428f5e394f6c6ace8a2783fd41b8))
* **testing:** fix the testing review findings and share one core instance in CJS ([#12](https://github.com/nejcm/dev-toolbar/issues/12)) ([4e09040](https://github.com/nejcm/dev-toolbar/commit/4e090400dbff72c3f5d27d3ea2b5e53a1659daad))

## [0.3.0](https://github.com/nejcm/dev-toolbar/compare/v0.2.0...v0.3.0) (2026-09-02)


### ⚠ BREAKING CHANGES

* **core:** `collectCommands`, `resolveExtensionCommands` and `collectDiagnostics` are removed from the `@nejcm/dev-toolbar` root export. Use `api.getCommands()` / `api.getDiagnostics()` from an extension, or `runCommand()` from the host.

### Features

* **core:** fix the core review findings and drop the aggregation helpers ([#10](https://github.com/nejcm/dev-toolbar/issues/10)) ([7ee237a](https://github.com/nejcm/dev-toolbar/commit/7ee237a384258407eecedf18feb24ac09fd7f11a))


### Bug Fixes

* **pkg:** resolve CJS types correctly and gate package shape, formatting, PR titles and knip ([#8](https://github.com/nejcm/dev-toolbar/issues/8)) ([9c3d449](https://github.com/nejcm/dev-toolbar/commit/9c3d449e47e3e72175ccfd678ede5eb256e49643))

## [0.2.0](https://github.com/nejcm/dev-toolbar/compare/v0.1.0...v0.2.0) (2026-09-01)


### Features

* **command-menu:** add /ext/command-menu and settle dynamic commands ([1b95b18](https://github.com/nejcm/dev-toolbar/commit/1b95b189d706148bb2adccfcf168c899ad8d8341))
* **core:** implement P0 shell — portal, bar, overflow, panels, storage ([50da8c5](https://github.com/nejcm/dev-toolbar/commit/50da8c5c6bf0726714b7deba6a26ced1fd34c725))
* **diagnostics:** add /ext/diagnostics — the bug-report snapshot ([8685770](https://github.com/nejcm/dev-toolbar/commit/86857700e4c768281f3d68309166c338b6465bcc))
* **environment:** add /ext/environment — environment and actor context ([efbff55](https://github.com/nejcm/dev-toolbar/commit/efbff55e48c86dd2db924ff4ab9aa50be595344f))
* **flags:** add /ext/flags — local flag overrides and the promoted flag ([8205763](https://github.com/nejcm/dev-toolbar/commit/8205763649462c6fd25d9dcadf253de89afb96c0))
* **overlays:** add /ext/overlays — layout, grid, inspector and focus order ([c52e416](https://github.com/nejcm/dev-toolbar/commit/c52e4164eaad09a08aeceeb582a9dbb5a993a5f6))
* **runtime,metrics:** implement P1 — /runtime and the metrics extension ([7a19fb6](https://github.com/nejcm/dev-toolbar/commit/7a19fb68a6430fb10757040f743e23074b8dbe5b))
* **testing:** complete P0 — /testing subpath, playground, architecture docs ([9d0c742](https://github.com/nejcm/dev-toolbar/commit/9d0c74273da9f18b6de6c3bff1ca445259f60062))
* **theme-editor:** add /ext/theme-editor — live design-token editing ([abe4faf](https://github.com/nejcm/dev-toolbar/commit/abe4faf3308b01a4340fd9ea94f71f8b4e34f09e))


### Bug Fixes

* **ci:** build before test, and pin the Node major CI runs ([7e6dd33](https://github.com/nejcm/dev-toolbar/commit/7e6dd333acd09ad8d1bea9e3fd4dc9bff927c9bb))
* **lint:** clear the warning backlog and drop the ratchet to zero ([#4](https://github.com/nejcm/dev-toolbar/issues/4)) ([0300bc1](https://github.com/nejcm/dev-toolbar/commit/0300bc1953efb9171a5e81d2b89f21cc075fc86e))
* **playground:** default the bar inset on and cover the header for top position ([29663a7](https://github.com/nejcm/dev-toolbar/commit/29663a7ae6264bacedec93b5dfc47c6d76c36bfd))

## 0.1.0 (2026-09-02)

First publish, and the whole of the accepted plan. The shell (P0), the runtime
primitives and the first extension (P1), P2's three extensions, P3's two and P4's one.
`CONTRACT_VERSION` is `1`.

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
- `@nejcm/dev-toolbar/ext/theme-editor` — live design-token editing (§3H), and the
  only extension that carries both of the earlier hazards at once: it mutates the
  application like `/ext/flags` and it writes to the host's CSS like `/ext/overlays`.
  The tokens stay the consumer's — a catalogue in, an optional `onApply` out, and no
  design system, colour model or palette generator anywhere in it. An edit is an
  inline custom property on the surface you pick (§3H's subtree selection), and every
  row shows the edit, the application's own value and the design system's default
  side by side; the app value is captured *before* the write lands, because once the
  property is on the element the computed value is the edit.
  **Reversal is exact**: the inline value each property held first — priority
  included — is restored, and a `style` attribute the extension created is removed
  rather than left empty, on reset, on *Preview: off* (§3H's before/after) and
  unconditionally on teardown. Edits persist per instance and are re-applied on the
  next mount, `readStoredThemeOverrides()` reads them before the first paint, and
  `?dtb-theme=reset` drops them all before any of them is applied. An edit whose
  token has left the catalogue still gets a row, because it is still being written.
  Write failures are recorded per token and shown on the row that failed. Values that
  are not of the token's type are refused with the draft kept, never coerced.
  **It cannot restyle the toolbar**: `--dtb-*` and `--dev-toolbar*` are never written,
  whatever the consumer declares, and a surface inside a `[data-dev-toolbar]` subtree
  is refused — a guard expressed as a refusal to emit rather than as CSS, which is
  §14.7's lesson taken one step further. Four exports — CSS variables, a versioned
  recipe, the W3C design-tokens shape for Figma, and a `?dtb-theme=` share link — all
  read one redacted snapshot. Import, presets and the link go through **one**
  sanitiser: only names the live catalogue declares, only values the editor itself
  would accept, so `url(...)` in somebody's link cannot make the page fetch from
  their host. Colours, lengths and numbers are never masked by *name* (token names
  are descriptive English and collide with any credential word list) but are still
  masked by value shape; a free `string` token is masked by name too. Masked tokens
  are shown as the mask in the human-readable exports and **omitted**, with a count,
  from the two a machine applies.
- `readStoredThemeOverrides()` on `/ext/theme-editor` — the `readStoredOverrides()`
  story for tokens: reads the persisted edits without mounting anything.
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

### Three leaks the theme editor's author found by attacking it

All in P4 code, all fixed before review, and each pinned by a test that fails against
the pre-fix code. Same shape: a string whose *source* had never been classified, which
is a different search from re-reading the joins §15.3 is about.

Independent review then found two more, and the honest note is that "all
mutation-checked" was an overclaim as first written: the bleed guard's **storage**
caller had no test at all, so deleting the guard changed nothing the suite could see.
Both are fixed below and both are now mutation-checked for real.

- **A surface selector was printed into exported CSS unchecked.** It never resolves —
  `querySelector` fails closed — so nothing was applied; the export nonetheless carried
  a working rule the consumer never wrote, into a file somebody pastes into their
  stylesheet. `isPrintableSelector()` now refuses to emit one, and an unprintable
  surface falls back to `:root` with the reason in a comment.
- **A persisted edit was trusted because we had written it.** `localStorage` is
  writable by every script on the origin. Worse than an export leak: `setProperty`
  accepts a custom-property value of nearly any shape, so `red; background: url(…)`
  planted in storage became a live declaration in the inline style attribute. Stored
  values are re-checked on load, refusals are counted in the panel, and the cleaned map
  is written back. Names are still not filtered against the catalogue — an orphan is the
  developer's own work.
- **A token `description` reached the Figma export unredacted.** Now redacted once, on
  the way into the view, so the panel and the export read one string. Tracked as
  `metadataMasked` separately from `masked`, which drives the editor, and counted in
  the export that actually carries descriptions.

A fourth attack found no leak, but found that the exact-reversal tests were pinning the
wrong guard: the "did this element already have a `style` attribute" reading was
unreachable in every test, because an element with real declarations is caught by the
declaration count instead. There is now a case per reading, and a third guard no test
could distinguish from its neighbour was deleted rather than kept.

@One blocking defect, fixed, plus five smaller ones. The full review reasoning lived
in that phase's working notes, which are not tracked; the rules it sharpened are in
[docs/architecture.md](./docs/architecture.md).

- **Fixed: the recipe export re-masked by token name, breaking the round trip.**
  `executableRecipe()` correctly omits masked tokens; `recipeText()` then put the whole
  payload through `redact()` again as belt-and-braces, and `redact()` matches keys by
  substring at every depth — so `--sidebar-bg` (`sidebarbg` contains `sid`) and
  `--spinner-size` (contains `pin`) exported as `"[redacted]"` while the panel and the
  CSS export showed the real values. Re-importing that recipe applied *nothing*, because
  the sanitiser refuses the mask sentinel: total round-trip loss on ordinary token names.
  `shareLink()` for the same state carried raw values, which is what proved it a defect
  rather than a policy. Both executable documents are now built by one function, the
  metadata still goes through the object walk (that is the pass that catches a
  structural field of *ours* whose name collides) and each override value goes through
  `redact()` alone as a bare string — value-shape matching only. The rule, for anyone
  writing the next extension: **belt-and-braces redaction must be shape-only or
  key-exempted downstream of a classified join.**
- **Fixed: the storage caller of the bleed guard was untested.** `vetStored()`
  deliberately does not filter names, so a `--dtb-*` entry planted in `localStorage`
  reached `writeOne`, where one line stopped it — and deleting that line broke no test.
  The guard worked; the coverage claim did not. Now pinned, and `vetStored()` drops a
  reserved name outright rather than carrying residue that no per-row control could
  clear.
- **Fixed: a replaced surface element left the panel claiming edits the page had
  reverted.** A migration now re-applies every edit, not just the one being written.
- **Fixed: `isPrintableSelector` denied combinators,** so `#app > main` exported scoped
  to `:root` with a note saying it could not be printed — a wrong scope, which is worse
  than the refusal it imitated.
- **Fixed: a token's `group` reached the Figma export unredacted,** the same class as
  the description. `descriptionMasked` is now `metadataMasked` and covers both.
- **Recorded:** `adopt()` replaces rather than merges (the notice now counts what it
  displaced), and two toolbars editing the same token on one surface can resurrect a
  displaced value on reverse-order teardown — inherent to a per-closure restore scheme.

### Closed: the last known join, in `/ext/metrics`

`describe()` in `ext/metrics/collectors/delay.ts` built `tag#id.class` from live DOM
its own and unmaskable behind `tag`. The known-gaps register recorded it as
deliberately unfixed on the grounds that it lived in approved P1 code; P4 removed that
argument by fixing three fresh instances of the same shape and writing the checklist
that names it. Each part now goes through the same one-line masking
`describeAttribution` got, with a test for a masked target and one for an ordinary
target that must stay readable. (The register named the function `describeTarget`; it
was always `describe()`.)

### Documentation fix found by running the SSR check

The plan's SSR verification — a real Next app-router page — had not actually been run
before P4. It passes: the server HTML contains the page and none of the bar, and there
is no hydration warning in `next dev` or in a production build with
`reactStrictMode: true`. It also exposed a documentation error. The `"use client"`
banner makes each built entry a client module, so a server component may **render**
README and the architecture reference described the banner as making the package
importable from a server component and stopped there; both now show the one-file client
wrapper, which is where the extension array belongs anyway.

### Fixed

- `redact()` in `/runtime` silently dropped an object key named `__proto__` — the
  rebuild assigned into a plain object, where `Object.prototype`'s setter swallows
  the write, so the key read back through the prototype and rendered as
  `"[object Object]"` with a spurious `masked` badge. Nothing was ever polluted.
  Both rebuild paths (`redact` and `redactHeaders`) now define the property. Affected
  `/ext/environment` as well as `/ext/flags`.

### What the last extension changed in the contract: nothing

`/ext/theme-editor` is the seventh consumer and the one carrying both of the riskiest
shapes in the catalogue, and it needed no contract change at all — no new slot, no new
`api` member, no widened field. `CONTRACT_VERSION` stays `1`. Four of the last five
extensions moved it in zero places, which is the strongest available evidence that it
is finished; a bump on this phase would spend the only signal a version number carries
[docs/architecture.md](./docs/architecture.md).

One small correction to the redaction rule, in this extension only rather than in
`/runtime`: a structural field of *our own* whose name contained `token` was masked by
`redact()`'s substring key matching, so an outbound recipe reported `"[redacted]"`
where a count belonged. Renamed, and a test now asserts that no top-level field of any
outbound payload comes back equal to the mask. Our own field names are foreign to the
redactor too.

### Contract changes from building the palette

[docs/architecture.md](./docs/architecture.md).

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
[docs/architecture.md](./docs/architecture.md).

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

young — see [docs/architecture.md](./docs/architecture.md).

### The one contract change from building the snapshot

`/ext/diagnostics` is the second extension whose job is to *read* what the others
produce, and it hit §13.3's problem in a new place: several extensions already had a
places. Full rationale in [docs/architecture.md](./docs/architecture.md).

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
[docs/architecture.md](./docs/architecture.md).
- **It is still not a security boundary.** `redact()` matches key names and value
  shapes. A secret under an innocent key with no telltale shape survives, and the
  test suite pins that limit deliberately rather than only demonstrating successes.
  You are the last check, which is why the text is on screen before you send it.
