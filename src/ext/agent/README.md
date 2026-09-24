# `ext/agent`

The bar's state and commands on a global, so an in-page agent can read them from
`page.evaluate` rather than scrape the DOM. Development builds; running commands
is a second, separate opt-in.

- **Subpath:** `@nejcm/dev-toolbar/ext/agent`
- **Factory:** `agentBridge(options?)` → `DevToolbarExtension`
- **Full documentation:** [docs/ext/agent.md](../../../docs/ext/agent.md)

## Files

| File | What is in it |
| --- | --- |
| `index.tsx` | The factory and the chip |
| `runtime.ts` | `installAgentBridge()` — the registry, the global, the handle, teardown |
| `report.ts` | The optional off-page transport: coalesced POSTs and the command queue |
| `types.ts` | The published handle's shape, `DEFAULT_GLOBAL_NAME`, the protocol version |

There is no `ui.tsx` or `css.ts`: the chip is a plain trigger, and the surface
this extension exists for is a global, not a panel. It stays that way with an
icon — the one rule an icon needs is `/kit`'s glyph clamp, so this extension
ensures **kit's** sheet rather than growing one of its own.

## The decisions worth knowing

- **A registry, not a singleton.** Core supports multiple mounted roots, so
  `default` *throws* unless there is exactly one rather than guessing which.
- **It paints a chip on purpose.** The plan called for no `compact` and no
  `panel`, but that shape paints a chip anyway — `Bar.tsx` falls back to a
  `trigger` span — and a null compact slot still creates the item and its
  divider. `hidden` would stop `start()` entirely and take the global with it,
  so `priority: -1` makes the chip collapse first instead.
- **`allowRun` defaults off**, because the global is reachable by any page
  script. When it is off the published handle has no `runCommand`, and a command
  queued through `report` comes back refused rather than run. Changing
  `globalName` is not a substitute — obscurity is not a control.
- **`report` is absent by default**, and absent means the bridge opens no
  connection to anything: the global is the whole surface, and only a script
  already in the page can reach it. Present means the page POSTs its coalesced,
  already-redacted snapshot to `report.url` and picks up queued commands, which
  is what lets an agent that never loads the app `curl` the state. Point it at a
  dev-server route on the **same origin**.
- **Nothing touches a global at module evaluation**, so SSR stays safe.
  Teardown removes stale handles and the global.
- **`read().shell` is the one DOM read.** The shell belongs to core, which has
  no extension to publish those facts through `diagnostics()`; changing that
  would be a core contract change.

Core's import boundary applies here as everywhere: this extension imports only
core *types*, and uses `/runtime` for redaction — which core itself may not.
The roster and command results are masked by the kit's `readDiagnosticsRoster` and
`redactForExport`, the same reader `/ext/diagnostics` uses.

## Options that change behaviour

`globalName`, `allowRun`, `report`, `extraKeys`, `instanceId`,
`contractVersion`.

## Presentation

```tsx
agentBridge({ presentation: { icon: <RobotIcon /> } });
```

**Two knobs, not four.** The seven value-bearing extensions take the whole
`CompactPresentation` — `preset`, `icon`, `render` and `name`. This chip has one
text and no value, so every preset member but `"default"` would be a no-op or a
lie and a `render` callback over a view that never changes is a `ReactNode` with
extra steps. `AgentPresentation` is `Pick<CompactPresentation<AgentChipView>,
"icon" | "name">`: the two knobs that act, meaning exactly what they mean on the
other eight.

`TView` is `AgentChipView` — this extension has **no store**, so there is no
snapshot to hand a callback. It gets the four facts the chip *is* instead:
`label`, `allowRun`, `globalName`, `instanceId`. `allowRun` is the one worth
branching on: `icon: (view) => (view.allowRun ? <Armed /> : <ReadOnly />)` paints
the distinction `data-dtb-agent-mode` already carries.

- **An icon replaces the label in the bar, and joins it in the `⋮` menu.** The
  chip is a readout; an icon and a word side by side say the same thing twice in
  the width the bar is short of. The menu is never wordless, which is the rule
  `/kit` enforces for every preset.
- **With an icon the chip becomes `role="img"` with an `aria-label`.** A bare
  `<span aria-label>` is *not* a named node — the attribute is ignored and the
  chip is announced by its `title`, or by nothing. **Without** an icon it stays
  the role-less span it has always been, named by its own text: adding a role
  there would change what every screen reader already reads out, so `name`
  without an icon does nothing.
- **`title` is not overridable.** It explains — which global, which instance,
  whether running is allowed — and it does not name.
- **Nothing reaches the bridge.** The icon lives in the factory closure and is
  read during render, so no `ReactNode` can reach `read()` or the `report`
  transport, both of which must stay JSON.
- **New parts:** `agent-icon` (the `Glyph`) and `agent-label` (the `⋮` word).
  Both only exist on the icon path.

`injectStyles` (default `true`) and `styleNonce` control the one stylesheet this
brings: `KIT_CSS`, ensured only while an icon is on the bar. Turn it off if you
turned off core's `injectStyles`, and ship `KIT_CSS` yourself.

`docs/adr/ADR-004-per-extension-bar-presentation.md` records the decision.

## Tests

`__tests__/agent.test.tsx` for the bridge and the registry, `phase1`–`phase3`
for each layer of the surface, `protocol-version.test.ts` for the version the
handle publishes, and `presentation.test.tsx` for the chip — where the
default tree is pinned as a literal string and the role-less chip's
`title`-derived accessible name is pinned with it.
