# Environment redaction

`/ext/environment` shows the build and session the app is running as — and the
part worth verifying is what it refuses to show. The playground's context
deliberately carries four secrets, one of them nested two levels deep under an
innocent key, and every one must appear masked in the panel, in the chip, and
in anything copied out of it.

## Sub-features

- `env-chip` summarises the environment in the bar and colours its severity.
- `env-panel` groups the context into `build`, `session` and `client` rows.
- `env-redact` masks a token in a query string, a bare token key, an email,
  and a `refreshToken` nested inside `extra.identity`.
- `env-copy` masks the same values in both copy actions.
- `env-alert` surfaces impersonation as an `alert` banner and a chip flag.
- `env-poll` picks up context mutations on its next poll, without a reload.
- `env-empty` explains itself when the app supplies no context.

## How to get to it (user POV)

- Click the `env` chip at the start of the bar.
- Reach it from inside the `⋮` menu when the bar is narrow.
- Use `Copy environment summary`, `Copy environment context as JSON` or
  `Re-read environment context` from `⌘K`.
- The playground's own `env-impersonate`, `env-sync` and `env-supply` buttons
  mutate the context the app hands over.

## Driving it with the Browser pane

Preconditions:

- Baseline per [README](./README.md), viewport pinned to 1280×800.
- The playground supplies its full context (`env-supply` reads
  `context supplied: true`).

- **Open the panel.** Click `[data-dtb-ext-id="environment"] [data-dtb-part="trigger"]`.
  Use that CSS selector: the chip carries no `aria-label`, so a `find` for role
  `button` name `Environment` matches nothing — its accessible name is its own
  text, `envstaging`. Probe: `panel.extension` is `"environment"` and
  `environment.rows` has 20 entries across groups `build`, `session`, `client`.
- **The four secrets are masked.** Each row's `value` is the value with the
  marker spans left out, and `markers` lists the markers (`masked`,
  `detected`) separately — so these are equality assertions, not substring
  games. In `environment.rows`, require:
  - `API endpoint` = `https://api.example.com/v2?access_token=[redacted]`,
    `markers` `["masked"]` — the host and path survive, only the credential goes;
  - `User` = `n***@example.com`, `markers` `["masked"]`;
  - `authToken` = `[redacted]`, `markers` `["masked"]`;
  - `identity` = `{"email":"n***@example.com","refreshToken":"[redacted]"}`,
    `markers` `["masked"]` — the nested case, which only a redactor that walks
    the unserialised object finds.
- **Nothing leaks anywhere else.** Grep the whole probe snapshot, `panel.body`
  included, for `super-secret`, `abcdef123456`, `rt-nested-secret` and
  `nejc.mursic@example.com`. Zero matches is the assertion; a single match is
  the failure.
- **Non-secrets are untouched.** `Release` is `web-2026.08.28.4`, `Commit` is
  `a84c7e1`, `Region` is `ap-southeast-1`, `Roles` is `admin, support`, and
  none of them carries a marker. Over-redaction is a failure too.
- **Copy is masked as well.** Click the panel's `Copy JSON` button —
  `[data-dtb-action="copy-json"]`, *not* `[data-dtb-part="env-action"]`, which
  matches both actions and whose first match is `Copy summary`. (`Copy
  environment context as JSON` is the ⌘K command's label, not this button's.)
  Then read the clipboard with `navigator.clipboard.readText()`. The four
  secrets are absent and the panel's footer states the masked count (`4 here`
  at baseline).
- **Impersonation.** Click `[data-testid="env-impersonate"]` and wait one poll
  (500 ms). Probe: `environment.chip` gains `impersonating`,
  `environment.banner` carries the `alert`, and the `Impersonation` row reads
  the actor and subject. Click again to restore.
- **Empty context.** Click `[data-testid="env-supply"]` and wait one poll.
  Probe: the groups are replaced by an `env-empty` note explaining that the app
  supplied nothing — not a blank panel. Click again to restore.
- **Proof.** Capture the probe snapshot containing `environment.rows`, the
  clipboard text, and a screenshot of the open panel with the `masked` badges
  visible.

## Gotchas

- The chip is `warn` severity at baseline because the environment is `staging`.
  That is the resting state, not a finding.
- The extension polls every 500 ms, so a probe fired immediately after an
  `env-*` fixture click still shows the previous value. Wait a poll, or
  re-read until it settles.
- Reading the clipboard needs the pane focused and may prompt for permission.
  When it is unavailable, say the copy path was not verified — do not infer it
  from the panel, which is a different render.
- The `masked` and `detected` markers are sibling elements inside the row
  value with no separating whitespace, so a naive `textContent` read yields
  `[redacted]masked` and `1280×800 @2xdetected`. The probe splits them into
  `value` and `markers` for you; if you read the DOM yourself, exclude
  `[data-dtb-part="env-tag"]` rather than reaching for `includes`.
- Masking happens before render: there is no un-masked value hiding in a
  `title` or a `data-` attribute to compare against. Nothing in the DOM proves
  the redactor saw the secret — the fixture in `extensions.tsx` is the record
  of what was fed in, so cite it alongside the artifact.
- The panel root `[data-dtb-part="env-panel"]` carries no `aria-label` once
  the pending PR stack #21–#28 lands (a role-less `div` with a label is an
  ARIA violation, so it was removed). The panel's accessible name is core's:
  the `[data-dtb-part="panel"]` host is a `region` named `Environment`
  (`src/core/PanelHost.tsx`), so `find` by role `region` still resolves; the
  chip is the one with no name of its own (`envstaging`). Source-confirmed,
  not driven.
- `Route`, `Viewport` and `Connection` in the `client` group are detected by
  the extension, not supplied by the app; they change with the viewport you
  pinned.
