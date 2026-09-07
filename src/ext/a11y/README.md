# `ext/a11y`

axe-core violations grouped by impact, on demand and never on a timer, with
click-to-highlight over the page.

- **Subpath:** `@nejcm/dev-toolbar/ext/a11y`
- **Factory:** `a11y(options?)` → `DevToolbarExtension`
- **Full documentation:** [docs/ext/a11y.md](../../../docs/ext/a11y.md)

```tsx
const extensions = [a11y({ rules: { "color-contrast": { enabled: false } } })];
```

## The one optional peer

**`axe-core` is an optional peer, not a dependency.** It is loaded with
`import("axe-core")` when the extension starts; a consumer who has not installed
it gets the `"unsupported"` state — the same word `/ext/metrics` uses for a
missing platform API — and nothing throws. Installing it is not free: axe-core
is roughly 550 KB and a supply-chain surface of its own, so this is the one
place in the package where "zero runtime dependencies" is true of the package
and still costs the consumer something.

## Files

| File | What is in it |
| --- | --- |
| `index.tsx` | The factory, the scan/export/highlight commands and the peer load |
| `runtime.ts` | Engine queueing, the markup walk, masking, the report store |
| `ui.tsx` / `css.ts` | The chip, the panel, the impact groups and the highlight surface |
| `types.ts` | `A11yReport`, the impact vocabulary and the selection key |

## Nothing runs on a timer

A full-document axe pass is expensive — milliseconds at best, seconds on a large
page — so it happens on a click, a command or an agent call. Never on an
interval, and not at mount unless `scanOnStart` says so. The toolbar's own DOM
is excluded from the default context: the bar is not the app under test.

There is deliberately **no timeout**, and `clear()` *disowns* a scan in flight
rather than cancelling it, because axe exposes no abort. The blast radius of
each, and why a timeout would cause more false failures than it rescues hangs,
is in [the doc](../../../docs/ext/a11y.md).

## Redaction: the sharpest edge in the package

axe's results are foreign data on their way into a bug report, and an element's
HTML snippet is the worst case — `<input type="password" value="…">` is exactly
the markup axe flags. So:

- **Attribute values survive only for the attributes accessibility is about**
  (`id`, `class`, `type`, `role`, `aria-*`, `alt`, `title`, `placeholder`,
  `href`, `src`, and a handful more). Everything else becomes `[redacted]`
  wholesale, without first being tested for credential shape.
- **Kept attribute values and snippet text go through `redactText()`**, which
  scans for credential shapes and `scheme://…` runs anywhere inside the value.
  `href` and `src` are known to *be* URLs, so the whole value is tried as one
  first. Selectors and axe's failure summaries keep whole-value `redact()`.
- **The markup is parsed, not pattern-matched.** A tag ends at the first `>`
  *outside* an attribute value. A comment is dropped whole; a declaration, CDATA
  section or processing instruction makes the whole snippet `[unreadable]`.
  Anything the walk cannot read confidently is `[unreadable]` rather than raw —
  losing a snippet costs a line of the panel, guessing at one costs a credential.
- **Everything is bounded** at 4 KB, cut back to a whitespace boundary so a
  truncated value can never be half a credential.

The limits that remain — an unknown credential *shape*, a credential split
across a child tag, a relative reference after another URL — are pinned by tests
and written out in
[docs/ext/a11y.md](../../../docs/ext/a11y.md#accepted-limits). Not a security
boundary: if a page renders credentials in the DOM, treat the export the way you
would treat a screenshot of that page.

## Commands

`<id>.scan`, `<id>.clear`, `<id>.export`, `<id>.highlight`.

## Options that change behaviour

`rules`, `axeOptions`, `context`, `nodeLimit`, `scanOnStart`, `load` (supply
your own axe copy), `redactOptions`.

## Tests

`__tests__/runtime.test.ts` for queueing, the markup walk and masking;
`peer.test.ts` for the missing-`axe-core` path; `a11y.test.tsx` for the panel,
the highlight surface and the commands.
