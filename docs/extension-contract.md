# The extension contract

An extension is a plain object.

```ts
interface DevToolbarExtension {
  id: string;                    // identity: dedupe, panel state, storage scope
  label: string;
  contractVersion?: number;      // core warns once on a mismatch
  align?: "start" | "end";       // default "start"
  order?: number;                // ascending, within the region
  priority?: number;             // lowest collapses into ⋮ first
  hidden?: boolean;              // you compute this — core has no ctx
  keepMounted?: boolean;         // panel state survives closing
  compact?: (props: CompactSlotProps) => React.ReactNode;
  panel?: (props: PanelSlotProps) => React.ReactNode;
  overlay?: (props: OverlaySlotProps) => React.ReactNode;   // modal; never collapsed
  // Core aggregates; it renders no palette. A function is re-enumerated on
  // every pass, so a command that only exists later is still reachable.
  commands?: AnyToolbarCommand[] | (() => AnyToolbarCommand[]);
  // Aggregated the same way as commands; /ext/diagnostics renders the roster.
  diagnostics?: () => unknown;
  start?(api: ExtensionRuntimeApi): void | (() => void);
}
```

`compact` and `panel` are render *functions*, not components, so core can hand down
state you cannot otherwise know:

```ts
interface CompactSlotProps {
  isOverflowed: boolean;         // rendered in the ⋮ menu rather than the bar
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
the `⋮` menu is not in the DOM at all, which would cost an extension its modal (and
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
  getCommands(): readonly AnyToolbarCommand[];          // the live aggregation
  runCommand(id: string, input?: unknown): Promise<boolean>;   // false = nothing declares it
  invokeCommand<Out>(id, input?): Promise<CommandInvocation<Out>>;  // ... and what it returned
  getDiagnostics(): readonly ExtensionDiagnostics[];    // one entry per present extension
}
```

`getCommands()` / `runCommand()` / `invokeCommand()` / `getDiagnostics()` are how an extension reads the
aggregation without importing a *value* from core — `useToolbarCommands()` and
`useDevToolbar().getCommands()` are for the host application. All three re-enumerate
on call, so they are never behind. `runCommand()` rejects with the command's own error
if its `run()` throws or rejects, instead of swallowing it — catch it at the call site.

Core **reports** visibility and never pauses you on your own behalf — a cumulative
counter that silently stops counting is worse than one that keeps going.

Two lifecycle rules the metrics extension paid for, so you do not have to:

- **`hidden` is not "unpainted", it is "does not exist here".** A hidden extension is
  never `start()`ed and is torn down if it becomes hidden; its panel is unmounted and
  closed; and it contributes no commands, so `runCommand()` and the ⌘K palette cannot
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

## Contract v2 — commands with input and a result

`CONTRACT_VERSION` is `2`. A command may now say what it takes and hand back what it
produced:

```ts
interface ToolbarCommand<In = void, Out = void> {
  id: string;
  label: string;
  description?: string;          // prose for a reader deciding whether to call it
  group?: string;
  keywords?: string[];
  shortcut?: string;             // display-only
  input?: CommandInputSchema;    // absent = takes nothing
  run(input: In): Out | Promise<Out>;
}
```

**If you wrote an extension against v1, you have nothing to do.** `In` and `Out` both
default to `void`, so a `run(): void` you already wrote still satisfies
`run(input: void): void`, and a roster typed `readonly ToolbarCommand[]` still type-checks.
Declaring `contractVersion: 1` remains legal — core warns once in the console and
changes nothing else, exactly as [ADR-003](./adr/ADR-003-contract-version-policy.md)
describes. Bump the number when you start using `input`, `description` or a return
value; leave it alone otherwise, or drop the field.

**One exception, and it is a compile error rather than a surprise at runtime.**
`ExtensionRuntimeApi` gained a required `invokeCommand`. Core is what *provides* that
object, so writing an extension is unaffected — but if you **construct** one, which in
practice means a hand-rolled fake `api` in your tests, it will not type-check until you
add the method. It is required rather than optional on purpose: an optional method
every caller has to guard is a weaker contract than one core guarantees. The one-line
stub is:

```ts
invokeCommand: async () => ({ ok: false, reason: "unknown-command" }) as const,
```

`fakeExtensionApi()` from [`/testing`](./testing.md) is the answer that survives the
*next* widening too — reach for it rather than writing the object out by hand.

This is the only part of v2 that is not purely additive in source terms.

The one thing worth knowing: to give a command a typed `In`, declare the generic
explicitly. Inside a `ToolbarCommand[]` literal, contextual typing infers `In` as
`void`:

```ts
const setFlag: ToolbarCommand<{ key: string; value?: FlagValue }> = {
  id: "flags.set",
  label: "Set a feature flag override",
  input: {
    fields: {
      key: { type: "string", required: true },
      value: { type: ["boolean", "string", "number"] },
    },
  },
  run: ({ key, value }) => runtime.applyOverride(key, value),
};
```

### `CommandInputSchema` is deliberately small

It is **not** JSON Schema and **not** Zod. Zero runtime dependencies is a rule here,
and every shape a toolbar command has actually needed is a flat bag of
`boolean | string | number | enum`:

```ts
interface CommandInputSchema {
  fields: Readonly<Record<string, CommandInputField>>;
}

type CommandInputField =
  | { type: CommandInputType | readonly CommandInputType[]; ...common }  // boolean|string|number
  | { type: "enum"; values: readonly CommandInputValue[]; ...common };

// ...common: description?, required?, default?
```

No nesting, no arrays, no `anyOf`/`$ref`, no `minimum`/`pattern`, and **no validator**.
The schema is a *description for a reader* — a palette deciding whether it can render
a form, an agent deciding what to pass. `run()` is the only thing that knows what its
own input means, so `run()` is what refuses bad input, by throwing a message that says
why. [`/ext/flags`](./ext/flags.md)' `flags.set` refuses a value of the wrong type
rather than coercing it, which is the same rule its panel editor already followed.

The array form of `type` is there because polymorphic values are real: `flags.set`'s
`value` is whatever type the *named* flag has, and a schema that could not say so
would be a lie the first time it was used.

### Running one, and reading the result

`run()` may return a value. `runCommand` still resolves a boolean — it is published,
and widening it would make every `if (await runCommand(id))` pass silently — so the
result comes back through `invokeCommand`:

```ts
const outcome = await api.invokeCommand("diagnostics.capture");
// { ok: true, result: DiagnosticSnapshot }   — the snapshot it just captured
```

Available as `useDevToolbar().invokeCommand(id, input?)` in the host, `api.invokeCommand`
in an extension, `invokeCommand(id, { input, scope })` as a bare export, and
`toolbar.invokeCommand()` in [`@nejcm/dev-toolbar/testing`](./testing.md). All of them
reject with the command's own error if `run()` throws — only
[`/ext/agent`](./ext/agent.md) turns that into a value, because a rejection crossing
`page.evaluate` arrives as a bare string.

### What a palette does with `input`

[`/ext/command-menu`](./ext/command-menu.md) **skips every command that declares
`input`**. It has no form to render one with, and a row that cannot be run — or one
that runs with `undefined` and throws — would both be worse than not listing it. Those
commands stay fully reachable through `getCommands()`, `invokeCommand()` and
[`/ext/agent`](./ext/agent.md). A form in the palette is a later change, not a missing
piece of this one.


---

[Documentation index](./README.md)
