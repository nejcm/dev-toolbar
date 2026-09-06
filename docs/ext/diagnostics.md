# `@nejcm/dev-toolbar/ext/diagnostics`

One snapshot for a bug report, with long-task and responsiveness data in it.
Everything it produces is text you are about to paste into a ticket, so the whole
extension is arranged around that.

```tsx
import { diagnostics } from "@nejcm/dev-toolbar/ext/diagnostics";

// Once, at module scope. Not inside render.
const extensions = [
  metrics(),
  flags({ readings, onOverride }),
  diagnostics({
    app: () => ({ release: __RELEASE__, userId: session.userId }),
    sources: [{ id: "router", label: "Router", read: () => router.state }],
  }),
];
```

**It aggregates; it does not re-collect.** A useful snapshot lists flags, metrics and
session context — every one of which is already owned by an extension that knows
more about it than this one could. So core aggregates
`DevToolbarExtension.diagnostics()` the way it aggregates `commands`, and this
extension reads the roster. What it gathers for itself is only what nobody else
owns: the page's own facts, and the `PerformanceObserver` data.

**You review before you send.** The panel shows the exact text the Copy and
Download buttons produce — not a summary, the same string — and nothing leaves the
machine until you press one. Markdown for a ticket, JSON for a tool; the choice
persists.

**Omissions are visible.** An extension that throws, contributes nothing, or returns
something that will not serialise gets a status, a line in a top-level `omissions`
list, a banner in the panel and a heading in the Markdown. A snapshot that quietly
dropped the one failing extension would read as complete, and whoever picks up the
ticket would have no way to know it is not.

**It never reports a number it does not have.** `longtask` and `layout-shift` are
Chromium-only today and `event` is not universal either, so every count is `null`
rather than `0` when it could not be observed, with a note saying which. "No long
tasks" and "this browser cannot count long tasks" are opposite claims.

**Interactions are counted the way INP counts them.** A click's several `event` entries
share one non-zero `interactionId` and count once at the longest duration; raw event entries
appear beside the count (`1 (5 event entries)`).
Per the Event Timing specification's *computing interactionId* algorithm, non-zero ids go to
`keydown`/`keyup`, `pointerdown`/`pointerup`, `click`, `contextmenu`, and IME-composition
`input`; `keydown`/`pointerdown` inherit the completing `keyup`/`pointerup` id. All
other events get 0, including `mousedown`/`mouseup`, `mouseover`/`pointerover`/`pointermove`,
`keypress`, `compositionstart`/`update`/`end`, non-composition `input`, and `pointercancel`,
which leaves `pointerdown` at 0. Entries with id 0 stay in the raw total but are not interactions.
Engines
without `interactionId` count one entry as one interaction and say so in the note. The
layout-shift `total` is a plain sum of shift scores in the window, not Cumulative Layout Shift.

**Redaction happens on the way in.** The consumer's `app` context, every `source`,
every extension contribution, the page URL, a long task's container attribution and
another extension's error message are all redacted as the snapshot is built, and the
panel, the clipboard, the download and the commands read that one object. The number
of masked values is shown next to the buttons. It is still not a security boundary —
`redact()` matches key names and value shapes, so a secret under an innocent key with
no telltale shape survives, which is exactly why the text is on screen before you
send it.

**It says what went wrong on the way here.** `window`'s `error` and
`unhandledrejection` events, and patched `console.error` / `console.warn`, go into a
bounded tail that the snapshot carries under `console` and the chip counts on a badge.
That is the half of a bug report you cannot otherwise get: you can copy state, and you
cannot copy the console.

An earlier version of this page argued the opposite — that a global handler is
permanent instrumentation of your application, duplicating a reporter you already have.
The instrumentation is real, which is why every part of it below is a rule rather than
a detail; the conclusion was wrong, because "the console at the moment it broke" is not
something your reporter puts in the ticket either. `sources` still works, and is still
the right way to hand over an existing reporter's own view:

```tsx
diagnostics({
  sources: [{ id: "errors", label: "Recent errors", read: () => Sentry.lastEvents() }],
});
```

### The console tail

- **It always calls through.** Your `console.error` runs, with the arguments you
  passed, on every path — including when something inside the tail throws. Nothing is
  swallowed and nothing is reordered.
- **It restores on teardown, by identity.** Unmount the toolbar and `console.error` is
  the function it was before, `===`. The one exception is somebody else patching after
  us: their wrapper stays, because clobbering it back to the original would silently
  uninstall *their* instrumentation. Same rule, same reason, as the `fetch` interceptor
  in [`/runtime`](../runtime.md).
- **It cannot recurse.** Anything logged *while* the tail is recording — the toolbar's
  own `ExtensionBoundary`, which calls `console.error` by design when an extension
  crashes; your logging pipeline's own mirror of a log — goes straight to the original
  and is not captured a second time.
- **`console.log` is never patched**, and there is no option that would. Errors and
  warnings are the signal; logs are volume.
- **Format strings are substituted**, the way the console shows them: `%s`, `%d`/`%i`,
  `%f`, `%o`/`%O`/`%j`, `%%`, and `%c`, which consumes its CSS argument and emits
  nothing. React's own dev warnings are format strings, so without this the most common
  `console.error` in a React app would read as `%o` followed by its arguments.
- **Repeats group, and a repeat is news.** The same message from the same source is one
  entry with a `count`, so a render loop logging 4,000 times is one row with a number on
  it — and the row moves back to the front when it repeats. "Newest first" and the
  `limit` on the export therefore mean *most recently seen*, not first seen, and a full
  tail evicts the message nothing has repeated. Evictions are counted in `dropped`.
- **Stacks are kept only where there are frames, and never their header.** V8 repeats
  the raw message above the first frame, where anchored value matching cannot see it, so
  everything above that frame is dropped; the message is reported, masked, in `message`.
  A stack with no frame at all is *only* a header — what `Error.stackTraceLimit = 0`
  produces — and is dropped whole rather than exported raw.
- **Off is one option.** `console: false` patches nothing and adds no listener, and each
  source has its own switch: `{ error, warn, windowErrors, rejections, size,
  maxMessageChars, maxStackChars }`. With capture off, the counts are `null` and the
  status says `disabled` — never a zero that reads as "nothing went wrong".

What it masks, and what it cannot: every argument is redacted **before** the line is
assembled — objects walked by `redact()` (where key-name matching works), strings
matched by value shape, and every `scheme://…` run in a string or a stack frame put
through `redactUrl()`, because a credential-carrying URL in the middle of a sentence is
the shape a console message actually has and anchored matching cannot see it. What
survives is what survives everywhere else in this extension, and each of these is
pinned by a test rather than hoped about:

- a bare secret written into prose (`"the password is hunter2"`) is neither a matched
  key nor a matched shape;
- a credential embedded in a stack frame's **function name** — frame matching looks for
  URLs and whole-value shapes, not for `Bearer …` inside an identifier;
- an `Error`'s `cause`, and an `AggregateError`'s `errors`, which are not read at all,
  so anything only reachable through them is absent rather than masked.

That is why the panel shows you the text before you copy it.

Options: `app` (object or getter), `sources`, `console`, `windowMs`,
`slowInteractionMs`, `historySize`, `recentSize`, `now`, `redactOptions`, plus the usual
`id` / `label` / `align` / `order` / `priority` / `hidden` / `keepMounted` /
`injectStyles` / `styleNonce`.

Commands: `diagnostics.capture` (capture only — it deliberately does not copy),
`diagnostics.copy`, `diagnostics.copyJson`, `diagnostics.download`, and — unless capture
is off — `diagnostics.console.export` (the tail as data, newest first, `limit` optional)
and `diagnostics.console.clear`. The chip's badge count and the tail's status also
appear in this extension's own `diagnostics()` summary, so an agent reading the roster
learns something is on fire without opening a panel.

**There is no console panel, and one is not planned.** Without object inspection, source
maps, filtering and live evaluation it would be strictly worse than the real console,
and object inspection alone is unwinnable. The toolbar owns the summary and the export;
DevTools owns the drill-down.

## Contributing to somebody else's snapshot

Any extension can. Add a `diagnostics()` to it:

```ts
export function jobQueue(): DevToolbarExtension {
  return {
    id: "job-queue",
    label: "Queue",
    // Pure, cheap, JSON-serialisable, and already safe to leave the machine.
    diagnostics: () => ({ depth, lastError }),
  };
}
```

Core calls it, contains a throw, and hands the result to whatever is reading. If
`/ext/diagnostics` is not mounted, nothing calls it and it costs nothing.

If it throws, core reports the error's message and its name **separately**, never
pre-joined — the reader has to mask the message before prefixing it, because the
redactors match value shapes anchored to the whole string and a message that *is* a
credential-carrying URL (what `fetch` and axios throw) stops being maskable the moment
`"Error: "` is in front of it.


---

[Documentation index](../README.md) · [Extension contract](../extension-contract.md) · [Runtime](../runtime.md)
