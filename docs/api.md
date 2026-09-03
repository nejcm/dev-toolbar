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
| `shortcut` | `"Mod+Shift+."` | `null` disables it |
| `injectStyles` | `true` | `false` → import `@nejcm/dev-toolbar/styles.css` yourself |
| `styleNonce` | — | CSP nonce for the injected core stylesheet |
| `classNames` | — | Per-part class map |
| `container` | `document.body` | Portal target |

`instanceId` and `storage` are read **once, on mount**, so the store and everything
derived from it can never disagree about where preferences live. Changing either
prop later is ignored; remount the toolbar (`key={instanceId}`) to move it.

`classNames` is compared **field by field**, not by identity, so writing the object
inline (`classNames={{ bar: "my-bar" }}`) is fine — it does not defeat the
memoisation of the context value or of the overlay host.

Under a `style-src 'self' 'nonce-…'` CSP an un-nonced `<style>` is dropped silently:
the bar renders unstyled with nothing in the console but a CSP report. Pass
`styleNonce` to prevent that. It applies to **core's** sheet only, and only to the
injection that creates it — first-writer-wins, so changing the nonce later does not
restyle an existing element. First-party extensions inject their own sheets and are
not covered; with `injectStyles={false}` the prop does nothing, because nothing is
injected.

## Insetting your layout

The shell publishes `--dev-toolbar-height` on `<html>` — the whole toolbar, bar
*plus* any open panel. Every instance also publishes
`--dev-toolbar-height-<instanceId>`, the `instanceId` with anything outside
`A-Za-z0-9_-` folded to `_`, and the unsuffixed name belongs to the `"default"`
instance alone. So two toolbars on one page never overwrite or remove each other's
value; inset by the suffixed name when you mount more than one.
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

## The `···` menu

Items that do not fit the bar collapse into a `···` popup, lowest `priority` first. It is a
disclosure, not an ARIA menu: its entries are your own compact slots, buttons and all,
and a `menuitem` may not contain interactive content. So the `···` button carries
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
| `runCommand(id, scope?)` | Runs an aggregated command from code with no React context — a hotkey, a console, a test. Resolves `false` when no mounted toolbar declares the id, `true` once the command's `run()` completes. Rejects with `run()`'s own error if it throws or rejects — callers must catch it. `scope`, a `readonly ToolbarCommand[]`, is searched instead of the mounted toolbars. Inside components prefer `useDevToolbar().runCommand`. |
| `CONTRACT_VERSION` | The extension contract's version, currently `1`. See [ADR-003](./adr/ADR-003-contract-version-policy.md). |
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

## Types

Every type the root entry exports. The slot props, `DevToolbarExtension`,
`ExtensionRuntimeApi`, `ToolbarCommand` and friends are described under
[the extension contract](./extension-contract.md).

| Type | What it types |
| --- | --- |
| `DevToolbarProps` / `DevToolbarInsetProps` | The two components' props. |
| `DevToolbarExtension` | One extension object. |
| `ToolbarCommand` / `ToolbarCommandsInput` | A command, and the array-or-function form `commands` accepts. |
| `ExtensionRuntimeApi` | What `start(api)` receives. |
| `CompactSlotProps` / `PanelSlotProps` / `OverlaySlotProps` | What each slot renders with. |
| `ExtensionDiagnostics` / `DiagnosticStatus` | One entry in the diagnostics roster, and its `"ok" \| "absent" \| "failed"` status. |
| `ToolbarStorage` | The three-method storage adapter. |
| `ToolbarAlign` / `ToolbarPosition` / `ToolbarDensity` / `ToolbarColorScheme` | `"start" \| "end"`, `"bottom" \| "top"`, `"compact" \| "comfortable"`, `"light" \| "dark" \| "system"`. |
| `DevToolbarClassNames` | The per-part class map the `classNames` prop takes. |
| `DevToolbarContextValue` | What `useDevToolbar()` returns. |
| `ToolbarState` | The store snapshot: `visible`, `position`, `activePanelId`, `panelHeight`. Its `registered` field is marked `@internal` — it holds only the dynamic registrations, so it is not the extension list; use `useDevToolbar().extensions` for that. |


---

[Documentation index](./README.md)
