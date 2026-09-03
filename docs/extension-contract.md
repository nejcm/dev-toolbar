# The extension contract

An extension is a plain object.

```ts
interface DevToolbarExtension {
  id: string;                    // identity: dedupe, panel state, storage scope
  label: string;
  contractVersion?: number;      // core warns once on a mismatch
  align?: "start" | "end";       // default "start"
  order?: number;                // ascending, within the region
  priority?: number;             // lowest collapses into ··· first
  hidden?: boolean;              // you compute this — core has no ctx
  keepMounted?: boolean;         // panel state survives closing
  compact?: (props: CompactSlotProps) => React.ReactNode;
  panel?: (props: PanelSlotProps) => React.ReactNode;
  overlay?: (props: OverlaySlotProps) => React.ReactNode;   // modal; never collapsed
  // Core aggregates; it renders no palette. A function is re-enumerated on
  // every pass, so a command that only exists later is still reachable.
  commands?: ToolbarCommand[] | (() => ToolbarCommand[]);
  // Aggregated the same way as commands; /ext/diagnostics renders the roster.
  diagnostics?: () => unknown;
  start?(api: ExtensionRuntimeApi): void | (() => void);
}
```

`compact` and `panel` are render *functions*, not components, so core can hand down
state you cannot otherwise know:

```ts
interface CompactSlotProps {
  isOverflowed: boolean;         // rendered in the ··· menu rather than the bar
  isPanelOpen: boolean;
  density: "compact" | "comfortable";
  openPanel(): void;
  closePanel(): void;
  togglePanel(): void;           // the one every trigger actually wants
}

interface PanelSlotProps {
  isActive: boolean;             // false only for keepMounted panels
  density: "compact" | "comfortable";
  height: number;
  close(): void;
}

interface OverlaySlotProps {
  density: "compact" | "comfortable";
  position: "bottom" | "top";
}
```

`overlay` is for a surface the bar cannot host — a dialog, a picker, a layer drawn
over the page. It renders once,
inside the toolbar root, for as long as you are present, not hidden and the bar is
visible, and **overflow never collapses it**: a compact item that has collapsed into
the `···` menu is not in the DOM at all, which would cost an extension its modal (and
its key binding) exactly when the window got narrow. Most overlays render `null` most
of the time. `/ext/command-menu` is the worked example for a modal;
`/ext/overlays` for a persistent surface, where the trick worth stealing is
`z-index: -1`: the toolbar root is a stacking context above your app, so a negative-z
child of it paints over the page and under the bar, the panel and the palette.

Core keeps *reporting* visibility rather than acting on it, so `start()` keeps running
while the bar is hidden even though your overlay is not rendered. If yours is modal,
close it on `api.subscribeVisibility(false)` and gate any key binding on
`api.isVisible()` — otherwise it reappears, unasked, when the bar comes back. If it
observes the page, detach the observers there too: measuring for a surface that is
not rendered is pure waste.

`start(api)` runs once per mount, for background work:

```ts
interface ExtensionRuntimeApi {
  signal: AbortSignal;                                  // aborts on teardown
  isVisible(): boolean;
  subscribeVisibility(cb: (visible: boolean) => void): () => void;
  storage: ToolbarStorage;                              // scoped to this extension
  getCommands(): readonly ToolbarCommand[];             // the live aggregation
  runCommand(id: string): Promise<boolean>;             // false = nothing declares it
  getDiagnostics(): readonly ExtensionDiagnostics[];    // one entry per present extension
}
```

`getCommands()` / `runCommand()` / `getDiagnostics()` are how an extension reads the
aggregation without importing a *value* from core — `useToolbarCommands()` and
`useDevToolbar().getCommands()` are for the host application. All three re-enumerate
on call, so they are never behind. `runCommand()` rejects with the command's own error
if its `run()` throws or rejects, instead of swallowing it — catch it at the call site.

Core **reports** visibility and never pauses you on your own behalf — a cumulative
counter that silently stops counting is worse than one that keeps going.

Two lifecycle rules the metrics extension paid for, so you do not have to:

- **`hidden` is not "unpainted", it is "does not exist here".** A hidden extension is
  never `start()`ed and is torn down if it becomes hidden; its panel is unmounted and
  closed; and it contributes no commands, so `runCommand()` and P2's palette cannot
  reach it either. Anything less and hiding a collector would leave `fetch` patched,
  its request table on screen, and a copy-to-clipboard command one keystroke away for
  a user not allowed to see any of it. To merely collapse an item out of sight, use
  `priority`.
- **Build your extension once, at module scope.** The object identity *is* the
  lifecycle: `start()` belongs to the object core first saw, so rebuilding it inside
  render leaves the bar rendering a second object that owns nothing. Core warns once
  per id when it detects this. A hot-module reload of the module that builds your
  extensions does the same thing; reload the page.

A minimal one:

```tsx
const build: DevToolbarExtension = {
  id: "build-info",
  label: "Build",
  align: "end",
  priority: 90,
  compact: ({ openPanel }) => (
    <button type="button" data-dtb-part="trigger" onClick={openPanel}>
      {import.meta.env.VITE_COMMIT?.slice(0, 7) ?? "dev"}
    </button>
  ),
  panel: () => <BuildDetails />,
};
```

For subtree-scoped tools, register from inside the tree instead:

```tsx
const { register } = useDevToolbar();
useEffect(() => register(routeTool), [register]);
```

There is no global registry — it would break SSR, break two toolbars on one page,
and leak between tests.

A slot that throws degrades to an error chip. The bar and every other extension keep
working. In the `compact` and `panel` slots the chip is itself a retry button, so a slot
that threw on transient state can be brought back without reloading.
[docs/architecture.md](./architecture.md#7-writing-an-extension).


---

[Documentation index](./README.md)
