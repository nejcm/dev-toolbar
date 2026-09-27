# ADR-006 — Viewer settings

**Status:** Accepted. Core renders the Settings menu, the store persists its values,
the seven preset-capable first-party extensions declare `presets`, and the playground
proves it in a browser (`examples/playground/e2e/settings.spec.ts`). Supersedes in part
[ADR-004](./ADR-004-per-extension-bar-presentation.md): its "`src/core/` is not
touched" constraint, and its rejected "global `presentation` default" row, as far as
the preset is concerned.

## Context

Every way to change how the bar looks is an **Option**: a prop on `<DevToolbar>` or a
factory option on an extension, set by the **Consumer** in code. The **Viewer** — the
developer actually looking at the bar in a browser — cannot move it to the top, make it
comfortable, show metrics as icons, or drop a chip they never read, without a code
change and a rebuild. The terms are defined in [`CONTEXT.md`](https://github.com/nejcm/dev-toolbar/blob/main/CONTEXT.md).

What makes this hard to reverse:

- **Storage keys.** A Setting persists under `dtb:v1:<instanceId>:…`. Once a browser
  holds a key, its name and value shape are published: a rename orphans every stored
  Setting, and a looser validator would have to keep accepting what it once wrote.
- **The extension contract.** The preset has to reach an extension's compact slot.
  `CompactSlotProps` and `DevToolbarExtension` are what third-party extensions are
  written against, and ADR-004 kept `src/core/` out of presentation precisely so it
  would not have to add a field there.
- **A cog in every bar.** Every consumer's bar gains a control on upgrade. Taking it
  away again, or changing what it shows, is a visible change for everyone.

## Decision

Core owns a **Settings menu**: a `⚙` button in the bar's end region, after the `⋮`,
that never collapses, and a popover built on the same disclosure rules as the `⋮`.
It holds position, density and colour scheme for the whole bar, then one row per
present extension with a **shown in bar** checkbox and, where the extension declares
`presets`, a **presentation preset** select, then **Reset toolbar settings**.

The preset travels as a slot prop. `DevToolbarExtension.presets?: readonly
CompactPreset[]` opts an extension in; core passes `CompactSlotProps.preset` only when
the stored value is in that list. The extension applies it with kit's
`withSlotPreset(presentation, preset)` before resolving its control, so the Setting
replaces the factory `preset` only — a consumer `render` callback still runs, and sees
the new `ctx.fallback`. `CompactPreset` moves to core, which is why core can name it;
kit re-exports it.

The additions are optional fields, so `CONTRACT_VERSION` stays `2` under
[ADR-003](./ADR-003-contract-version-policy.md)'s interim rule.

### Precedence

- An **uncontrolled Option is only the default**: a stored Setting wins over it.
  `density`, `colorScheme` and `defaultPosition` are uncontrolled.
- A **controlled prop always wins**. With `position` + `onPositionChange`, the menu's
  position row routes through `onPositionChange`, exactly like `setPosition` does.
- Picking the Option's own value **clears** the stored override rather than storing a
  copy, so a later change to the Consumer's default reaches that Viewer. For a preset,
  "Extension default" is that choice.
- `settings={false}` hides the cog and ignores stored Settings; an object allowlists
  sections. A section that is off ignores what is stored for it.
- **Reset** removes exactly what the menu shows — `position`, `density`, `colorScheme`
  and `extensionSettings` — and leaves `visible`, `activePanel`, `panelHeight` and
  every extension's own data alone.

### "Shown in bar" is not `hidden`

`hidden: true` is the Consumer's switch and tears the extension down: no `start()`,
no commands, no diagnostics, no panel. A Viewer who only wants a quieter bar must not
be able to switch off an extension's behaviour — the flags extension applying
overrides, the agent bridge answering — from a checkbox that reads like a layout
choice. So `shown: false` removes the item from the bar and the `⋮` and nothing else:
the extension keeps running, its commands stay in `⌘K`, and it stays in the
diagnostics roster.

### Alternatives considered

| Option | Why not |
| --- | --- |
| Leave Settings to consumers — document a pattern with props and `localStorage` | Every consumer writes the same menu, differently, and none can reach a first-party extension's preset without remounting it with new factory options, which restarts its runtime. |
| An extension (`/ext/settings`) instead of core | It would need to write core state (position, density) and every other extension's preset, which is exactly what an extension cannot reach: it gets its own `api`, not other extensions' slots. |
| A global `presentation` default on `<DevToolbar>` (ADR-004's rejected row) | Still rejected as a *Consumer* Option: nine per-extension factory options already cover it. The Viewer's preset is different in kind — per browser, per extension, chosen at run time — and a factory option cannot change on a running extension. |
| Pass the preset through context rather than a slot prop | An extension would have to know about a core hook to receive it, and the value would bypass `CompactSlotProps`, which is the one place slot inputs are declared and tested. |
| Push the preset to every extension, no opt-in | Extensions that have no presets (`agent`, `command-menu`) or a custom control would get a select that does nothing. `presets` is the extension saying which ones it can paint. |
| Reuse `hidden` for "shown in bar" | See above: a Viewer checkbox would stop an extension's runtime. |
| Store the whole settings object under one key | A validator failure would lose every Setting at once, and Reset would have to rewrite rather than remove. One key per toolbar-wide Setting, one record for the per-extension ones. |

### Risk accepted

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| The cog takes width from every bar on upgrade | Certain | One fewer chip fits before collapse | The collapse machine charges the cog as fixed chrome width, so nothing overruns; `settings={false}` removes it. The release notes call out the new cog. |
| A stored preset an extension later drops from `presets` | Low | A stale Setting | Core passes only presets still in the list; the select shows "Extension default". |
| Two present extensions share a label | Medium (the playground has one) | Ambiguous row names for a screen reader | Rows are named `Label (id)` only when labels collide. |
| A Viewer hides every chip | Low | An apparently empty bar | The cog never collapses and is never hidden, so Reset is always one click away. |

## Consequences

- `src/core/` now knows the `CompactPreset` names. ADR-004's rule that presentation
  lives only in kit and the extensions still holds for everything else: icons, the
  `render` callback, the name override and the part tables stay out of core.
- A third-party extension gets a preset row by declaring `presets` and applying
  `withSlotPreset`; declaring `presets` without applying it shows a select that does
  nothing, which will read as a bug.
- With a section off, what is stored for it is ignored — and with the position section
  off, an uncontrolled `setPosition` call is a no-op too, since position is then fixed
  to the Consumer's default.
- The menu cannot tell which preset the factory set, so choosing that same preset
  stores it; only "Extension default" clears.
- `storage={null}` makes Settings last for the session only.
- Adding a Setting is a new storage key and a new menu row: an ADR-level change by the
  rule in [the ADR README](./README.md).
