# `@nejcm/dev-toolbar/ext/flags`

Feature-flag controls, including the promoted flag.

**The flags are yours.** This extension owns no flag store, integrates no provider
and reaches for no global. You hand it what your application resolved and, if you
want the panel to do more than read, a typed adapter it calls when somebody asks for
a local override.

```tsx
import { flags } from "@nejcm/dev-toolbar/ext/flags";

// Once, at module scope. Not inside render.
const extensions = [
  flags({
    flags: () =>
      catalogue.map((definition) => ({
        ...definition,                  // key, label, type, defaultValue, owner…
        value: base[definition.key],    // BEFORE local overrides — see below
        source: "server-rule",
      })),
    onOverride: (key, value) => {
      // `value === undefined` means "no local override any more".
      if (value === undefined) delete overrides[key];
      else overrides[key] = value;
      republish();
    },
    promoted: { flagKey: "ui-facelift", label: "UI Facelift 2026", icon: "◈" },
  }),
];
```

Your app then reads `overrides[key] ?? base[key]`, which is the precedence the panel assumes.
Keeping the two maps apart is the whole integration contract: the extension needs
the value *before* the override to be able to show both. If you do fold them into
one store nothing breaks — the override badge comes from the extension's own map,
never from comparing values.

`flags` takes an array, a **function** re-read every `pollMs` (default 1 s) and on
demand, or anything with `read()`/`subscribe()` — a
[`Readable`](../kit.md#live-input) from `@nejcm/dev-toolbar/kit`, or a Zustand/Redux
store's `{ getState, subscribe }` as-is — which is re-read **when it notifies** and
never polled. Server-resolved flags that arrive after mount, or a catalogue kept in a
store, belong in that third shape: the panel follows the store instead of catching up
on the next tick.

```ts
const catalogue = createSource<readonly FlagReading[]>([]);
const extensions = [flags({ flags: catalogue, onOverride })];
// wherever the resolved flags land:
catalogue.set(readings);
```

**Omit `onOverride` and the panel is read-only**: it lists, searches and copies, and
changes nothing. That is the honest answer for a consumer with nowhere to put an
override.

Each row shows the effective value, **the application's own value** and the default
side by side, plus the evaluation source, the owner, an expiry and a project link.
Booleans get a switch, variants a `<select>`, strings and numbers an input (Enter or
blur commits). Per-flag `clear`, one **Clear all overrides** button, and a *Copy
recipe* for sharing.

## It changes what your app does

Everything else in this package observes. This one mutates, and the mutation
outlives the tab — so:

- **Overrides persist** under `dtb:v1:<instanceId>:ext:<id>:overrides` and are
  re-applied through your adapter on the next mount. That happens in an effect, so
  the first paint after a reload is un-overridden. Seed your own store earlier if
  that matters:

  ```ts
  import { readStoredOverrides } from "@nejcm/dev-toolbar/ext/flags";
  const overrides = readStoredOverrides({ instanceId: "app" });
  ```

- **`?dtb-flags=reset` is the kill switch.** Loading any page with it drops every
  stored override *before* any of them is applied — the override that breaks the app
  is the one you cannot reach the panel to remove. `=clear` and `=off` do the same
  thing. `readStoredOverrides()` honours it too. `resetParam: null` disables it,
  `resetParam: "my-flags"` renames it.
- **A renamed flag does not leave a ghost.** An override whose key is no longer in
  your catalogue is still being applied to your app, so it still gets a row — tagged
  *no longer in the catalogue*, counted, and clearable.
- **Reload behaviour is per flag.** `reloadBehavior: "full-reload"` on a definition
  means an override on it is labelled *reload required*, with a reload button.
- **A throwing adapter is shown, not swallowed, per flag.** The failing row is
  tagged *override not applied* and keeps that tag until that same flag applies
  successfully — a later success on a different flag does not clear it. The bar
  stays up.
- **Bad input is refused, not coerced.** Typing something that is not a value of the
  flag's type marks the row and applies nothing.

## What it does with your data

Flag keys and values reach a clipboard, so the `/ext/environment` rule applies:
every value goes through [`redact()`](../runtime.md) on the way *in*,
once, and the panel, *Copy recipe* and the copy commands read the same redacted
snapshot. Each value is redacted under its own flag key, so `checkout.apiToken`
masks by key and an innocent key holding `Bearer …` masks by value; booleans and
numbers are left readable, since they cannot carry a credential. `sensitive: true`
on a definition masks it whatever it looks like. A masked value never round-trips
through the editor — the input takes a new value instead. The `<select>` a variant
flag gets is covered by the same rule: its options carry an index, never the value,
and their labels are redacted alongside the row (a masked one reads
`variant N (masked)`), so a credential in a `variants` list never reaches the DOM.

Commands aggregated into `useToolbarCommands()`: one `flags.toggle.<key>` per
boolean flag — re-enumerated on every aggregation pass, so a flag that appears after
mount gets its command as soon as the extension's next poll sees it, with no reload —
plus `flags.clearOverrides`, `flags.copyRecipe`,
`flags.copyJson` and `flags.refresh`.

`flags.set` is the [contract v2](../extension-contract.md#contract-v2--commands-with-input-and-a-result)
addition and takes `{ key, value? }`:

```ts
await api.invokeCommand("flags.set", { key: "new-header", value: false });
await api.invokeCommand("flags.set", { key: "new-header" });   // clears the override
```

It refuses rather than coerces: an unknown key, or a value the flag's declared type
rejects, throws a message saying which. **Omitting `value` is what clears an
override** — `null` does not clear, because `null` is a real flag value. It is also
*refused* for every boolean, string and number flag, since a `null` override of one
would be discarded on the next reload anyway; only a variant flag whose `variants`
list includes `null` accepts it. The schema says the same, which is why `value`
advertises `["boolean", "string", "number"]` and nothing about null. It carries an
`input` schema, so `⌘K` does not list it; the per-flag `flags.toggle.<key>` commands
are what a human finds there, and they stay. The two are not redundant: the
enumeration is the palette's affordance, `flags.set` is the tool call, and only
`flags.set` can reach a string, number or variant flag at all. Through
[`/ext/agent`](./agent.md) it is one call with no panel and no pixels.

Like the other extensions it ships its own
stylesheet — pair `injectStyles={false}` on `<DevToolbar>` with
`flags({ injectStyles: false })` and deliver `FLAGS_CSS` yourself.
`styleNonce` on `<DevToolbar>` is forwarded to the sheet via the slot;
`flags({ styleNonce })` overrides it.

---

[Documentation index](../README.md) · [Extension contract](../extension-contract.md) · [Runtime](../runtime.md)
