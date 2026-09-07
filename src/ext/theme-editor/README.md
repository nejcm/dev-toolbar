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

## Tests

`__tests__/runtime.test.ts` for resolution, persistence and exports;
`attack.test.ts` for the values the editor must refuse;
`theme-editor.test.tsx` for the panel and commands.
