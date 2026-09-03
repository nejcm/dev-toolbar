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

## How to get to it (user POV)

- Click the `flags` chip in the bar to open the panel.
- Use the **UI Facelift 2026** switch directly in the bar.
- Reach either from inside the `···` menu when the bar is narrow.
- Run a flags command from `⌘K` (`Clear all local flag overrides`,
  `Copy flag override recipe`, `Copy flag overrides as JSON`,
  `Re-read feature flags`).
- Load any page with `?dtb-flags=reset`.

## Driving it with the Browser pane

Preconditions:

- Baseline per [README](./README.md); probe `storage` is `{}`.
- The app resolves `new-header = true` and `flags.chip` reads `flags6`.

- **Open the panel.** `find` role `button` name `Flags`, click the ref. Probe:
  `panel.extension` is `"flags"`; `flags.rows` has six entries keyed
  `new-header`, `billing.tier`, `checkout.apiToken`, `checkout.copy`,
  `search.rank`, `ui-facelift`.
- **Override a boolean.** `find` role `switch` name `Toggle new-header`, click
  the ref. Probe, and require all four of:
  - the row: `key` `new-header`, `tags` contains `override`,
    `switchChecked` `"false"`, and `values` is
    `{effective: "false", base: "true", default: "false", source: "local-override"}`
    — four separate handles (`[data-dtb-part="flag-value"]` by
    `data-dtb-role`, plus `flag-source`), because their container's text runs
    them together with no separator;
  - the chip: `flags.chip` is `flags1 overridden`;
  - the app: `flags.appReadout[1]` is
    `new-header = false (overridden — the app resolves true)` — this is the
    playground resolving `override ?? base`, i.e. the override actually
    reached the application;
  - storage: `storage["dtb:v1:playground:ext:flags:overrides"]` is
    `{"new-header":false}`.
- **Persistence.** `navigate` to `http://localhost:5273/`. Probe: the same
  four facts hold, and `activePanel` reopened the flags panel.
- **Masking.** Probe the same snapshot. The `checkout.apiToken` row carries
  tag `masked` and its `values` reads `effective: "[redacted]"`,
  `base: "[redacted]"`, `default: "null"`, `source: "server-rule"`. Grep
  `panel.body` for `tok-live-abcdef123456` — it must not appear. The panel's
  own footer states the masked count (`1 here`).
- **Promoted flag.** Probe: `flags.promoted` *contains* `UI Facelift 2026` (in
  the bar, not the panel) and the `ui-facelift` row carries tag `promoted`. Use
  a containment check, not equality: the control renders its configured icon in
  a span before the label, so the text reads `◈UI Facelift 2026`. Click the
  promoted switch in the bar and confirm `flags.appReadout[0]` flips.
- **Reject a bad value.** *(Recipe not yet proven — see Gotchas.)* `find` role
  `textbox` name `Override search.rank`, type `abc`, then commit with `Enter`
  or by clicking away — the editor only commits on Enter or blur, never
  per keystroke. Expect a `rejected` tag with an `alert` reading `not a
  number`, `data-dtb-invalid="true"` on the input, `flags.appReadout` for
  `search.rank` unchanged, and nothing written to storage: a refused edit
  keeps the draft rather than coercing `"abc"` to `0`.
- **Clear from the panel.** Click the `Clear all overrides (n)` button
  (`[data-dtb-part="flag-action"]`). Probe: no row carries `override`,
  `flags.chip` is back to `flags6`, and the overrides key is gone from
  `storage`.
- **Clear from the URL.** Re-apply an override, then `navigate` to
  `http://localhost:5273/?dtb-flags=reset`. Probe: `flags.appReadout[1]` is
  `new-header = true`, `flags.chip` is `flags6`, and the overrides key is
  absent — with the panel never opened.
- **Proof.** Capture probe snapshots at baseline, after the override, after the
  reload, and after the reset, plus a screenshot of the open panel showing the
  `overridden` tag and the `[redacted]` row.

## Gotchas

- The panel showing `now false` is not proof. The override only counts once
  the app's own `flag-readout` resolves it — an adapter can accept a write and
  not apply it, which is exactly what the `flag-break-adapter` fixture
  simulates (the row then carries `not-applied`).
- `checkout.apiToken` reads `default null` rather than its real value; the mask
  is applied before render, so there is nothing to un-mask in the DOM.
- The `new-header` row also carries an `expired` tag (`expired 2026-01-01`)
  at baseline. Assert `tags` contains `override`, not that it equals it.
- Two fixtures leave state behind that a `?dtb-flags=reset` does *not* undo:
  `flag-flip-base` changes the app's own base value, and `flag-orphan` writes
  a renamed-flag override straight into storage and reloads. Prefer
  `localStorage.clear()` plus a reload when returning to baseline.
- `search.rank` carries a `full-reload` behavior tag: its override is stored
  immediately but the app is documented as needing a reload to pick it up.
- **The `rejected` path is unverified.** Driving the text editors needs
  reliable keyboard input, which the harness did not have when this map was
  written (see [shell.md](./shell.md) on a hidden Browser pane). `form_input`
  sets the DOM value without going through React's `onChange`, so the
  extension's draft stays empty and the commit is a no-op — it looks like a
  silent pass. Verify this step with the pane displayed, using `computer`
  `type` plus `Enter`, before reporting it either way.
- Overrides live in the browser, not the URL. Copying the recipe writes to the
  clipboard, which needs the pane focused; prefer asserting on the panel and
  storage rather than on clipboard contents.
