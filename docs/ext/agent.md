# `@nejcm/dev-toolbar/ext/agent`

The bridge. An in-page agent — Playwright, CDP, a computer-use tool, the console —
gets the toolbar's own aggregations as JSON instead of scraping the DOM and clicking
pixel coordinates.

**For development builds.** It publishes a handle on a global, and a global is
reachable by any script on the page. It is not shipped by default and is opt-in per
consumer: ship it where you would ship a devtool.

```tsx
import { agentBridge } from "@nejcm/dev-toolbar/ext/agent";

// Once, at module scope. Not inside render.
const extensions = [agentBridge({ instanceId: "playground" })];
```

```js
// …then, from the page:
window.__DEV_TOOLBAR__.instances["playground"].read();
window.__DEV_TOOLBAR__.default.listCommands();
```

`read()` returns `{ instanceId, contractVersion, visible, allowRun, commands, shell,
diagnostics }` — plain JSON-serialisable data, because the reader on the other side is
usually `page.evaluate`, which structured-clones what it returns.

`diagnostics` is one entry per present, non-hidden extension. The first-party
extensions publish typed state there — every flag with its effective, base and default
values; every metric as a number with a unit and a severity; environment rows as
key/value/markers with the masking already applied; which overlays are on; whether the
palette is open and what is typed in it; the theme tokens that have been edited; and a
*summary* of the last diagnostics capture — so a reader answers "is the override
applied" without opening a panel or parsing a chip.

`shell` is the chrome — `mounted`, `position`, `density`, `colorScheme`,
`heightVariable`, `bar`, `overflow`, `activePanel`. It is the one thing the bridge
reads off the DOM, because the shell is core's and core has no extension to publish it
through `diagnostics()`.

## It is a registry, not a singleton

Core supports several mounted roots, so handles are keyed by `instanceId` and
`__DEV_TOOLBAR__.default` **throws** — naming the ids to choose from — when there is
not exactly one mounted. A guess would make the second toolbar an invisible source of
wrong answers. `start(api)` is handed no instance identity, so pass `instanceId` the
same value you pass `<DevToolbar>`, exactly as [`/ext/flags`](./flags.md) and
[`/ext/theme-editor`](./theme-editor.md) ask you to.

A foreign value already sitting at `globalName`, or a second bridge claiming an
`instanceId` that is taken, is refused with a warning rather than overwritten.

## `allowRun` is off by default

Reading is already-redacted extension output. `runCommand` is arbitrary effect chosen
by whoever got a script onto the page, so it is a **second** opt-in:

```tsx
agentBridge({ instanceId: "playground", allowRun: true });
```

With it off there is no way to run anything at all — the handle carries no
`runCommand`, rather than one that refuses.

With it on, errors are values, never rejections: a rejection crossing `page.evaluate`
arrives as a string with no shape to branch on.

```js
await handle.runCommand("diagnostics.copyJson"); // { ok: true }
await handle.runCommand("nope");                 // { ok: false, reason: "unknown-command" }
await handle.runCommand("jobs.explode");         // { ok: false, reason: "threw", error, errorName }
```

## Input and results (contract v2)

`runCommand` takes a second argument and hands back what the command returned, so the
bridge is where an `input`-carrying command is actually usable — `⌘K`
[skips those](./command-menu.md).

```js
// One call, no panel, no pixels:
await handle.runCommand("flags.set", { key: "new-header", value: false });
// { ok: true }

// The snapshot it just captured, rather than "yes, something happened":
const { result } = await handle.runCommand("diagnostics.capture");
result.generatedAt;

// A command that refuses its input is still a value, not a rejection:
await handle.runCommand("flags.set", { key: "new-header", value: "yes" });
// { ok: false, reason: "threw", error: '"new-header" is a boolean flag; "yes" is not …' }
```

`result` is redacted on the way out, like every other read, and is omitted entirely for
the many commands that return nothing. `listCommands()` carries each command's
`description` and `input` schema, which is what makes it a tool listing rather than a
menu — read `input` to know what to pass. The shape of both is in
[the extension contract](../extension-contract.md#contract-v2--commands-with-input-and-a-result).

## What it does not do

- **It adds no enumeration path.** Commands and diagnostics come from `api`, so a
  `hidden` extension contributes nothing through the bridge for exactly the reason it
  contributes nothing to the bar.
- **It reads no extension's DOM.** The single exception is `read().shell`, which is
  read off the toolbar's own root element because nothing else can publish it; every
  other field comes from `api`. It touches no global at module evaluation — importing
  it on a server is inert, and `shell` reports `mounted: false` where there is no
  document.
- **It redacts on the way out.** `read()` runs `api.getDiagnostics()` through
  [`redact()`](../runtime.md) (with your `extraKeys`) as defence in depth on top of the
  contract's requirement that an extension redacts at the source. `runCommand`'s
  `result` goes through the same pass. That is the reason this is an extension and not
  a core feature: core may not import `/runtime`, so a bridge in core would publish
  unredacted output on a global.

  **That pass costs depth, and how much depends on which surface you read.**
  `redact()` walks from depth 0 and substitutes `"[truncated]"` for any object at
  `maxDepth` (8 by default) or deeper — so how much of your `diagnostics()` value
  survives depends on how far inside the redacted root it sits. Measured, for levels
  of nesting below a contribution's own root:

  | Surface | What redacts it | Levels kept |
  | --- | --- | --- |
  | `read().diagnostics[n].data` | the bridge, over the whole roster — `data` is 2 deep | **5** |
  | `runCommand("diagnostics.capture").result` | the bridge, over the whole snapshot — `data` is 3 deep | **4** |
  | The bug-report JSON (`diagnostics.copyJson` / `.download`) | [`/ext/diagnostics`](./diagnostics.md), per contribution at its own root | **7** |

  The bug report is the **most** permissive of the three, not the least:
  `/ext/diagnostics` redacts each contribution at depth 0 as it collects it and never
  re-redacts the assembled snapshot, and `renderJson` is a plain `JSON.stringify`.
  The bridge's capture result is the strictest, because it is that
  already-redacted snapshot put through a *second* pass three levels down. So a
  deeply nested `sources` entry can arrive intact in a bug report and truncated
  through the bridge. If your data nests that far, flatten it, or raise `maxDepth`
  through `redactOptions` at the source. Everything the first-party extensions
  publish is well inside every one of these limits.
- **It renders almost nothing.** No panel and no stylesheet; the `compact` slot is one
  `<span>` carrying the label, a `title`, and
  `data-dtb-agent-mode="read-only" | "run-enabled"` — in an `allowRun: true` build that
  chip is the only in-bar sign that a command-running global is on the page. `priority`
  is `-1`, below core's default of `0`, so it is the **first** item to collapse into the
  `⋮` menu: nothing is lost when it does, and a metrics sparkline in its place would
  be. Pass `hidden: true` to remove it — and the bridge with it, since `hidden` means the
  extension does not exist for this actor, so core never calls `start()`.

## The global goes when the toolbar does

`api.signal` deletes the handle on unregister or unmount, and the last instance out
deletes the global itself. A name still resolving to an empty registry reads as "a
toolbar is mounted" to anything probing for one.

A handle someone captured *before* that refuses afterwards rather than answering out of
an unmounted toolbar: `read()` and `listCommands()` throw, and `runCommand()` resolves
`{ ok: false, reason: "torn-down" }`. Reads throw because the only value-shaped answer
available — an empty snapshot — is indistinguishable from a live toolbar with nothing in
it, which is the wrong answer to hand an agent.

`globalName` (default `"__DEV_TOOLBAR__"`) exists to opt into a *different* name, not
to hide the surface. Discoverability is the point for an agent; obscurity is not a
control, and `allowRun` is.

## Off the page: `report`, and a dev-server route

Everything above needs a script *inside the page*. An agent editing `src/ext/flags`
never loads the app, so the global is invisible to it and a screenshot is a token bill.
`report` closes that: the page POSTs its (coalesced, already-redacted) snapshot to a
local endpoint, and reads pick up whatever that endpoint queued for it.

```tsx
agentBridge({
  instanceId: "playground",
  allowRun: true,
  report: { url: "/__dev-toolbar/state" }, // dev-server route, same origin
});
```

`intervalMs` (default `1000`) caps how often a *snapshot* goes out — writes go through
`createThrottledStore` from [`/runtime`](../runtime.md), so an unchanged snapshot posts
nothing. `pollMs` (default `500`) is how often the page checks in at all, and therefore
the pickup latency for a queued command. Measured on the playground, where live metrics
keep the snapshot changing: a check-in every 500 ms, and 9 distinct snapshots in 12 s,
the gaps alternating 1.0 s and 2.0 s. A command's result always travels with a fresh
snapshot, so a read straight after a write is never behind.

With `allowRun: false` the handle carries no `runCommand`, so a queued command comes
back `{ ok: false, reason: "run-not-allowed" }`: a consumer who wanted reads gets a
reporter, read routes, and no way to run anything.

**The receiving half is not in this package.** It is the playground's own Vite plugin,
[`examples/playground/plugins/devToolbarAgent.ts`](https://github.com/nejcm/dev-toolbar/blob/main/examples/playground/plugins/devToolbarAgent.ts),
deliberately a recipe to copy and adapt rather than a published `./vite` subpath: a
bundler plugin inside a zero-dependency React library is a coupling this does not need
until somebody asks for it. It serves

```
GET  /__dev-toolbar/state         the latest snapshot, plus how old it is
GET  /__dev-toolbar/commands      the command registry, with descriptions and input schemas
POST /__dev-toolbar/commands/:id  queued for the page, result returned
POST /__dev-toolbar/state         where the page checks in
```

so the question the bridge was built for is now a shell command:

```console
$ curl -s localhost:5273/__dev-toolbar/state | jq '.extensions.flags.flags[] | select(.key == "search.rank")'
{
  "key": "search.rank",
  "type": "number",
  "source": "local-override",
  "overridden": true,
  "masked": false,
  "reloadBehavior": "full-reload",
  "effective": 9,
  "base": 2,
  "default": 1,
  "tags": ["override", "reload"]
}

$ curl -s -X POST localhost:5273/__dev-toolbar/commands/flags.set \
    -H 'content-type: application/json' -d '{"key":"search.rank","value":9}'
{ "ok": true, "command": "flags.set", "waitedMs": 785 }
```

`extensions` is the middleware's own projection — one key per extension id, holding
exactly what that extension published — alongside the snapshot's own `commands`,
`shell` and unabridged `diagnostics` roster.

**The `POST` needs a page connected, and says so instead of hanging.** The server has no
channel to the page; the page checks in. So every way that can fail is a status code and
a body, never a wait:

| Situation | Status | `reason` |
| --- | --- | --- |
| Nothing has ever reported | `503` | `no-page-connected` |
| Last check-in older than `staleMs` (3 s) | `503` | `no-page-connected`, with `ageMs` |
| The page's bridge has `allowRun: false` | `403` | `run-not-allowed` |
| No command declares that id | `404` | `unknown-command` |
| The command ran and threw (e.g. refused its input) | `422` | `threw`, with `error` |
| Queued, nobody picked it up within `timeoutMs` (10 s) | `504` | `timeout`, with `pickedUp: false` |
| Cross-origin `Origin` header | `403` | `cross-origin` |

The `GET` routes answer `200` with a stale snapshot and `connection.stale: true` rather
than refusing — the latest snapshot is still the latest snapshot, and saying how old it
is beats saying nothing.

**A backgrounded tab is the one thing that looks like a bug and is not.** The check-in
runs on `setInterval`, and browsers clamp timers in a hidden tab — measured here: the
500 ms poll became 1 000 ms, and one hidden stretch went 10 s with no check-in at all,
so `connection.connected` went `false` and the `POST` route answered
`no-page-connected`. Bring the tab to the front (or take a screenshot of it) and the
check-ins resume within a second. Read `connection` before believing an old
`reportedAt`; that field exists for exactly this.

Round-trip cost, end to end: `POST /commands/:id` returned in `waitedMs` between 266 ms
and 980 ms across the runs in this repo, the spread being where in the poll cycle the
request landed.

**One page at a time.** The middleware holds one slot, so two tabs of the same app
overwrite each other's snapshot and a queued command runs in whichever polls first. That
is a documented limit, not a hidden one: every check-in carries a per-page `reporterId`,
and `connection` reports `reporters` (distinct pages seen within `staleMs`),
`reporterId` (whose snapshot you are reading) and `ambiguous` (`true` above one), while a
command result names the page that ran it in `ranIn`. Read `ambiguous` before trusting a
snapshot. Keying the slot per page is the fix if this ever stops being a one-tab tool.

**Threat model, because this runs arbitrary commands on your open page.** Five controls,
all in the plugin: it is `apply: "serve"` with only a `configureServer` hook, so it
cannot reach a production build; it refuses to install at all when the dev server is
bound to anything but loopback (`--host` prints
`[dev-toolbar-agent] not installed: the dev server is bound to true, not loopback`);
`allowRun` still decides whether the run route does anything; a request carrying a
foreign `Origin` is refused, so a page you happen to be browsing cannot drive your
toolbar through `fetch("http://localhost:5273/…")`; and the `Host` header is itself
checked against the loopback spellings, so the `Origin` comparison cannot be satisfied by
an attacker-controlled name that resolves to `127.0.0.1` (Vite's own host validation
would also catch that today, but it is skipped when `server.https` is set, and a control
this middleware leans on belongs in this middleware). There is no authentication, no TLS
and no rate limiting, deliberately — anything with a shell on that machine can already
do worse. `report` is off by default, and so is `allowRun`.

A malformed check-in body is answered with `400 bad-body`, and both async handlers are
wrapped so any throw becomes `500 middleware-error` rather than an unhandled rejection —
which, under Node's default policy, ends the dev server. That is not hypothetical: three
two-word `curl`s did exactly that before the guard existed, and
`examples/playground/plugins/__tests__/devToolbarAgent.test.ts` now pins all three.

Options: `globalName`, `allowRun`, `extraKeys`, `report`, `instanceId`,
`presentation` (below), `injectStyles`, `styleNonce`, plus the usual
`id` / `label` / `align` / `order` / `priority` / `hidden`.

Commands: none. It contributes a transport, not behaviour.

## Bar presentation

```tsx
agentBridge({ presentation: { icon: <RobotIcon /> } });
```

**Two knobs, not four.** The seven value-bearing extensions take a whole
[`CompactPresentation`](../kit.md#presentation) — `preset`, `icon`, `render`, `name`.
This chip has one text and no value, so there is nothing to preset *against*: every
member but `"default"` would be a no-op or a lie, and a `render` callback over a view
that never changes is a `ReactNode` with extra steps. `AgentPresentation` is therefore
`Pick<CompactPresentation<AgentChipView>, "icon" | "name">`.

The narrowing is visible rather than silent — the bare-preset shorthand is a **compile
error** here, not an option that quietly does nothing:

```tsx
agentBridge({ presentation: "icon" });
// error TS2559: Type 'string' has no properties in common with type 'AgentPresentation'.
```

Like every factory option it is fixed when the factory is called; remount the toolbar or
reload to change it.

- **`TView` is `AgentChipView`.** This extension has no store, so there is no snapshot to
  hand a callback: it gets the four facts the chip *is* — `label`, `allowRun`,
  `globalName`, `instanceId`. `allowRun` is the one worth branching on:
  `icon: (view) => (view.allowRun ? <Armed /> : <ReadOnly />)` paints the distinction
  `data-dtb-agent-mode` already carries.
- **An icon replaces the label in the bar, and joins it in the `⋮` menu.** The chip is a
  readout; an icon and a word side by side say the same thing twice in the width the bar
  is short of. The menu is never wordless, which is the rule the kit enforces everywhere.
- **With an icon the chip becomes `role="img"` with an `aria-label`** — a bare
  `<span aria-label>` is *not* a named node, so the attribute would be ignored and the
  chip announced by its `title`, or by nothing. **Without** an icon it stays the
  role-less `<span>` it has always been, named by its own text. Adding a role there would
  move the default's accessible name, so it is conditional on purpose — and the corollary
  is that **`name` does nothing without an icon**: there is no named node for it to land
  on.
- **New parts, both on the icon path only:** `agent-icon` (the glyph wrapper) and
  `agent-label` (the `⋮` word).
- **`injectStyles` (default `true`) and `styleNonce` apply on the icon path only.** The
  one sheet this extension brings is `KIT_CSS`, for the glyph clamp, and it is ensured
  only while an icon is on the bar — so under a nonce-based CSP a consumer who never
  passes an icon never sees a kit `<style>` from `/ext/agent` at all. Turn `injectStyles`
  off if you turned core's off, and ship `KIT_CSS` yourself.
- **Nothing here reaches the bridge.** The icon lives in the factory closure and is read
  during render, so no `ReactNode` can reach `read()` or the `report` transport — both of
  which must stay JSON.

The `role="img"` path is proven in a browser as well as in unit tests. The playground
opts this extension into an icon in both of its non-`default` **Bar icons** modes
(`examples/playground/src/barIcons.tsx`), and
`examples/playground/e2e/presentation.spec.ts` pins the fork: exactly one `[role="img"]`
inside the bar in `icon` mode — this chip, carrying a non-empty `aria-label`, its
`data-dtb-agent-mode`, one clamped `<svg>` and no text of its own — and none in
`default`. axe-core 4.13.0 over an include-the-bar context
(`{ include: [["[data-dev-toolbar]"]] }`, which is what a consumer passes through
`/ext/a11y`'s `context` option, since its default *excludes* the toolbar) reports the
node as **passing** `aria-allowed-role`, `aria-roles` and `role-img-alt`; in `default`
mode `role-img-alt` is inapplicable, because there is no such node.

---

[Documentation index](../README.md) · [Extension contract](../extension-contract.md) · [Runtime](../runtime.md)
