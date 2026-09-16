# `@nejcm/dev-toolbar/kit`

The vocabulary and the glue for writing an extension. Types every extension would
otherwise re-declare, non-React helpers every extension would otherwise re-implement,
one shared stylesheet, and a set of thin React controls that render the markup an
extension writes by hand anyway.

All nine first-party extensions consume it — `/ext/agent`, the one with neither a panel
nor a stylesheet of its own, joined them for the `presentation` option — and a
third-party extension consumes it identically, which is the point. Writing something
that looks native stops being a few hundred lines of copied CSS.

```ts
import {
  // types
  type Severity,
  type SeverityWithOverride,
  type Readable,
  type ReadableStore,
  type Source,
  type Input,
  type CompactPreset,
  type CompactPresentation,
  type CompactPresentationInput,
  type CompactRenderContext,
  type CompactParts,
  type CompactDefaults,
  // helpers, no React
  parseRecord,
  parseList,
  readJson,
  writeJson,
  createPoller,
  createSource,
  derive,
  isReadable,
  readInput,
  createStyleInjector,
  ensureKitStyles,
  resolveStyleNonce,
  matchesQuery,
  resolvePresentation,
  resolveCompactControl,
  resolveCompactParts,
  resolveIcon,
  resolveAccessibleName,
  KIT_CSS,
  // React
  embed,
  useExtensionSurface,
  useSource,
  useCopyStatus,
  Action,
  Banner,
  Chip,
  CopyButton,
  EmptyState,
  Field,
  Glyph,
  Note,
  renderCompact,
  renderCompactParts,
  Row,
  Rows,
  SearchField,
  Select,
  Tag,
  TextInput,
} from "@nejcm/dev-toolbar/kit";
```

**What it is not.** Not a component framework — every control is replaceable by
hand-written JSX producing the same DOM, and nothing in the kit is required. The minimal
`build-info` example in
[extension-contract.md](./extension-contract.md#writing-one-that-looks-native) still
imports nothing. Not a theme: no colour props, no variants, no `size="lg"`; controls
read `--dtb-*` tokens like everything else. Not opinionated about what a number
means — the kit ships a `Severity` *type* and the CSS that colours it, never a
threshold. And not a dependency of core: core never imports `runtime/`, `kit/` or
`ext/`, and the kit sits at the same layer as [`/runtime`](./runtime.md).

## What gets in

**Three users, or a third party asking.** Below that bar a helper stays in the
extension that needs it. The kit is a shared surface with semver attached to every
prop in it, so a helper with one user is a liability: it costs a public API and buys
nothing that a local function would not.

The current kit has these grandfathered interfaces. Counts are production imports
of the exact kit specifier, not same-name locals:

| Interface | Production imports | Why it stays |
| --- | --- | --- |
| Persisted state | `readPreference`: 6; `writePreference`: 6; `removePreference`: 0; `readStoredRecord`: 2; `readJson`: 0; `writeJson`: 0; `parseList`: 1; `parseRecord`: 2 | The preference module is the one owner of the storage guard and failure policy: every first-party extension that persists anything — flags, theme-editor, overlays, command-menu, diagnostics, metrics — reads and writes through it, and no extension touches `api.storage` directly any more. `removePreference` has no first-party caller because writing the fallback already removes the key. `parseList` serves the command menu's persisted recents; `parseRecord` serves the flag and theme-editor override maps. |
| Key/value readout | `Rows`: 2; `Row`: 2 | `Rows` is `Row`'s container half. The `<dl>` grid needs the fragment-shaped `<dt>`/`<dd>` pair to be usable. |
| Inputs | `SearchField`: 2; `TextInput`: 2; `Select`: 2 | They are the kit's input set. Core's `:where(input, select, textarea)` rule supplies field geometry, while the `field` and `search` kinds give authors a stable pair of hooks covering all three. |
| Copy actions | `CopyButton`: 2; `useCopyStatus`: 2 | `CopyButton` owns the button/status-region pairing. `useCopyStatus` is the shared status state for panels with several copy buttons. |
| Filtering | `matchesQuery`: 2 | It is the string-level predicate shared by the flags and theme-editor view wrappers. |
| Labelled control | `Field`: 1 | It names the wrapping-label pattern that associates a control without generating or synchronising an `id`. |
| Bar presentation | `resolvePresentation`: 9; `resolveAccessibleName`: 9; `renderCompactParts`: 8; `resolveCompactControl`: 7; `renderCompact`: 7; `hasPaintableIcon`: 3; `resolveIcon`: 3; `Glyph`: 1; `resolveNameOverride`: 1; `resolveCompactParts`: 0 | Every bar control a consumer can restyle resolves its [`presentation`](#presentation) option through the same helpers, so the two guarantees — an icon-only preset with no icon paints text, and the `⋮` menu always paints full text — hold once rather than nine times. `resolvePresentation` normalises the bare-preset shorthand in the factory and `resolveAccessibleName` guards the name override, which is why those two read **9**: they are the pair every extension needs, the two that take no icon and no preset included. `resolveCompactControl` is the one a value-bearing extension calls: it composes `resolveIcon` and `resolveCompactParts`, owns the per-control `hasPaintableIcon` guard, and takes the extension's own `"default"` parts as an argument, because `"default"` means *whatever this extension renders today* and that differs across the nine. `renderCompact` assembles the `CompactRenderContext` and applies the `undefined` fall-through, which is precisely what seven copies would drift on. Both read **7** rather than 9 because `/ext/agent` and `/ext/command-menu` take [the narrowed two-knob option](#the-narrowed-option-agent-and-command-menu) — no presets to resolve, no callback to invoke. `renderCompactParts` paints the icon and the text — the one function here that renders anything — and it reads **8**: the seven plus agent, which is icon-and-text without being preset-driven. It was promoted only after six extensions had written the same fragment by hand, which is the *three users* bar met twice over rather than a shape predicted for them. `resolveIcon` reads **3** — the three sites that resolve an icon without going through `resolveCompactControl`: command-menu and agent, which have no parts to resolve, and `/ext/flags`, which resolves the rich icon first so it can fall back to the legacy `PromotedFlag.icon` string. `hasPaintableIcon` reads **3** for exactly that reason: those same three then have to answer *is this an icon?* themselves, and the answer has to be the one the resolver uses — `false`, `true`, `null`, `undefined` and `""` are all empty, `0` is not — or a `&&` guard paints an empty glyph on three of the nine and nowhere else. Flags is the case that proves it is one rule rather than a lookalike: the legacy glyph is a `string | undefined` painted on truthiness since that control existed, and over that type the two rules agree byte for byte. `resolveNameOverride` reads **1** and is not expected to rise far: it is `resolveAccessibleName` without the fallback, for a control that has no name of its own and so must write no `aria-label` rather than an empty one — `/ext/metrics`' `⋮` rows, today. It exists so the whitespace rule is defined once; `resolveAccessibleName` is a one-liner over it. `Glyph` reads **1** and did not fall: it read 6 until `renderCompactParts` took the wrapper over, and what is left is `/ext/command-menu`, whose trigger is hand-written and paints an icon beside a hotkey hint that is neither a short nor a full text. It stays exported because it owns the `aria-hidden` default and the direct-child clamp that keeps a 24px `<svg>` from setting the bar's height, and because `Chip`'s icon slot and `renderCompactParts` are both callers inside kit itself — every glyph in the bar is one of its instances whether or not an extension named it. `resolveCompactParts` finished the rollout at **0**, which the row above said was the moment to ask whether it should stay. It stays, and the count is 0 *by construction* rather than for want of adoption: `resolveCompactControl` composes it, so a first-party extension has no reason to call it directly and never will. It is the third-party half of the bar — an author whose control is not icon-plus-text-plus-value needs the truth table itself — and it is the one function carrying both guarantees, so a userland re-derivation is exactly the drift the kit exists to prevent. Removal stays a live option on the same terms `Chip`'s `icon` / `iconProps` are kept under (ADR-004): if no third party asks, it can go. |
| Live input | `isReadable`: 2; `readInput`: 2; `createSource`: 0; `derive`: 0; `useSource`: 0 | Admitted on the *third party asking* half of the bar: the first real integration hand-rolled a module-scope holder, reader functions and an effect to bridge React-owned state into `environment()` and `flags()`. `isReadable`/`readInput` are what those two runtimes use to accept the result; `createSource`, `derive` and `useSource` are the consumer's end of the same bridge and have no first-party caller by construction — no first-party extension owns app state. |

One helper is admitted as an explicit exception to that bar rather than on either half
of it: `embed()`, below, has **zero** first-party users by construction — it frames
somebody else's panel, and no first-party extension is somebody else's — and no third
party asked for it. It was approved through Phase 0C of `plans/ecosystem-extensions.md`,
which weighed an `/ext/embed` subpath against a helper and chose the helper: the
containment a subpath would have offered is already core's, and what remained was a
frame for extension authors, not an extension. The exception is this one helper; the
rule stands for the next candidate.

The current examples of things that do **not** qualify: `switch` (two sites, both
`role="switch"` buttons in `/ext/flags` and `/ext/overlays`, so a kit `Toggle` would
have shipped with zero users and a kit `Switch` with two), `sparkline` (metrics only)
and `count` (flags only). They stay local until a third one wants them.

---

## Tier A — helpers and types

No React. The part a third-party author benefits from even when rendering everything
themselves.

### Vocabulary

```ts
type Severity = "unknown" | "ok" | "warn" | "bad";
type SeverityWithOverride = Severity | "override";
```

Four extensions independently declared this union under four names before the kit
existed, which made the collision invisible to anyone grepping for it. Use
`SeverityWithOverride` where a local override is a state of its own — a flag or a
design token the developer has pinned — and `Severity` where it is not.

Deciding *which* severity a value has stays yours. The kit ships no thresholds; every
extension's own `severityFor(...)` is a judgement about its own data.

### Persisted state

```ts
interface Preference<T> {
  key: string;
  encoding: "string" | "json"; // "string" only when T is string | null
  fallback: T;
  isValue: (v: unknown) => v is T;
}
type PreferenceRead<T> =
  | { readonly readable: true; readonly value: T }
  | { readonly readable: false };
readPreference<T>(storage, preference: Preference<T>): T;
readPreferenceIfReadable<T>(storage, preference: Preference<T>): PreferenceRead<T>;
writePreference<T>(storage, preference: Preference<T>, value: T): void;
removePreference(storage, preference: { key: string }): void;

parseRecord<T>(raw: string | null, isValue: (v: unknown, name: string) => v is T): Record<string, T>;
parseList<T>(raw: string | null, isValue: (v: unknown) => v is T, limit?: number): T[];
readJson<T>(storage, key, fallback: T, guard: (v: unknown) => v is T): T;
writeJson(storage, key, value: unknown): void;

extensionStorageKey(instanceId, extensionId, key): string;
readStoredRecord<T>(options, isEntry: (v: unknown, name: string) => v is T): Record<string, T>;
resetRequested(param: string | null | undefined): boolean;
```

A **preference** is a named, validated, persisted value: four operations and two
encodings, deliberately nothing more. `readPreference` returns the stored value when
it passes `isValue`, else `fallback`. `readPreferenceIfReadable` returns a tagged
`PreferenceRead`: `{ readable: false }` means the adapter threw before answering,
while `{ readable: true, value: fallback }` means the adapter answered but nothing
valid was stored. The unreadable result deliberately carries no fallback value.
`writePreference` stores the value or removes the key when the value equals `fallback`,
so storage holds only what differs from the fallback. A preference whose default is
consumer-configurable, such as overlay toggles under `defaults` or the theme editor's
`surfaces[0]`, sets `fallback: null`, so an explicit choice persists even when it
matches that default. `removePreference` drops the key.
`storage` is `api.storage` from `start(api)`, or `null`/`undefined` before `start()`
has run. Every operation tolerates that and a throwing adapter, including a browser
with site data blocked, a full quota, or a sandboxed iframe. It returns the fallback or
an unreadable result, or does nothing. A storage adapter is consumer code, and a
preference must never take down a panel or a click handler.

The two encodings are both first-class. `"string"` stores the value byte-for-byte —
what a tab id, a snapshot format or an override map the extension serialises itself
write — and never JSON-wraps it, so a value persisted before an extension adopted this
module still reads back. `"json"` runs a whole value through `JSON`.

```ts
const tab: Preference<CollectorId | null> = {
  key: "tab",
  encoding: "string",
  fallback: null,
  isValue: (v): v is CollectorId | null => v === null || ORDER.includes(v as CollectorId),
};
const current = readPreference(storage, tab); // "vitals" — the raw id, not '"vitals"'
writePreference(storage, tab, "network");
```

`parseRecord` is the "read a map of overrides back out of storage" function
`/ext/flags` and `/ext/theme-editor` had each written, and `/ext/command-menu` had in
its array form: try/parse, reject `null`, arrays and non-objects, keep only guarded
values, and hand back a **null-prototype** object. That last part is the decision
worth centralising — a persisted `__proto__` key has to round-trip as data,
and `in` and lookup have to behave the same on every path. The guard sees each entry's
name as well as its value, so a validator that depends on the key — a token's declared
type, say — fits without a second pass.

`parseList` is the array form, with an optional `limit` applied after filtering.
`readJson`/`writeJson` are the un-named forms of the JSON preference, for a caller that
holds only a key; they never throw either.

```ts
const isFlagValue = (v: unknown): v is FlagValue =>
  typeof v === "boolean" || typeof v === "string" || typeof v === "number";

const overrides = parseRecord(storage.getItem("overrides"), isFlagValue);
```

**Before mount.** Core scopes an extension's storage to
`dtb:v1:<instanceId>:ext:<extensionId>:`; an app that has to agree with the panel on
first paint reads the same bytes before `start()` has run and there is no
`api.storage` yet. `extensionStorageKey` builds that key — the kit's one hand-maintained
copy of core's prefix, asserted equal to core's `STORAGE_PREFIX` in the kit's tests.
`readStoredRecord` reads a persisted map through it from `localStorage` (or the
`storage` you pass), honours the `?<resetParam>=reset` kill switch through
`resetRequested`, vets every entry by value *and* name through the validator you hand
it, and returns a plain object. The kill switch is off until you pass `resetParam`.
The flags and theme-editor pre-mount readers (`readStoredOverrides`,
`readStoredThemeOverrides`) are built on it: each passes its own `resetParam` default
and closes its runtime's entry guard over `isEntry`. Pass the mounted runtime's own
validator and the app seeds itself with exactly the entries the panel will accept.
Anything a guard cannot express — theme-editor trims accepted values, and its checker
returns a *reason* rather than a boolean — stays in the caller as a pass over the
returned map; the reader vets and reads, nothing more.

### Live input

```ts
interface Readable<T> {
  read(): T;
  subscribe(listener: () => void): () => void; // returns unsubscribe
}
interface ReadableStore<T> { getState(): T; subscribe(listener: () => void): () => void }
interface Source<T> extends Readable<T> { set(next: T): void }
type Input<T> = T | (() => T) | Readable<T> | ReadableStore<T>;

createSource<T>(initial: T): Source<T>;
derive<T>(inputs: readonly (Readable<unknown> | ReadableStore<unknown>)[], compute: () => T): Readable<T>;
isReadable<T>(input: Input<T>): input is Readable<T> | ReadableStore<T>;
readInput<T>(input: Input<T>): T;
```

An extension is built once, at module scope, before React mounts anything, so it
cannot read a hook. That left two ways to feed it a value that changes: a getter
polled on a timer — a redact-and-diff pass per tick for nothing, and up to a poll of
staleness after the change — or a module-scope variable an effect keeps current. A
`Readable` is the third: the value *plus* a notification, so the runtime subscribes
once and rebuilds its snapshot exactly when the app says so. The rebuild is
synchronous; publishing it to the bar still goes through the snapshot store's 250 ms
throttle.

`Input<T>` is the type an option takes when it accepts all three.
`/ext/environment`'s `context` and `/ext/flags`' `flags` are `Input`s; a plain value
and a getter behave exactly as before, and a `Readable` is re-read on notify instead of
on the timer. `readInput` resolves whichever was passed, `isReadable` is the branch a
runtime takes to decide between subscribing and polling.

A Zustand or Redux store already has this shape up to naming, so
`{ getState, subscribe }` is accepted as-is — a Zustand *bound hook* included, which
carries `getState`/`subscribe` on the function. That last case is why the store shape
is recognised rather than left to an adapter: a bound hook is also a function, and
treating it as a getter would call a hook outside a component. The structural check is
safe wherever `T` itself cannot carry a `subscribe` method beside `read` or `getState`;
a fixed-key options object and an array cannot. Do not declare an `Input<T>` over a
`T` that could.

```ts
// app/dev-toolbar.ts — module scope, like the extensions it feeds
const user = createSource<User | undefined>(undefined);
const session = derive([user, useAppStore], () => ({
  environment: config.env,
  userId: user.read()?.id,
  region: useAppStore.getState().region,
}));

export const extensions = [environment({ context: session }), flags({ flags: useFlagStore })];
```

`createSource` returns a `Source<T>` — a `Readable<T>` plus `set()` — the writable
end for state that lives in React (below). `set()` is
free when the value is unchanged by `Object.is`, so assigning from every render is
fine. `derive` fans one subscription out over several inputs; `compute` reads them
itself and runs on every `read()` — the runtime redacts and diffs the result, so
nothing is memoised here.

A store that notifies on every dispatch costs one rebuild per notification. That is
the honest rate for "publish when the app changes"; a store noisier than the panel
wants can be wrapped in a `Readable` that debounces `subscribe`.

### Polling

```ts
createPoller(fn: () => void, options: {
  intervalMs: number;
  fallbackMs?: number;
  signal?: AbortSignal;
}): () => void;
```

Starts an interval and returns a stop function that is safe to call twice. It owns
three decisions three extensions had each made separately: a **250 ms floor**, so no
option value can turn a dev tool into a busy loop; a non-finite `intervalMs` falling
back to `fallbackMs` and then to 1000 ms, rather than to the floor — `pollMs: NaN`
used to mean a different thing in different extensions; and teardown, wiring the
`AbortSignal` `start(api)` already gave you so a stop is one listener, removed on stop.
An already-aborted signal, or a non-function `fn`, yields a no-op.

```ts
start(api) {
  return createPoller(() => runtime.sample(), {
    intervalMs: pollMs,
    fallbackMs: 1000,
    signal: api.signal,
  });
}
```

### Style injection

```ts
createStyleInjector(entry: string, css: string): (doc?: Document, nonce?: string) => HTMLStyleElement | null;
ensureKitStyles: (doc?: Document, nonce?: string) => HTMLStyleElement | null;
KIT_CSS: string;
```

`createStyleInjector` wraps [`ensureStyleSheet`](./runtime.md) — one sheet per document,
keyed on a `style[data-dev-toolbar-styles]` element rather than a module flag — into the
signature every extension's `ensureXStyles` already had. `ensureKitStyles` is that
injector, pre-bound to `KIT_CSS`: an extension that uses the shared stylesheet calls it
alongside its own sheet, and the DOM key means the second caller injects nothing.

```ts
const injectStyles = createStyleInjector("ext-build-info", BUILD_INFO_EXTENSION_CSS);

export function ensureBuildInfoStyles(doc?: Document, nonce?: string): HTMLStyleElement | null {
  ensureKitStyles(doc, nonce);
  return injectStyles(doc, nonce);
}
```

`KIT_CSS` is exported for the other delivery route: a consumer who ships CSS themselves
(`injectStyles: false` everywhere) concatenates the sheets they need and serves one
file, and `KIT_CSS` belongs in it once. Each first-party extension's exported `*_CSS`
string *deliberately embeds its own copy*, so hand-shipping a single one still yields a
styled panel; combining several therefore repeats that prefix, which is harmless
duplication rather than a bug.

### CSP

```ts
resolveStyleNonce(option: string | undefined, slot: string | undefined): string | undefined;
```

One expression — `option || slot` — with a policy behind it. The factory option wins,
because a host whose extension sheets need a different nonce has nowhere else to say
so; and an **empty** option defers to the slot rather than blanking the host's nonce,
so `styleNonce: ""` cannot silently produce an un-nonced sheet that a
`style-src 'nonce-…'` CSP drops with nothing in the console. Every slot in the seven
first-party factories that render something calls it — `/ext/agent` is headless and
injects nothing. It is published so a third-party extension can state the same policy
instead of re-deriving it. See [styling.md](./styling.md#csp).

### Filtering

```ts
matchesQuery(haystack: readonly (string | undefined)[], query: string): boolean;
```

String-level and deliberately dull: trim, lower-case, and an empty query matches
everything, which is what makes it usable as the filter predicate for an unfiltered
list. `undefined` entries are skipped, so optional fields go in without a guard.

```ts
const visible = rows.filter((row) => matchesQuery([row.key, row.label, row.owner], query));
```

`/ext/flags` and `/ext/theme-editor` each export a `matchesQuery` of their own that
takes a *view object*. Those are published API on their own subpaths and stay where
they are, as thin wrappers over this one. Same-name locals are not kit usage: each
extension's `severityFor` is likewise its own, judging its own data.

### React glue

```ts
useExtensionSurface<T>(
  store: Pick<ThrottledStore<T>, "subscribe" | "getSnapshot">,
  inject: boolean,
  ensureStyles: (doc?: Document, nonce?: string) => unknown,
  nonce?: string,
): T;
```

The extension author's hook. It subscribes a component to a
[`createThrottledStore`](./runtime.md) snapshot through `useSyncExternalStore` and, when
`inject` is true, ensures the stylesheet from an effect. `getSnapshot` is passed as the
server snapshot too, because extension stores are created eagerly from the same inputs —
another shape, or a throw, would break SSR.

It is what makes a slot function cheap: the slot returns a component, and the component
subscribes.

```tsx
interface BuildChipProps {
  runtime: BuildInfoRuntime;
  injectStyles: boolean;
  styleNonce?: string;
}

export function BuildChip({ runtime, injectStyles, styleNonce }: BuildChipProps) {
  const snapshot = useExtensionSurface(runtime.store, injectStyles, ensureBuildInfoStyles, styleNonce);
  return <Chip label="build" value={snapshot.commit} severity={snapshot.severity} />;
}
```

```ts
useSource<T>(source: Pick<Source<T>, "set">, value: T): void;
```

The host application's hook, and the one place the kit is called from a component that
is not a slot. It assigns a React-owned value — the signed-in user, a router's
location, a query result — into a module-scope [`createSource`](#live-input) from a
layout effect, so every extension subscribed to that source rebuilds its snapshot in
the same commit rather than on its next poll. Publication is still the extension
store's: `/ext/environment` and `/ext/flags` write through a 250 ms
[throttle](./runtime.md), so a change landing inside that window shows on the trailing
edge, not before the paint.

```tsx
const user = createSource<User | undefined>(undefined); // module scope, next to the extensions

function DevToolbarHost() {
  const currentUser = useCurrentUser();
  useSource(user, currentUser);
  return <DevToolbar extensions={extensions} />;
}
```

It clears **nothing** on unmount, deliberately. The module-scope-mutable pattern it
replaces reset its holder in a cleanup, and under StrictMode's mount → cleanup → mount
the toolbar briefly reported "nobody signed in" to whichever poll landed in between.
The source, like the extension it feeds, outlives any one component; a value that
should be absent is assigned as absent by the component that knows so. On a server the
effect never runs, and the source keeps its initial value.

### `embed`

```ts
embed(options: EmbedOptions): DevToolbarExtension;
```

The frame for a third-party devtool panel — TanStack Query's, React Hook Form's, a Redux
monitor. It returns an ordinary extension: core's own trigger — or, given `value`, a
`Chip`-based one reading `label` and `value` — a `panel` that renders `options.render(props)` inside a bare
`<div data-dtb-part="embed-frame">` with `height: 100%` and a `min-height` floor
(default 240px), `keepMounted` passed through, and `render()` left uncalled until the
panel first opens. It scopes, resets and injects **nothing** for the embedded subtree —
the frame carries core's `data-dtb-embed` opt-out, which keeps core's element-level
defaults (the button face, field geometry, box-sizing) off the tool, and the only sheet
the helper ensures is this kit's, for that chip, and only when `value` asks for one. The plain `{ id, label, panel }` object works without it; the helper is
for the fiddly parts. [embedding.md](./embedding.md) is the recipe and the reference for
`EmbedOptions`.

```tsx
const queryDevtools = embed({
  id: "tanstack-query",
  label: "query",
  keepMounted: true,
  render: ({ close }) => (
    <ReactQueryDevtoolsPanel client={queryClient} style={{ height: "100%" }} onClose={close} />
  ),
});
```

---

## Tier B — the shared stylesheet and `data-dtb-kind`

One sheet, keyed on a second attribute, so the button reset that had been hand-copied
into five extensions — and had already drifted three ways — lives once.

**Two attributes, two jobs.** `data-dtb-part` says *which* part this is
(`env-note`, `metrics-chip`); `data-dtb-kind` says *what sort of thing* it is (`note`,
`chip`). Parts stay namespaced per extension and keep every meaning and value they had,
so nothing a consumer wrote against them stops working. Kinds are shared, which is what
lets one stylesheet serve every extension. An element usually carries both:

```html
<p data-dtb-part="env-note" data-dtb-kind="note">…</p>
```

### The kinds

| Kind | What the sheet gives it | Control |
| --- | --- | --- |
| `chip` | inline flex row, `--dtb-chip-gap`, no wrapping | `<Chip>` |
| `dot` | a 6px round status dot, muted by default | `<Chip>`'s dot slot |
| `glyph` | a centring inline-flex box whose line box is `--dtb-glyph-size`, clamping its direct child to the same | `<Glyph>`, `<Chip>`'s icon slot |
| `label` | muted text | `<Row>`'s `<dt>`, opt-in on `<Chip>` |
| `value` | the mono font | `<Chip>`'s value slot, `<Row>`'s `<dd>` |
| `action` | the ten-declaration **panel** button reset, plus `:hover:not(:disabled)` — both guarded `:not([data-dtb-part="trigger"])`, see [`Action` is a panel control](#action-is-a-panel-control) | `<Action>`, `<CopyButton>` |
| `note` | `margin: 0` and muted colour | `<Note>`, `<Field>`, `<CopyButton>`'s status span |
| `tag` | a small padded inline marker, one step down in size — guarded `:not([data-dtb-part="trigger"])`, see [`Action` is a panel control](#action-is-a-panel-control) | `<Tag>` |
| `row` | a bordered, padded grid card | — (hand-written) |
| `rows` | the `max-content 1fr` key/value grid, plus zero `dd` margins | `<Rows>` |
| `list` | a flex column with the list marker removed | — (hand-written) |
| `empty` | muted text | `<EmptyState>` |
| `banner` | padded and rounded; bordered and tinted per severity | `<Banner>` |
| `search` | a flexible, bounded-width search box | `<SearchField>` |
| `toolbar` | a wrapping control row with a rule under it | — (hand-written) |
| `stack` | a panel root: a flex column with the first-party section gap, filling the body | — (hand-written) |
| `field` | **nothing** — a hook only, see below | `<TextInput>`, `<Select>` |

Seventeen kinds, and `field` is the one the kit styles nothing for; the other sixteen
each get rules from `KIT_CSS`.

`row`, `list`, `toolbar` and `stack` have no control because there is nothing for one to
do: they are a `<div>`, a `<ul>` and two `<div>`s with an attribute on them. Add the attribute
by hand.

`field` is the deliberate carve-out. Core already owns field geometry through its
`:where(input, select, textarea)` rule, so the kit adds no rules of its own and
`data-dtb-kind="field"` lets a consumer reach `TextInput` and `Select` with one
selector. `SearchField` emits `data-dtb-kind="search"`; a kind is single-valued, so
target all three kit inputs with `:is([data-dtb-kind="field"],
[data-dtb-kind="search"])`. Core's rule skips `type="color"` and `type="checkbox"`, so a
`<TextInput type="color">` carries the hook and gets neither treatment.

### Severity is compound, never descendant

```css
[data-dev-toolbar] [data-dtb-kind="dot"][data-dtb-severity="warn"] { background: var(--dtb-warn); }
```

Both attributes on the **same element**. A container carrying `data-dtb-severity` does
not tint what is inside it, which is why an extension can put the attribute on a panel
root for its own targeting without the kit colouring the whole panel. The kit colours
three kinds by severity — `dot` (background), `value` (colour) and `banner` (border,
background and colour). Borders and text come from `--dtb-ok`, `--dtb-warn`,
`--dtb-danger` and, for `override`, `--dtb-accent`; override one of those and every
extension's severity borders and text move at once. Banner **grounds** are separate
tokens — `--dtb-ok-bg`, `--dtb-warn-bg`, `--dtb-danger-bg`, and `--dtb-item-active-bg`
for `override` — so a full re-tint means overriding both halves.

A `value` and a `banner` are text at 11px or 12px — both under WCAG's 18.66px
large-text threshold — so a severity colour owes 4.5:1 against the bar, against a
panel, *and* against its own `-bg` tint over either; the `dot` in the same colour is
non-text and owes 3:1. The shipped tokens clear that on the grounds core paints —
the bar, a panel, a field, a trigger that is hovered or has its panel open — and
`src/core/__tests__/contrast.test.ts` keeps them there. Stacking one severity's tint
*on another's* is outside that arithmetic and is the extension's own to measure. An
override is yours to check either way: the toolbar is excluded from `/ext/a11y`'s
scans, so axe in your app will not see it.

### Under a host reset

Because the sheet is layered, a kit control needs the same armour any dev-toolbar
element needs in a host that ships an unlayered CSS reset. Tailwind's Preflight
(`button, input, optgroup, select, textarea { padding: 0; color: inherit }`) beats
`KIT_CSS` exactly as it beats core's sheet, and a `<TextInput>` or `<Select>` renders
flat and muted. The remedy is the consumer-side `revert-layer` block in
[styling.md](./styling.md#under-a-host-reset), which is keyed on
`:is([data-dtb-part], [data-dtb-kind])` — the kind half is what reaches a kit control
that carries no part name of its own.

### Overriding it

The sheet is wrapped in `@layer dev-toolbar` and every selector is scoped by
`[data-dev-toolbar]`, the same two rules core's own stylesheet follows and the repo's
stylesheet test enforces. Unlayered author CSS beats any layered rule regardless of
specificity, so a consumer's one-class selector wins over the kit's attribute selectors
with no `!important` anywhere. Full detail in [styling.md](./styling.md).

---

## Tier C — React controls

Thin by construction. Every one of them:

- renders exactly the DOM an extension writes today, plus its `data-dtb-kind`
- spreads `...rest` onto the DOM node and forwards `ref` to it, so the escape hatch is
  always there and a site keeps its own `data-dtb-part`. `Row` is the one exception to
  the `ref` half — it is a fragment, see below — but it spreads like the rest
- holds no state, except `CopyButton`, which *is* a state machine
- has no `className` prop of its own beyond passthrough — theming is tokens and
  attributes

| Control | Element | For |
| --- | --- | --- |
| `<Action>` | `<button type="button">` | any panel button |
| `<CopyButton>` | `<button>` + a status region | copy-to-clipboard, outcome included |
| `<Chip>` | `<span>` + dot/icon/label/value | the compact-slot summary |
| `<Glyph>` | `<span>` | a consumer-supplied icon, hidden and clamped — see [Presentation](#glyph-and-icons-that-are-characters) |
| `<Note>` | `<p>`, `<span>` or `<label>` | secondary text |
| `<Banner>` | `<p>` or `<div>` | a panel-wide message |
| `<Tag>` | `<span>` | a marker beside a value (`masked`, `detected`) |
| `<EmptyState>` | `<div>` or `<p>` | the "nothing to show" placeholder |
| `<SearchField>` | `<input type="search">` | filtering a long list |
| `<Rows>` / `<Row>` | `<dl>` / `<dt>`+`<dd>` | a key/value readout |
| `<Field>` | `<label>` wrapping its control | a labelled form control |
| `<TextInput>` / `<Select>` | `<input>` / `<select>` | the controls inside it |

### `CopyButton` and `useCopyStatus`

```tsx
<CopyButton
  text={() => runtime.snapshotText()}
  statusText={{
    idle: "Credential-shaped values are masked before anything is copied.",
    ok: `Copied — ${masked} value${masked === 1 ? "" : "s"} masked.`,
    failed: "Clipboard unavailable.",
  }}
  data-dtb-part="build-action"
>
  Copy summary
</CopyButton>
```

The button renders alongside a `role="status"` span carrying `statusText[status]`.
Both halves matter: the write goes through `/runtime`'s `writeClipboardText`, which
resolves `false` on a sandboxed frame or a denied permission instead of throwing, and
the polite live region is what tells a screen-reader user which of those happened.

`text` may be a function, resolved on activation, so a panel does not serialise a
snapshot on every render. `statusText` is a prop rather than kit wording because the
interesting sentence — how many values were masked — is the extension's fact, not the
kit's.

Where one panel has several copy buttons sharing one status line, use the hook and
render the region yourself:

```tsx
const { status, copy } = useCopyStatus();
…
<Action onClick={() => copy(runtime.snapshotText())}>Copy summary</Action>
<Action onClick={() => copy(JSON.stringify(runtime.diagnostics(), null, 2))}>Copy JSON</Action>
<Note as="span" role="status">{status === "failed" ? "Clipboard unavailable." : …}</Note>
```

`copy(null)` reports `failed` without touching the clipboard, for the "there was
nothing to copy" branch.

### `Chip`

```tsx
<Chip
  label="build"
  value={commit}
  severity={view.severity}
  data-dtb-part="build-chip"
  dotProps={{ "data-dtb-part": "build-dot" }}
  labelProps={{ "data-dtb-part": "build-label", "data-dtb-kind": "label" }}
  valueProps={{ "data-dtb-part": "build-value" }}
>
  {view.dirty ? <span data-dtb-part="build-alert">uncommitted</span> : null}
</Chip>
```

A dot, an optional icon, an optional label, an optional value, and whatever `children`
append. Each slot takes its own props so a site keeps its part names. The dot and value
carry a `data-dtb-kind` by default; the label does not, because most sites leave it
unstyled — pass <code v-pre>labelProps={{ "data-dtb-kind": "label" }}</code> to opt in, or
`"data-dtb-kind": undefined` on the others to opt out.

`label`, `icon` and `value` are each optional, and `undefined | null` renders **nothing
at all** rather than an empty span: the chip is `inline-flex` with a gap, so an empty
span would still consume one and leave an icon-only chip off-centre.

`icon` renders after the dot, inside a [`Glyph`](#glyph-and-icons-that-are-characters),
and `iconProps` reaches that wrapper. The icon slot is the one that will not let you
drop its `data-dtb-kind`: the clamp keyed on that kind is the reason `Glyph` exists, so
style the icon through the element you hand to `icon`, or add your own `data-dtb-part`
alongside the kind.

**The first-party Group A chips deliberately do not use the `icon` and `label` slots.**
They pass their icon and text as `children` instead, because `ctx.fallback` in
[Presentation](#render-and-what-it-may-not-take) has to be one children tree — the same
construction handed to a `render` callback and painted when there is none — and because
a `render` that replaced a whole slotted `Chip` would take the dot and the state
attributes with it. The two slots are third-party surface, for an author whose control
genuinely *is* a plain slotted chip with no callback to honour;
[ADR-004](./adr/ADR-004-per-extension-bar-presentation.md) records that, and that their
expected first-party count is zero.

`severity` writes onto the dot and the value and **nothing else** — not the container.
A site that also wants `[data-dtb-severity]` on the chip itself passes
`data-dtb-severity` through `...rest` as well; passing both is correct, not a
duplicate.

The dot always renders. A chip that should not have one is two spans written by hand —
which is exactly what `/ext/flags`' bar chip does, because an extra node there would
shift the whole summary by a dot and a gap.

### `Note`, `Banner`, `Tag`, `EmptyState`, `Action`

One-liners over tier B. `Note`, `Banner` and `EmptyState` take an `as` prop, restricted
to the elements those sites actually use, because a note is sometimes a `<p>` and
sometimes a `<span>` inside a flow of controls.

`Banner` takes an optional `severity` and **no default `role`**. The kit cannot know
whether a message interrupts (`role="alert"`) or waits for a pause (`role="status"`),
and guessing either way is worse than the compile-time silence — a `Banner` without one
is announced to nobody, so give it one.

`Action` defaults `type="button"`, which is the bug it exists to stop: a bare `<button>`
inside a form submits it.

#### `Action` is a panel control

**`Action` is for panel controls. A bar trigger is your own element.** The kit's
`action` kind is the *panel* button reset — `--dtb-control-height`,
`--dtb-control-padding-x`, a 1px border — and the bar paints its chips from core's
`[data-dtb-part="trigger"]` rule instead: `--dtb-item-padding-x` and no border.

The two used to collide. Both selectors are `(0,2,0)` and both live in
`@layer dev-toolbar`, so source order decided, and the kit sheet is injected after
core's — an `Action` used as a `compact` slot silently took the panel reset, painting a
frame no other bar chip has and measuring **8px wider** (3px more padding a side, plus
the border a side, at either density). That 8px is enough to tip a chip over the bar's
collapse threshold and into the `⋮` menu on one machine and not another; it did exactly
that to this repo's playground.

Both `action` rules now carry `:not([data-dtb-part="trigger"])`, so the reset stops at
the bar and core's trigger rule styles the chip unopposed — an `Action` on the bar is
merely redundant rather than wrong. `:not()` takes the specificity of its argument, so
the guard raises the *kit's* rule to `(0,3,0)`, which is enough to stop matching at the
bar without changing what it does anywhere else.

**`tag` carries the same guard**, for the same reason and on the same measurement.
`Tag` renders a `<span>`, and core sanctions `span[data-dtb-part="trigger"]` as a bar
*readout* — a compact slot with no panel behind it — so a `Tag` used as one is plausible
authoring rather than absurd. Unguarded it tied core's trigger rule the same way and won
the same way, taking a live trigger 3px of padding a side and a font step down: **12px
narrower**.

Those two are the whole list, and it is a list of *kinds*, not parts. `item`,
`overflow-button`, `overflow-menu-item` and `error-chip` are rendered by core, so no
extension can put a kind on one, and `trigger` is the only bar part you write yourself.
Other kinds disagree with the bar's geometry too — `glyph`, `note`, `dot`, `row`,
`banner`, `stack`, `list`, `toolbar`, `search` — and are deliberately left alone: none of
them reads as something you would reach for to build a bar chip, and a guard with no
plausible mistake behind it is a change with no defect behind it. A kit `Chip` on — or
inside — a trigger is the opposite case: plausible, and already correct, because `chip`
declares no geometry that core's trigger rule does not already declare.
See [Writing your own bar control](#writing-your-own-bar-control).

**Why the guard is kit-side and not a specificity bump in core.** Not because a consumer
would start losing: both sheets live in `@layer dev-toolbar`, and unlayered author CSS
beats *any* layered rule regardless of specificity ([README](https://github.com/nejcm/dev-toolbar/blob/main/README.md#styling),
[architecture](./architecture.md#light-dom-not-shadow-dom)), so core's number is invisible to
anyone styling from outside the layer. The real reasons are three. Raising it would edit
`src/styles.css` and `src/core/css.ts` — the byte-identity ritual — to fix a kit-side
mistake. It would settle one tie rather than the class: every kit kind that disagrees
with the bar would need core to out-specify it in turn. And `:not()` puts the exclusion
where the knowledge lives — the kit knows `action` is a panel control, and core has no
business knowing kit kinds exist at all.

### `SearchField`

```tsx
const [query, setQuery] = useState("");
…
<SearchField
  label="Search flags"
  placeholder={`Search ${snapshot.flags.length} flags`}
  value={query}
  onChange={setQuery}
  data-dtb-part="flag-search"
/>
```

`onChange` receives the **value**, not the event. The state stays in the extension: a
control that owned it could not be filtered against or reset.

`label` is required and becomes `aria-label`, because a bare `type="search"` with only
a placeholder is announced as "search" and nothing else. `aria-labelledby` still passes
through `...rest` and wins where a site has a visible heading to point at.

### `Rows` and `Row`

```tsx
<Rows data-dtb-part="env-rows">
  {fields.map((field) => (
    <Row
      key={field.id}
      label={field.label}
      valueProps={{ "data-dtb-part": "env-row-value", "data-dtb-masked": String(field.masked) }}
    >
      {field.value}
      {field.masked ? <Tag>masked</Tag> : null}
    </Row>
  ))}
</Rows>
```

`Rows` is the two-column `<dl>` grid; `Row` is a `<dt>`/`<dd>` pair returned **as a
fragment**, so the pairs stay direct children of that grid instead of being wrapped in
an element that would break it. That is also why `Row` takes no `ref`: a fragment has no
single DOM node, and inventing a wrapper to hang one on would change the layout. A site
that needs a ref writes the two elements by hand — they are two lines.

A fragment has no single node to spread onto either, so `Row` addresses its two cells by
name: `labelProps` reaches the `<dt>`, `valueProps` the `<dd>`. Anything passed at the
top level spreads onto the **`<dd>`** — the value cell is the one a site names and
targets — so `<Row data-dtb-part="env-row-value">` lands where you meant it rather than
disappearing. The kit-owned `value` kind wins over the top-level spread, as it does on
the other controls. `valueProps` wins on a collision, being the explicit way to address
that cell or opt out of the kind.

`Rows` is for a key/value readout. A list of rich rows is a `<ul data-dtb-kind="list">`
of `<li data-dtb-kind="row">`, written by hand; `/ext/overlays` is the worked example.

### `Field`, `TextInput`, `Select`

```tsx
<Field label="Sort" data-dtb-part="build-field">
  <Select value={sort} onChange={(next) => setSort(next === "severity" ? "severity" : "declared")}>
    <option value="declared">as declared</option>
    <option value="severity">worst first</option>
  </Select>
</Field>
```

`Field` is a muted `<label>` **wrapping** its control, which *is* the association — no
`id` to generate, none to collide, nothing to keep in sync. It renders the label text,
a space, then the control, and is the same DOM as `<Note as="label">` with the pattern
named.

Where the control inside also carries its own `aria-label`, that name wins over the
visible text in the accessibility tree. That is deliberate, not a duplicate: it is how a
one-word visible label gets spelled out for a screen reader.

`TextInput` and `Select` pass the **value** to `onChange`, like `SearchField`, and carry
`data-dtb-kind="field"`. Neither takes styling from the kit; see the `field` carve-out
above.

---

## Presentation

Every first-party extension takes one `presentation` option, and it is the same option
in all nine: a preset, your own icon, a `render` callback over that extension's own view
data, and an accessible-name override. The vocabulary lives here so a third-party bar
control can be written against the same four knobs.

```ts
type CompactPreset =
  | "default"    // whatever this extension renders today
  | "icon"       // the icon alone; falls back to text with no icon supplied
  | "icon-value"
  | "icon-label"
  | "label"
  | "value";

interface CompactPresentation<TView> {
  preset?: CompactPreset;                                    // default "default"
  icon?: ReactNode | ((data: TView) => ReactNode);
  render?: (data: TView, ctx: CompactRenderContext) => ReactNode;
  name?: (data: TView) => string;
}

type CompactPresentationInput<TView> = CompactPreset | CompactPresentation<TView>;
```

A bare preset is the shorthand for `{ preset }`, which is the case most consumers want:

```tsx
metrics({ presentation: "icon-value" });
metrics({ presentation: { preset: "icon-value", icon: (m) => ICONS[m.id] } });
```

**No icon ships with this package** — not bundled, not vendored, not an optional peer.
`icon` takes a `ReactNode`, so it is your `<svg>`, your icon-font element or your
character, from whatever set your design system already uses.

**The option is `presentation`, not `compact`.** `compact` already names the slot on
`DevToolbarExtension`, and two things called `compact` would be a vocabulary collision.

### Which text a preset selects

A bar chip usually has two texts: a hardcoded short word it paints in the bar
(`"a11y"`, `"env"`, `"overlays"`) and the configured `label`, which is its identity in
the `⋮` menu and in its accessible name. **Presets operate on the short bar word;
`label` stays the overflow and accessible-name identity.** The axis is
`"none" | "short" | "full"`, presets in the bar select `"short"`, and the overflow rule
forces `"full"` — so a preset can never leave a menu row wordless. `docs/styling.md`
[states the rule once](./styling.md#which-text-a-bar-control-paints); this is the
resolver's half of it.

| Preset | In the bar | In the `⋮` menu |
| --- | --- | --- |
| `"default"` | whatever that extension paints today | whatever that extension paints today |
| `"icon"` | icon | icon + **full text** |
| `"icon-value"` | icon + value | icon + full text + value |
| `"icon-label"` | icon + short word | icon + full text |
| `"label"` | short word | full text |
| `"value"` | value | full text + value |

Two guarantees live in `resolveCompactParts` and nowhere else, which is what makes them
hold once rather than nine times:

1. **An icon-only preset with no icon supplied paints text.** A blank control is worse
   than an unstyled one, and a function `icon` may return nothing for one control and a
   node for the next, so the guard is per control.
2. **The `⋮` menu always paints full text** under every preset, by construction.

**"No icon" means emptiness, not `undefined`.** `icon: (view) => view.enabled && <Icon />`
is an ordinary callback, and it returns `false` for a disabled control — so `false`,
`true`, `null`, `undefined` and `""` are all *no icon*, because React paints nothing for
any of them. That is `hasPaintableIcon`, one exported rule that the resolver, `Chip`'s
`icon` slot and the three hand-written controls (`/ext/agent`, `/ext/command-menu` and
`/ext/flags`' legacy `PromotedFlag.icon` glyph) all read, so a `&&` guard falls back to
text or to the control's own symbol rather than to an empty
`<span data-dtb-kind="glyph">` that still eats a `gap`. **`0` is an icon**: React renders
it as the character `0`, and a numeric badge is a legitimate one — so the rule is
emptiness, never truthiness.

The rule is those five **primitives**, and it stops there. An empty array, an empty
fragment and `[null]` are *nodes*, so they count as an icon and still paint the blank
glyph — as does a component that returns `null`, which no value test can detect without
rendering it. Recursing halfway would move the boundary without reaching it, so
`icon: () => undefined` is the supported way to say "no icon for this one", and
`icon: (view) => view.badges.map(…)` should return `undefined` rather than `[]` when
there is nothing to show.

**Sharp edge: the menu row drops the *value* under `"icon"` and `"label"`.** The
overflow rule forces the text on, never the value — so under `presentation: "icon"` a
metrics row in the `⋮` menu reads `Memory` where the default reads `Memory 53 MB`. That
is the table above read literally rather than a bug, and the fix is one word:
`"icon-value"` keeps the number in both places.

`"default"` is a member of the enum rather than an absence, and it resolves to `null`:
each extension reads `parts === null ? <today's tree> : <driven tree>`, which is what
makes "today's output is byte-identical" a structural property rather than a truth-table
coincidence. Today's rendering is not one thing across the nine — Group A is short word
plus value, `/ext/agent` is label-only, `/ext/command-menu` is a symbol plus a hotkey
hint — so a member named `"label-value"` would have been a lie for three of them.

### `render`, and what it may not take

`render` supplies the control's **children** and nothing else. The `<button>`, its
`type`, `aria-expanded`, `onClick`, `title`, any `role="switch"`/`aria-checked`, the
chip's dot, every `data-dtb-*` state attribute and the severity children an extension
paints after the contents — diagnostics' badge, environment's `impersonating` marker,
overlays' error tag — all stay the extension's, under every preset including `"icon"`.
**A preset changes text, not state.**

What a callback *does* own is the icon, the text and the value — the three parts a preset
selects — wherever the control is painted. `/ext/metrics`' `⋮` row is the one place that
takes explaining: its value span sits outside the chip rather than inside it, so the dot
and the severity attributes are out of reach, but the span is still dropped when a
callback painted. Otherwise `render: (m) => <b>{m.display} used</b>` would read
`48 MB used` in the bar and `48 MB used48 MB` in the menu.

```ts
interface CompactRenderContext {
  preset: CompactPreset;
  icon?: ReactNode;        // already resolved through a function icon
  isOverflowed: boolean;
  isPanelOpen: boolean;
  fallback: ReactNode;     // what the preset would have painted
}
```

`fallback` is an element tree rather than a rendered result, so building it costs
nothing when a callback ignores it — and it is the *same* construction the extension
paints when there is no callback, which makes `render: (_, ctx) => ctx.fallback` exact
rather than two pieces of markup kept in step:

```tsx
metrics({
  presentation: {
    preset: "icon-value",
    render: (metric, ctx) => (metric.severity === "bad" ? <Siren /> : ctx.fallback),
  },
});
```

Returning `undefined` falls through to the preset too, so a callback opts out per
control rather than per extension.

**A callback is honoured in the `⋮` menu as well as the bar**, with `ctx.isOverflowed`
as the hook. That is a deliberate inconsistency with the guarantee above: a preset is
the library's opinion and should be safe by construction, while a callback is you taking
the wheel, and silently discarding your output in one of the two places is a worse
surprise than a documented edge. The cost is real — a menu row painting no text is
announced by its `title` alone where the row is named by its content, as `/ext/metrics`'
per-metric rows are — so branch on `ctx.isOverflowed` and paint a word.
[ADR-004](./adr/ADR-004-per-extension-bar-presentation.md) records the deviation and
what reversing it would cost.

`name` overrides the control's `aria-label`; a whitespace-only return is ignored, so no
override can leave an icon-only control unnamed. `title` is **not** overridable — it
explains, it does not name. It is invoked **once per bar control**, exactly as `icon` and
`render` are: `/ext/metrics`' bar button is one control naming N metrics, so it resolves
against the first metric in bar order, while each `⋮` row *is* one metric and resolves
against its own. A row that gets no usable override is left with **no `aria-label` at
all** rather than an empty one — those rows are named by their content today, and whether
they should be named outright is the open decision ADR-004 records. `resolveNameOverride`
is the helper for a control in that position; `resolveAccessibleName` is the one for a
control with a name of its own to fall back to, and it is defined in terms of it, so the
whitespace rule is one rule.

**What the *fallback* name must contain is the extension's business, not kit's**, and
there is one rule it follows: the name contains the short bar word, because WCAG 2.5.3
Label in Name wants the word a speech-input user can see inside the name they can say.
Whatever the name does *not* carry — the visible readout — reaches a screen reader as the
control's **description**, and that is already the chip's `title`: an `aria-label`
replaces content rather than adding to it, but a browser with no `aria-describedby` to
follow describes a control by its `title`, and every first-party chip has one that states
its readout with more context than the value span does. An explicit `aria-describedby`
would *displace* that, so exactly one extension adds one — `/ext/metrics`, whose title
(`Runtime performance — click for details`) carries no readout at all; it points at its
own label and value spans, in pairs. Kit answers *which parts*; the value span, any `id`
on it and the `aria-describedby` are that extension's own DOM, which is why no helper here
has an opinion about them. See
[styling.md](./styling.md#the-name-carries-the-word-title-carries-the-readout).

### A factory option cannot be changed at runtime

`presentation` is fixed when the factory is called, exactly like `label`, `align` and
`injectStyles`. **Handing `<DevToolbar>` a newly built extension object for an id that
is already running does not reconfigure it.** Core keeps the first object's `start()`,
logs `extension "<id>" was rebuilt after it started`, and never starts the new closure —
so the bar renders a control wired to a runtime nobody is driving, and the symptom is a
chip that has simply stopped: `/ext/a11y`'s `axeVersion` goes null, metrics freeze.

To change presentation at runtime, remount the toolbar or reload the page:

```tsx
// `key` makes the flip what it really is: a config change. The shell unmounts,
// every extension is stopped, and the new objects are started.
<DevToolbar key={mode} extensions={extensionsFor(mode)} />
```

`examples/playground/src/App.tsx` is the worked example. This is the *other* side of
[the build-once rule](./extension-contract.md): the object
identity is the lifecycle.

### The narrowed option: agent and command-menu

`/ext/agent` and `/ext/command-menu` take
`Pick<CompactPresentation<TView>, "icon" | "name">` — the two knobs that act, and no
`preset` or `render`. Neither control has a value and neither has two texts, so there is
nothing to preset *against*: every member but `"default"` would be a no-op or a lie, and
a `render` callback over a view that never changes is a `ReactNode` with extra steps.

The narrowing is visible rather than silent. The bare-preset shorthand is a **compile
error** there, not an option that quietly does nothing:

```tsx
agentBridge({ presentation: "icon" });
// error TS2559: Type 'string' has no properties in common with type 'AgentPresentation'.

agentBridge({ presentation: { icon: <RobotIcon /> } }); // ✅
```

They stay a `Pick` of the shared interface rather than lookalikes of their own, so
`icon` and `name` mean there exactly what they mean on the other seven, and widening
later is additive.

### `Glyph`, and icons that are characters

```tsx
<Glyph data-dtb-part="build-icon">{icon}</Glyph>
```

A `<span data-dtb-kind="glyph">` that is `aria-hidden` by default — the name belongs to
the control, and an announced icon duplicates it — and that **clamps its direct child**
to `--dtb-glyph-size` (`1.15em`), because a 24px `<svg>` handed to an 11px bar would set
the bar's height. Pass `aria-hidden={false}` with a `role` and a name where the icon
*is* the name.

It is a standalone control and not only a `Chip` slot because three of the nine
first-party bar controls are hand-written and cannot route through `Chip`.

**A character needs no wrapper.** `icon` takes a `ReactNode`, and a string is the
cheapest icon there is; the glyph's own line box is `--dtb-glyph-size`, so a bare
`"▲"` sits in a real box and lines up with the `<svg>`s beside it. Wrap one in a
`<span>` only to clamp an oversized character — an emoji — since the clamp is
`[data-dtb-kind="glyph"] > *` and a bare text node is not an element for it to match.

### Writing your own bar control

The trigger is **your** element — a `<button>` (or a `<span>`, for a readout with no
panel) carrying `data-dtb-part="trigger"`, with kit controls *inside* it. Do not reach
for `<Action>` here; see [`Action` is a panel control](#action-is-a-panel-control).

An extension outside this package resolves the same option with the same helpers. Two
shapes it has to supply itself: `CompactParts` — `{ icon, text, value }`, where `text`
is the `"none" | "short" | "full"` axis rather than a boolean — and `CompactDefaults`,
the `{ bar, overflow }` pair naming what **your** `"default"` paints in each place.
This build chip paints its short word plus a value in the bar and the full label plus
the value in the `⋮` menu, which is what Group A does:

```tsx
const BAR_PARTS: CompactParts = { icon: false, text: "short", value: true };
const OVERFLOW_PARTS: CompactParts = { icon: false, text: "full", value: true };
```

```tsx
const presentation = resolvePresentation(options.presentation); // once, in the factory

compact: ({ isOverflowed, isPanelOpen, togglePanel }) => {
  const control = resolveCompactControl(presentation, view, {
    isOverflowed,
    defaults: { bar: BAR_PARTS, overflow: OVERFLOW_PARTS },
  });
  const fallback = (
    <Chip data-dtb-part="build-chip" severity={view.severity}>
      {renderCompactParts({
        parts: control.parts,
        icon: control.icon,
        iconProps: { "data-dtb-part": "build-icon" },
        short: "build",
        full: options.label,
        textProps: { "data-dtb-part": "build-label" },
      })}
      {control.parts.value ? <span data-dtb-part="build-value">{view.commit}</span> : null}
    </Chip>
  );
  return (
    <button
      type="button"
      data-dtb-part="trigger"
      aria-expanded={isPanelOpen}
      aria-label={resolveAccessibleName(presentation.name, view, options.label)}
      onClick={togglePanel}
    >
      {renderCompact(presentation, view, { icon: control.icon, isOverflowed, isPanelOpen }, fallback)}
    </button>
  );
};
```

`resolveCompactControl` is the one to reach for: it composes `resolveIcon` and
`resolveCompactParts`, owns the `hasPaintableIcon` guard per control, and takes
**your** `"default"` parts as `defaults`, because `"default"` means *whatever this
extension renders today* and the kit cannot know what that is for you. Its output
guarantees that `parts.icon` implies a paintable icon — which is
`renderCompactParts`' precondition, so take `parts` from there rather than assembling
them by hand.

`renderCompactParts` stops at the icon and the text. The value span, its
`data-dtb-severity` and any state child after it stay yours: the kit answers *which
parts*, the extension paints the DOM. And nothing here may enter a store snapshot — a
`ReactNode` cannot be signed, so icons and callbacks belong in the factory closure and
travel as props, exactly as `label` and `injectStyles` do.

---

## Importing it

Extensions **value-import the kit by package specifier**:

```ts
import { Chip, useExtensionSurface } from "@nejcm/dev-toolbar/kit";
```

Never `../../kit`. The CJS build does not code-split, so a relative value import is
inlined into every extension bundle that reaches it — seven copies of a shared
stylesheet string, which would make the whole package a net loss. The bare specifier
resolves to the host's one copy in both formats, the same trick `src/testing/` uses for
core. `import type` from core stays relative, because types erase.
`src/core/__tests__/boundary.test.ts` guards both halves.

`src/testing/` never depends on the kit, in either direction: `installClipboard()` stubs
`writeClipboardText`'s effect rather than rendering a `CopyButton`, so a consumer can
take the test helpers without the kit.

## What is deliberately not here

**Nothing that wraps `redact()`.** Redaction is a per-extension decision about that
extension's own data, and a convenience wrapper here would be read as "the kit handles
that for you" — which is exactly the belief
[architecture.md](./architecture.md) §10 warns against. Call `redact()` from
[`/runtime`](./runtime.md) yourself, on your own data, where you can see what you are
masking.

**No thresholds, no adapters, no colour model.** The shell ships no opinions about what
a number means, and the kit inherits that. Tier B is the one place opinion lives, and it
is core's opinion — the `--dtb-*` tokens — collected into one sheet rather than a new
one invented.

---

[Documentation index](./README.md)
