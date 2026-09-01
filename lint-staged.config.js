// oxfmt and oxlint are separate binaries and oxfmt handles JS/TS only, so this
// is two commands rather than one.
//
// `--no-error-on-unmatched-pattern` on both is load-bearing, not decorative.
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
};
