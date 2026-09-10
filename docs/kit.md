# `@nejcm/dev-toolbar/kit`

The vocabulary and the glue for writing an extension. Types every extension would
otherwise re-declare, non-React helpers every extension would otherwise re-implement,
one shared stylesheet, and a set of thin React controls that render the markup an
extension writes by hand anyway.

The seven first-party extensions with a UI consume it, and a third-party extension
consumes it identically — which is the point. Writing something that looks native
stops being a few hundred lines of copied CSS.

```ts
import {
  // types
  type Severity,
  type SeverityWithOverride,
  type Readable,
  type ReadableStore,
  type Source,
  type Input,
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
  Note,
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
| Bar presentation | `Glyph`: 0; `resolveCompactParts`: 0; `resolvePresentation`: 0; `resolveIcon`: 0; `resolveAccessibleName`: 0 | Every bar control a consumer can restyle resolves its `presentation` option through the same four pure helpers, so the two guarantees — an icon-only preset with no icon paints text, and the `⋮` menu always paints full text — hold once rather than nine times. `Glyph` is a standalone control rather than only a `Chip` slot because three of the nine bar controls are hand-written on purpose and cannot route through `Chip`; it owns the `aria-hidden` default and the direct-child clamp that keeps a 24px `<svg>` from setting the bar's height. `resolveIcon` and `resolveAccessibleName` serve the seven value-bearing extensions; agent and command-menu take an icon only. Third-party authors are the other half of the point: the vocabulary is what lets somebody else's extension present like a first-party one. Every count is **0** today, and honestly so: the vocabulary landed first, on its own, so the resolver's truth table could be pinned before any extension read it. The counts here are measured, never predicted, and get their real values as the rollout wires each bar control up. |
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
readPreference<T>(storage, preference: Preference<T>): T;
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

A **preference** is a named, validated, persisted value: three operations and two
encodings, deliberately nothing more. `readPreference` returns the stored value when
it passes `isValue`, else `fallback`. `writePreference` stores the value — or removes
the key when the value equals `fallback`, so storage holds only what differs from the
fallback. A preference whose default is consumer-configurable — overlay toggles under
`defaults`, the theme editor's `surfaces[0]` — sets `fallback: null`, so an explicit
choice persists even when it matches that default. `removePreference` drops the key.
`storage` is `api.storage` from `start(api)`, or `null`/`undefined` before `start()`
has run; every operation tolerates that and a throwing adapter alike — a browser with
site data blocked, a full quota, a sandboxed iframe — by returning the fallback or
doing nothing. A storage adapter is consumer code, and a preference must never take
down a panel or a click handler.

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
| `glyph` | a centring inline-flex box with `line-height: 0`, clamping its direct child to `--dtb-glyph-size` | `<Glyph>`, `<Chip>`'s icon slot |
| `label` | muted text | `<Row>`'s `<dt>`, opt-in on `<Chip>` |
| `value` | the mono font | `<Chip>`'s value slot, `<Row>`'s `<dd>` |
| `action` | the ten-declaration button reset, plus `:hover:not(:disabled)` | `<Action>`, `<CopyButton>` |
| `note` | `margin: 0` and muted colour | `<Note>`, `<Field>`, `<CopyButton>`'s status span |
| `tag` | a small padded inline marker, one step down in size | `<Tag>` |
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
| `<Chip>` | `<span>` + dot/label/value | the compact-slot summary |
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
  label="env"
  value={kind}
  severity={snapshot.severity}
  data-dtb-part="env-chip"
  dotProps={{ "data-dtb-part": "env-dot" }}
  labelProps={{ "data-dtb-part": "env-label", "data-dtb-kind": "label" }}
  valueProps={{ "data-dtb-part": "env-value" }}
>
  {snapshot.impersonating ? <span data-dtb-part="env-alert">impersonating</span> : null}
</Chip>
```

A dot, a label, an optional value, and whatever `children` append. Each slot takes its
own props so a site keeps its part names. The dot and value carry a `data-dtb-kind` by
default; the label does not, because most sites leave it unstyled — pass
`labelProps={{ "data-dtb-kind": "label" }}` to opt in, or `"data-dtb-kind": undefined`
on the others to opt out.

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
