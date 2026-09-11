# Styling the toolbar

**1. `--dtb-*` tokens.** Set them anywhere above the bar:

```css
[data-dev-toolbar] {
  --dtb-bg: #120b1f;
  --dtb-fg: #f4e9ff;
  --dtb-accent: #ff7ac6;
  --dtb-bar-height: 40px;
}
```

**2. `data-dtb-part` and `data-dtb-kind` attributes.** Two attributes, two jobs.
`data-dtb-part` says *which* part this is; `data-dtb-kind` says *what sort of thing* it
is. Most elements in a panel carry both, and you can target either.

```html
<p data-dtb-part="env-note" data-dtb-kind="note">…</p>
```

*Parts* are the precise hooks. Core owns the unprefixed names — `root`, `bar`, `region`,
`item`, `trigger`, `overflow-button`, `overflow-menu`, `overflow-menu-item`, `overlay`,
`panel`, `panel-resizer`, `panel-body`, `error-chip`, `error-retry`, `inset`. An
extension that ships its own CSS namespaces its parts *by kind of extension* —
`/ext/metrics` uses `metrics-chip`, `metrics-panel` and so on for every instance,
whatever `id` you give it, so one rule styles them all. To reach a single instance, use
the `data-dtb-ext-id` on the surrounding item.

*Kinds* are the shared vocabulary: `action`, `chip`, `dot`, `glyph`, `label`, `value`,
`note`, `tag`, `row`, `rows`, `stack`, `list`, `empty`, `banner`, `search`, `toolbar`,
`field`. They are shared across extensions on purpose, so one rule of yours reaches
every panel button or every key/value grid at once — something part names, being namespaced, cannot do. `KIT_CSS`,
exported from [`@nejcm/dev-toolbar/kit`](./kit.md), is the stylesheet that styles them.

```css
[data-dev-toolbar] [data-dtb-kind="action"] { border-radius: 2px; }   /* every panel button */
[data-dev-toolbar] [data-dtb-part="metrics-chip"] { font-weight: 600; }  /* just metrics' chip */
```

One of those seventeen is deliberately unstyled: `field`, which the kit's `TextInput`
and `Select` emit, is a hook for those two generic controls, not every kit input and not a
promise of a kit rule. `SearchField` emits `search`; a kind is single-valued, so use
`:is([data-dtb-kind="field"], [data-dtb-kind="search"])` to select all three. Core
already owns field geometry through its `:where(input, select, textarea)` rule, so the
kit adds nothing on top. That core rule skips `type="color"` and `type="checkbox"`, so
a `<TextInput type="color">` carries `data-dtb-kind="field"` while getting neither
core's treatment nor a kit one.

Those element-level rules — the `:where(input, select, textarea)` geometry, the
`:where(button)` face, `box-sizing` on `*` — apply to everything under the root
*except* a subtree marked `data-dtb-embed`, which is how a third-party devtool keeps
its own look inside a panel; [embedding.md](./embedding.md#the-stylesheet-rule-theirs-is-theirs)
has the details.

**Severity** is a third attribute, `data-dtb-severity`, carrying `unknown`, `ok`,
`warn`, `bad` or `override`. The kit's rules pair it with a kind **on the same
element** — never as a descendant selector — so a container carrying a severity does
not tint what is inside it:

```css
[data-dev-toolbar] [data-dtb-kind="dot"][data-dtb-severity="warn"] { background: var(--dtb-warn); }
```

Borders and text come from `--dtb-ok`, `--dtb-warn` and `--dtb-danger` (and
`--dtb-accent` for `override`), so overriding one of those restyles every extension's
severity borders and text at once. Banner grounds are their own tokens —
`--dtb-ok-bg`, `--dtb-warn-bg`, `--dtb-danger-bg`, and `--dtb-item-active-bg` for
`override` — so a full re-tint means overriding both halves.

`data-dtb-tone` is older, extension-local vocabulary rather than part of the kit.
Flags banners retain `error` and `warn` alongside kit severity. Theme-editor banners
use `error`, `warn` and `info`, interpreted only by its own stylesheet. New extensions
should use `data-dtb-kind` with `data-dtb-severity` instead.

**Delivery.** The kit sheet is injected through each extension's own `injectStyles`
switch, so it arrives with the extension that uses it. If you deliver CSS yourself,
`KIT_CSS` is exported so you can ship it once in a combined stylesheet; each first-party
extension's exported `*_CSS` string embeds its own copy deliberately, so hand-shipping
one string still yields a styled panel, and combining several simply repeats that shared
prefix.

**3. `classNames`.** A narrow map for putting your own class on a part:

```tsx
<DevToolbar classNames={{ bar: "my-bar", panel: "my-panel" }} extensions={…} />
```

None of it needs `!important`. Core's and the kit's stylesheets live entirely inside
`@layer dev-toolbar`, and unlayered author CSS beats any layered rule regardless of
specificity — a one-class selector of yours overrides their attribute selectors.

Because the bar is light DOM, an extension can also just use Tailwind, styled
components, or your design system, and it renders the way it does everywhere else.
[docs/architecture.md](./architecture.md#4-style-api).

## Icons on the bar

Every first-party extension takes a `presentation` option that accepts your own
`ReactNode` icon — no icon set ships with this package. Whatever you pass lands in a
wrapper carrying `data-dtb-kind="glyph"`, next to a part name the extension owns
(`metrics-icon`, `flag-promoted-icon`, `cmd-icon`, and so on for all nine), so both
hooks are there:

```css
[data-dev-toolbar] { --dtb-glyph-size: 1.35em; }                       /* every glyph */
[data-dev-toolbar] [data-dtb-part="metrics-icon"] { color: var(--dtb-accent); }
```

`--dtb-glyph-size` is a variable the kit sheet **reads and never declares**, which is
why it is absent from the token table in
[architecture.md](./architecture.md#41---dtb--tokens): nothing sets it, the sheet falls
back to `1.15em`, and setting it is how you change it. The `em` unit is the point — it
inherits `--dtb-font-size`, so glyphs track the density switch (11px compact, 12px
comfortable) with no token of their own.

The wrapper sets its line box to that length and clamps its **direct child** to it,
because a 24px `<svg>` handed to an 11px bar would otherwise set the bar's height.
Spacing between an icon and the word beside it is the chip's `--dtb-chip-gap`, never a
margin of yours.

**A character is an icon too**, and it needs no wrapper: the glyph's own line box gives
a bare `"▲"` a real box, so it lines up with the `<svg>`s beside it. Wrap a character in
a `<span>` only to clamp an oversized one — an emoji — since the clamp is
`[data-dtb-kind="glyph"] > *` and a bare text node is not an element for it to match.

## Which text a bar control paints

A bar chip usually has two texts: a hardcoded short word it paints in the bar (`"a11y"`,
`"env"`, `"overlays"`) and the `label` you configured, which is its identity in the `⋮`
overflow menu and in its accessible name. **A `presentation` preset operates on the
short bar word; `label` stays the overflow and accessible-name identity.** The axis is
`"none" | "short" | "full"`: presets in the bar select `"short"`, and the overflow rule
forces `"full"`, so a preset can never leave a menu row wordless.

That is the whole rule, and it is stated once here. The preset-by-preset table, the
sharp edge where a menu row keeps the word but drops the *value*, and what a `render`
callback may and may not take are in
[kit.md](./kit.md#presentation); each extension's own page in [ext/](./ext/) names the
short word it paints and the parts its icon and text land in.

## Under a host reset

The same contract cuts the other way, and it is the thing most consumers meet: **a CSS
reset is unlayered too**, so Tailwind's Preflight — `button, input, optgroup, select,
textarea { padding: 0; color: inherit }` — beats every layered rule core and the kit
declare. Controls flatten: no padding, no hover background, inherited muted text.

Nothing about this is special to hand-written extension CSS. A control from
[`/kit`](./kit.md) needs exactly the same armour, because `KIT_CSS` sits in the same
`@layer dev-toolbar` core's sheet does. The remedy is one unlayered block on your side,
keyed on the two attributes that mean "the toolbar owns this element":

```css
[data-dev-toolbar] :is([data-dtb-part], [data-dtb-kind]) {
  margin: revert-layer;
  padding: revert-layer;
  background-color: revert-layer;
  font-size: revert-layer;
  line-height: revert-layer;
  letter-spacing: revert-layer;
  color: revert-layer;
  list-style: revert-layer;
}
```

`revert-layer` resolves to whatever `@layer dev-toolbar` would have produced for that
element in that state, so hover and `[aria-expanded="true"]` come back without being
restated and keep tracking core. The full block, the border half of it, and why
reverting is safe are in
[architecture.md](./architecture.md#4-style-api);
`examples/playground/src/playground.css` carries it verbatim.

## CSP

Under `style-src 'self' 'nonce-…'`, an un-nonced `<style>` is dropped silently — the
bar renders, unstyled, with nothing in the console but a CSP report. Pass the nonce
as `styleNonce` on `<DevToolbar>`. Core stamps it on its own sheet and forwards it to
every slot, so first-party extensions pick it up automatically.

A per-factory `styleNonce` option overrides the slot prop when a host's extension
sheets need a different nonce, or when an extension injects outside a slot. That rule
is one published function — `resolveStyleNonce(option, slot)` from
[`@nejcm/dev-toolbar/kit`](./kit.md#csp) — so your own extension can state the same
policy rather than re-derive it; an empty option defers to the slot rather than blanking
the host's nonce. The nonce is applied only when a sheet is created
(first-writer-wins). `injectStyles={false}` skips core's injection; each extension has
its own `injectStyles` switch. Extensions using the shared kit stylesheet inject it
through that same switch.

---

[Documentation index](./README.md)
