# ADR-003 — `CONTRACT_VERSION` compatibility policy

**Status:** Proposed. **The question is open** — this record exists to state it
precisely, not to settle it. Nothing here is in force; what is in force is the
precedent described under Context.

## Context

`CONTRACT_VERSION` is exported from `src/core/contract.ts` and is `1`. An extension
may declare `contractVersion`; core compares the two.

**What a mismatch does today: it logs a `console.warn`, once per extension id, and
nothing else.** The extension still renders, still starts, still contributes commands
and diagnostics. An absent `contractVersion` is silent, and nothing warns when the
toolbar is `enabled={false}`. The field is documentation, not a gate.

That much is deliberate and is not the open question. Core has no basis to decide what
a mismatch *means* — a `2` extension against a `1` core may be entirely compatible —
and refusing to render would turn a warning into an outage in somebody's development
tooling.

The open question is **when the number should change.** What exists is precedent, not
a rule. Seven first-party extensions were built against the contract before `0.1.0`,
and every change any of them forced was additive or a semantic correction:

| Change | Shape |
| --- | --- |
| `togglePanel()` on `CompactSlotProps` | New field |
| `--dtb-ok` / `--dtb-warn` and their `-bg` pairs | New tokens |
| `commands` may be a function | Widened existing field |
| The `overlay` slot | New optional slot |
| `diagnostics()`, `getDiagnostics()` | New optional field, new `api` method |
| `hidden` means absent everywhere, not unpainted | Semantic correction |

None bumped, on the reasoning that bumping for an additive change spends the one
signal a version number carries. That reasoning leaned partly on "nothing has been
published yet", which stopped being true at `0.1.0`.

Two further facts constrain any answer:

- **The field cannot become a gate cheaply.** Making core refuse a mismatched
  extension would be a breaking change for every extension that declares a number,
  and it is the outage-instead-of-warning trade above.
- **Extensions on their own subpath cannot import the constant** — [ADR-001](./ADR-001-extensions-are-plain-objects.md)
  forbids value imports from core — so any extension that states a version
  hand-maintains a copy of the number, closed only by an equality assertion in its
  tests. Every bump therefore has to be propagated by hand across every extension that
  declares one.

## Decision

**Undecided.** The candidate policies, with what each costs:

| Option | What it says | Cost |
| --- | --- | --- |
| **A. Bump only on breaking changes.** | The number is a compatibility boundary: same number means an extension written for it works. Additive changes never bump. | An extension declaring `1` may still need a newer core than the consumer has, because the feature it uses arrived additively. The number cannot express "needs at least". |
| **B. Bump on any contract change, additive included.** | The number is a feature level, and an extension declaring `3` is saying it needs core `>= 3`. | Turns every additive widening into a coordinated bump across every first-party extension's hand-maintained copy. Makes the common case noisy, so the number stops being read. |
| **C. Drop `contractVersion` from the contract.** | Package semver is already the compatibility signal, and it is one nobody has to maintain by hand. | Removing a published field is itself a breaking change, and it loses the mismatch warning, which is genuinely useful when a consumer has two copies of core in the tree. |

The interim rule, which is what `CONTRIBUTING.md` says today: **do not bump silently.
If you are changing the contract in a way that is not purely additive, say so in the
PR description and raise the version question there.** Do not assume the additive
precedent covers you.

### Risk accepted

While this is open:

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| An extension written against a newer core is installed against an older one, uses an additively-added field, and gets `undefined` behaviour with no warning — because both declare `1` | Medium, and rising with each additive change | A slot that silently does not render, or a command that never appears | Package semver: the extension's `peerDependencies` on `@nejcm/dev-toolbar` is the real signal, and is not hand-maintained. |
| The number is bumped for an additive change and consumers read it as breaking | Low | Unnecessary migration work | The interim rule: raise it in the PR rather than deciding it in a commit. |
| The hand-maintained copies drift from core's constant and a wrong version number is printed into an outbound bug report | Low | A wrong fact in somebody's ticket about a version they cannot check | The equality assertion pattern in `src/ext/diagnostics/__tests__/diagnostics.test.tsx`. Copy the assertion, not just the constant. |

## Consequences

Until this is settled:

- `contractVersion` is described everywhere as documentation rather than a check, and
  should not be documented as a compatibility guarantee.
- The mismatch warning stays a warning.
- Any extension that needs to *state* the version copies the equality assertion
  alongside the constant.

Settling it means picking A, B or C, superseding this record, and — for A or B —
writing the rule into `CONTRIBUTING.md` next to the commit convention, because the
person who needs it is writing a PR description.
