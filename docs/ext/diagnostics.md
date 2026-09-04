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

**A `recentErrors` field is deliberately absent.** Shipping it would mean this extension
installing a global `window.onerror` handler — permanent instrumentation of your
application, duplicating the error reporter you already have, and liable to disagree
with it. `sources` is the answer instead, and it works today:

```tsx
diagnostics({
  sources: [{ id: "errors", label: "Recent errors", read: () => Sentry.lastEvents() }],
});
```

Options: `app` (object or getter), `sources`, `windowMs`, `slowInteractionMs`,
`historySize`, `recentSize`, `now`, `redactOptions`, plus the usual `id` / `label` /
`align` / `order` / `priority` / `hidden` / `keepMounted` / `injectStyles` /
`styleNonce`.

Commands: `diagnostics.capture` (capture only — it deliberately does not copy),
`diagnostics.copy`, `diagnostics.copyJson`, `diagnostics.download`.

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
