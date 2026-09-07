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
this extension exists for is a global, not a panel.

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

## Options that change behaviour

`globalName`, `allowRun`, `report`, `extraKeys`, `instanceId`,
`contractVersion`.

## Tests

`__tests__/agent.test.tsx` for the bridge and the registry, `phase1`–`phase3`
for each layer of the surface, and `protocol-version.test.ts` for the version
the handle publishes.
