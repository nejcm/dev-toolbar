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
plus the usual `id` / `label` / `align` / `order` / `priority` / `hidden` /
`injectStyles` / `styleNonce`.

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
  A host command declaring `Mod+K` collides with this palette's default and both
  fire: core's `preventDefault()` cannot suppress a listener an extension
  registered in `start()`.

Replacing it with your team's own `cmdk` is one line: leave it out and write your own
over `useToolbarCommands()` (stable snapshot) or `useDevToolbar().getCommands()`
(re-enumerates now). That is what core aggregating and rendering nothing is for.


---

[Documentation index](../README.md) · [Extension contract](../extension-contract.md) · [Runtime](../runtime.md)
