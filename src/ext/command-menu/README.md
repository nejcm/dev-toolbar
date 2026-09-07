# `ext/command-menu`

A `⌘K` palette over every command the toolbar has aggregated. It contributes no
commands of its own — it is a reader of core's aggregation.

- **Subpath:** `@nejcm/dev-toolbar/ext/command-menu`
- **Factory:** `commandMenu(options?)` → `DevToolbarExtension`
- **Full documentation:** [docs/ext/command-menu.md](../../../docs/ext/command-menu.md)

```tsx
const extensions = [commandMenu(), flags({ /* … */ }), metrics()];
```

`Mod+K` opens it; type to filter, `↑`/`↓` to move, `↵` to run, `esc` to dismiss.

## Files

| File | What is in it |
| --- | --- |
| `index.tsx` | The factory and the overlay/trigger wiring |
| `runtime.ts` | Enumeration, matching, recent-command memory, keyboard handling |
| `ui.tsx` / `css.ts` | The dialog, the list and the empty state |
| `types.ts` | The row view model and the matching vocabulary |

## Four rules that shape it

- **Re-enumerates on every open**, since `commands` may be a function whose
  output changes after mount. It never renders a captured list.
- **Runs commands by `id`, through core**, so a since-removed command reports
  *no longer available* rather than running a stale closure — and a `hidden`
  extension's commands stay unreachable here too.
- **A failing command keeps the palette open.** The throw is caught and shown in
  place rather than reaching the host app.
- **It lives in the `overlay` slot, not a panel.** A panel would evict whatever
  the palette was opened to act on, and the overlay is the one surface core
  never collapses into the `⋮` menu — so the shortcut works even once the bar
  chip has collapsed.

Swapping in your own `cmdk` is one line: drop this extension and build over
`useToolbarCommands()` / `useDevToolbar().getCommands()` instead.

## Options that change behaviour

`shortcut`, `placeholder`, `emptyMessage`, `rememberRecent`, `apple` (platform
override for the rendered hint).

## Tests

`__tests__/matching.test.ts` for the filter, `runtime.test.ts` for enumeration
and keyboard handling, `parity.test.ts` for agreement with core's aggregation,
and `command-menu.test.tsx` for the rendered dialog.
