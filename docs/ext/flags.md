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
    // `presentation` restyles the chip and each promoted flag — see below.
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

If your app keeps the whole map in one place — a store it mirrors, a context it
republishes — implement `onOverridesChange` instead of, or as well as, `onOverride`. It
is handed the **complete, vetted map** after every change: the replay on mount, a
`?dtb-flags=reset` load (an empty map), each edit in the panel, *Clear all* and the
`flags.set` command. When both adapters are supplied, the per-key `onOverride` calls
of a change run first and `onOverridesChange` follows in the same synchronous change,
so the two agree unless one of them throws. Ordering cannot promise more than that: a
throw is caught and shown in the panel instead — per row for `onOverride`, cleared by
that key's next success; as one banner for `onOverridesChange`, cleared by its next
call that returns — and the panel's own map still changed and was persisted. Either
adapter makes the panel writable.

```ts
flags({
  flags: () => readings,
  onOverridesChange: (overrides) => overrideStore.replace(overrides),
});
```

**Omit both `onOverride` and `onOverridesChange` and the panel is read-only**: it
lists, searches and copies, and changes nothing. That is the honest answer for a
consumer with nowhere to put an override.

### Two values, two panels

The `value` you hand `flags()` is the application's answer **with no override
applied** — the extension layers its own override map on top, and that is what lets a
row show the effective value next to the app's own. Feed it a value your override
already changed and the row can never show what the app would do without it.

The opposite holds for everything that reports facts. [`environment()`](./environment.md)
and [`diagnostics()`](./diagnostics.md) want **what the app is actually doing, override
included** — a panel of facts that says `designVersion: v1` while the page renders `v2`
is wrong, however the `v2` came about. Pre-override into `flags()`, post-override into
everything else.

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
  const overrides = readStoredOverrides({ instanceId: "app", flags: () => readings });
  ```

  Pass `flags` — the catalogue, in any shape `flags()` accepts — and the map is vetted
  against it with the same `vetOverrides` pass `start()` runs, so an override whose
  value no longer matches its flag's declared type is dropped here exactly as the
  panel would drop it; an override for a key the catalogue no longer lists is kept,
  as the panel keeps it (see the ghost rule below). Without `flags` you get the map as
  parsed: every entry that is a flag value. `vetOverrides` is exported too, for a
  catalogue that arrives after the read. The result is always a plain object.

  **Seed by replacing your map, not by merging into it.** The result is the whole
  stored map, and under the reset param below it is `{}` — a merge would keep exactly
  the overrides the reset was asked to drop.

- **`?dtb-flags=reset` is the kill switch.** Loading any page with it drops every
  stored override and every session override held by the same runtime *before* any of
  them is applied — the override that breaks the app
  is the one you cannot reach the panel to remove. `=clear` and `=off` do the same
  thing. Your adapter is told: `onOverride(key, undefined)` for every key that was
  stored or held in the session, once per distinct key, then `onOverridesChange({})`,
  so a mirror the app persisted on its own is emptied too. `readStoredOverrides()`
  honours it too: while the param is in the URL it returns `{}`. `resetParam: null`
  disables it, `resetParam: "my-flags"` renames it.

  On another `start()` of the same runtime, session overrides survive when a custom
  storage adapter cannot be read. The default `localStorage` adapter reports a blocked
  store as empty, so only custom adapters that throw on reads get this guarantee. A new
  runtime or page reload cannot recover an override that storage never accepted.

  **Known limitation.** The param is honoured on every `start()`, not once per page
  load. While it is still in the URL, any remount — StrictMode, an `enabled` toggle, a
  `hidden` flip, a lazily mounted route building its own `flags()` — drops the
  overrides you set since the reset, and `readStoredOverrides()` keeps returning `{}`.
  Strip the param from the URL after using it (`history.replaceState`, or a plain
  navigation) before setting new overrides.
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

## Bar presentation

This extension puts **two kinds of control** in the bar, so it has two `presentation`
options. A control's presentation is configured next to that control, rather than by one
callback that would have to receive `FlagsSnapshot | FlagView` and make you narrow it.

| Option | Control | `TView` | Invoked |
| --- | --- | --- | --- |
| `flags({ presentation })` | the flags chip | `FlagsSnapshot` | once |
| `PromotedFlag.presentation` | one promoted flag | `FlagView` | once per promoted flag |

```tsx
flags({
  presentation: "icon-value",
  promoted: [
    { flagKey: "ui-facelift", presentation: { preset: "icon", icon: <FlagIcon /> } },
    { flagKey: "checkout.tier" },   // untouched — still the default tree
  ],
});
```

The four knobs — a preset, your own `ReactNode` icon, a `render` callback and an
accessible-name override — the preset-by-preset table and the rules every extension
shares are in [kit.md](../kit.md#presentation). Two of those rules are worth repeating
before the specifics: `"default"` is byte-identical to what shipped before the option
existed, and `presentation`, like every factory option, is **fixed when the factory is
called** — to change it at runtime, remount the toolbar or reload.

What is specific to this extension:

- **The chip's short bar word is `flags`, and its `⋮` row says `flags` too under
  `"default"`** — unlike the kit chips, it has never swung to its `label` when
  overflowed. Any *preset* still forces the full word there. The chip's icon lands in
  `data-dtb-part="flag-icon"`; a promoted flag's in `flag-promoted-icon`.
- **`PromotedFlag.icon` stays a `string`** — "a short glyph rendered before the label.
  Text, not an asset." It is copied into every snapshot as `FlagView.promotedIcon`, and
  this store republishes on a **string signature**: a `ReactNode` cannot be signed, and
  it would sit inside what `diagnostics()` serialises. Rich icons go on
  `presentation.icon`, which lives in the factory closure and reaches the DOM as a prop.
  The string glyph still fills the icon slot when no `presentation.icon` is supplied, so
  it survives a preset instead of vanishing; supply both and the rich one wins. `icon: ""`
  is not an icon — it has never painted a node, so an icon-only preset falls back to text
  rather than leaving a control that is nothing but its dot.
- **A promoted control's `"default"` tree paints `presentation.icon`.** It is the one
  place a bare `icon` under `"default"` is not a no-op, because this control has had a
  glyph slot since it existed. Chips whose default names no icon slot ignore a bare
  `icon`.
- **A promoted boolean falls back to text rather than to nothing.** A switch has no value
  slot — it announces its own state — so `"value"`, and `"icon-value"` with no icon,
  paint the label instead of leaving a control that is nothing but its dot.
- **`role="switch"`, `aria-checked`, `data-dtb-flag` and `data-dtb-overridden` are not a
  preset's to change, nor a callback's.**

---

[Documentation index](../README.md) · [Extension contract](../extension-contract.md) · [Runtime](../runtime.md)
