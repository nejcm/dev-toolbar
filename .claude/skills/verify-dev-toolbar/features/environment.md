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

Throughout, `env` is
`read().diagnostics.find(d => d.id === "environment").data` —
`{generatedAt, environment, severity, supplied, impersonating, maskedCount,
fields}` — and each field is `{id, label, group, source, masked, markers,
value}`. **The masking is already applied**: this is the same redacted view the
panel renders, published rather than scraped, so there is no `[redacted]masked`
run-together problem and no marker to strip out of the text.

- **Read it with the panel shut.** `env.environment` is `"staging"`,
  `env.severity` is `"warn"`, `env.supplied` is `true`, and `env.fields` has 20
  entries across groups `build`, `session` and `client`. Then click
  `[data-dtb-part="item"][data-dtb-ext-id="environment"] [data-dtb-part="trigger"]` to prove the
  panel opens — that CSS selector, because the chip carries no `aria-label` and
  a `find` for role `button` name `Environment` matches nothing; its accessible
  name is its own text, `envstaging`. `shell.activePanel` becomes
  `"environment"`.
- **The four secrets are masked.** These are equality assertions on
  `env.fields`, not substring games:
  - `apiEndpoint` = `https://api.example.com/v2?access_token=[redacted]`,
    `markers` `["masked"]` — the host and path survive, only the credential goes;
  - `userId` = `n***@example.com`, `markers` `["masked"]`;
  - `extra:authToken` = `[redacted]`, `markers` `["masked"]`;
  - `extra:identity` = `{"email":"n***@example.com","refreshToken":"[redacted]"}`,
    `markers` `["masked"]` — the nested case, which only a redactor that walks
    the unserialised object finds.

  `env.maskedCount` is `4` and matches the panel's own footer.
- **Nothing leaks anywhere else.** Grep the **whole** bridge read — every
  extension's contribution, not just this one — for `super-secret`,
  `abcdef123456`, `rt-nested-secret` and `nejc.mursic@example.com`. Zero
  matches is the assertion; a single match is the failure. This is a stronger
  check than the old panel-text grep: the bridge read is everything the
  toolbar would hand a machine, and it is redacted twice — once by the
  extension on the way in, once by the bridge on the way out.
- **Non-secrets are untouched.** `release` is `web-2026.08.28.4`, `commit` is
  `a84c7e1`, `region` is `ap-southeast-1`, `roles` is `admin, support`, and
  each has `masked: false` and empty `markers`. Over-redaction is a failure
  too.
- **Copy is masked as well.** Click the panel's `Copy JSON` button —
  `[data-dtb-action="copy-json"]`, *not* `[data-dtb-part="env-action"]`, which
  matches both actions and whose first match is `Copy summary`. (`Copy
  environment context as JSON` is the ⌘K command's label, not this button's.)
  Then read the clipboard with `navigator.clipboard.readText()`. The four
  secrets are absent and the panel's footer states the masked count (`4 here`
  at baseline).
- **Impersonation.** Click `[data-testid="env-impersonate"]` and wait one poll
  (500 ms). Read: `env.impersonating` is `true`, `env.severity` is `"bad"`
  (impersonation outranks the environment), and the `impersonation` field
  reads the actor and subject with `alarming` among its `markers`. The banner
  itself is a rendering — screenshot it, or `find` role `alert`. Click again to
  restore.
- **Empty context.** Click `[data-testid="env-supply"]` and wait one poll.
  Read: `env.supplied` is `false` and `env.environment` is `"unknown"` — never
  inferred from the hostname. The panel replaces the groups with an `env-empty`
  note rather than going blank; that half is a rendering. Click again to
  restore.
- **Proof.** Capture the bridge read containing `env.fields`, the clipboard
  text, and a screenshot of the open panel with the `masked` badges visible.

## Gotchas

- The chip is `warn` severity at baseline because the environment is `staging`.
  That is the resting state, not a finding.
- The extension polls every 500 ms, so a read fired immediately after an
  `env-*` fixture click still shows the previous value. Wait a poll, or
  re-read until it settles.
- Reading the clipboard needs the pane focused and may prompt for permission.
  When it is unavailable, say the copy path was not verified — do not infer it
  from the panel, which is a different render.
- The `masked` and `detected` markers are sibling elements inside the rendered
  row with no separating whitespace, so a `textContent` read yields
  `[redacted]masked` and `1280×800 @2xdetected`. That was the reason the old
  scraper existed and it no longer applies: `value` and `markers` arrive as
  separate published fields. Do not read the row from the DOM.
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
- `route`, `viewport` and `connection` in the `client` group are detected by
  the extension, not supplied by the app — `source: "detected"` and `markers`
  containing `detected` say so. They change with the viewport you pinned.
