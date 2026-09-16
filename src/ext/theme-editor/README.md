# `ext/theme-editor`

Live design-token editing, with the app's own value shown next to your edit, and
CSS, a versioned recipe, a design-tokens export or a share link on the way out.

- **Subpath:** `@nejcm/dev-toolbar/ext/theme-editor`
- **Factory:** `themeEditor(options?)` → `DevToolbarExtension`
- **Full documentation:** [docs/ext/theme-editor.md](../../../docs/ext/theme-editor.md)

```tsx
const extensions = [
  themeEditor({
    tokens: [
      { name: "--brand-500", label: "Brand", type: "color", group: "Colour" },
      { name: "--radius-md", type: "length", defaultValue: "8px" },
    ],
  }),
];
```

## Files

| File | What is in it |
| --- | --- |
| `index.tsx` | The factory, the export commands, the preset commands, the refusal messages |
| `runtime.ts` | Token resolution, the edit model, persistence, exports and the share link |
| `ui.tsx` / `css.ts` | The chip, the panel, the editors and the group layout |
| `types.ts` | Token descriptors, the value grammar and `describeValueRefusal()` |

## The tokens are yours

This extension owns no design system and generates no palette. You hand it the
custom properties your app publishes; it edits them in place and hands the edit
back as CSS, a recipe, a design-tokens export or a link.

- **Kill switch.** Edits persist under
  `dtb:v1:<instanceId>:ext:<id>:overrides` and reapply on the next mount.
  `?dtb-theme=reset` drops them before any are applied, so a broken edit is
  recoverable even when it makes the panel unreadable.
- **A throwing consumer adapter does not wipe the session.** Under `persist: true`
  the stored map replaces the live one only when `getItem` actually returned. A
  `stop()`/`start()` with an adapter supplied through the toolbar's `storage` prop
  keeps the edits after a read throws. The default `localStorage` adapter reports
  blocked site data as empty instead;
  [§3 of the architecture](../../../docs/architecture.md#3-state-storage-and-lifecycle)
  records that distinction and its lifecycle limit. `persist: false` resets on every
  `start()`, deliberately. `__tests__/runtime.test.ts` pins both.
- **Exact reversal.** Edits are inline custom properties on the surface element.
  Prior values are recorded and restored, and an element with no original
  `style` attribute ends up with none — `setProperty` then `removeProperty`
  would otherwise leave a stray `style=""`.
- **Cannot restyle the toolbar.** `--dtb-*` and `--dev-toolbar*` are refused in
  code, regardless of what a consumer declares.

Everything that leaves — panel, exports, share link, clipboard commands,
`/ext/diagnostics` — reads one snapshot redacted on the way *in*. There is no
unmasked path.

## Deliberately out of scope

No palette generation from base/accent/contrast, no OKLCH delta model, no Figma
plugin — only the deterministic export half of that pipeline. Each omission is
stated in-panel next to the feature it would have belonged to.

## Commands

`<id>.setToken`, `<id>.reset`, `<id>.refresh`, `<id>.togglePreview`,
`<id>.preset.<name>`, `<id>.copyCss`, `<id>.copyRecipe`, `<id>.copyFigma`,
`<id>.copyLink`.

## Options that change behaviour

`tokens`, `surfaces`, `presets`, `mode`, `persist`, `themeParam`, `createdBy`,
`pollMs`, `redactOptions`.

`presentation` changes how the bar control looks, not what it edits: a
`CompactPreset`, your own `ReactNode` icon (or `(view) => ReactNode`), a
`render` callback and an accessible-name override. It resolves through `/kit`'s
`resolveCompactControl`, so `"default"` is byte-identical to what shipped
before the option existed. **Presets operate on the short bar word
(`"theme"`)**; `label` stays the accessible-name identity, and a preset in the
`⋮` menu swings to it — `"default"` paints `"theme"` in both places, because
that is what this chip has always shipped.

The callbacks are handed a narrow `ThemeEditorBarView` — `tokenCount`,
`overriddenCount`, `preview`, `supplied`, `writable` — rather than the whole
`ThemeSnapshot`. A view type that is only read can gain and lose fields freely;
as a callback parameter it is contravariant, so the token list, the groups and
the apply errors are deliberately not in it.

`mode` (`"light" | "dark" | null`) is **also** left out, and that one is a
decision rather than a consequence: it is the obvious input for a sun/moon icon,
and the argument against it is only that the view was cut to the five facts the
chip itself paints. A consumer's callback *reads* this type, so adding a field is
additive and safe in a minor release — the contravariance cost is paid by
renaming or removing one, not by adding. Left out until somebody asks.

This chip **colours its own dot** from `data-dtb-edited` and `data-dtb-preview`
rather than from a kit `severity`, and its count opts out of the kit's `value`
kind. Those are state, not text: they are written on the `Chip` itself, above
the children a consumer supplies, so no preset and no `render` can change what
colour the bar is showing you — only the words next to it. Nothing configured
here reaches the store or the runtime: the store compares the whole snapshot and
the exports serialise it, and a React element survives neither, so the icon and
the callbacks stay in the factory closure and travel as props.
[ADR-004](../../../docs/adr/ADR-004-per-extension-bar-presentation.md).

## Tests

`__tests__/runtime.test.ts` for resolution, persistence and exports;
`attack.test.ts` for the values the editor must refuse;
`theme-editor.test.tsx` for the panel and commands.
`presentation.test.tsx` pins the default bar and `⋮` markup as literal strings —
in the state that ships and in an edited, preview-paused one — every preset in
both places, and the three callbacks.
