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
  closeButton?: boolean;         // default true; hide core's panel close button
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
  styleNonce?: string;           // CSP nonce for a stylesheet this slot injects
}

interface PanelSlotProps {
  isActive: boolean;             // false only for keepMounted panels
  density: "compact" | "comfortable";
  height: number;
  close(): void;
  styleNonce?: string;
}

interface OverlaySlotProps {
  density: "compact" | "comfortable";
  position: "bottom" | "top";
  styleNonce?: string;
}
```

Core adds a close button to an open panel. Set `closeButton: false` when the panel
already has one; Escape still closes the panel. This optional field is additive and
does not change `CONTRACT_VERSION`.

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

Both `isVisible()` and `subscribeVisibility()` report the *effective* visibility: the
controlled `visible` prop where the host passes one, the persisted store value
otherwise. The callback fires from a post-commit effect — after React has committed
the change, not synchronously inside the update that caused it — and not on subscribe,
so read `isVisible()` for the current value. Flips that cancel out inside one batch (a
hide then a show) are coalesced and deliver nothing.

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
  per id when it detects this — `extension "<id>" was rebuilt after it started` — and
  keeps the first object's `start()`. A hot-module reload of the module that builds your
  extensions does the same thing; reload the page.

  **The corollary: a factory option cannot be changed at runtime.** Handing
  `<DevToolbar>` a freshly built object for a running id is that same warning, not a
  reconfiguration: the new closure is never started, so the bar renders a control wired
  to a runtime nobody is driving, and the symptom is a chip that has quietly stopped
  updating. To change `presentation`, `label`, `injectStyles` or any other factory option
  while the app is running, remount the toolbar — `<DevToolbar key={mode} …>` — or reload
  the page. `examples/playground/src/App.tsx` is the worked example.

  The corollary every real app meets on day one: the object cannot read a hook, yet
  what it shows — the signed-in user, the workspace, the resolved flags — lives in
  React or in a store. Do not reach for a module-scope variable that an effect keeps
  current: reset in a cleanup, it reads as absent between StrictMode's double mount.
  Give the extension a [`Readable`](./kit.md#live-input) instead — a `createSource()`
  written from the component through `useSource()`, a Zustand/Redux store passed
  as-is, or `derive()` over several — and subscribe to it in `start()`, publishing on
  notify. On teardown core aborts `signal` and *then* calls the cleanup `start()`
  returned, so a subscription released from both must have an idempotent cleanup —
  the second call finds nothing left to release. `/ext/environment` and `/ext/flags`
  accept one directly; `readInput()` and
  `isReadable()` in the kit are the two lines your own `start()` needs to do the same,
  while still accepting a plain value or a polled getter.

## Writing one that looks native

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

A dozen lines, and it imports nothing. That is the floor on purpose: an extension is
a plain object, and none of what follows is required to render one. The same floor is
how a *third-party* devtool gets onto the bar — `{ id, label, panel: () => <Whatever /> }`
and core supplies the trigger; [embedding.md](./embedding.md) is that recipe, the
bring-your-own-CSS rule that goes with it, and the optional `embed()` frame helper.

The next step, when you want it to look like the first-party panels rather than like a
`<button>` on a page, is [`@nejcm/dev-toolbar/kit`](./kit.md) — the shared stylesheet
and the thin controls over it. Nothing there is a framework; each control renders the
DOM you would have written, plus a `data-dtb-kind` the shared sheet styles. A useful
order to pick them up:

**`Chip` first**, because the compact slot is what everybody sees. A dot, a label and a
value, laid out and coloured like every other chip in the bar:

```tsx
import { Chip } from "@nejcm/dev-toolbar/kit";

compact: ({ isPanelOpen, togglePanel }) => (
  <button type="button" data-dtb-part="trigger" aria-expanded={isPanelOpen} onClick={togglePanel}>
    <Chip label="build" value={commit} severity="ok" data-dtb-part="build-chip" />
  </button>
),
```

`severity` colours the dot and the value from `--dtb-ok` / `--dtb-warn` /
`--dtb-danger`, so your chip agrees with the rest of the bar for free.

If you want the consumer of *your* extension to be able to restyle that chip the way
they can restyle the first-party ones — an icon of theirs, icon-only, icon plus value —
the kit publishes the vocabulary for it: one `presentation` option holding a preset, a
`ReactNode` icon, a `render` callback over your own view type and an accessible-name
override, plus the four pure helpers that resolve it. The shape, the preset table, the
two guarantees it enforces and a worked bar control are in
[kit.md](./kit.md#presentation). No icon set ships with this package; icons are the
consumer's assets, passed in.

**`Note` and `Action` next** — the two things every panel has. `Note` is muted,
margin-free secondary text; `Action` is a `<button type="button">` carrying the shared
reset, so your buttons match the ones next door and cannot accidentally submit a form.

```tsx
<Note data-dtb-part="build-note">Read from `import.meta.env` at build time.</Note>
<Action data-dtb-part="build-action" onClick={reload}>Reload</Action>
```

**`Rows` then**, once the panel has more than a sentence to say. It is the two-column
key/value `<dl>` grid the first-party panels print their readouts into; `Row` is one
`<dt>`/`<dd>` pair:

```tsx
<Rows data-dtb-part="build-rows">
  <Row label="Commit">{commit}</Row>
  <Row label="Built">{builtAt}</Row>
</Rows>
```

**`SearchField` last**, when the list is long enough that scrolling it stops working.
It pairs with the kit's `matchesQuery(haystack, query)`, and the state stays yours:

```tsx
const [query, setQuery] = useState("");
const visible = rows.filter((row) => matchesQuery([row.label, row.value], query));
…
<SearchField label="Search build facts" value={query} onChange={setQuery} />
```

Two more things belong in the same step. `useExtensionSurface(store, injectStyles,
ensureStyles, styleNonce)` is how a slot stays cheap — the slot returns a component,
the component subscribes to your store and ensures your stylesheet. And if you ship
CSS, `createStyleInjector` plus `ensureKitStyles` is the pair that delivers the shared
sheet alongside your own. The full reference, including what deliberately is *not* in
the kit, is [docs/kit.md](./kit.md); `examples/playground/src/kitDemo.tsx` is one
extension built entirely from it, end to end.

For subtree-scoped tools, register from inside the tree instead:

```tsx
const { register } = useDevToolbar();
useEffect(() => register(routeTool), [register]);
```

There is no global registry — it would break SSR, break two toolbars on one page,
and leak between tests.

A slot that throws degrades to an error chip. The bar and every other extension keep
working. In the `compact` and `panel` slots the chip is itself a retry button, so a slot
that threw on transient state can be brought back without reloading. The optional
`onExtensionError` callback receives the normalized error and slot metadata while the
local failure is still logged to the console.
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
  shortcut?: string;             // hint; bound only with bindCommandShortcuts
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
