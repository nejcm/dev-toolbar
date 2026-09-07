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
- **The stack keeps every line but its header, which is deleted rather than rewritten.**
  V8 writes `` `${name}: ${message}` `` above the first frame, and `redact()`'s value
  matching is anchored, so `Bearer sk-live-…` is a credential and `Error: Bearer
  sk-live-…` is not. That header carries nothing the tail does not already report — the
  message line is those same two halves, masked — so it is **removed**, by comparing the
  head of the stack with the known raw `name` and `message` — plus `Error: ${message}`,
  because V8's formatter treats an absent or empty `name` as absent and writes that name
  itself, and leaving it out put a message-only error's raw message back in the stack.
  Nothing tests for what a header looks like; trying to identify one was its own leak (a header from an `Error`
  whose `name` contains `@host:1` reads exactly like a SpiderMonkey frame, and dropping
  by shape silently threw away frameless stacks and every stack from an engine whose
  frame shape this package had not been taught). Every other line is kept, masked. A
  stack that is *only* a header — `Error.stackTraceLimit = 0` — therefore reports as no
  stack at all, and the message is still there.

  Deletion replaced substitution because substitution leaked on **overlapping halves**:
  an `Error` named `Bearer A` whose message was `Digest realm="Bearer A",nonce="…"`
  exported the nonce, because replacing the name first rewrote the very text the message
  replacement then had to match. Reversing the order moves the hole to the other
  overlap. Removing text cannot corrupt what is left, which is the whole point.

  What survives is a header an engine **transforms** instead of repeating. Because every
  engine writes the `name` first, an upper-cased *message* half still goes (the name is
  still a literal prefix of the line); a header whose **name half** was transformed too
  is not known text, so that line stays. Pinned as a test, not patched — recognising a
  transformed header means a second notion of "credential", which is what leaked three
  times.
- **It never claims to be capturing when it is not.** The tail patches the console that
  is live when it starts and never re-patches on its own — a tail that silently wrapped
  whatever object turned up at `globalThis.console` would be instrumenting consoles
  nobody asked it to. What it does is ask again: every attach re-runs the read-back, and
  `status` and `watching` are re-derived on every read. So replacing `console.error`
  under us, or swapping `globalThis.console` for another object, turns the report into
  `unavailable` with an empty `watching` instead of `capturing` with counts nobody
  observed. Counts already taken stay — they are what was seen while it *was* watching —
  and the wrapper it installed stays restorable by identity, so nothing is stranded.
- **Off is one option.** `console: false` patches nothing and adds no listener, and each
  source has its own switch: `{ error, warn, windowErrors, rejections, size,
  maxMessageChars, maxStackChars }`. With capture off, the counts are `null` and the
  status says `disabled` — never a zero that reads as "nothing went wrong".

What it masks, and what it cannot: every argument is redacted **before** the line is
assembled — objects walked by `redact()` (where key-name matching works), strings
matched by value shape, and every `scheme://…` run in a string or a stack line put
through `redactUrl()`, because a credential-carrying URL in the middle of a sentence is
the shape a console message actually has and anchored matching cannot see it.

`redact()` is the **only** judge of a credential here, and it judges **whole values**.
Nothing in this extension scans a line for one. Three mechanisms that did — a frame
classifier, a header classifier, and a whitespace tokeniser that re-asked `redact()`
about each word and each adjacent pair — each shipped a leak, and the tokeniser also
reported `"the token expired"` as `"the token [redacted]"`. That false positive is gone;
so is the mechanism.

### The limit that matters most before you paste

**A credential written into prose survives, in the message as well as the stack.** The
worked example, executed through both the JSON and the Markdown export:

```
console.error(new Error("failed: token Bearer sk-live-abc123"))
```

`"Bearer sk-live-abc123"` is a credential and `redact()` masks it. `"failed: token
Bearer sk-live-abc123"` is a *sentence containing* one, and it is reported verbatim in
`entries[].message`. The same is true of `"the password is hunter2"`. It reaches the
ticket once rather than twice — `entries[].stack` used to repeat it through the header,
and the header is deleted now — but once is enough to matter. This is not an oversight
to be patched with a scanner: every attempt to teach this module a second notion of
"credential" leaked something worse, including masking one half of an overlapping pair
and shipping the other half beside a `[redacted]` marker that claimed it was handled.

Diagnostics output is designed to be pasted into a bug report, so read it first. **That
is why the panel shows you the text before you copy it.**

The rest of what survives is pinned by a test rather than hoped about:

- a credential embedded in a stack frame's **function name** — matching looks for URLs
  and whole-value shapes, not for `Bearer …` welded into an identifier;
- an `Error`'s `cause`, and an `AggregateError`'s `errors`, which are not read at all,
  so anything only reachable through them is absent rather than masked;
- zero-width spaces or punctuation immediately before `Bearer`, which stop the value
  matcher from recognising the whole value;
- a header an engine transformed rather than repeated, where the transformation reaches
  the `name` half as well (see the stack rule above);
- a **transparent `Proxy`** over the console. `new Proxy(A, {})` is a distinct object, so
  it is a distinct key addressing the same property, and no key can tell it from its
  target. Executed: start a tail on `A`, then set `globalThis.console = new Proxy(A, {})`
  and start a second tail — the second wraps the first's wrapper, only the second
  captures (the shared re-entrancy guard silences the inner one, and the first honestly
  reports `unavailable`), the app's own method still runs exactly once, and stopping the
  first tail before the second strands the first's wrapper on `A` for the life of the
  page. It keeps forwarding, so no logging is lost.

One guarantee worth stating precisely: **a foreign property is read once** — but that
holds for an argument this extension successfully classifies as error-shaped, whose
`name`, `message` and `stack` are snapshotted before anything uses them. An argument
that fails that classification is handed to `redact()`, which walks it and reads its
properties itself. "Read once" is a claim about the classified snapshot, not about every
value the tail is given.

**One limit worth measuring before you ship two copies.** The console patch is module
state, so a page that resolves both `dist/ext/diagnostics.js` and
`dist/ext/diagnostics.cjs` gets two wrappers, one around the other. While both are up
nothing is lost. Taking them down *inner-first* is what costs: teardown never restores
over a later patch, so the inner wrapper stays — listener-less, still forwarding — and
every start/stop cycle strands one more. Executed with two module copies over one
`console`, over the built ESM+CJS pair: **Node 26.4.0 throws `RangeError: Maximum call
stack size exceeded` from cycle 10,408** (stable across runs), while **Bun 1.4.0 still
forwarded after 20,000 cycles** and never threw. The number belongs to the engine's
stack depth, not to this package — quote it with its engine or not at all, and do not
read Bun's result as an absence of the problem: every cycle still costs a frame. What
matters is what happens past the limit, where it exists: the call throws and never
reaches the original, so it is **your** app's logging that is gone, not only our
capture. The fix is a bundler one —
resolve the package to a single format. Nothing in this package can repair it from
inside, and the versions of this package that tried made the failure silent instead.

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
