# `ext/environment`

Environment, release, commit and authenticated-actor context, with production
coloured like production. Everything shown is **supplied by you**: no
`process.env`, no globals. The only self-detected facts are route, viewport and
connection, and they are labelled `detected` so they are never mistaken for
something a deployment asserted.

- **Subpath:** `@nejcm/dev-toolbar/ext/environment`
- **Factory:** `environment(options?)` → `DevToolbarExtension`
- **Full documentation:** [docs/ext/environment.md](../../../docs/ext/environment.md)

```tsx
const extensions = [
  environment({ context: { environment: "staging", release: __RELEASE__, userId: user.id } }),
];
```

## Files

| File | What is in it |
| --- | --- |
| `index.tsx` | The factory, the commands and the clipboard exports |
| `runtime.ts` | Context resolution, detection, redaction and the snapshot store |
| `ui.tsx` / `css.ts` | The chip and the panel |
| `types.ts` | The context shape and the field vocabulary |

## What it owns, and what it does not

It owns presentation and masking. It owns no source of truth: supply nothing
and it says `unknown`, which is the honest answer rather than a guessed one.

Every value goes through `redact()` from `/runtime` on the way in, plus email
masking, and the panel and clipboard read that same redacted snapshot — there
is no unmasked path. **Masking is visible**: a masked row is tagged and counted
next to the copy buttons, because unseen redaction looks exactly like "never
supplied".

For a restricted view, pass `fields` — an allowlist, where everything else is
*dropped* rather than hidden, `extra:<key>` entries included.

## Commands

`<id>.copy`, `<id>.copyJson`, `<id>.refresh`.

## Options that change behaviour

`context`, `fields`, `detect`, `maskPii`, `pollMs`, `redactOptions`.

`presentation` changes how the bar control looks, not what it reports: a
`CompactPreset`, your own `ReactNode` icon (or `(snapshot) => ReactNode`), a
`render` callback over `EnvironmentSnapshot` and an accessible-name override.
It resolves through `/kit`'s `resolveCompactControl`, so `"default"` is
byte-identical to what shipped before the option existed. **Presets operate on
the short bar word (`"env"`)**; `label` stays the accessible-name identity, and
a preset in the `⋮` menu swings to it. `kindLabel(snapshot)` is exported so a
callback can paint the same value word the preset does instead of re-deriving
the `supplied && kind !== "unknown"` rule.

Two things are specific to this extension. It renders **two button wrappers** —
the bar `trigger`, and the `⋮` row `env-overflow`, which deliberately carries no
`aria-expanded` — and both are driven by the same option, including the name
override; the fork is about the element, never the presentation. And
`"default"` paints `"env"` in **both** places, where the other kit-chip
extensions swing to their full label in the menu, because that is what this
chip has always shipped.

The parts go in as the kit `Chip`'s *children* rather than its `icon` / `label`
/ `value` slots, so `render` replaces them and never the `Chip` — the dot,
`data-dtb-severity`, the `impersonating` marker and the `aria-label` are not a
callback's to lose. Nothing configured here reaches the store: the store compares
the whole snapshot and the exports serialise it, and a React element survives
neither, so the icon and the callbacks stay in the factory closure and travel as
props.
[ADR-004](../../../docs/adr/ADR-004-per-extension-bar-presentation.md).

## Tests

`__tests__/runtime.test.ts` for resolution, detection and masking;
`environment.test.tsx` for the chip, panel and commands.
`presentation.test.tsx` pins the default markup of **both** wrappers as literal
strings — in the empty state and in an impersonating production one — every
preset in both, and the three callbacks.
