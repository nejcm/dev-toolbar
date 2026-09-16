# `@nejcm/dev-toolbar/ext/theme-editor`

Live design-token editing. Edit the custom properties your application already
publishes, see the application's own value next to your edit, and take the result away
as CSS, as a versioned recipe, as a design-tokens export or as a link.

```tsx
import { themeEditor } from "@nejcm/dev-toolbar/ext/theme-editor";

// Once, at module scope. Not inside render.
const extensions = [
  themeEditor({
    tokens: [
      { name: "--brand-500", label: "Brand", group: "Colour", type: "color" },
      { name: "--radius-md", group: "Shape", type: "length", defaultValue: "8px" },
      { name: "--type-scale", group: "Type", type: "number", defaultValue: "1" },
    ],
    // Which surface each edit is written to. Defaults to `:root` only.
    surfaces: [
      { id: "root", label: "Whole application", selector: ":root" },
      { id: "checkout", label: "Checkout only", selector: "[data-area=checkout]" },
    ],
  }),
];
```

**The tokens are yours.** This extension owns no design system and generates no
palette. `value` is optional: leave it out and the application's own value is read off
the surface with `getComputedStyle`, captured *before* the edit lands so the panel can
keep showing it. Supply `onApply` if you also want the edit mirrored into your own
theme provider; the live preview happens either way.

Types are `color`, `length`, `number` and `string`. A `number` or `length` that does not
parse is **refused with the draft kept**, never coerced — the `/ext/flags` rule. A
`color` gets a swatch, and a native picker when the current value is hex.

## It changes what your app looks like

So it behaves like `/ext/flags`, which changes what your app *does*:

- **Edits persist** under `dtb:v1:<instanceId>:ext:<id>:overrides` and are re-applied
  on the next mount. `readStoredThemeOverrides()` reads them before you render, if your
  own theme object needs to agree with the panel on the first paint. It applies the same
  vetting the panel does — `localStorage` is writable by anything on the origin — so pass
  it the same `tokens` (and `mask`, if you changed it) to get exactly the map the panel
  will keep. Without `tokens` every value is checked as a `string`, the loosest type: the
  whole security pass still runs, but a value your catalogue declares as a `number` or
  `length` and would refuse as one survives.
- **Edits outlive a restart a consumer-supplied adapter cannot serve.** With
  `persist: true`, edits live only in the session map when that adapter's `getItem`
  throws, and toggling the toolbar off and on keeps them: an unreadable result does not
  replace the live map. The default `localStorage` adapter reports blocked site data
  as empty instead; [the architecture note](../architecture.md#3-state-storage-and-lifecycle)
  records that distinction and its lifecycle limit. `persist: false` is the deliberate
  exception and resets the edit map on every `start()`; the preview toggle and surface
  choice remain session state across a restart.
- **There is a kill switch.** Any page loaded with `?dtb-theme=reset` drops every edit
  *before* any of them is applied, because the edit that makes the page unreadable is
  the one you cannot see the panel to remove.
- **Reset is exact.** The inline value each property held before the extension touched
  it — priority included — is restored, and a `style` attribute the extension created
  is removed rather than left empty. Same on teardown, unconditionally.
- **Preview: off** holds every edit back without discarding it, which is the
  before/after comparison. Turning it back on re-applies through the same path.
- **An edit the catalogue no longer declares still gets a row.** It is still being
  written to your page, so it is shown, tagged and clearable.
- **Hiding the bar does not revert anything.** Deliberately unlike `/ext/overlays`: an
  edit is a state you chose, not a drawing.

## It cannot restyle the toolbar

The bar is styled from `--dtb-*` and publishes `--dev-toolbar-height`, and the default
surface `:root` is an ancestor of the portalled toolbar root — so those names are
**never written**, whatever you declare. A token that carries one gets a row saying
why. Restyling the bar is a supported thing to want; do it from your own stylesheet
([Styling](../styling.md)), which needs nothing from this extension.

A surface whose selector resolves inside a `[data-dev-toolbar]` subtree is refused for
the same reason.

## Sharing and importing

Four outputs, all built from one already-redacted snapshot:

| Format | For |
| --- | --- |
| CSS variables | Pasting into your stylesheet |
| Recipe JSON | Re-importing here, or committing |
| Design tokens (`$type`/`$value`) | Figma Variables and other W3C design-tokens importers |
| Share link | `?dtb-theme=<recipe>` on the current URL |

A pasted recipe, a `preset` you supply, and a link all go through the **same** filter:
only token names your current catalogue declares, and only values the editor itself
would accept — which is what keeps `url(...)` in somebody's link from making your page
fetch from their host. Anything dropped is counted and named.

Presets are `ThemeRecipe`s **you** compute, which is where a palette generator belongs:

```ts
themeEditor({
  tokens,
  presets: [
    { schemaVersion: 1, name: "High contrast", mode: "light", surface: "root",
      overrides: generateScale("#0b7285"), createdAt: new Date().toISOString() },
  ],
  // The app's own colour mode. Report-only without `set`.
  mode: { read: () => myTheme.mode, set: (next) => myTheme.setMode(next) },
});
```

## What it does with your data

Token values reach a clipboard, a file and a URL, so `redact()` runs on the way **in**
and the panel and every export read the same masked snapshot. Two rules are specific to
tokens:

- **A colour, a length and a number are never masked by their name.** Token names are
  descriptive English, so `--session-panel-bg` collides with the credential word list
  routinely — and masking it would hide the token you most need to see. Those types are
  matched on the *value's* shape only, which still masks a `Bearer …`, a JWT or a URL
  carrying a token in its query. A free `string` token is matched on its name as well,
  and `sensitive: true` masks anything.
- **A masked value never round-trips.** The editor starts empty with a placeholder
  rather than seeded, and the recipe and share link **omit** masked tokens with a stated
  count rather than carrying `[redacted]` into a document something is going to apply.

A token's `description` and its `group` are redacted the same way, once, so the panel
and the Figma export read the same strings — with the honest limit that `redact()`
matches value *shapes* anchored to the whole string, so a credential buried
mid-sentence in your own prose survives.

The recipe JSON and the share link are built by one function and carry the **raw**
values, masked ones omitted with a count. They deliberately get no second
key-matching pass, for the reason above: masking `--session-panel-bg` in a document
something is about to apply is how a theme stops round-tripping.

Persisted edits are re-checked on load rather than trusted: `localStorage` is writable
by anything on the origin, and an unchecked custom-property value is accepted by the
CSSOM almost verbatim. Anything refused is dropped, counted in the panel, and removed
from storage. The surface selector is checked before it is printed into exported CSS,
for the same reason.

Use `redactOptions: { allowKeys: ["..."] }` if the default list is masking a token of
yours that is not a secret.

Options: `tokens`, `onApply`, `surfaces`, `presets`, `mode`, `pollMs`, `redactOptions`,
`themeParam`, `persist`, `now`, `document`, `createdBy`,
`presentation` (see [Bar presentation](#bar-presentation)), plus the usual `id` / `label` /
`align` / `order` / `priority` / `hidden` / `keepMounted` / `injectStyles` /
`styleNonce`.

Commands: `theme-editor.preset.<name>` (one per preset, enumerated live),
`theme-editor.reset`, `theme-editor.togglePreview`, `theme-editor.copyCss`,
`theme-editor.copyRecipe`, `theme-editor.copyFigma`, `theme-editor.copyLink`,
`theme-editor.refresh` — plus `theme-editor.setToken`,
[contract v2](../extension-contract.md#contract-v2--commands-with-input-and-a-result)'s
addition:

```ts
await api.invokeCommand("theme-editor.setToken", { name: "--brand-500", value: "#3b82f6" });
await api.invokeCommand("theme-editor.setToken", { name: "--brand-500" });  // clears it
```

This is the command that could not exist before v2. A token's value space is open —
`#3b82f6`, `12px`, `1.4` — so no enumeration of per-value commands was ever possible
and the panel's text input was the only way in. It refuses the same values the editor
refuses, and says which; it declares `input`, so `⌘K` does not list it.


## Bar presentation

```tsx
themeEditor({ presentation: { preset: "icon-value", icon: <PaletteIcon /> } });
```

`presentation` changes how the bar control looks, never what it edits.
The four knobs — a preset, your own `ReactNode` icon, a `render` callback and an
accessible-name override — the preset-by-preset table and the rules every extension
shares are in [kit.md](../kit.md#presentation). Two of those rules are worth repeating
before the specifics: `"default"` is byte-identical to what shipped before the option
existed, and `presentation`, like every factory option, is **fixed when the factory is
called** — to change it at runtime, remount the toolbar or reload.

What is specific to this extension:

- **The short bar word is `theme`**, and `"default"` paints it in both the bar and the
  `⋮` menu, because that is what this chip has always shipped. Any preset still forces
  the full `label` in the menu. The icon lands in `data-dtb-part="thm-icon"` and the word
  in `thm-label`.
- **The callbacks are handed a narrow `ThemeEditorBarView`** — `tokenCount`,
  `overriddenCount`, `preview`, `supplied`, `writable` — rather than the whole
  `ThemeSnapshot`. A type that is only *read* may gain and lose optional fields freely;
  as a callback parameter it is contravariant, so the token list, the groups and the
  apply errors are deliberately not in it.
- **`mode` (`"light" | "dark" | null`) is deliberately not in that view yet**, even
  though it is the obvious input for a sun/moon icon. It is a recorded omission rather
  than an oversight: the view was cut to the five facts the chip itself paints, and
  adding a field to a view a consumer only *reads* is additive and safe. If you want to
  branch an icon on the mode, say so — it can land in a minor release without breaking a
  callback.
- **This chip colours its own dot** from `data-dtb-edited` and `data-dtb-preview` rather
  than from a kit `severity`, and its count opts out of the kit's `value` kind. Both are
  state, written on the chip above whatever children you supply, so no preset and no
  `render` can change the colour the bar is showing you — only the words next to it.

---

[Documentation index](../README.md) · [Extension contract](../extension-contract.md) · [Runtime](../runtime.md)
