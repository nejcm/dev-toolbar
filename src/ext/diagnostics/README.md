# `ext/diagnostics`

One snapshot for a bug report: the page, long tasks, a tail of console errors
and unhandled rejections, and every other extension's diagnostics. You read the
exact text before it goes anywhere.

- **Subpath:** `@nejcm/dev-toolbar/ext/diagnostics`
- **Factory:** `diagnostics(options?)` → `DevToolbarExtension`
- **Full documentation:** [docs/ext/diagnostics.md](../../../docs/ext/diagnostics.md)

```tsx
const extensions = [
  metrics(),
  flags({ /* … */ }),
  diagnostics({ app: () => ({ release: __RELEASE__, userId: session.userId }) }),
];
```

## Files

| File | What is in it |
| --- | --- |
| `index.tsx` | The factory, the capture commands and the export descriptions |
| `runtime.ts` | The snapshot: page facts, aggregation, redaction, JSON and Markdown |
| `console.ts` | The console/error tail — patching, grouping, the ring, stack masking |
| `responsiveness.ts` | `PerformanceObserver` long-task and responsiveness data |
| `ui.tsx` / `css.ts` | The chip (which counts the tail) and the panel |
| `types.ts` | `ConsoleTailEntry`, the snapshot shape and the omission vocabulary |

## It aggregates; it does not re-collect

Flags, metrics and session context are owned by extensions that know more about
them than this one could, so the snapshot *asks*: core aggregates
`DevToolbarExtension.diagnostics()` the way it aggregates `commands`, and this
extension reads the roster through `api.getDiagnostics()`. It collects for
itself only what no other extension owns — page facts and the
`PerformanceObserver` data.

## What it promises

- **Nothing leaves the machine on its own.** The panel shows the exact text the
  copy and download buttons would produce, before either is pressed.
- **Redaction happens on the way in, once.** Panel, clipboard, download and
  every command read the same already-redacted object; serialising before
  redacting would make nested keys invisible to the matcher.
- **Omissions are visible.** A contributing extension that throws or fails to
  serialise gets a status, a line in top-level `omissions`, a panel banner and a
  Markdown heading — never a silent drop.
- **It never claims to know what it does not.** Entry types vary by engine, so
  counts are `null` rather than `0` when unobservable, each with a note.
- **It says what went wrong on the way here.** `window`'s `error` and
  `unhandledrejection` events and patched `console.error`/`console.warn` go into
  a bounded, grouped tail. The patch always calls through, restores by identity
  on teardown, is opt-out-able per method (`console: false` for all of it), and
  never touches `console.log`.

## Two redactors, deliberately different

`entries[].message` is judged by the runtime's `redactProse()` — `redact()`'s
**whole-value** matching plus a URL sweep, never a substring scan.
`entries[].stack` goes through `redactText()`, which scans for the same
credential shapes *anywhere inside* the text and masks the matched spans in
place. A stack is exactly the case anchored matching cannot serve — its
credentials arrive inside longer lines — and every earlier attempt to handle
that by *classifying* lines (a frame classifier, a header classifier, a
whitespace tokeniser) shipped a leak. `redactText()` classifies nothing.

The consequences, and the limits still pinned by tests, are in
[docs/ext/diagnostics.md](../../../docs/ext/diagnostics.md#accepted-limits).

## What it is not

Not a security boundary. `redact()` is key-name and value-shape matching, so a
credential under an innocent key can survive. The panel shows you the text
because **you** are the last check before it reaches a ticket.

## Commands

`<id>.capture`, `<id>.copy`, `<id>.copyJson`, `<id>.download`,
`<id>.console.clear`, `<id>.console.export`.

## Options that change behaviour

`app`, `sources`, `console`, `recentSize`, `redactOptions`.

`presentation` changes how the bar control looks, not what it captures: a
`CompactPreset`, your own `ReactNode` icon (or `(view) => ReactNode`), a
`render` callback and an accessible-name override. It resolves through `/kit`'s
`resolveCompactControl`, so `"default"` is byte-identical to what shipped
before the option existed and the `⋮` menu always paints the full `label`.
**Presets operate on the short bar word (`"diagnostics"`)**, which is the swing
`ui.tsx` used to write by hand as `isOverflowed ? label : "diagnostics"`;
`label` stays the overflow and accessible-name identity.

The callbacks receive a narrow **`DiagnosticsBarView`** — `captured`,
`omissions`, `errors`, `warnings` — and not `DiagnosticsSnapshotState`, whose
`revision`, `capturedAt` and `snapshot` read as implementation detail. A view
type that is only read can gain and lose fields freely; as a callback parameter
it is contravariant, so every field there is one that cannot be renamed later.

**The error/warning badge is not yours to restyle.** It sits outside both the
preset and `render`, after the contents, under every preset including `"icon"`
— it is live state, and the one thing on the chip that says something is wrong.
The parts go in as the kit `Chip`'s *children* rather than its
`icon` / `label` / `value` slots, so `render` replaces them and never the
`Chip` — the dot, `data-dtb-incomplete` and the `aria-label` are not a
callback's to lose. Nothing configured here reaches the store: this snapshot is
`JSON.stringify`d into the report, which a React element does not survive, so the
icon and the callbacks stay in the factory closure and travel as props.
[ADR-004](../../../docs/adr/ADR-004-per-extension-bar-presentation.md).

## Tests

`__tests__/console.test.tsx` for the tail and its masking,
`responsiveness.test.ts` for the observer data, `runtime.test.ts` for the
snapshot and its exports, `diagnostics.test.tsx` for the panel and commands.
`presentation.test.tsx` pins the default bar and `⋮` markup as literal strings
— in the empty state *and* with a caught error and warning, so the badge's
hand-written attributes are covered — plus every preset in both places and the
three callbacks.
