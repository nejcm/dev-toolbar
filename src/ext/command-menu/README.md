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
| `ui.tsx` / `css.ts` | The dialog, the list, the empty state, and the shortcut hints — whose `⌘ ⌃ ⌥ ⇧` are set in the UI face, the monospace ones having no such glyph |
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

## Presentation

```tsx
commandMenu({ presentation: { icon: <PaletteIcon /> } });
```

**Two knobs, not four.** The seven value-bearing extensions take the whole
`CompactPresentation` — `preset`, `icon`, `render` and `name`. This trigger has
a symbol and a hotkey hint, and neither is a value, so no preset member would
mean anything here that supplying an icon does not already mean.
`CommandMenuPresentation` is `Pick<CompactPresentation<CommandMenuSnapshot>,
"icon" | "name">`: the two that act. `TView` is the same `CommandMenuSnapshot`
the trigger already renders from, so `snapshot.open` is there to branch on.

- **An icon replaces the hardcoded `⌘`, and nothing else.** The hint still
  follows it in the bar and the label still follows it in the `⋮` menu, so the
  trigger is never wordless.
- **It lands in a new `data-dtb-part="cmd-icon"` span carrying `/kit`'s
  `data-dtb-kind="glyph"`** — the clamp that stops a 24px `<svg>` setting the
  bar's height. **`cmd-glyph` deliberately does not gain that kind.** That part
  is not "the leading symbol": it is *every* Apple modifier symbol this
  extension paints, including the ones inside each palette row's
  `cmd-option-hint`, and it exists to set that text in the UI face at `1.18em`
  because the monospace faces have no such glyph. The kind is for foreign
  elements; the symbol keeps its type-setting, and its bytes.
- **`name` overrides the `aria-label`**; a whitespace-only return is ignored.
  `title` is not overridable, and it is where the hotkey is still spelled out
  once the hint has been replaced.
- **Nothing reaches the store.** The icon lives in the factory closure and
  travels as a prop, exactly as `label` and `injectStyles` do.

`docs/adr/ADR-004-per-extension-bar-presentation.md` records the decision.

## Tests

`__tests__/matching.test.ts` for the filter, `runtime.test.ts` for enumeration
and keyboard handling, `parity.test.ts` for agreement with core's aggregation,
`command-menu.test.tsx` for the rendered dialog, and `presentation.test.tsx`
for the trigger — where the default tree is pinned as a literal string in the
bar and in the `⋮` menu.
