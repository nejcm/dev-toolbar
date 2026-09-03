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

**3. `classNames`.** A narrow map for putting your own class on a part:

```tsx
<DevToolbar classNames={{ bar: "my-bar", panel: "my-panel" }} extensions={…} />
```

None of it needs `!important`. Core's stylesheet lives entirely inside
`@layer dev-toolbar`, and unlayered author CSS beats any layered rule regardless of
specificity — a one-class selector of yours overrides core's two-attribute selector.

Because the bar is light DOM, an extension can also just use Tailwind, styled
components, or your design system, and it renders the way it does everywhere else.
[docs/architecture.md](./architecture.md#4-style-api).


---

[Documentation index](./README.md)
