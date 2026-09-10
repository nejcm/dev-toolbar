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
- **There is a kill switch.** `?dtb-flags=reset` drops every stored override
  before it is applied — the override that breaks the app is the one you cannot
  reach the panel to remove. The adapter hears about every dropped key. It is
  honoured on every `start()`, so a remount while the param is still in the
  URL drops the overrides set since the reset — a known limitation; strip the
  param from the URL after using it.
- **An override is never quiet.** The bar counts them, every overridden row is
  marked, and the app's own value stays on screen next to the override.

## Commands

`<id>.toggle.<flagKey>` (one per flag), `<id>.set`, `<id>.clearOverrides`,
`<id>.refresh`, `<id>.copyJson`, `<id>.copyRecipe`.

## Options that change behaviour

`flags`, `onOverride`, `onOverridesChange`, `promoted`, `audience`,
`resetParam`, `pollMs`, `redactOptions`. `readStoredOverrides({ flags })` vets
the pre-mount read against the catalogue with the exported `vetOverrides`.

## Tests

`__tests__/runtime.test.ts` for storage, the reset param and override
application; `flags.test.tsx` for the panel, the promoted chip and the commands.
