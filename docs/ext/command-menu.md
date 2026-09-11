# `@nejcm/dev-toolbar/ext/command-menu`

The palette over the commands core has been aggregating all along. It contributes
none of its own — it is the only extension here that reads instead of adding.

```tsx
import { commandMenu } from "@nejcm/dev-toolbar/ext/command-menu";

// Once, at module scope. Not inside render.
const extensions = [commandMenu(), flags({ … }), metrics()];
```

`Mod+K` opens it; type to filter; `↑`/`↓` move, `↵` runs, `esc` dismisses. With no
query it browses — recently run commands first, then everything else grouped by
extension; with a query it is one flat list ordered by match quality. Options:
`shortcut` (`null` binds no key), `placeholder`, `emptyMessage`, `rememberRecent`,
`presentation` (below), plus the usual `id` / `label` / `align` / `order` /
`priority` / `hidden` / `injectStyles` / `styleNonce`.

Six things worth knowing:

- **It re-enumerates every time it opens.** `commands` may be a function, so an
  extension can begin contributing one after mount. The palette asks again rather
  than rendering a list it captured.
- **It runs by `id`, through core.** A command that was listed and has since gone
  says *no longer available* instead of firing a stale closure, and a `hidden`
  extension is as unreachable here as everywhere else.
- **A failing command keeps the palette open** and shows the message where you can
  read it. It is running your code; the throw never reaches your app.
- **It does not list a command that declares `input`.**
  [Contract v2](../extension-contract.md#contract-v2--commands-with-input-and-a-result)
  lets a command ask for `{ key, value }`; this palette has no form to collect that
  with, so it skips those rows rather than offering one it cannot run. They stay
  reachable from `getCommands()`, `invokeCommand()` and [`/ext/agent`](./agent.md). A
  form here is a later change.
- **It lives in the `overlay` slot, not a panel.** A panel would evict whatever you
  opened the palette to act on, and a collapsed compact item would take the shortcut
  with it. The bar chip is a convenience — the key binding is bound in `start()`.
  Hiding the toolbar (`Mod+Shift+.`) dismisses an open palette and disables the
  shortcut until the bar is back.
- **Its `shortcut` option is unaffected by `<DevToolbar bindCommandShortcuts>`.**
  That prop binds aggregated *commands*; this extension contributes none, so
  turning it on does not double-bind the palette. Leave this option as it is.
- **A host command declaring `Mod+K` collides with this palette's default, and
  only one of them fires.** Both listeners sit on `window` and both bail on
  `defaultPrevented`, so the one registered first wins and its
  `preventDefault()` suppresses the other. This extension's listener goes up in
  `start()`, which core runs in an effect *before* the effect that installs its
  own shortcut listener — so the palette takes the chord and the command core
  bound never runs. The one exception is the case the palette declines: while
  the bar is hidden it ignores the chord entirely, and core's binding runs the
  command instead. Do not bind a command to a chord the palette owns; give one
  of them a different chord.

Replacing it with your team's own `cmdk` is one line: leave it out and write your own
over `useToolbarCommands()` (stable snapshot) or `useDevToolbar().getCommands()`
(re-enumerates now). That is what core aggregating and rendering nothing is for.


## Bar presentation

```tsx
commandMenu({ presentation: { icon: <PaletteIcon /> } });
```

**Two knobs, not four.** The seven value-bearing extensions take a whole
[`CompactPresentation`](../kit.md#presentation) — `preset`, `icon`, `render`, `name`.
This trigger has a symbol and a hotkey hint, and neither is a value, so there is nothing
to preset *against*: no member would mean anything here that supplying an icon does not
already mean. `CommandMenuPresentation` is
`Pick<CompactPresentation<CommandMenuSnapshot>, "icon" | "name">`.

The narrowing is visible rather than silent — the bare-preset shorthand is a **compile
error** here, not an option that quietly does nothing:

```tsx
commandMenu({ presentation: "icon" });
// error TS2559: Type 'string' has no properties in common with type 'CommandMenuPresentation'.
```

Like every factory option it is fixed when the factory is called; remount the toolbar or
reload to change it.

- **An icon replaces the hardcoded `⌘`, and nothing else.** The hint still follows it in
  the bar and the label still follows it in the `⋮` menu, so the trigger is never
  wordless.
- **It lands in a new `data-dtb-part="cmd-icon"` span carrying the kit's
  `data-dtb-kind="glyph"`** — the clamp that stops a 24px `<svg>` setting the bar's
  height. **`cmd-glyph` deliberately does not gain that kind.** That part is not "the
  leading symbol": it is *every* Apple modifier symbol this extension paints, the ones
  inside each palette row's `cmd-option-hint` included, and it exists to set that text in
  the UI face at `1.18em` because the monospace faces have no such glyph.
- **`TView` is `CommandMenuSnapshot`**, the same object the trigger already renders from,
  so `snapshot.open` is there to branch an icon on.
- **`name` overrides the `aria-label`**; a whitespace-only return is ignored. `title` is
  not overridable, and it is where the hotkey is still spelled out once a `name` override
  has dropped the hint from the accessible name.

---

[Documentation index](../README.md) · [Extension contract](../extension-contract.md) · [Runtime](../runtime.md)
