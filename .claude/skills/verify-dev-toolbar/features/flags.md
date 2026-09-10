# Feature flags

`/ext/flags` owns nothing but the overrides: the flags belong to the app, and
the extension shows what the app resolves next to what the developer forced,
applies the override through the app's own adapter, persists it, masks
credential-shaped values, and offers a URL escape hatch when an override has
broken the app badly enough that the panel is out of reach.

## Sub-features

- `flags-panel` lists every catalogued flag with `now` / `app` / `default` /
  `source`, searchable.
- `flags-override-bool` flips a boolean in place from a `switch`.
- `flags-override-value` overrides a string or number, and rejects a value of
  the wrong type without applying it.
- `flags-apply` pushes the override into the app, which resolves it.
- `flags-persist` keeps overrides across reloads under
  `dtb:v1:playground:ext:flags:overrides`.
- `flags-promoted` renders `ui-facelift` as its own switch in the bar rather
  than a panel row.
- `flags-mask` masks a credential-shaped key everywhere, including copies.
- `flags-clear` drops every override from the panel.
- `flags-reset` drops every override from a URL, without the panel.
- `flags-bulk-error` publishes one `bulkError` — one `alert` banner in the
  panel — and marks no row, when the whole-map `onOverridesChange` adapter
  throws; it clears again when the adapter recovers.

## How to get to it (user POV)

- Click the `flags` chip in the bar to open the panel.
- Use the **UI Facelift 2026** switch directly in the bar.
- Reach either from inside the `⋮` menu when the bar is narrow.
- Run a flags command from `⌘K` (`Toggle flag: …` per boolean flag,
  `Clear all local flag overrides`, `Copy flag override recipe`,
  `Copy flag overrides as JSON`, `Re-read feature flags`). `flags.set` is
  **not** in `⌘K` — it declares an `input` schema and the palette has no form
  for one; it is a bridge-only command.
- Load any page with `?dtb-flags=reset`.

## Driving it with the Browser pane

Preconditions:

- Baseline per [README](./README.md); the page read's `storage` is `{}`.
- The app resolves `new-header = true`; `ext("flags").overriddenCount` is `0`
  and `ext("flags").flags` has six entries.

Throughout, `ext("flags")` is
`read().diagnostics.find(d => d.id === "flags").data` and `flag(key)` is
`ext("flags").flags.find(f => f.key === key)`. Each row is
`{key, type, source, overridden, masked, reloadBehavior, effective, base,
default, tags}`, with **typed** values — `false`, not `"false"` — except on a
masked row, which publishes the same redacted string the panel shows.

- **Override a boolean, with the panel shut.** This is the assertion the whole
  read surface exists for: `runCommand("flags.toggle.new-header")` →
  `{ok: true}`, then read. Require all four of:
  - `flag("new-header")` is
    `{effective: false, base: true, default: false, source: "local-override",
    overridden: true}` and its `tags` *contains* `override`;
  - `ext("flags").overriddenCount` is `1`;
  - the app: the page read's `appFlags[1]` is
    `new-header = false (overridden — the app resolves true)` — the playground
    resolving `override ?? base`, i.e. the override actually reached the
    application;
  - storage: `storage["dtb:v1:playground:ext:flags:overrides"]` is
    `{"new-header":false}`.

  `shell.activePanel` is still `null` throughout. Capture that field with the
  artifact: it is what makes this a proof that the state is readable without
  the UI, rather than a proof that the panel renders.
- **Set a specific value in one call.** `flags.toggle.<key>` only exists for
  *boolean, non-orphaned* flags and only flips whatever is there. `flags.set`
  takes `{key, value?}` and covers every flag:
  `runCommand("flags.set", {key: "search.rank", value: 9})` → `{ok: true}`,
  then `flag("search.rank")` is `{effective: 9, base: 2, overridden: true,
  source: "local-override"}` and the page read's `appFlags` entry for
  `search.rank` moved with it — a number flag, which had no one-call path at
  all before contract v2. **Omitting `value` is what clears** the override
  (`runCommand("flags.set", {key: "search.rank"})` → `overridden: false`,
  `effective` back to the app's `2`).
- **A refusal is a value, not a rejection.**
  `runCommand("flags.set", {key: "new-header", value: "yes"})` →
  `{ok: false, reason: "threw", error: '"new-header" is a boolean flag; …'}`,
  and the row is unchanged: `overridden: false`, `appFlags` untouched, nothing
  in `storage`. Same for an unknown key (`No flag named "nope"`) and for a
  variant outside the declared set. The command refuses rather than coercing,
  which is the rule the panel's editor already followed.
- **`value: null` is refused, not a way to clear.** `null` is a real
  `FlagValue`, but the flag's declared type is checked with `typeof`, so
  `runCommand("flags.set", {key: "new-header", value: null})` →
  `{ok: false, reason: "threw", error: '"new-header" is a boolean flag; null is
  not a valid boolean value'}`, and the row is unchanged. The same holds for
  `theme.name` (string) and `search.rank` (number). That refusal is correct:
  a stored `null` override of a typed flag is dropped by `vetOverrides` on the
  next load, so accepting it would create an override that silently vanishes.
  Only a **variant** flag whose `variants` list includes `null` accepts one,
  and the playground has no such flag — do not expect the accepting branch
  here. The `input` schema advertises `["boolean", "string", "number"]` and
  carries the rule in `value.description`; if you ever read a `nullable` field
  back off `listCommands()`, that is a finding.

- **Then drive the user path.** Clear the override
  (`runCommand("flags.clearOverrides")`), `find` role `button` name `Flags` and
  click the ref (`shell.activePanel` becomes `"flags"`), then `find` role
  `switch` name `Toggle new-header` and click it. The same four facts hold —
  and now the switch itself is proven, which `runCommand` alone does not do.
- **Persistence.** `navigate` to `http://localhost:5273/`. The same four facts
  hold, and `shell.activePanel` reopened the flags panel.
- **Masking.** Read again. `flag("checkout.apiToken")` has `masked: true`, its
  `tags` contains `masked`, and `effective`, `base` and `default` are
  `"[redacted]"`, `"[redacted]"` and `"null"` — **strings**, with `source`
  `"server-rule"`. A masked row publishes the panel's redacted display strings
  rather than typed values, because there is no unmasked path out of this
  extension, to the screen or to a reader. Unmasked rows publish the typed
  value, so check `masked` before comparing. Grep the *whole* bridge read for
  `tok-live-abcdef123456`: it must not appear. The panel's own footer states
  the masked count (`1 here`).
- **Promoted flag.** `flag("ui-facelift").tags` contains `promoted`. The bar
  control itself is a rendering: screenshot it, or `find` role `switch` name
  `Toggle ui-facelift`. Click it and confirm the page read's `appFlags[0]`
  flips.
- **Reject a bad value.** *(Recipe not yet proven — see Gotchas.)* `find` role
  `textbox` name `Override search.rank`, type `abc`, then commit with `Enter`
  or by clicking away — the editor only commits on Enter or blur, never
  per keystroke. The refusal itself is a rendering (an `alert` reading `not a
  number`, `data-dtb-invalid="true"` on the input); the *state* assertion is
  that `flag("search.rank")` is unchanged — `overridden: false`, `effective`
  still the app's own number — the page read's `appFlags` entry for
  `search.rank` is unchanged, and nothing is written to storage. A refused
  edit keeps the draft rather than coercing `"abc"` to `0`.
- **Clear from the panel.** Click the `Clear all overrides (n)` button
  (`[data-dtb-part="flag-action"]`). Read: no row's `tags` contains
  `override`, `overriddenCount` is `0`, and the overrides key is gone from
  `storage`.
- **Clear from the URL.** Re-apply an override, then `navigate` to
  `http://localhost:5273/?dtb-flags=reset`. Read: `appFlags[1]` is
  `new-header = true`, `overriddenCount` is `0`, and the overrides key is
  absent — with the panel never opened.
- **Proof.** Capture the bridge read at baseline, after the override, after the
  reload, and after the reset, plus a screenshot of the open panel showing the
  `overridden` tag and the `[redacted]` row.

## Gotchas

- **`overridden: true` is not proof the app got it.** The override only counts
  once the app's own `flag-readout` resolves it — an adapter can accept a write
  and not apply it, which is exactly what the `flag-break-adapter` fixture
  simulates. The published row then carries the `not-applied` tag, and
  `effective` still reports what the extension *believes* the app sees. Read
  both `tags` and the page read's `appFlags`.
- `checkout.apiToken` reads `default: "null"` — the string, because a masked
  row publishes display text — rather than its real value. The mask is applied
  before anything is published, so there is nothing to un-mask anywhere: not in
  the DOM and not in the bridge read.
- The `new-header` row also carries an `expired` tag at baseline. Assert
  `tags` *contains* `override`, never that it equals `["override"]`. The
  vocabulary is `override`, `not-applied`, `orphaned`, `promoted`, `masked`,
  `expired`, `reload` — the same strings the panel's `data-dtb-tag`
  attributes carry.
- Two fixtures leave state behind that a `?dtb-flags=reset` does *not* undo:
  `flag-flip-base` changes the app's own base value, and `flag-orphan` writes
  a renamed-flag override straight into storage and reloads. Prefer
  `localStorage.clear()` plus a reload when returning to baseline.
- `search.rank` has `reloadBehavior: "full-reload"`: its override is stored
  immediately but the app is documented as needing a reload to pick it up, and
  the row gains the `reload` tag until the reload happens or
  `acknowledgeReload()` runs. Only *boolean, non-orphaned* flags get a
  `flags.toggle.<key>` command; for anything else use `flags.set`, which takes
  `{key, value?}` and reaches string, number and variant flags too. Both ship:
  the enumeration is what a human finds in `⌘K` (which skips `flags.set`,
  because it declares `input`), and `flags.set` is the one-call tool path.
- **The `rejected` path is unverified.** Driving the text editors needs
  reliable keyboard input, which the harness did not have when this map was
  written (see [shell.md](./shell.md) on a hidden Browser pane). `form_input`
  sets the DOM value without going through React's `onChange`, so the
  extension's draft stays empty and the commit is a no-op — it looks like a
  silent pass. Verify this step with the pane displayed, using `computer`
  `type` plus `Enter`, before reporting it either way.
- **The read-only branch is unreachable in the playground.** `writable` is
  "either `onOverride` or `onOverridesChange` is a function" in
  `src/ext/flags/runtime.ts` — it is published, so `ext("flags").writable`
  answers it directly — and the playground passes both, so every step above is the writable
  path and the `switch` named `Toggle new-header` stays. Without it (pending
  PR stack #21–#28, `fix(ext): stop trusting unvetted overrides …`) a
  promoted boolean drops `role="switch"` and `aria-checked` entirely, its
  click opens the panel instead of toggling, and the chip `title` ends in
  `read-only`. Source-confirmed, not driven; there is no fixture for it, and
  `flag-break-adapter` is not one — it keeps `onOverride` and makes it throw,
  which is the `not-applied` path.
- Overrides live in the browser, not the URL. Copying the recipe writes to the
  clipboard, which needs the pane focused; prefer asserting on the panel and
  storage rather than on clipboard contents.
