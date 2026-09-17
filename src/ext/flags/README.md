# `ext/flags`

Your feature flags on the bar, with a promoted flag pinned in it, local
overrides that survive a reload, and a `?dtb-flags=reset` kill switch.

- **Subpath:** `@nejcm/dev-toolbar/ext/flags`
- **Factory:** `flags(options?)` → `DevToolbarExtension`
- **Full documentation:** [docs/ext/flags.md](../../../docs/ext/flags.md)

```tsx
const extensions = [
  flags({
    flags: () => catalogue.map((d) => ({ ...d, value: base[d.key], source: "server-rule" })),
    onOverride: (key, value) => (value === undefined ? store.clear(key) : store.set(key, value)),
    promoted: { flagKey: "ui-facelift", label: "UI Facelift 2026" },
  }),
];
```

## Files

| File | What is in it |
| --- | --- |
| `index.tsx` | The factory, the per-flag toggle commands and the exports |
| `runtime.ts` | Override storage, the reset param, the adapter call-out, the view model |
| `ui.tsx` / `css.ts` | The promoted chip, the panel, search and the override controls |
| `types.ts` | The flag definition, the override shape and the audience vocabulary |

## What it owns, and what it does not

It owns **no flag store** and integrates no provider — the same rule
`/ext/environment` follows. You hand it what your application resolved, **before
any local override**, and optionally an adapter it calls when somebody asks for
one: `onOverride(key, value)` per key, or `onOverridesChange(map)` with the
whole vetted map after each change (called after the per-key calls of the same
change). Omit both and the panel is read-only: it lists, searches and copies,
and changes nothing. That is the honest degradation, not a reason to invent a
store.

This is the first extension that **mutates the application** rather than
observing it, which is why three rules hold:

- **Overrides outlive the tab.** Persisted under
  `dtb:v1:<instanceId>:ext:<id>:overrides` and re-applied through your adapter
  on the next mount. The app boots with its own values first; call
  `readStoredOverrides()` before you render if you need them earlier.
- **There is a kill switch.** `?dtb-flags=reset` drops every stored override and every
  session override held by the same runtime before it is applied — the override that
  breaks the app is the one you cannot reach the panel to remove. The adapter hears
  about every distinct stored or session key. The reset is honoured on every `start()`,
  so a remount while the param is still in the URL drops the overrides set since the
  reset — a known limitation; strip the param from the URL after using it.
- **An override is never quiet.** The bar counts them, every overridden row is
  marked, and the app's own value stays on screen next to the override.

On another `start()` of the same runtime, session overrides survive when a custom
storage adapter cannot be read. The default `localStorage` adapter reports a blocked
store as empty, so only custom adapters that throw on reads get this guarantee. A new
runtime or page reload cannot recover an override that storage never accepted.

## Commands

`<id>.toggle.<flagKey>` (one per flag), `<id>.set`, `<id>.clearOverrides`,
`<id>.refresh`, `<id>.copyJson`, `<id>.copyRecipe`.

## Options that change behaviour

`flags`, `onOverride`, `onOverridesChange`, `promoted`, `audience`,
`resetParam`, `pollMs`, `redactOptions`. `readStoredOverrides({ flags })` vets
the pre-mount read against the catalogue with the exported `vetOverrides`.

## Presentation

`/ext/flags` puts **two kinds of control** in the bar, so it has two
`presentation` options — a control's presentation is configured next to that
control, rather than by one callback that would have to receive
`FlagsSnapshot | FlagView` and make you narrow it.

| Option | Control | `TView` | Invoked |
| --- | --- | --- | --- |
| `flags({ presentation })` | The flags chip | `FlagsSnapshot` | once |
| `PromotedFlag.presentation` | One promoted flag | `FlagView` | once per promoted flag |

```tsx
flags({
  presentation: "icon-value",
  promoted: [
    { flagKey: "ui-facelift", presentation: { preset: "icon", icon: <FlagIcon /> } },
    { flagKey: "checkout.tier" }, // untouched — still the default tree
  ],
});
```

Both take the same four knobs (`preset`, `icon`, `render`, `name`) from
`@nejcm/dev-toolbar/kit`; a bare preset is the shorthand. `render` supplies
**children only** — the `<button>`, `type`, `aria-expanded`, `onClick`,
`title`, `role="switch"`/`aria-checked`, the promoted dot, `data-dtb-flag` and
`data-dtb-overridden` stay this extension's, and a preset changes text, never
state. Returning `undefined` falls through to the preset; a whitespace-only
`name` is ignored, so no override can leave a control unnamed.

Two things are specific to flags:

- **The chip's `⋮` row says `flags`, not `Flags`, under `"default"`.** Unlike
  the Group A chips, it has never swung to its `label` when overflowed. Any
  *preset* still forces the full word there, which is the library-wide
  overflow guarantee.
- **`PromotedFlag.icon` stays a `string`** — "text, not an asset". It is copied
  into every snapshot as `FlagView.promotedIcon`, and the store compares the
  whole snapshot structurally: a React element is a plain object the comparator
  walks into, in development through `_owner` into a cyclic fiber, and it would
  sit inside what `diagnostics()` serialises. Rich icons go on
  `presentation.icon`, which lives in the factory closure and reaches `ui.tsx`
  as a prop, exactly as `label` and `injectStyles` do. The string glyph still
  fills the icon slot when no `presentation.icon` is supplied, so it survives a
  preset instead of vanishing; supply both and the rich one wins (a function
  `icon` that returns nothing for this control counts as not supplied, and the
  string glyph fills the slot again). `icon: ""` is not an icon: it has never
  painted a node and still does not fill the slot, so an icon-only preset falls
  back to text rather than leaving a control that is nothing but its dot.
- **A promoted control's `"default"` tree paints `presentation.icon`.** It is
  the one place a bare `icon` under `"default"` is not a no-op: this control has
  had a glyph slot since it existed — the string `PromotedFlag.icon` — and
  `presentation.icon` fills that same slot, which is the upgrade path off the
  string field. No existing consumer can have a `presentation`, so today's bytes
  are unmoved. Chips whose default names no icon slot ignore a bare `icon`.
- **A promoted boolean falls back to text rather than to nothing.** A switch has
  no value slot — it announces its own state — so `"value"`, and `"icon-value"`
  with no icon, would leave a control that is nothing but its dot. Both paint
  the label instead: a blank control is worse than an unstyled one.

`docs/adr/ADR-004-per-extension-bar-presentation.md` records the decision.

## Tests

`__tests__/runtime.test.ts` for storage, the reset param and override
application; `flags.test.tsx` for the panel, the promoted chip and the
commands; `presentation.test.tsx` for both `presentation` surfaces — the
byte-identical default trees, the preset table on each, and the evidence that
no `ReactNode` reaches the store, `diagnostics()` or the copy-recipe path.
