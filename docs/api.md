# API reference — `@nejcm/dev-toolbar`

The root entry: what `<DevToolbar>` takes, what else the package exports, and every
type it publishes. Start at the [README](../README.md) if you just want it mounted.

## Props

| Prop | Default | Notes |
| --- | --- | --- |
| `extensions` | `[]` | Source of truth for the item list |
| `enabled` | `true` | `false` renders children only — no portal, no lifecycle |
| `instanceId` | `"default"` | Namespaces persisted preferences. **Mount-time only** |
| `storage` | `localStorage` | Adapter, or `null` to disable. **Mount-time only** |
| `density` | `"compact"` | `"compact" \| "comfortable"` |
| `colorScheme` | `"system"` | `"light" \| "dark" \| "system"` |
| `defaultVisible` / `defaultPosition` / `defaultPanelHeight` | — | Used only when nothing is persisted yet |
| `visible` / `position` | — | Controlled values; provide `onVisibleChange` / `onPositionChange` for internal controls |
| `onVisibleChange` / `onPositionChange` / `onPanelChange` | — | Called for uncontrolled changes and controlled internal setter requests |
| `shortcut` | `"Mod+Shift+."` | `null` disables it |
| `bindCommandShortcuts` | `false` | Bind every aggregated command that declares a `shortcut` |
| `injectStyles` | `true` | `false` → import `@nejcm/dev-toolbar/styles.css` yourself |
| `styleNonce` | — | CSP nonce for injected stylesheets (core's, and forwarded to every slot) |
| `onExtensionError` | — | Called after core logs a slot failure; receives the normalized `Error` and slot metadata |
| `classNames` | — | Per-part class map |
| `container` | `document.body` | Portal target |
| `className` / `style` | — | On the toolbar root |
| `children` | — | Rendered untouched, in a fragment |

`instanceId` and `storage` are read **once, on mount**, so the store and everything
derived from it can never disagree about where preferences live. Changing either
prop later is ignored; remount the toolbar (`key={instanceId}`) to move it.

`classNames` is compared **field by field**, not by identity, so writing the object
inline (`classNames={{ bar: "my-bar" }}`) is fine — it does not defeat the
memoisation of the context value or of the overlay host.

`visible` and `position` are controlled values. Their matching callbacks receive
requests from the toggle shortcut or context setters; those setters do not update
the store or persistence while the field is controlled. Removing either prop returns
to the persisted or default store value. Supplying `defaultVisible` or
`defaultPosition` alongside its controlled prop is allowed and seeds that fallback.

Under a `style-src 'self' 'nonce-…'` CSP an un-nonced `<style>` is dropped silently —
the bar renders unstyled, with nothing in the console but a CSP report — so pass
`styleNonce`. Core stamps it on its own sheet and forwards it to every slot as
`styleNonce`, which is how first-party extensions pick it up without reading this
prop. A factory `styleNonce` option, where present, wins over the slot prop — for a
host whose extension sheets need a different nonce, or an extension that injects
outside a slot. Applied only when a sheet is created (first-writer-wins, so a later
nonce does not restyle an existing element). With `injectStyles={false}` the prop
does nothing for core's sheet, because nothing is injected; each extension has its
own `injectStyles` switch.

## Insetting your layout

The shell publishes `--dev-toolbar-height` on `<html>` — the whole toolbar, bar *plus*
any open panel. Every instance also publishes `--dev-toolbar-height-<instanceId>`
(anything outside `A-Za-z0-9_-` folded to `_`), and the unsuffixed name belongs to the
`"default"` instance alone — so two toolbars never overwrite or remove each other's
value. Inset by the suffixed name when you mount more than one;
`<DevToolbarInset>` already pads by its own instance's, falling back to the
unsuffixed one.

## Toggle shortcut

The default is `Mod+Shift+.` — and `Mod` is **exclusive**, not "either modifier":

- **macOS: `Cmd+Shift+.` only.** `Ctrl+Shift+.` does nothing there.
- Everywhere else: `Ctrl+Shift+.`.

Pass your own (`shortcut="Ctrl+Alt+D"`) or `shortcut={null}` to disable. Matching is
by `key` or by physical `code`, so a shifted punctuation key works on any layout.

It fires wherever focus is, text fields included, but not for an auto-repeat, not
mid-IME-composition, and not when something else already called `preventDefault()`
— the listener is on `window`, so your own `document` handler wins the chord.

## Command shortcuts

`ToolbarCommand.shortcut` is a hint until you opt in:

```tsx
<DevToolbar bindCommandShortcuts extensions={extensions} />
```

Default `false`. Turning it on by default would bind keys in every app that already
ships display-only `shortcut` strings — including strings that describe a host's own
listener, which would then fire twice.

When on:

- Core re-enumerates `getCommands()` on every keydown that passes the same guards as
  the toggle (`defaultPrevented`, `isComposing`, `repeat`). A function-form roster
  that starts declaring a shortcut after mount is bound without a re-render. There is
  no modifier pre-gate — a declared bare letter would otherwise silently fail to bind —
  so typing in a host text field rebuilds the roster and re-parses every declared
  chord per character; a large `flags` roster may measure it.
- Commands that declare `input` are not bound — a keypress has nowhere to put a value.
- First declaration wins, in aggregation order; a later command with the same chord
  warns once.
- The toggle shortcut always wins over a command; a command that declared that
  chord is warned once and not run.
- Bindings fire while the bar is hidden. Hidden *extensions* contribute no commands,
  so the roster is already correct; the listener does not consult visibility (store
  or controlled).
- There is no focus heuristic: a declared chord fires even from a text field. Make
  the chord specific enough that this is safe.
- `preventDefault()` runs on a match. A `run()` that throws or rejects is logged with
  the command id and does not kill the listener.

`/ext/command-menu`'s own `shortcut` option is a separate binding in `start()`. This
prop does not double-bind the palette — that extension contributes no commands. But
the two listeners are not independent: whichever went up first wins the chord, and
its `preventDefault()` stops the other. Extension `start()` runs in an earlier effect
than this listener, so a command bound to the palette's chord loses to the palette
while the bar is visible and wins while it is hidden (the palette ignores the chord
then). Do not bind a command to a chord an extension already owns.

## The `⋮` menu

Items that do not fit the bar collapse into a `⋮` popup, lowest `priority` first. It is a
disclosure, not an ARIA menu: its entries are your own compact slots, buttons and all,
and a `menuitem` may not contain interactive content. So the `⋮` button carries
`aria-expanded` and, while open, `aria-controls`; the popup is a labelled
`role="group"`; opening it moves focus to the first focusable thing inside it — the
popup itself if there is none — and `Tab` walks the rest; `Escape` closes it and hands
focus back to the button; a click outside closes it and leaves focus where the click
put it.

## Other exports

`DevToolbar`, `DevToolbarInset`, `useDevToolbar` and `useToolbarCommands` are the
whole surface most apps touch. The rest of the root entry is a short list of escape
hatches; everything here is public and covered by the package's versioning.

| Export | What it is for |
| --- | --- |
| `runCommand(id, scope?)` | Runs an aggregated command with no React context — a hotkey, a console, a test. Resolves `true` once `run()` completes, `false` when no mounted toolbar declares the id, and rejects with `run()`'s own error — catch it. `scope` (a `readonly AnyToolbarCommand[]`) is searched instead of the mounted toolbars. Still a boolean under contract v2; use `invokeCommand` to pass input or read a result, or `useDevToolbar().runCommand` inside components. |
| `invokeCommand(id, options?)` | `runCommand` that resolves **what the command returned**: `{ ok: true, result }`, or `{ ok: false, reason: "unknown-command" }`. `options` is `{ input?, scope? }` — an object rather than a third positional argument, so no existing `runCommand(id, scope)` call changes meaning. Rejects with `run()`'s own error, like `runCommand`. |
| `CONTRACT_VERSION` | The extension contract's version, currently `2`. See [contract v2](./extension-contract.md#contract-v2--commands-with-input-and-a-result) and [ADR-003](./adr/ADR-003-contract-version-policy.md). |
| `HEIGHT_VARIABLE` | The name of the CSS variable the shell publishes — `"--dev-toolbar-height"` — so a CSS-in-JS host need not retype the string. It is the `"default"` instance's; every instance also publishes `<HEIGHT_VARIABLE>-<instanceId>`. |
| `createLocalStorage()` | The default adapter: `localStorage`, but it never throws. Useful as the base of your own wrapper. |
| `createMemoryStorage(seed?)` | In-memory adapter for tests and non-browser hosts. `seed` is a plain key/value map of already-persisted JSON. |
| `createNullStorage()` | Swallows every write and reads `null` — what `storage={null}` installs. |
| `STORAGE_PREFIX` | `"dtb:v1"`, the first segment of every key the shell writes. Enough to find or clear persisted preferences from outside React; the key shapes are in [architecture.md](./architecture.md#3-state-storage-and-lifecycle). |
| `CORE_CSS` | Core's stylesheet as a string, for a host that injects CSS itself — a nonce-based CSP, or a `<style>` it controls. Same bytes as `@nejcm/dev-toolbar/styles.css`. |
| `ensureStyles(entry?, css?, doc?)` | Injects a stylesheet once per document, keyed on `entry`. Pass `doc` to reach a second document, which is what a `container` inside an iframe or a popped-out window needs. |
| `DEFAULT_SHORTCUT` | `"Mod+Shift+."`, so your own UI can show the binding it actually has. |
| `MIN_PANEL_HEIGHT` / `MAX_PANEL_HEIGHT` / `DEFAULT_PANEL_HEIGHT` | `160` / `800` / `320`. The range `defaultPanelHeight` and the resizer are clamped to. |

The aggregation helpers behind `getCommands()` and `getDiagnostics()` are **not**
exported. They only ever see an extension array the caller assembled by hand, which
is not the merged list the toolbar renders — read the aggregation through
`api.getCommands()` / `api.getDiagnostics()` in an extension, or
`useToolbarCommands()` / `useDevToolbar().getCommands()` in the host.

For the metrics subpath, see [custom collectors](./ext/metrics.md#custom-collectors):
`MetricsOptions.collectors`, `CollectorId`, the collector contract, and the separate
built-in `views` and consumer `custom` snapshot records. The same subpath adds the
four [`network.*` commands](./ext/metrics.md#the-network-commands) — `export`,
`copyAsCurl`, `clear` and `pause` — reachable from here through
`invokeCommand("metrics.network.export")` like any other aggregated command, and the
`fetch`/`XMLHttpRequest` interceptor behind them is a [`/runtime`](./runtime.md)
export. These are subpath exports, not root exports; the extension contract version
remains 2.

To put a third-party devtool's panel on the bar, see [embedding.md](./embedding.md):
the plain `{ id, label, panel }` object needs nothing from this entry but the
`DevToolbarExtension` type, and the optional `embed()` frame helper is a
[`/kit`](./kit.md#embed) export, not a root one.

## Types

Every type the root entry exports. The slot props, `DevToolbarExtension`,
`ExtensionRuntimeApi`, `ToolbarCommand` and friends are described under
[the extension contract](./extension-contract.md).

| Type | What it types |
| --- | --- |
| `DevToolbarProps` / `DevToolbarInsetProps` | The two components' props. |
| `DevToolbarExtension` | One extension object. |
| `ToolbarCommand` / `ToolbarCommandsInput` | A command, and the array-or-function form `commands` accepts. `ToolbarCommand<In, Out>` — both default to `void`. |
| `AnyToolbarCommand` | The element type of a command *roster* — what `getCommands()`, `useToolbarCommands()` and `commands` hold. A roster mixes commands with different `In`/`Out`, so it needs one element type they all satisfy; `readonly ToolbarCommand[]` still works everywhere it did, because the two are mutually assignable. |
| `CommandInputSchema` / `CommandInputField` / `CommandInputPrimitiveField` / `CommandInputEnumField` / `CommandInputType` / `CommandInputValue` | What a command declares it accepts. A flat bag of primitives and enums — see [contract v2](./extension-contract.md#commandinputschema-is-deliberately-small). |
| `CommandInvocation` / `InvokeCommandOptions` | What `invokeCommand` resolves, and what it takes. |
| `ExtensionRuntimeApi` | What `start(api)` receives. |
| `CompactSlotProps` / `PanelSlotProps` / `OverlaySlotProps` | What each slot renders with. |
| `ExtensionDiagnostics` / `DiagnosticStatus` | One entry in the diagnostics roster, and its `"ok" \| "absent" \| "failed"` status. |
| `ExtensionErrorInfo` | Metadata passed to `onExtensionError` for a failed slot. |
| `ToolbarStorage` | The three-method storage adapter. |
| `ToolbarAlign` / `ToolbarPosition` / `ToolbarDensity` / `ToolbarColorScheme` | `"start" \| "end"`, `"bottom" \| "top"`, `"compact" \| "comfortable"`, `"light" \| "dark" \| "system"`. |
| `DevToolbarClassNames` | The per-part class map the `classNames` prop takes. |
| `DevToolbarContextValue` | What `useDevToolbar()` returns. |
| `ToolbarState` | The store snapshot: `visible`, `position`, `activePanelId`, `panelHeight`. Its `registered` field is marked `@internal` — it holds only the dynamic registrations, so it is not the extension list; use `useDevToolbar().extensions` for that. |


---

[Documentation index](./README.md)
