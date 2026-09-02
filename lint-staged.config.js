// oxfmt and oxlint are separate binaries, and oxfmt is configured here for JS,
// TS and YAML while oxlint has no YAML rules at all — so JS/TS gets both
// commands and the YAML entry gets oxfmt alone. YAML is here because `format:check` in `verify`
// covers `.github/`, and without this entry a hand-edited workflow would pass
// `pre-commit` and fail CI.
//
// `--no-error-on-unmatched-pattern` on every entry is load-bearing, not
// decorative.
// lint-staged matches this glob on basename, so a staged file under an ignored
// directory (`examples/playground`, `test/fixtures`) is still handed to the
// tools, which then exclude it by their own ignore rules and exit non-zero on
// having nothing left to do — oxfmt with 2, oxlint with 1. Without these flags
// that blocks the commit outright.
export default {
  "*.{ts,tsx,js,jsx}": [
    "oxfmt --no-error-on-unmatched-pattern",
    "oxlint --fix --no-error-on-unmatched-pattern",
  ],
  "*.{yml,yaml}": ["oxfmt --no-error-on-unmatched-pattern"],
};
