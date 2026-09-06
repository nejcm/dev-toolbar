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
  // helpers, no React
  parseRecord,
  parseList,
  readJson,
  writeJson,
  createPoller,
  createStyleInjector,
  ensureKitStyles,
  resolveStyleNonce,
  matchesQuery,
  KIT_CSS,
  // React
  useExtensionSurface,
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
| Persisted state | `readJson`: 0; `writeJson`: 0; `parseList`: 1; `parseRecord`: 2 | The JSON helpers keep guarded parsing and the storage guard and failure policy in one place. `parseList` serves the command menu's persisted recents; `parseRecord` serves the flag and theme-editor override maps. |
| Key/value readout | `Rows`: 2; `Row`: 2 | `Rows` is `Row`'s container half. The `<dl>` grid needs the fragment-shaped `<dt>`/`<dd>` pair to be usable. |
| Inputs | `SearchField`: 2; `TextInput`: 2; `Select`: 2 | They are the kit's input set. Core's `:where(input, select, textarea)` rule supplies field geometry, while the `field` and `search` kinds give authors a stable pair of hooks covering all three. |
| Copy actions | `CopyButton`: 2; `useCopyStatus`: 2 | `CopyButton` owns the button/status-region pairing. `useCopyStatus` is the shared status state for panels with several copy buttons. |
| Filtering | `matchesQuery`: 2 | It is the string-level predicate shared by the flags and theme-editor view wrappers. |
| Labelled control | `Field`: 1 | It names the wrapping-label pattern that associates a control without generating or synchronising an `id`. |

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
parseRecord<T>(raw: string | null, isValue: (v: unknown) => v is T): Record<string, T>;
parseList<T>(raw: string | null, isValue: (v: unknown) => v is T, limit?: number): T[];
readJson<T>(storage, key, fallback: T, guard: (v: unknown) => v is T): T;
writeJson(storage, key, value: unknown): void;
```

`parseRecord` is the "read a map of overrides back out of storage" function
`/ext/flags` and `/ext/theme-editor` had each written, and `/ext/command-menu` had in
its array form: try/parse, reject `null`, arrays and non-objects, keep only guarded
values, and hand back a **null-prototype** object. That last part is the decision
worth centralising — a persisted `__proto__` key has to round-trip as data,
and `in` and lookup have to behave the same on every path.

`parseList` is the array form, with an optional `limit` applied after filtering.
`readJson`/`writeJson` sit one level up, over a `ToolbarStorage` — `api.storage` from
`start(api)` is one — and never throw: a full quota, a serialisation cycle or a
storage adapter that refuses all return the fallback or do nothing.

```ts
const isFlagValue = (v: unknown): v is FlagValue =>
  typeof v === "boolean" || typeof v === "string" || typeof v === "number";

const overrides = parseRecord(storage.getItem("overrides"), isFlagValue);
```

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

The one hook. It subscribes a component to a
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
| `field` | **nothing** — a hook only, see below | `<TextInput>`, `<Select>` |

Fifteen kinds, and `field` is the one the kit styles nothing for; the other fourteen
each get rules from `KIT_CSS`.

`row`, `list` and `toolbar` have no control because there is nothing for one to do:
they are a `<div>`, a `<ul>` and a `<div>` with an attribute on them. Add the attribute
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
