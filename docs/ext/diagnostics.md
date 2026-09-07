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
- **The stack is masked without deleting headers.** The original stack, header
  included, is scanned for known credential shapes *wherever they sit in a line*
  rather than only when a line is a credential end to end. `redact()`'s value matching
  is anchored — `Bearer sk-live-…` is a credential to it, `Error: Bearer sk-live-…` is
  not — and a stack is exactly the case where credentials arrive inside longer strings.
  So stacks go through `redactText()` instead: it scans for credential shapes anywhere
  in the text, merges overlapping matches before replacing anything, and rewrites only
  the matched spans, then applies the stack length cap. A Digest match masks the
  entire remaining suffix, so frames below it can disappear. `redact()`'s own
  semantics are unchanged for every other caller,
  including `entries[].message`.

  This replaced **header deletion**, which is what six earlier rounds each tried a
  variant of. Deleting the `` `${name}: ${message}` `` line meant deciding which lines
  were headers, and every way of deciding leaked: by shape, because an `Error` whose
  `name` contains `@host:1` reads exactly like a SpiderMonkey frame and unrecognised
  engines' stacks vanished silently; by known text, because a header repeated *after* a
  frame was never reached, and because a prefix collision (`name` of `Digest`, empty
  message) deleted a line whose presence was the only reason the text below it was
  masked. Substitution leaked earlier still, on overlapping halves — an `Error` named
  `Bearer A` whose message was `Digest realm="Bearer A",nonce="…"` exported the nonce,
  because replacing one half rewrote the text the other half had to match. Masking in
  place decides nothing about a line's role, so there is no classification left to get
  wrong.

  Two consequences are worth knowing. A stack that is *only* a header —
  `Error.stackTraceLimit = 0` — now reports as that header, masked, rather than as no
  stack at all. And the header line is no longer redundant with `message`: it repeats
  the same two halves, so a credential in either is masked twice over rather than
  removed once.
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
matched by value shape, and every `scheme://…` run in a string or a stack put
through `redactUrl()`, because a credential-carrying URL in the middle of a sentence is
the shape a console message actually has and anchored matching cannot see it.

Two judges, deliberately different. `entries[].message` is judged by `redact()`, which
matches **whole values**. `entries[].stack` goes through `redactText()`, which scans for
credential *shapes* anywhere inside the text. The distinction is not arbitrary: a stack
is a multi-line string whose credentials arrive inside longer lines, and every earlier
attempt to handle that by classifying lines — a frame classifier, a header classifier,
and a whitespace tokeniser that re-asked `redact()` about each word and adjacent pair —
shipped a leak. `redactText()` classifies nothing; it masks matched spans in place.

### The limit that matters most before you paste

**A credential written into prose survives in the message.** The worked example,
executed through both the JSON and the Markdown export:

```
console.error(new Error("failed: token Bearer sk-live-abc123"))
```

`"Bearer sk-live-abc123"` is a credential and `redact()` masks it. `"failed: token
Bearer sk-live-abc123"` is a *sentence containing* one, and it is reported verbatim in
`entries[].message`. The same is true of `"the password is hunter2"`. The stack repeats
that header line, but the stack is scanned, so the `Bearer …` half is masked there —
the message is where it survives. Widening `redact()` itself to scan is separate work
with its own review: it is the shared primitive every surface in the package uses.

Diagnostics output is designed to be pasted into a bug report, so read it first. **That
is why the panel shows you the text before you copy it.**

### Accepted limits

With a foreign stack string such as
`{name: "Error", message: "", stack: "Error sk-live-LEAK\nErrorX LEAK2\n    at foo"}`,
both secret-bearing lines survive unchanged in JSON and Markdown. This is
strictly more text than the old prefix-collision deletion exposed. That deletion
incidentally removed lines starting with `Error`, including `ErrorX`; neither
secret matches a recognised credential shape. This example requires a supplied
foreign stack string rather than the native V8 header for those name and message
values. It is not fixed because restoring line classification or header deletion
would restore the mechanism behind the previous leaks. A test pins the current
output explicitly.

Cross-line masking also has costs. `Error: Bearer\n    at LEAK (a.js:1:1)`
becomes `Error: Bearer\n    [redacted] LEAK (a.js:1:1)`: the marker replaces
`at`, and says nothing about the text beside it. Restricting the separator to
one line would reopen the tested `Bearer\nLEAK_SECRET_123` leak. Digest masking
discards everything after its first parameter, including later frames.
Stopping at a newline would expose `nonce=LEAK_SECRET_123` in
`Digest realm=ordinary,\nnonce=LEAK_SECRET_123`. These rules remain conservative;
preserving those frames needs a separate decision about multiline credentials.

Other limits pinned by tests:

- a credential embedded in a stack frame's **function name** — matching looks for URLs
  and whole-value shapes, not for `Bearer …` welded into an identifier;
- an `Error`'s `cause`, and an `AggregateError`'s `errors`, which are not read at all,
  so anything only reachable through them is absent rather than masked;
- a word character or `=` immediately before `Bearer` (`_Bearer …`, `1Bearer …`,
  `Bearer=…`), which stops both matchers — the anchored value matcher for `message`,
  the word boundary for the stack. A **zero-width space** is not a word character, so
  it stops only the `message` matcher: `​Bearer …` is masked in the stack and
  survives in the message;
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
stack size exceeded` after the order of ten thousand cycles** — two harnesses on the
same Node lost call-through at 10,358 and 10,408 — while **Bun 1.4.0 still forwarded
after 20,000 cycles** and never threw. Treat the count as a property of the engine's
stack depth and of the harness measuring it, never of this package: quote an order of
magnitude with its engine or not at all, and do not read Bun's result as an absence of
the problem — every cycle still costs a frame. What
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
