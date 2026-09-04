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

**2. `data-dtb-part` attributes.** Every part carries one — `root`, `bar`, `region`,
`item`, `trigger`, `overflow-button`, `overflow-menu`, `overflow-menu-item`,
`overlay`, `panel`, `panel-resizer`, `panel-body`, `error-chip`, `error-retry`,
`inset`.

Core owns the unprefixed names. An extension that ships its own CSS namespaces its
parts *by kind* — `/ext/metrics` uses `metrics-chip`, `metrics-panel` and so on for
every instance, whatever `id` you give it, so one rule styles them all. To reach a
single instance, use the `data-dtb-ext-id` on the surrounding item. Severity colours
come from `--dtb-ok`, `--dtb-warn` and `--dtb-danger`, so overriding one token
restyles every extension's severity at once.

`data-dtb-part` identifies the exact part; `data-dtb-kind` identifies its shared kind,
such as `action`, `chip`, `note` or `value`. `KIT_CSS`, exported from
`@nejcm/dev-toolbar/kit`, styles those kinds and can be shipped once in a combined
manual stylesheet. One kind is deliberately not among them: `field`, which `TextInput`
and `Select` emit, is a hook for selecting a kit form control, not a promise of a kit
rule — core already owns field geometry through its `:where(input, select, textarea)`
rule, so the kit adds nothing on top. That core rule skips `type="color"` and
`type="checkbox"`, so a `<TextInput type="color">` carries `data-dtb-kind="field"`
while getting neither core's treatment nor a kit one. First-party `*_CSS` strings
include `KIT_CSS` deliberately so each one remains self-contained; combining several repeats that shared prefix. The kit
sheet uses `@layer dev-toolbar`, so unlayered consumer overrides still win.

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

## CSP

Under `style-src 'self' 'nonce-…'`, an un-nonced `<style>` is dropped silently — the
bar renders, unstyled, with nothing in the console but a CSP report. Pass the nonce
as `styleNonce` on `<DevToolbar>`. Core stamps it on its own sheet and forwards it to
every slot, so first-party extensions pick it up automatically.

A per-factory `styleNonce` option overrides the slot prop when a host's extension
sheets need a different nonce, or when an extension injects outside a slot. The nonce
is applied only when a sheet is created (first-writer-wins). `injectStyles={false}`
skips core's injection; each extension has its own `injectStyles` switch. Extensions
using the shared kit stylesheet inject it through that same switch.

---

[Documentation index](./README.md)
