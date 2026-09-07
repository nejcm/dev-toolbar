# The console error tail

`/ext/diagnostics` watches four sources of "something went wrong" — `window`'s
`error` and `unhandledrejection` events and patched `console.error` /
`console.warn` — groups repeats into one row, masks every message as it is
captured, and folds the result into the snapshot a bug report is pasted from.
The user-visible half is a badge on the `diagnostics` chip that counts what was
caught since load, and two `⌘K` commands that hand the tail over as text.
`console.log` is never patched and there is no option that would patch it.

Snapshot capture, the format buttons and download are a different surface of
the same extension and are still unmapped; this file is only the tail.

## Sub-features

- `tail-sources` captures `console.error`, `console.warn`, `window.error` and
  `unhandledrejection`, and nothing else — `console.log` moves no counter.
- `tail-group` folds a repeated message into one entry and raises its `count`
  instead of filling the ring.
- `tail-badge` counts events live on the chip, before any capture, with
  `data-dtb-errors` / `data-dtb-warnings` / `data-dtb-tone` beside the number
  and the count spelled out in the trigger's `aria-label`.
- `tail-redact` masks credentials argument by argument on the way in — an
  object's `sessionToken`, and an `access_token` in a URL sitting inside a
  sentence — so nothing unmasked reaches the export, the snapshot or the
  bridge read.
- `tail-export` returns the whole tail through
  `diagnostics.console.export`, newest first, with an optional numeric
  `limit`.
- `tail-clear` drops every entry and zeroes the counters through
  `diagnostics.console.clear`, and keeps capturing.
- `tail-snapshot` carries the same report in the captured snapshot's
  top-level `console` section.

## How to get to it (user POV)

- Read the badge on the `diagnostics` chip — inside the `⋮` menu at
  1280×800, because `diagnostics` is collapsed there.
- Open the `diagnostics` panel and read the messages under *Console* in the
  snapshot preview.
- Run `Export the console error tail` or `Clear the console error tail` from
  `⌘K`.
- The playground's **Drive the console tail** card
  (`[data-testid="console-error"]`, `console-warn`, `console-repeat`,
  `console-throw`, `console-reject`, `console-log`) is the fixture for every
  source.

## Driving it with the Browser pane

Preconditions:

- Baseline per [README](./README.md), viewport pinned to 1280×800.
- `read().diagnostics.find(d => d.id === "diagnostics").status` is `"ok"`.

Throughout, the counts are
`read().diagnostics.find(d => d.id === "diagnostics").data.console` —
`{status, errors, warnings, dropped, watching}`. **There is no top-level
`errors` on that `data`, and no `extensions` map anywhere in the read**;
reading `data.errors` (or `read().extensions.diagnostics.errors`) yields
`undefined` and invites the conclusion that the badge is broken. The messages
themselves are deliberately *not* published here — a roster read is not the
place for redacted foreign text — so they come from
`runCommand("diagnostics.console.export")`.

- **Read the resting state.** `console.status` is `"capturing"` and
  `console.watching` is exactly
  `["console.error", "console.warn", "window.error", "unhandledrejection"]`.
  `console.errors` is **2 at baseline, not 0**: the `boom` extension crashes on
  mount, and one crash produces two `console.error` calls — core's
  `ExtensionBoundary` log and React's own *"The above error occurred in the
  `<Slot>` component"* log. Both are captured, as two grouped entries with
  `count: 1`. That is the resting state, not a finding.
- **The badge, and the trap.** At 1280×800 `diagnostics` is **collapsed**
  (measured: `shell.overflow.present: true`, `shell.overflow.items`
  `["metrics", "hydr", "boom", "diagnostics", "agent"]`), and a collapsed
  extension is removed from the bar and re-rendered inside the menu — so its
  chip is not in the document at all and
  `document.querySelector('[data-dtb-part="diag-errors"]')` returns `null`.
  **Open the overflow first**: click `[data-dtb-part="overflow-button"]`
  (accessible name `More developer toolbar items`), screenshot if the pane is
  hidden, *then* read the badge. A `null` badge with a non-zero
  `console.errors` means the chip is not rendered, never that the badge is
  broken.
- **What the badge carries.** Driven with 8 errors and 1 warning in the tail:
  `textContent` is `"9"` (the combined count), `data-dtb-errors` is `"8"`,
  `data-dtb-warnings` is `"1"`, `data-dtb-tone` is `"error"` (`"warn"` when
  `errors` is `0`), and `aria-hidden` is `"true"` — the number is a duplicate
  to a screen reader, because the chip's own trigger is named
  `Diagnostics, 8 errors, 1 warning`. Assert the label with a DOM read of
  `[data-dtb-part="overflow-menu-item"][data-dtb-ext-id="diagnostics"] [data-dtb-part="trigger"]`,
  and expect singular/plural to follow the numbers (`1 error, 1 warning`).
- **Opening the `⋮` adds two errors.** Measured: the counts went 6 → 8 the
  moment the menu opened, because collapsing re-renders `boom` inside it and
  it crashes again — two more `console.error` events. So either clear the tail
  *after* opening the menu, or budget those two. Every count in a badge
  assertion must be read in the same call as the badge.
- **Each source, with the tail cleared first.** `runCommand
  ("diagnostics.console.clear")`, then click and re-read:
  - `console-error` → `errors +1`, one entry, `source: "console.error"`;
  - `console-warn` → `warnings +1`, `source: "console.warn"`, message
    `deprecated: <LegacyTile> goes away in v3`;
  - `console-repeat` → `errors +5` but **one** entry with `count: 5` and
    message `render loop: state updated during render`, which is the grouping
    assertion: counters count events, entries are groups;
  - `console-throw` → one `source: "window.error"` entry reading
    `Error: playground: uncaught from a timer (http://localhost:5273/src/App.tsx:<line>:<col>)`
    — thrown out of a timer, so it reaches `window.onerror` and not React;
  - `console-reject` → one `source: "unhandledrejection"` entry prefixed
    `Unhandled rejection: `;
  - `console-log` → **nothing moves**: same `errors`, same `warnings`, same
    entry list. That is the point of the button.
- **Redaction.** `console-error` logs `sessionToken: "sess-console-secret"`
  and `retryUrl: "https://api.playground.test/retry?access_token=tok-console-secret"`.
  Export the tail and assert the entry reads
  `checkout failed {"orderId":"ord_991","sessionToken":"[redacted]","retryUrl":"https://api.playground.test/retry?access_token=[redacted]`
  — the key-matched value and the in-sentence URL credential both masked.
  Then grep for `sess-console-secret` and `tok-console-secret` in three
  places: the export result, `runCommand("diagnostics.capture")`'s snapshot,
  and `JSON.stringify(read())` in full. Zero matches in all three is the
  assertion; one match anywhere is the finding. (Driven: zero in all three.)
- **The export command.** `runCommand` wraps every result:
  `{ok: true, result}` on success, `{ok: false, reason: "threw", error,
  errorName}` on a rejected input — it does **not** throw, so a `catch` proves
  nothing and `result` is where the report is. That report is
  `{status, note, watching, errors, warnings, dropped, truncated, entries}`,
  entries **newest first by last occurrence** — a message that just repeated
  outranks one seen at startup. `{limit: 2}` keeps the newest two and sets
  `truncated: true` (driven); `{limit: "all"}` comes back as
  ``{ok: false, reason: "threw", error: "`limit` must be a finite number."}``
  rather than silently returning everything (driven).
- **The clear command.** `runCommand("diagnostics.console.clear")` →
  `errors`, `warnings` and `dropped` are `0`, `entries` is empty, and
  `status` is still `"capturing"`. Log again and the counters resume from
  zero; nothing else in the snapshot changes.
- **The snapshot carries the same report.** `runCommand
  ("diagnostics.capture")` returns a snapshot whose keys are
  `generatedAt, toolbar, page, responsiveness, console, app, contributions,
  omissions`, and whose `console` section has the export's own shape
  (`status, note, watching, errors, warnings, dropped, truncated, entries`).
  It is the same masked report, not a second rawer copy.
- **Proof.** Capture the bridge read with `data.console` beside the badge's
  attributes read in the same call, the export result showing the grouped
  `count: 5` entry and the masked `checkout failed` line, and a screenshot of
  the open `⋮` menu with the badge visible on the `diagnostics` entry.

## Gotchas

- **The badge is inside the chip, and the chip may not be rendered.** This is
  the one mistake this recipe exists to stop: at 1280×800 `diagnostics` sits
  in the overflow, so the badge does not exist until the `⋮` menu is open. A
  report that says "the badge is broken" without an `shell.overflow.open:
  true` read in the same call has not tested the badge.
- **Do not read `data.errors` or `read().extensions`.** The counts are nested
  under `data.console`. Both wrong paths return `undefined`, which reads like
  a zero and is not one.
- The counters are published **off the current task** (a microtask, then a
  100 ms throttle in the store), because React reports its dev warnings
  through `console.error` *during render*. A read fired synchronously after a
  click can still show the previous numbers — await a tick, or re-read until
  it settles.
- `errors`, `warnings` and `dropped` are `null`, not `0`, when nothing was
  ever watched (`status: "unavailable"`, or `"disabled"` when the consumer
  passes `console: false`). `null` means "nobody observed"; `0` means
  "observed and saw none". Never collapse them.
- Counters count **events**; `entries` are **groups**. `errors: 5` with one
  entry of `count: 5` is correct and is the grouping working.
- One React crash is **two** `console.error` calls (core's boundary log and
  React's own), so `boom` moves the counter by two every time it mounts —
  including every time the overflow menu opens.
- A masked URL swallows the non-whitespace text immediately after it: the
  `checkout failed` line ends at `access_token=[redacted]` and the closing
  `"}` is gone. That is a deliberate trade (a URL run stops at whitespace
  only, because stopping at a quote left the secret next to a mask that
  claimed otherwise) — do not report the missing brace as corruption.
- A credential written into **prose** — `failed: token Bearer …` — is a
  documented limit and survives in `entries[].message`; `redact()` judges
  whole values and nothing here judges parts of one. It no longer appears a
  second time in `entries[].stack`: the stack's header line is deleted, so
  every `stack` in the export starts at a frame. A missing `Error: …` line at
  the top of a stack is the design, not truncation. The panel shows the text
  before you copy it.
- `status` and `watching` are re-derived on **every** read, so they are
  present-tense. If a driving step replaces `console.error` or reassigns
  `globalThis.console`, expect `status: "unavailable"` with `watching: []` —
  the tail does not re-patch, it drops the claim. Counts already taken stay
  (they are what was seen while it was watching); a tail that never watched
  anything still reports `null`.
- `console.log` is never patched, and there is no option that would patch it.
  A request to capture logs is a source change, not a driving step.
- The two console commands are contributed **only** when the tail is not
  `disabled`, so `read().commands` lists no `diagnostics.console.*` id under
  `console: false`. An absent command there is by design, not a regression.
- A small `maxMessageChars` can slice through a `[redacted]` marker —
  `maxMessageChars: 12` over `Bearer sk-live-…` yields `Bearer [reda… (5 more
  characters)`. Cosmetic and accepted: slicing only removes trailing
  characters, so no value is revealed.

*Driven end to end at 1280×800 against `dist/` built 2026-09-07T09:22:29Z
(`loadedAt` 09:23:15Z): all four sources, the grouping, `console.log` moving
nothing, both commands, the badge and its attributes through the open `⋮`, the
three-way credential grep, and the snapshot's `console` section. Not driven:
the panel's own *Console* rendering, `console: false`, and `maxMessageChars`
truncation.*
