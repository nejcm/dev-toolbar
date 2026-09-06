# Testing extensions

`renderWithToolbar` needs `@testing-library/react`, an **optional** peer. The other
testing helpers do not need it, and the runtime import stays clean without it.
The helpers import the root package, which requires `react-dom`. Calling
`renderWithToolbar()` without it throws a message telling you what to install.

The runtime import is clean without RTL; the types are not. `dist/testing.d.ts`
and `dist/testing.d.cts` both statically import `@testing-library/react`'s own
types, so a consumer without RTL installed still hits an unresolved-module error
from the type-checker — under `skipLibCheck: false`, which is `tsc`'s own default,
not an edge case — even though nothing breaks at runtime.

```bash
npm install --save-dev @testing-library/react
```

```tsx
import { makeExtension, renderWithToolbar } from "@nejcm/dev-toolbar/testing";

const { toolbar, unmount } = renderWithToolbar(<App />, {
  extensions: [myExtension],
  layout: { barWidth: 600, itemWidth: 80 },   // jsdom reports every box as 0×0
});

toolbar.openPanel("my-extension");
expect(toolbar.panel("my-extension")).not.toBeNull();

toolbar.resize(160);
expect(toolbar.overflowedIds()).toContain("my-extension");
unmount();
```

Toolbar handles are instance-scoped: their DOM queries and state changes refer to
the toolbar they mounted. Use a different `instanceId` for each toolbar when
mounting more than one in a test.

`overflowedIds()` and `isOverflowed()` answer *whether* an item collapsed and work
with the `⋮` menu closed. A collapsed item is not rendered at all until the menu
opens, so `item(id)` returns `null` for one until you call `toolbar.openOverflow()`.

`panel(id)` answers presence in the DOM, which is not the same question as *open*: a
`keepMounted` panel stays mounted, rendered `hidden`, after `closePanel()`, so
`expect(toolbar.panel(id)).not.toBeNull()` keeps passing for one even while it is
closed. Ask `activePanelId()` when the question is really whether the panel is open.

Every `toolbar` method that changes state is `act()`-wrapped for you — including
`runCommand(id)`, which is `async` because the command it runs may be, so it is the
one you await instead of wrapping again:

```ts
expect(await toolbar.runCommand("queue.drain")).toBe(true);
```

`toolbar.invokeCommand(id, input?)` is the contract v2 counterpart, `act()`-wrapped the
same way, for a command that takes input or returns something:

```ts
const outcome = await toolbar.invokeCommand("flags.set", { key: "beta", value: true });
expect(outcome).toEqual({ ok: true, result: undefined });
```

`@nejcm/dev-toolbar/testing` also ships `makeExtension()` for throwaway extensions
(including deliberately broken ones, via `throwInCompact` / `throwInPanel` /
`throwInStart`), `fakeExtensionApi()` for the object `start()`
receives, `createMockBus()` for a pub/sub bus with a hand-cranked clock, and
`installToolbarLayout()` if you would rather drive the fake layout yourself.
`installClipboard()` records completed writes in a live readonly array without
importing `/runtime` or `/kit`; pass `null` to make the clipboard explicitly
unavailable. Call its idempotent `restore()` in teardown. Storage defaults to a fresh
in-memory adapter, so tests never leak preferences into each other.

**`makeCommand(options?)`.** The same idea as `makeExtension()`, but for a single
`ToolbarCommand`: an id (auto-generated as `fake-command-N` if you don't pass one), a
`label` that defaults to the id, and a `run` that defaults to a no-op you can
overwrite with your own spy.

```ts
import { makeCommand } from "@nejcm/dev-toolbar/testing";

const run = vi.fn();
const command = makeCommand({ label: "Drain queue", run });
```

**`fakeExtensionApi(options?)`.** The `ExtensionRuntimeApi` object core hands to
`start()`, built by hand — for a test that drives an extension's runtime directly
without mounting a toolbar. Returns `{ api, setVisible, abort, controller }`:
pass `api` to `start()`, call `setVisible(false)` to drive the visibility
subscription, and `abort()` to fire the teardown path `api.signal` represents.

```ts
import { fakeExtensionApi } from "@nejcm/dev-toolbar/testing";

const { api, setVisible, abort } = fakeExtensionApi({
  getCommands: () => [myCommand],       // every member is overridable
});

const stop = myRuntime.start(api);
setVisible(false);
expect(myRuntime.store.getSnapshot().paused).toBe(true);
stop();
abort();
```

Defaults are the empty shape: visible, nothing aggregated, `runCommand`
resolving `false`, `invokeCommand` resolving `{ ok: false, reason:
"unknown-command" }`, and a fresh `createMemoryStorage()`. Overriding `isVisible`
or `subscribeVisibility` opts that half out of `setVisible` — override both or
neither.

Reach for this rather than writing the object out by hand. `ExtensionRuntimeApi`
is the one half of the contract a consumer *constructs* rather than consumes, so
every widening of it is a compile error in every suite that fakes one:
[contract v2](./extension-contract.md#contract-v2--commands-with-input-and-a-result)'s
required `invokeCommand` broke ten inside this repo alone. This helper is where the
next widening is absorbed.

**`resetExtensionIds()`.** Resets the `fake-N` / `fake-command-N` counters that
`makeExtension()` and `makeCommand()` draw generated ids from, back to zero. The two
sequences are independent. Only needed when a test asserts on a generated id itself;
passing an explicit `id` never advances either counter, so most tests don't need it.

**`testingLibraryReady`.** A `Promise<void>` that resolves once the eagerly-started,
optional `@testing-library/react` import has settled, one way or the other — it never
rejects; a failed import just sets an internal flag that `renderWithToolbar()`'s error
message reports. Under an ESM runner like Vitest this has already settled by the time
a test body runs, since the runner evaluates the whole module graph first, so await
it only if you need to render during module evaluation itself. Under Jest it is a
weaker guarantee: the dynamic `import()` it is chained to never settles inside Jest's
sandbox (see the header comment in `src/testing/reactTestingLibrary.ts`), so this
promise may simply never settle there either — never await it as a gate under Jest.
`renderWithToolbar()` doesn't need it regardless: under Jest it loads Testing Library
through the runner's own `require` instead.

**`createMemoryStorage()` / `createNullStorage()`.** Re-exported here for
convenience; they are the same functions the package's root entry exports, in both
the ESM and CJS builds (see *Conventions* in AGENTS.md for why `/testing` reaches
core through `@nejcm/dev-toolbar` rather than a relative import). Reach for them
directly when seeding storage before render or asserting against the adapter
afterward.

**`rerender(ui)`.** On the object `renderWithToolbar()` returns, it re-renders `ui`
inside the *same* mounted toolbar — its preferences and any installed layout survive.
It overrides Testing Library's own `rerender`, which would otherwise replace the
whole tree, toolbar included, since no `wrapper` sits between them.

**`mountToolbar()` / `cleanupToolbar()`.** A suite that mounts more than once tends to
grow an array of `unmount` functions and an `afterEach` that drains it. `mountToolbar()`
is `renderWithToolbar()` that keeps that list for you, and `cleanupToolbar()` drains it
— newest mount first — and restores any fake layout still installed. The returned
`unmount` is idempotent and de-registers the mount, so a test that tears its own
toolbar down to assert teardown behaviour needs no bookkeeping either.

**`afterEach(cleanupToolbar)` is required if you use `mountToolbar()`**, not optional
tidying. The tracked list is this package's own, and nothing tells it about RTL's
auto-cleanup: without the hook it is never drained, so it accumulates every mount in
the file and the last-in-first-out teardown it exists to provide never happens. Add
the hook, or use plain `renderWithToolbar()` and add nothing — its own teardown, the
layout included, rides entirely on RTL's cleanup.

```tsx
import { afterEach } from "vitest";
import { cleanupToolbar, mountToolbar } from "@nejcm/dev-toolbar/testing";

afterEach(cleanupToolbar);

const { toolbar } = mountToolbar(<App />, { extensions: [myExtension], layout: true });
```

`createMockBus()` satisfies the `BusLike<ToolbarEventMap>` that `metrics`' `network.bus`
asks for, so it stands in for a real bus rather than merely resembling one — and its
`on` / `once` / `onAny` honour `{ signal }`, so a collector under test tears down on
its `AbortSignal` exactly as it does in production. It is deliberately *wider* than
that contract — `type` is `string` everywhere rather than a key of an event map, plus
a recorded history — which is the direction assignability needs; but it is not
generic the way `EventBus<Events>` is, so it is only structurally substitutable for a
specific `BusLike<Events>`, never a drop-in typed replacement for it. See the file
header of `src/testing/mockBus.ts` for the authoritative list of where it diverges
from `createEventBus()`; a few worth knowing up front:

- **`onError`** — mirrors `createEventBus()`'s option of the same name: called when a
  handler throws during `emit()`, instead of the error propagating to the caller.
  Defaults to `console.error`, same as the real bus.
- **`reset()` is wider than the real bus's `clear()`.** `EventBus.clear()` drops only
  subscribers; `MockBus.reset()` also wipes recorded history and pending timers. The
  two are deliberately not aliased under one name, since a shared name with different
  scope is a footgun for a test ported between the two buses.
- **`events()` returns a snapshot copy.** A later `clearEvents()` or further `emit()`
  call never mutates an array you already hold.

**Mock clock caveats.** `clock.advance(ms)` fires every timer due in the interval, in
order. `clock.setTime(ms)` does the same when moving the clock forward, but moving it
backward only rewinds — nothing fires. Both throw rather than truncate if a single
call would need more than 100,000 timer firings, which is almost always a timer
rescheduling itself faster than time is advancing rather than a legitimate test.
`clock.setInterval()` floors any delay below 1ms (including `NaN`) to 1ms, for both
the first firing and every recurring one after it, and leaves an `Infinity` delay
alone as a legitimate "never fires" interval rather than treating it as a runaway.

One caveat on the fake layout: it patches `HTMLElement.prototype.offsetWidth` and
`clientWidth` globally for the duration of the test, so it will fight a test that
stubs those for its own components.

Another: its `ResizeObserver` fires every callback with an **empty entry array**, so
code under test has to re-read `offsetWidth` / `getBoundingClientRect()` from the
element rather than `entries[0].contentRect` — core does exactly that. Code that
trusts the entries sees nothing change here.

Its teardown is tied to the rendered tree, so `unmount()`, Testing Library's
`cleanup()` and RTL's auto-cleanup all restore the real prototypes — a test that
renders with `layout` and never unmounts leaves nothing behind for the next one.
When you drive it yourself, `installToolbarLayout().restore()` does the same;
`restore()` is idempotent and order-independent, so nested installs and a shared
teardown list that drains in insertion order are both safe. `cleanupToolbar()` is
the net for a `restore()` you forgot.

**Jest.** Inside Jest's sandbox a dynamic `import()` never settles, so Testing Library
is loaded through the runner's own `require` instead — which returns the copy already
in Jest's registry, not a second one. It works out of the box; no configuration.

If a runner defeats both paths, hand the module over yourself, in the form that runner
supports:

```js
// Jest / CommonJS — put this in your setupFilesAfterEnv file
const { setTestingLibrary } = require("@nejcm/dev-toolbar/testing");
setTestingLibrary(require("@testing-library/react"));
```

```ts
// ESM
import { setTestingLibrary } from "@nejcm/dev-toolbar/testing";
setTestingLibrary(await import("@testing-library/react"));
```


---

[Documentation index](./README.md)
