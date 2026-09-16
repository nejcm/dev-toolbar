---
description: Two deepening refactors from the 2026-09-14 architecture review — a kit preference read that tells "storage could not answer" apart from "nothing stored" (closes a reproduced flags session-wipe), and a store-owned structural snapshot comparison that retires the five hand-written signatures and the 15 BUG-pinned tests behind them.
date: 2026-09-15
status: proposed
---

# Deepen the preference read, then let the store decide what changed

Written 2026-09-15, after `/improve-codebase-architecture` produced nine
candidates and Codex (`gpt-6-astra`, effort `high`, read-only) validated the
report claim by claim. These are the two it ranked first and second, in that
order. Every fact under "What is actually true" was read in this repo at
`431d735`; line numbers are from that commit and will drift.

Vocabulary is the codebase-design one: a **module** is an interface plus an
implementation; it is **deep** when a small interface hides a lot of behaviour;
**locality** is what maintainers get (one place to change and test);
**leverage** is what callers get (one interface, N call sites).

Both plans are additive on the published surface (`/kit`, `/runtime`), touch
no ADR, and leave `CONTRACT_VERSION` alone. Plan A ships first: it is half a
day and fixes a bug a user can hit today. Plan B is two to three days and has
a measurement gate.

---

## Plan A — a preference read that threw is not "nothing stored"

### What is actually true

**The kit's read collapses four outcomes into one.** `readGuarded` in
`src/kit/preference.ts:102-119` returns `fallback` when the key is absent, when
the adapter's `getItem` throws, when the decoder throws, and when `isValue`
rejects. The caller cannot tell which. The header docblock calls this the "one
guarded interface over `api.storage`", and `docs/kit.md:94` records adoption:
`readPreference` 6, `writePreference` 6, "no extension touches `api.storage`
directly any more".

**Three call sites re-derive the distinction by wrapping the adapter.** Each
builds an object literal whose `getItem` calls `api.storage.getItem` and sets a
flag *after* it returns, so a throw leaves the flag false:

| Site | Preference | What the flag gates |
| --- | --- | --- |
| `src/ext/theme-editor/runtime.ts:1399-1418` | `OVERRIDES_PREFERENCE` | `overrides = vetted.accepted` and the dropped-entries notice |
| `src/ext/theme-editor/runtime.ts:1431-1443` | `PREVIEW_PREFERENCE` | `preview = storedPreview !== "0"` |
| `src/ext/overlays/runtime.ts:863-876` | `enabledPreference` | `flags = stored === null ? {...initialFlags} : parseFlags(stored)` |

PR #91 (`4560ada`) added the first two and its body says: "This is now the
third copy of the same read-success pattern … A `readPreferenceIfReadable` in
`src/kit/preference.ts` would collapse them." Nothing in `plans/`, `docs/` or
`src/` has picked that up.

**Flags never got the guard, and the wipe is real.** `src/ext/flags/runtime.ts:770-772`:

```ts
} else if (writable) {
  overrides = vetOverrides(
    parseOverrides(readPreference(storage, OVERRIDES_PREFERENCE)),
    readFlags(),
  );
```

`OVERRIDES_PREFERENCE.fallback` is `"{}"` (`:45-50`), `dispose()` (`:801-813`)
never touches `overrides`, and `writePreference` swallows a throwing
`setItem`, so over a throwing adapter the in-memory map is the *only* copy.
A `stop()`/`start()` on the same runtime object — `enabled` flipping, `hidden`
toggling — replaces it with `{}`. Codex reproduced it in memory with core's
scoped-storage wrapper and an all-throwing adapter: after one override and a
restart, `overriddenCount` went 1 → 0; with `onOverride` the app kept the
override the toolbar forgot; with `onOverridesChange` the consumer received
`{}`. No flags test restarts a runtime (`runtime.test.ts:621` starts and stops
once); the throwing-storage test at `flags.test.tsx:540` mounts once.

**The reset branch has the same hole.** `:762-767` reads `previous` through the
same unguarded read and un-applies only its keys. Over an unreadable adapter
`previous` is `{}`, so `?dtb-flags=reset` on a remount leaves the session's
in-memory overrides applied in the app while the runtime believes it cleared
everything.

**Which adapters can the kit even see fail?** `createScopedStorage`
(`src/core/storage.ts:69`) forwards `getItem` with no catch, so a *consumer*
adapter's throw reaches `api.storage.getItem` and therefore the kit. The
*default* adapter, `createLocalStorage` (`:32-50`), catches and returns `null`
— its docblock promises "never throws — SSR, private mode and quota-exceeded
all degrade to a no-op". So the distinction this plan recovers exists for
custom adapters only. With the default adapter a disabled `localStorage` reads
as "nothing stored" and the wipe stays. `docs/architecture.md:316-319`
promises "A throwing adapter degrades to defaults rather than taking down the
render", which this plan keeps.

**Tests that already pin the fixed behaviour elsewhere**, to copy the shape
from: theme-editor `runtime.test.ts:984` "keeps a session edit across a
restart when every storage call throws", `:1006` "clears the session map on a
restart when readable storage has no edits", `:949` the preview `it.each`;
overlays `runtime.test.ts:143` and `:164`. `fakeExtensionApi({ storage })`
(`src/testing/fakeExtensionApi.ts:41`) takes the throwing adapter directly.

### The deepened module

`src/kit/preference.ts` gains one read beside the existing one. The existing
`readPreference` keeps its contract exactly (returns `T`, never throws) — it is
published and six extensions call it for values where "could not read" and
"nothing stored" rightly collapse.

The new read answers with a tagged result:

```ts
export type PreferenceRead<T> =
  | { readonly readable: true; readonly value: T }
  | { readonly readable: false };

/** Like readPreference, but says when the adapter could not answer. Never throws. */
export function readPreferenceIfReadable<T>(storage: Reader, preference: Preference<T>): PreferenceRead<T>;
```

Semantics, fixed here so the three wrappers' behaviour is preserved bit for bit:

| Outcome | Result |
| --- | --- |
| `getItem` throws | `{ readable: false }` |
| storage is `null`/`undefined` (persistence disabled) | `{ readable: true, value: fallback }` — nothing is stored |
| key absent | `{ readable: true, value: fallback }` |
| stored, passes `isValue` | `{ readable: true, value }` |
| stored, decoder throws or `isValue` rejects | `{ readable: true, value: fallback }` — the adapter *did* answer; the wrappers today treat a malformed value as readable and this must not change |

`readable: false` deliberately carries no value. Every caller's correct move
on an unreadable adapter is "keep what the session already has", and an
interface that hands them the fallback invites the very bug being fixed.

Considered and rejected: a `restore(storage, pref, current)` that returns
`current` when unreadable. Deeper for the restart use, but theme-editor needs
the parsed value between read and assignment (`vetted.dropped` drives a notice
and a re-persist), so the tagged result is the right level.

### Phases

#### Phase A0 — pin the bug (fails before the fix)

Flags `__tests__/runtime.test.ts`, next to the existing restart-less start/stop
test at `:621`:

- "keeps session overrides across a restart when every storage call throws":
  `write("ui-facelift", true)` → `stop()` → `start(api)` → `overriddenCount`
  is 1, the view is `overridden`, `onOverride` was replayed with `true`, and
  `onOverridesChange` (when supplied) received the one-entry map, not `{}`.
- "clears the session map on a restart when readable storage has no overrides":
  memory storage, `removeItem(OVERRIDES_KEY)` between stop and start →
  `overriddenCount` 0. Pins that "absent" still means "restore defaults".
- "un-applies session overrides on a reset load even when storage cannot be
  read": throwing adapter, one override, restart with `?dtb-flags=reset` →
  `onOverride(key, undefined)` was called for the session key.

All three fail on `431d735`. Adapter shape: copy `blocked` from theme-editor
`runtime.test.ts:984-1004`.

- Touches: `src/ext/flags/__tests__/runtime.test.ts` only.
- **Estimate: 1 hour.**

#### Phase A1 — the kit read

- `src/kit/preference.ts`: `PreferenceRead<T>`, `readPreferenceIfReadable`.
  Implement `readPreference` *on top of it* (`readPreferenceIfReadable(...)`,
  then `readable ? value : fallback`) so there is one guard, not two.
- `src/kit/index.ts`: export both. Knip will flag an unused export until A2
  lands in the same PR, so A1 and A2 ship together.
- Tests at the interface, `src/kit/__tests__/preference.test.ts`: the five
  rows of the table above, plus "readPreference is unchanged" for a throwing
  adapter (still returns fallback).
- `docs/kit.md`: add the function to the module section (`:162-173`, "three
  operations and two encodings" becomes four operations) and to the adoption
  table at `:94` with its count from A2. The admission bar ("three users, or a
  third party asking", `:84`) is met: two in theme-editor, one in overlays, one
  in flags.
- **Estimate: 2 hours.**

#### Phase A2 — adopt: flags fixed, three wrappers deleted

- `src/ext/flags/runtime.ts` `start()`:
  - non-reset branch: `const stored = readPreferenceIfReadable(storage, OVERRIDES_PREFERENCE); if (stored.readable) overrides = vetOverrides(parseOverrides(stored.value), readFlags());` — the re-apply loop and
    `notifyOverrides()` run either way, so a restart over an unreadable
    adapter replays the session map into the app exactly as a readable one
    replays the stored map.
  - reset branch: un-apply the union of `Object.keys(previous)` (when
    readable) and `Object.keys(overrides)` (the session), then `emptyOverrides()`.
- `src/ext/theme-editor/runtime.ts:1399-1418` and `:1431-1443`: replace the
  wrappers with the tagged read. Keep the `persist: false` behaviour as it is
  today (`overridesReadable = !persist` → the map is reset on every start when
  persistence is off; #91's body records this as known). That is a separate
  question — see Decisions.
- `src/ext/overlays/runtime.ts:863-876`: same.
- Existing theme-editor and overlays restart tests must pass unchanged: they
  cross the runtime interface, so they are the proof the refactor preserved
  behaviour. Delete nothing there.
- `src/ext/flags/README.md` and `docs/ext/flags.md`: one paragraph under the
  storage/persistence section — session overrides survive a restart the
  adapter cannot read; with the default `localStorage` adapter a blocked
  store reads as empty, so that guarantee holds for custom adapters (link to
  the architecture note below).
- **Estimate: 2 hours.** A1+A2 is one PR: `fix(kit,ext): keep flag overrides a
  restart cannot read from storage`. Not a breaking change; the PR body must
  say `/kit` gained an export.

#### Phase A3 — record the default-adapter limit

`docs/architecture.md` §3 (after `:319`): the default adapter converts every
`localStorage` failure to "nothing stored" by design, so an extension that
distinguishes "unreadable" from "absent" sees the difference only for a
consumer-supplied adapter that throws. Changing the default to surface
failures would alter what every third-party `api.storage.getItem` caller sees
and is not proposed. One paragraph; no ADR — this is a documented gap in the
style of §10, not a decision anyone will want to re-litigate.

- **Estimate: 30 minutes.** Same PR as A1/A2.

### Decisions made here, flag if you disagree

1. **Tagged result, not a sentinel or `undefined`.** `T` may legitimately be
   `null` (`enabledPreference`) and `undefined` is ambiguous; the tag also
   forces the "keep the session value" branch by carrying no value.
2. **Malformed-but-present is readable.** Matches the wrappers today and
   Codex's caution. Reverse only with a reason the tests can state.
3. **The default adapter keeps swallowing.** Documented as a limit (A3).
   Revisit only with a report of a real host where `localStorage.getItem`
   throws *and* a remount happens in the same session.
4. **`persist: false` on theme-editor still resets the map per start.** Out of
   scope; if it is a bug it is a separate `fix(ext)`.

---

## Plan B — let the store decide what changed

### What is actually true

**Five runtimes state their snapshot twice.** Once as a `*Snapshot` type with
every field required (`src/ext/README.md:47-51`), once as a hand-written
comparator handed to the store:

| Runtime | Store | Comparator | Snapshot type (fields) |
| --- | --- | --- | --- |
| flags | `createDerivedStore`, 250 ms (`runtime.ts:581`) | `signature()` `:565-579` | `FlagsSnapshot` 12 + `FlagView` 29 |
| theme-editor | `createDerivedStore`, 250 ms (`:917`) | `signature()` `:903-915` | `ThemeSnapshot` 16 + `TokenView` 19 |
| environment | `createDerivedStore`, 250 ms (`:434`) | `signature()` `:431-432` — `fields.map(id=value).join` only | `EnvironmentSnapshot` 8 + field 7 |
| metrics | `createThrottledStore`, 500 ms default (`:133`) | `signature()` `:84-99` → `equals` | `MetricsSnapshot` 7, nested views/requests |
| overlays | `createThrottledStore`, **0 ms** (`:310`) | `sameSnapshot` `types.ts:448-473` → `equals` | `OverlaysSnapshot` 9, `FocusItem[]` |

`createDerivedStore` (`src/runtime/derivedStore.ts:20-26`) *requires*
`signature` and turns it into `equals: (a, b) => signature(a) === signature(b)`.
`createThrottledStore` takes `equals`, default `Object.is`
(`throttledStore.ts:57, 87`), called once per publication on
`(published, pending)` (`:120-130`). Both option types are exported from
`src/runtime/index.ts:41, 44` — published. `docs/runtime.md:57-67` documents
`signature` and warns "A field omitted from `signature` can change without a
notification, so cover every field the reader depends on."

**The two lists drift, and 15 tests pin the drift.** `bunx vitest run -t "BUG:"`
over the five directories: 38 passed (it.each expansion), 0 failed, 0 skipped.
Every one asserts the *bug* — a field change with no notification:

| Where | Pins |
| --- | --- |
| flags `:1037-1041`, `:1045`, `:1138` | view `owner`/`reloadBehavior`/`recentlyUsed`; `expired`; masked `effective` |
| theme-editor `:1740`, `:1761`, `:2089` | raw `effective` behind an em dash; `modeWritable`; `applyErrors` under `tokens: []` |
| theme-editor `:1785-1786`, `:1809` | **aliasing**: mutating the consumer's `surfaces` array is visible through `getSnapshot()` before any refresh, and never notifies |
| environment `:739-753`, `:775` | `kind`/`impersonating`/`supplied`/`severity` with `fields: []`; `masked`/`maskedCount` behind equal text |
| metrics `:337-344`, `:376-389`, `:466`, `:499` | view `id..detail`; request fields at index 0/1; active `duration`; `network.detail` |
| overlays `:1044` | `FocusItem.tabIndex` |

PR #81 (`5e1ac89`) is what one such fix costs: one line,
`` `${JSON.stringify(snapshot.adapterErrors)}|` ``, in flags' signature.
Theme-editor's twin (`applyErrors`, test `:2089`) is still open.

**What must *not* publish.** flags `runtime.test.ts:1059-1083`
`it.each(["label","icon"])("promoted %s alone does not publish — config is not
live")`: `promotedLabel`/`promotedIcon` are consumer config handed through
verbatim and are deliberately unsigned. Per-build counters exist on four
snapshots: `revision` + `at` on flags, environment, metrics; `revision` only on
theme-editor; neither on overlays. metrics `:48` "does not publish while
nothing that is painted has changed" (4 s of ticks on an unsupported memory
metric → zero notifications) must keep holding.

**Aliasing is a real prerequisite, in one place.** theme-editor's snapshot
carries `surfaces` (`runtime.ts:857`) — the *consumer's array by reference*
(`:425-426`) — and `surface`, an element of it. Everything else is fresh per
build: flags copies `reloadPending`/`adapterErrors` but passes
`variants: reading.variants` (`:424`, the consumer's array) through; metrics
shares the factory-scoped `order` array across builds (never mutated);
overlays' `hover`/`focusItems` are rebuilt per measurement and never mutated in
place, so consecutive frames sharing a reference is safe and an identity
short-circuit is a win.

**Cost is real only for overlays.** `snapshot()` + `equals` run once per
animation frame while the pointer moves or the page scrolls (`runFrame` `:517-530`,
coalesced by `schedule()` `:532-539`), on a snapshot whose `focusItems` is every
painted focusable in the viewport up to a cap. `types.ts:444-447`: "Load-bearing
for cost: without it, every pointer-move frame would re-render the overlay
tree." Everything else compares at most every 250–500 ms.

**No structural-equality helper exists in `src/`.** JSON-string comparison is
used ad hoc (flags, metrics, `agent/report.ts:173`).

### The deepened module

One comparator module in `src/runtime/`, used two ways:

```ts
// src/runtime/snapshotEquals.ts
export interface SnapshotEqualsOptions {
  /** Key names ignored at every depth. Typically the per-build counters. */
  ignore?: readonly string[];
}
/** Structural equality over plain-data snapshots: primitives, arrays, null-prototype and plain objects. */
export function snapshotEquals<T>(options?: SnapshotEqualsOptions): (a: T, b: T) => boolean;
```

Rules, stated once so nine runtimes never restate them:

- Identity first (`Object.is`) — free win for shared unchanged references.
- Arrays: same length, elementwise.
- Plain objects (`Object.prototype`, `null` prototype): same own enumerable
  key set after removing ignored names, then per-key. A key whose value is
  `undefined` equals a missing key — optional fields (`description?`,
  `applyError?`) then compare the way a reader experiences them.
- Anything else (functions, class instances, `Date`) — `Object.is`. Snapshots
  are plain data by convention; a `ReactNode` never enters one. This rule is
  what keeps the compare cheap and predictable rather than a general deep-equal.
- `ignore` is by key *name* at any depth, not by path. It is the smallest
  interface that covers both top-level counters (`revision`, `at`) and nested
  config (`flags[].promotedLabel`). The names in play are unique within their
  snapshots; the tests in B3 pin that ignoring by name did not swallow a
  sibling.

`createDerivedStore` then makes `signature` optional and adds `ignore`:

```ts
export interface CreateDerivedStoreOptions<T> extends Omit<CreateThrottledStoreOptions<T>, "equals"> {
  /** Compared at publication time. Default: snapshotEquals({ ignore }). */
  signature?: (snapshot: T) => string;   // kept: published type, and a valid override
  /** Key names snapshotEquals ignores at every depth when signature is omitted. */
  ignore?: readonly string[];
}
```

Precedence: `signature` if given (unchanged behaviour for any third-party
caller), else `snapshotEquals({ ignore })`. `createThrottledStore` is not
changed: its `Object.is` default is published behaviour that diagnostics
(`runtime.ts:639`, no `equals`) and `agent/report.ts` rely on. metrics and
overlays pass `equals: snapshotEquals({ ignore })` explicitly.

Deletion test: the five comparators go, five `ignore` lists of one to four
names arrive, and the invariant "a field in the snapshot reaches the panel"
lives in one file with one test suite. Concentrates.

### Phases

#### Phase B0 — measure, and set the overlays gate

A throwaway `bun` script (not committed; drop it in the scratchpad) that
builds representative snapshots and times 10k comparisons each:

- flags: 50 `FlagView`s, one field changed vs. unchanged — `signature`
  string-build-and-compare vs. `snapshotEquals`.
- overlays: 200 `FocusItem`s plus a `hover`, unchanged (the per-frame steady
  state) and one `rect` changed — `sameSnapshot` vs. `snapshotEquals`.

Record the numbers in this file under "Re-measuring". **Gate:** overlays
adopts `snapshotEquals` only if the unchanged-frame compare is within 2× of
`sameSnapshot` on the 200-item case. flags/environment/theme-editor/metrics
adopt regardless — at 250–500 ms any plausible result is noise.

- **Estimate: 1 hour.**

#### Phase B1 — snapshot isolation (theme-editor, flags)

Own the data before comparing it.

- theme-editor `runtime.ts`: build `surfaces` as fresh `{ id, label, selector }`
  objects per build and `surface` as the matching fresh object (or index into
  the fresh list); the failure fallback at `:892` likewise. Flip the "before
  refresh" halves of the aliasing tests at `:1785-1786` and `:1809`: after
  mutation and *no* refresh, `getSnapshot().surface[field]` still reads the old
  value and `before.surfaces` still has length 1. Leave their "after refresh"
  assertions on the `BUG:` form until B3 flips them (the old signature still
  omits `label`/`selector`).
- flags `runtime.ts:424`: `variants: [...reading.variants]`.
- No comparator change in this phase, so the #50 publication tests are the
  regression net.
- **Estimate: half a day.** Own PR: `refactor(ext): stop publishing the
  consumer's surfaces array by reference`.

#### Phase B2 — the comparator and the derived store default

- `src/runtime/snapshotEquals.ts` + `__tests__/snapshotEquals.test.ts` at the
  interface: primitives; nested arrays/objects; `undefined` vs. missing key;
  null-prototype objects (`parseRecord` output); `ignore` at depth; a class
  instance and a function compare by identity; identity short-circuit; NaN.
- `src/runtime/derivedStore.ts`: `signature?`, `ignore?`, default comparator;
  a test that `signature` still wins when given, and that `ignore` reaches a
  nested key.
- `src/runtime/index.ts`: export `snapshotEquals`, `SnapshotEqualsOptions`.
- `docs/runtime.md:57-67`: rewrite the derived-store paragraph — the store
  compares the snapshot; list what to ignore; `signature` remains as an
  override. Add a `snapshotEquals` entry with the five rules.
- **Estimate: half a day.** Own PR: `feat(runtime): a structural snapshot
  comparison the derived store uses by default`. Additive on `/runtime`; the
  PR body says so.

#### Phase B3 — adopt in the four throttled-at-250–500 ms runtimes

One PR per runtime, or two PRs (derived-store trio, then metrics); each
deletes its `signature()`, adds its `ignore`, and flips its `BUG:` tests by
following the instruction each test already carries in its comment
("after the fix, expect toHaveBeenCalledTimes(1) and getSnapshot() toBe(peek())").

| Runtime | `ignore` | Tests to flip | Must keep passing |
| --- | --- | --- | --- |
| flags | `["revision", "at", "promotedLabel", "promotedIcon"]` | `:1037-1041`, `:1045`, `:1138` | `:1059-1083` config-is-not-live; `:800` reordered unrelated fields; `:1438` unchanged adapter errors |
| environment | `["revision", "at"]` | `:739-753`, `:775` | `:679` revision advances only on publish |
| theme-editor | `["revision"]` | `:1740`, `:1761`, `:2089`, and the "after refresh" halves of `:1785-1786`, `:1809` | `:1896` reconcile-before-notify |
| metrics (`equals: snapshotEquals({ ignore: ["revision", "at"] })`) | as stated | `:337-344`, `:376-389`, `:466`, `:499` | `:48` nothing-painted-changed; `:425` fold-then-throttle |

Two things to check while flipping, not assume:

- flags `recentlyUsed`: the comment at `:1033-1035` says a `recentlyUsed`-only
  change is deliberately unpublished, yet `:1037-1041` lists it as a `BUG:`.
  The comparator will publish it. Decide (see Decisions) and make the test say
  one thing.
- metrics `:48`: the memory collector's view on an unsupported host must be
  byte-stable across ticks for zero notifications to hold once *every* view
  field counts. If a `detail` tuple or `hint` carries a timestamp or a
  formatted "n s ago", that is a metrics bug the old signature was hiding, and
  it is fixed in the collector, not by widening `ignore`.

Also delete the now-redundant per-field "does not notify for unchanged …"
tests only where a `snapshotEquals` test states the same thing; keep every
test that pins a runtime-specific decision.

- **Estimate: 1 day across the four.**

#### Phase B4 — overlays, gated by B0

- If B0 passed the gate: `equals: snapshotEquals()` (no per-build counters to
  ignore), delete `sameRect`/`sameEdges`/`sameHover`/`sameSnapshot` from
  `types.ts:419-473` and their tests, flip `:1044`, and replace the
  "load-bearing for cost" comment with the B0 numbers.
- If it failed: add `tabIndex` to `sameSnapshot`, flip `:1044`, and add one
  line to the `:444-447` comment citing this plan and the measured ratio so
  the next review does not re-suggest it.
- Either way run `bun run test:e2e` — the overlays specs drive real pointer
  frames — and the `verify-dev-toolbar` overlays recipe once by hand.
- **Estimate: 2 hours.**

#### Phase B5 — conventions

- `src/ext/README.md` "Every field of a `*Snapshot` … is required" bullet: add
  the second half of the contract — the store compares the whole snapshot;
  a runtime lists only what must *not* publish, in `ignore`; snapshots hold no
  reference a consumer can mutate.
- Per-extension READMEs and `docs/ext/*.md` that mention `signature`: grep and
  update (`grep -rn "signature" src/ext/*/README.md docs/`).
- `knip` will catch a leftover export; `bun run verify` is the gate.
- **Estimate: 1 hour.** Folds into the last B3/B4 PR.

### Decisions made here, flag if you disagree

1. **Comparator in `/runtime`, not `/kit`.** The stores live in `/runtime`
   and the derived store's default needs it; `/kit` is React-adjacent glue.
2. **`createThrottledStore`'s default stays `Object.is`.** Published
   behaviour with two in-tree dependants; changing it is a semver question
   for no gain — the two throttled-store runtimes pass `equals` explicitly.
3. **`signature` stays as an optional override.** `CreateDerivedStoreOptions`
   is a published type; removing the field is a breaking change for a
   hypothetical third party. Mark it `@deprecated` in the docblock and drop it
   in the next major.
4. **`ignore` by key name at any depth.** Path syntax is a bigger interface
   for one nested case. If a future snapshot has a colliding name, that
   runtime gets a path-aware comparator then.
5. **`recentlyUsed` publishes.** It is state the runtime computes and the panel
   can show; the `BUG:` test says so. If the panel should *not* react, that is
   an `ignore` entry with a comment, not a comparator special case.
6. **Overlays is gated on measurement, not opinion.** 2× on an unchanged
   200-item frame is the line.

### Cost, in one table

| Phase | Touches | New tests | Deleted | Estimate |
| --- | --- | --- | --- | --- |
| A0 | flags tests | 3 | — | 1 h |
| A1 | kit/preference, kit/index, docs/kit | ~6 | — | 2 h |
| A2 | flags, theme-editor, overlays runtimes; two READMEs | — | 3 wrappers (~40 lines) | 2 h |
| A3 | docs/architecture §3 | — | — | 0.5 h |
| B0 | scratch script | — | — | 1 h |
| B1 | theme-editor, flags runtimes | flips 2 halves | — | 0.5 d |
| B2 | runtime/snapshotEquals, derivedStore, index, docs/runtime | ~12 | — | 0.5 d |
| B3 | 4 runtimes + tests | flips ~30 (it.each) | 4 signatures (~60 lines) | 1 d |
| B4 | overlays | flips 1 | up to 4 comparators (~55 lines) | 2 h |
| B5 | READMEs, ext README | — | — | 1 h |

### What would make this not worth doing

- **Plan A:** a decision that the default adapter must surface failures. Then
  the fix belongs in `src/core/storage.ts` and touches what every
  `api.storage` caller sees — a different, bigger change with a contract
  discussion attached. Nothing in the reproduced bug requires it.
- **Plan B:** B0 showing structural comparison materially slower than the
  string signature on *flags* at 250 ms. That would mean the comparator is
  wrong, not the idea; fix the comparator. Or: a third party found to rely on
  `signature` being *required* — impossible to know, and the override stays.
- **Both:** neither is worth a `CONTRACT_VERSION` discussion, and neither
  needs one.

## Re-measuring

Measured on 2026-09-16 with Bun 1.4.2 (JavaScriptCore), macOS arm64. Each
entry is the median of 10 samples of 10,000 comparisons after 10,000 warm-up
comparisons per comparator and case. Comparator construction and snapshot
allocation were outside the timed loop; the loop consumed every result. CV is
the sample standard deviation divided by the mean. The flags `signature()` is
a faithful copy of the private function at `src/ext/flags/runtime.ts:565-579`;
`sameSnapshot` is the real exported function. The structural comparator used
the location-aware exclusions chosen after validation: `revision` and `at`
only at the snapshot root, and `promotedLabel` and `promotedIcon` only on flag
views directly under `flags[]` and `promoted[]`.

| Runtime | Size | Case | Existing comparator, median ns/op (CV; range) | `snapshotEquals`, median ns/op (CV; range) | Ratio |
| --- | ---: | --- | ---: | ---: | ---: |
| flags | 50 | unchanged, separately allocated | 18,018.3 (2.1%; 17,525.7-18,701.1) | 32,849.8 (1.3%; 32,009.5-33,295.7) | 1.82× |
| flags | 50 | unchanged, shared nested references | 19,996.3 (2.5%; 18,926.3-20,260.5) | 236.8 (5.6%; 224.9-265.9) | 0.01× |
| flags | 50 | label changed, first item | 16,731.0 (2.6%; 16,007.0-17,391.7) | 537.1 (4.9%; 503.8-580.3) | 0.03× |
| flags | 50 | label changed, last item | 16,783.8 (2.3%; 15,990.1-17,211.1) | 28,778.8 (0.6%; 28,472.6-28,960.9) | 1.71× |
| flags | 500 | unchanged, separately allocated | 201,392.4 (0.8%; 199,032.9-204,592.2) | 353,424.7 (4.0%; 331,648.7-369,319.7) | 1.75× |
| flags | 500 | unchanged, shared nested references | 213,171.0 (0.4%; 211,691.4-214,046.5) | 264.1 (7.2%; 237.9-305.1) | <0.01× |
| flags | 500 | label changed, first item | 191,129.9 (0.6%; 188,777.7-192,863.4) | 603.4 (5.0%; 563.4-658.9) | <0.01× |
| flags | 500 | label changed, last item | 192,619.2 (0.5%; 190,531.1-193,466.0) | 314,506.4 (1.8%; 308,774.3-323,224.4) | 1.63× |
| overlays | 200 | unchanged, separately allocated | 1,153.0 (2.5%; 1,132.5-1,235.7) | 103,889.1 (6.1%; 95,436.2-115,012.6) | 90.11× |
| overlays | 200 | unchanged, shared nested references | 661.6 (2.8%; 646.7-705.3) | 332.1 (3.2%; 314.4-346.1) | 0.50× |
| overlays | 200 | rect changed, first item | 38.5 (6.2%; 37.3-44.1) | 1,888.8 (1.1%; 1,856.2-1,921.2) | 49.05× |
| overlays | 200 | rect changed, last item | 1,217.4 (2.0%; 1,165.5-1,244.7) | 110,785.4 (7.4%; 91,854.6-116,797.4) | 91.00× |
| overlays | 200 | `tabIndex` changed, first item | 1,205.1 (2.7%; 1,174.5-1,269.9) | 2,310.8 (1.5%; 2,277.7-2,403.0) | 1.92× |
| overlays | 200 | `tabIndex` changed, last item | 1,212.4 (2.0%; 1,162.1-1,256.3) | 111,454.2 (8.9%; 93,871.0-121,849.1) | 91.93× |
| overlays | 1,000 | unchanged, separately allocated | 6,247.9 (1.3%; 6,124.3-6,358.6) | 558,247.9 (4.0%; 531,832.2-594,140.9) | 89.35× |
| overlays | 1,000 | rect changed, last item | 6,053.9 (1.0%; 5,936.5-6,155.0) | 591,144.6 (4.0%; 560,350.8-626,580.0) | 97.65× |

For the `tabIndex` cases, `sameSnapshot` returned `true` and
`snapshotEquals` returned `false`, reproducing the omission that B4 must fix.
All other changed cases returned `false` from both comparators.

**Overlays gate: FAIL.** The representative unchanged-frame case is 90.11×,
not within 2×. Its absolute `snapshotEquals` cost is 0.104 ms, 0.62% of a
16.7 ms frame, so it passes an absolute frame-budget judgment at the default
200 items. At the configured ceiling of 1,000 items, runtime clamps
`focusLimit` to 1,000, the cost is 0.558 ms or 3.34% of the frame. The ratio
gate and absolute judgment disagree. Keep `sameSnapshot` for B4, make it cover
every `FocusItem` field, and reconsider only after an optimized comparator is
measured in Chromium. These Bun results establish JavaScriptCore cost and
short-circuit behavior; they do not establish Chromium cost or frame impact.

The claim that any plausible result is noise for the other four runtimes is
too broad. At 500 flags, a separately allocated unchanged comparison costs
0.353 ms versus 0.201 ms for `signature()`, and a last-item change costs
0.315 ms versus 0.193 ms. Those costs are small relative to a 250 ms timer,
but flags and theme-editor can flush synchronously, metrics permits a 100 ms
interval, and flag catalogues and custom collectors are not bounded. This
measurement supports adoption for a 500-view flags snapshot. It does not by
itself prove the same conclusion for unbounded inputs or the other three
runtimes.

The shared-reference rows are diagnostic only. Overlay frames allocate new
focus items and rects, so the 0.50× shared-reference result is not the gate
input.

### Re-measured in B2 against the shipped comparator

The table above was produced in B0 by a **scratch** comparator. Phase B2 re-ran
the same script — same machine, Bun 1.4.2 (JavaScriptCore), macOS arm64, same
10 samples of 10,000 comparisons after 10,000 warm-up comparisons, quiet
foreground, nothing else running — against the real
`src/runtime/snapshotEquals.ts` as shipped (own-property guard included) with
the shipped `ignorePaths` (`[["revision"], ["at"], ["flags", "promotedLabel"],
["flags", "promotedIcon"], ["promoted", "promotedLabel"], ["promoted",
"promotedIcon"]]`). The real comparator is **1.6–4.2× faster than the scratch
one** on every walked case, the widest margins on the overlay shapes: it reads
own enumerable *string* keys only (no `getOwnPropertySymbols` allocation per
object), tracks exclusions through a trie built once at creation instead of a
path array and a predicate call per key, and counts keys instead of allocating
filtered key arrays.

| Runtime | Size | Case | Existing comparator, median ns/op | B0 scratch `snapshotEquals` | **B2 real `snapshotEquals`** (CV) | B2 ratio vs existing |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| flags | 50 | unchanged, separately allocated | 19,056.0 | 32,849.8 | **21,125.3** (0.5%) | 1.11× |
| flags | 50 | unchanged, shared nested references | 20,768.5 | 236.8 | **174.1** (3.9%) | 0.01× |
| flags | 50 | label changed, first item | 17,585.7 | 537.1 | **237.4** (3.5%) | 0.01× |
| flags | 50 | label changed, last item | 17,517.0 | 28,778.8 | **18,773.1** (0.4%) | 1.07× |
| flags | 500 | unchanged, separately allocated | 211,977.0 | 353,424.7 | **211,452.8** (0.2%) | 1.00× |
| flags | 500 | unchanged, shared nested references | 219,126.7 | 264.1 | **179.5** (5.7%) | <0.01× |
| flags | 500 | label changed, first item | 196,318.6 | 603.4 | **235.8** (4.6%) | <0.01× |
| flags | 500 | label changed, last item | 196,676.0 | 314,506.4 | **185,173.2** (0.5%) | 0.94× |
| overlays | 200 | unchanged, separately allocated | 1,167.9 | 103,889.1 | **29,454.2** (0.4%) | 25.22× |
| overlays | 200 | unchanged, shared nested references | 663.8 | 332.1 | **89.6** (7.7%) | 0.14× |
| overlays | 200 | rect changed, first item | 37.9 | 1,888.8 | **446.8** (2.0%) | 11.79× |
| overlays | 200 | rect changed, last item | 1,180.7 | 110,785.4 | **29,251.9** (0.3%) | 24.77× |
| overlays | 200 | `tabIndex` changed, first item | 1,236.1 | 2,310.8 | **511.6** (2.6%) | 0.41× |
| overlays | 200 | `tabIndex` changed, last item | 1,191.5 | 111,454.2 | **29,252.8** (0.4%) | 24.55× |
| overlays | 1,000 | unchanged, separately allocated | 6,074.7 | 558,247.9 | **144,037.3** (0.3%) | 23.71× |
| overlays | 1,000 | rect changed, last item | 5,992.4 | 591,144.6 | **143,856.5** (0.3%) | 24.01× |

Both `tabIndex` cases still report `sameSnapshot` `true` and `snapshotEquals`
`false`, reproducing the omission B4 must fix. Every other changed case
returned `false` from both.

The `Object.hasOwn` guard on the right-hand read — without which an own
`__proto__` key answers `Object.prototype` and two unequal snapshots compare
equal — costs a consistent **~6%** across shapes, measured against an otherwise
identical quiet foreground run of the pre-guard build (overlays 200:
27,821.9 → 29,454.2; overlays 1,000: 135,224.6 → 144,037.3; flags 500
unchanged: 199,582.4 → 211,452.8). It is not optional and it does not change
any conclusion below.

**The flags concern in "what would make this not worth doing" is closed.** At
500 views the structural comparison is on par with `signature()` on the
unchanged frame (0.211 ms vs 0.212 ms), slightly cheaper on a last-item change
(0.185 ms vs 0.197 ms), and ~830× cheaper on a first-item change because it
short-circuits where a string build cannot. At 50 views it is 1.07–1.11×.
Nothing here says the comparator is wrong.

**Overlays gate: still FAIL on the ratio as written, now a comfortable PASS on
the absolute budget.** 25.22× is not within 2×. But the unchanged 200-item
frame costs 0.029 ms — 0.18% of a 16.7 ms frame, down from B0's 0.104 ms and
0.62% — and at the clamped 1,000-item ceiling 0.144 ms, 0.86% of a frame, down
from 0.558 ms and 3.34%. The B4 branch is therefore a judgment between the two
readings rather than the one-sided call B0 recorded; whichever branch is taken,
`FocusItem.tabIndex` must start being compared. These remain JavaScriptCore
numbers and still establish neither Chromium cost nor real frame impact.

BUG-pinned tests at `431d735`:

```sh
bunx vitest run -t "BUG:" src/ext/flags src/ext/theme-editor src/ext/environment src/ext/metrics src/ext/overlays
# 38 passed | 0 failed  (15 titles; it.each expands)
```
