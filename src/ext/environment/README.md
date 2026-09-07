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

## Tests

`__tests__/runtime.test.ts` for resolution, detection and masking;
`environment.test.tsx` for the chip, panel and commands.
