// oxlint has no YAML rules, so YAML gets oxfmt alone while JS/TS gets both.
// YAML is included because `format:check` in `verify` covers `.github/`, and
// without this entry a hand-edited workflow would pass pre-commit and fail CI.
//
// `--no-error-on-unmatched-pattern` is load-bearing: lint-staged matches this
// glob on basename, so a staged file under an ignored directory still gets
// handed to the tools, which then exclude it and exit non-zero on having
// nothing to do (oxfmt: 2, oxlint: 1) — without the flag that blocks the commit.
export default {
  "*.{ts,tsx,js,jsx}": [
    "oxfmt --no-error-on-unmatched-pattern",
    "oxlint --fix --no-error-on-unmatched-pattern",
  ],
  "*.{yml,yaml}": ["oxfmt --no-error-on-unmatched-pattern"],
};
