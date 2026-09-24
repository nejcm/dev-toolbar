---
description: Two deepening refactors from the 2026-09-24 architecture review, both rated Strong after a gpt-6-astra validation — one kit reader that masks core's diagnostics roster and proves it serialisable (closes a reproduced credential leak on the agent bridge and a reporter that dies or wedges on a BigInt), and one invariant suite that pins both ExtensionRuntimeApi adapters (core's and the published fake) to the contract, fixing the fake's three divergences.
date: 2026-09-24
status: implemented
---

# One reader for the diagnostics roster, one suite for the runtime api

Written 2026-09-24, after `/improve-codebase-architecture` produced nine
candidates and Codex (`gpt-6-astra`, effort `high`, read-only, one reviewer, no
fan-out) validated them claim by claim: 35 claims, 31 confirmed, 4 partial, 0
refuted. These are the two it left at **Strong**: card 2, which it ranked first,
and card 3 in its narrowed form — the shared suite, not the builder extraction.

Every fact under "What is actually true" was read at `dea1657` (`main`) unless
it says otherwise. Line numbers will drift. **The reset-param work landed on
`feat/reset-link-ux` while this plan was written**: `7ee6f7a feat(flags,theme-editor):
strip the reset param once honoured and show a reset link`, plus `447699c`. It
touches `src/kit/index.ts`, `src/kit/preference.ts`, `src/ext/flags/*`,
`src/ext/theme-editor/*` and `docs/kit.md`. Plan A touches `src/kit/index.ts`
and `docs/kit.md`, so branch it from `main` after that PR merges, or rebase
onto it. Plan B touches none of those files. Those commits leave every source
file both plans cite unchanged. They add to only two test files,
`src/core/__tests__/boundary.test.ts` (+2) and `src/test-utils/location.ts`
(+62), and neither plan edits either one.

Vocabulary is the codebase-design one. A **module** is an interface plus an
implementation. It is **deep** when a small interface hides a lot of behaviour.
**Locality** is what maintainers get: one place to change and test. **Leverage** is
what callers get: one interface, N call sites. A **seam** is where an interface
lives, and an **adapter** is a thing that satisfies it there.

Neither plan changes `src/core/contract.ts`, touches `CONTRACT_VERSION` or reopens
an ADR. Plan A is additive on `/kit` and fixes published behaviour in
`/ext/agent`. Plan B fixes published behaviour in `/testing`.

**Order.** Plan A's Phase 1 goes first: it is two bug fixes a user can hit today.
Plan B can run in parallel with all of Plan A, because they share no files.

**Outcome, 2026-09-24.** Plan A shipped as #138–#142, one PR per phase rather than
the slicing below; Plan B as #134–#136 (B1, B2, B5). B3 needed no change: all 16
fake-driven suites passed against the fixed fake. B4's gate did not fire — core's
conformance run is 13 cases, ~60 ms cold then 4–9 ms, and there is still no second
in-core consumer. Found on the way: a fourth fake divergence (a subscriber added
during delivery heard that delivery), fixed with the other three; the fake's
`setVisible` stays live after abort so subscribe-after-abort is observable. Where
the table in "The deepened module" disagreed with diagnostics' code, the kit
followed the code: a status core does not emit reads as `"ok"`, and `id`/`label`
pass through unmasked. The `/kit` export pin in `boundary.test.ts` grew by two
names. Surface A's depth moved 5 → 7, as decided.

---

## Plan A — one reader for core's diagnostics roster

### What is actually true

**Two readers, two masking policies.** Core's `collectDiagnostics`
(`src/core/diagnostics.ts:59-124`) builds one entry per present, non-hidden
extension. It puts a throwing `diagnostics()`'s message into `error` and its
name into `errorName`, **unredacted**, because core may not import `/runtime`
(`contract.ts:175-197` says so field by field). Two first-party extensions
read that roster:

| | `/ext/diagnostics` `gather()` (`runtime.ts:363-413`) | `/ext/agent` `readDiagnostics()` (`runtime.ts:244-249`) |
| --- | --- | --- |
| `getDiagnostics` missing or throwing | guarded; becomes a `"*"` contribution | unguarded; the throw escapes `read()` |
| failed entry's `error` / `errorName` | each half through `redactProse`, then joined | one anchored `redact()` over the whole array |
| `ok` entry's `data` | `redact()` at its own root, then `JSON.stringify` probe (`finish`, `:338-361`) | redacted as part of the array (data at depth 2) |
| unserialisable `data` (BigInt) | `status: "unserialisable"` | passes through; `JSON.stringify` throws later |
| own entry | skipped (`:388`) | n/a (declares no `diagnostics()`) |

**The leak is real and reaches the wire.** `redact()` is anchored: it masks a
value that *is* a credential, not one with text around it. So a failed entry
whose `error` is `"fetch https://api.example.com/v1?token=abc123 failed"`
survives the agent path unmasked, while `redactProse` gives `token=[redacted]`.
This was reproduced twice: once by this review, and once by Codex through
`collectDiagnostics`, `installAgentBridge` and `createAgentReporter` with an
intercepting `fetch`. Both the registry global (`read().diagnostics[0].error`)
and the reporter's outbound body carried the raw token. The transport is opt-in
(`report` option); the global is not.

`docs/architecture.md` §10 predicted exactly this: *"a second reader that
forgot to redact would ship raw contributions."*

**The reporter dies or wedges on a BigInt, two different ways.**

1. *Roster data.* `redact()` passes a BigInt through (`redact.ts:478-481`).
   The reporter's `tick()` (`report.ts:226-236`) wraps `handle.read()` **and**
   `JSON.stringify(snapshot)` in one `try`. It treats any throw as "the toolbar
   unmounted" and calls `stop()`. Reproduced by Codex: after the offending
   extension is removed, the second tick never reads again, and posts stay at 0.
   The stop-on-unmount behaviour itself is right and pinned:
   `phase3.test.tsx:321` *"stops itself when the toolbar it reports on has
   unmounted"*.
2. *Command results.* `runCommand` redacts `outcome.result`
   (`runtime.ts:279`), and a BigInt survives that. The outcome goes into the
   `results` of the next body, and `send()` serialises the body **inside its
   transport `try`** (`report.ts:188`). So the throw is counted as an
   unreachable server: it warns once about the endpoint, and the outcome is
   re-queued (`:263`, `:297`). Every later check-in carries it and fails the
   same way, so the reporter is wedged: no snapshot or outcome is delivered
   again. Read in the code; Codex confirmed the path but did not run it.

**Three depths are pinned and documented.** `redact()` truncates at
`maxDepth` 8 from depth 0, so what survives depends on where the redacted root
is. `phase2.test.tsx:401-500` pins three numbers, and `docs/ext/agent.md:118-136`
publishes them:

| Surface | What redacts it | Levels kept |
| --- | --- | --- |
| A. bridge `read().diagnostics` | `redact(getDiagnostics())`, data at depth 2 | 5 |
| B. bridge `runCommand("diagnostics.capture").result` | `redact(snapshot)`, data at depth 3 | 4 |
| C. bug-report JSON | `finish()` per contribution, data at depth 0 | 7 |

**The agent's snapshot type has no `"unserialisable"`.**
`AgentSnapshot.diagnostics` is `readonly ExtensionDiagnostics[]`
(`agent/types.ts:92`), whose `status` is `"ok" | "absent" | "failed"`
(`contract.ts:167-173`). Diagnostics has its own wider `DiagnosticContribution`
(`diagnostics/types.ts:150-158`). So the two readers can share the *masking*,
but not the *output shape*. This was Codex's main objection to the card, and
the module below is shaped by it.

**The kit's admission bar is "three users, or a third party asking"**
(`docs/kit.md:84`). A roster reader has two first-party users. `embed()` is the
precedent for an explicit exception admitted through a plan (`docs/kit.md:103-108`).
The case for this exception is §10's own: the audience that most needs the
reader is a third-party reader that would otherwise forget to redact.

### The deepened module

`src/kit/diagnostics.ts`, exported from `@nejcm/dev-toolbar/kit`. It is stateless
and marker-free, and it type-imports core's contract the way
`src/kit/preference.ts` already does.

```ts
/** One roster entry after masking. Every string is masked; `data` is redacted and JSON-safe. */
export type MaskedDiagnostics =
  | { id: string; label: string; status: "ok"; data: unknown }
  | { id: string; label: string; status: "absent" }
  /** Each half through redactProse, **unjoined**: joining is the reader's choice. */
  | { id: string; label: string; status: "failed"; error: string; errorName?: string }
  /** `data` did not survive JSON.stringify after redaction; it is dropped, not shipped. */
  | { id: string; label: string; status: "unserialisable"; error: string };

export type DiagnosticsRosterRead =
  | { gathered: true; entries: MaskedDiagnostics[] }
  /** No `getDiagnostics` on this api, or it threw (`error` masked). */
  | { gathered: false; error?: string };

/** Reads, masks and proves core's roster serialisable. Never throws. */
export function readDiagnosticsRoster(
  api: Pick<ExtensionRuntimeApi, "getDiagnostics"> | null | undefined,
  options?: RedactOptions,
): DiagnosticsRosterRead;

/** One foreign value on its way out: redact, then prove it serialises. Never throws. */
export function redactForExport(
  value: unknown,
  options?: RedactOptions,
): { status: "ok"; value: unknown } | { status: "absent" } | { status: "unserialisable"; error: string };
```

`redactForExport` is `/ext/diagnostics`' `finish()` lifted out, with its order
kept: `redact()` walks first, and only then is the result serialised. It
earns its export with three call sites. The roster reader uses it internally,
diagnostics uses it for consumer `sources` (`takeData`, `:319-336`), and the
agent uses it for command results.

The semantics below are fixed here. The diagnostics column must be preserved
**exactly**; that is Phase 3's gate.

| Input | Result |
| --- | --- |
| `api` null/undefined, or no `getDiagnostics` | `{ gathered: false }` |
| `getDiagnostics` throws | `{ gathered: false, error: formatError(e, options) }` |
| `status: "absent"` | passed through |
| `status: "ok"`, `redact(data)` is `undefined` | `status: "absent"` (diagnostics' existing rule, `:340-346`) |
| `status: "ok"`, redacted data serialises | `status: "ok"`, `data` redacted at its own root |
| `status: "ok"`, redacted data throws in `JSON.stringify` | `status: "unserialisable"`, `error: formatError(e, options)` |
| `status: "failed"` | `error: redactProse(error ?? "diagnostics() threw.")`, `errorName: redactProse(errorName)` when present |
| a status core does not emit | `status: "failed"`, `error: "unknown status"`, never the raw value |

Deliberately **not** in the module: skipping the reader's own id, joining
`name: message`, and mapping to a reader's output type. Those are the two
readers' own business, and they differ.

### Phases

#### Phase 1 — close the two agent defects in place

Bug fixes first, before any module exists, so the leak does not wait on a
refactor.

**1a — pin both defects (fails before the fix).**
- `src/ext/agent/__tests__/phase2.test.tsx`, beside the three-depth block. A
  toolbar with an extension whose `diagnostics()` throws
  `new Error("fetch https://api.example.com/v1?token=abc123 failed")` →
  `read().diagnostics[i].error` contains `token=[redacted]` and not `abc123`.
  A second case gives the error a credential-shaped `name` (for example,
  `"Bearer secret"`) → `errorName` is masked too.
- `phase3.test.tsx`, in "the check-in": the same extension →
  `snapshot.diagnostics[i].error` in the intercepted outbound body is masked.
- `phase3.test.tsx`, in "the reporter's lifetime": an extension whose `data` holds
  `1n` → the reporter keeps checking in (`posts` rises). After that extension is
  removed, the next snapshot post carries the healthy roster. The existing
  `:321` case (unmount → stop) must stay green.
- `phase3.test.tsx`, in "a queued command": a command resolving `1n` → the
  outcome is delivered, and the check-in after it succeeds and carries no
  re-queued copy.

**1b — mask a failed entry before the bridge publishes it.**
`createAgentHandle`'s `readDiagnostics` (`agent/runtime.ts:244-249`) maps each
`status: "failed"` entry's `error` and `errorName` through `redactProse` before
the existing whole-array `redact()`. Nothing else moves. Surface A's depth stays
5 and every existing test stays green. This ships as its own PR:
`fix(ext): mask a failed diagnostics entry before the agent bridge publishes it`.

**1c — the reporter tells an unmounted handle from an unserialisable snapshot.**
In `report.ts`:
- `tick()` splits its `try`. A throw from `handle.read()` still means
  unmounted, so it calls `stop()`. A throw from `JSON.stringify(snapshot)`
  warns once (`${AGENT_MARKER}`, masked via `describeError`) and skips this
  snapshot. It does not stop.
- Each outcome is serialised on its own **before** it enters a body. An outcome
  that throws is replaced by `{ ok: false, reason: "threw", error: "the result
  could not be serialised — <masked detail>" }`. This uses the existing
  published `AgentRunResult` member, so no type widens.
- `send()` serialises the body outside the transport `try`. A serialisation
  failure there is no longer counted as an unreachable server, and it is never
  re-queued.

This is its own PR: `fix(ext): keep the agent reporter running past a value it
cannot serialise`.

#### Phase 2 — the kit module

**2a — interface and tests.** `src/kit/diagnostics.ts` and
`src/kit/__tests__/diagnostics.test.ts`: one `it.each` row per line of the
semantics table, plus these cases:
- a custom `mask` is honoured on every string;
- `extraKeys` reaches `data`;
- a throwing getter inside `data` becomes `redact()`'s own tag rather than a throw;
- a cycle inside `data` becomes `redact()`'s own tag;
- an `error` that is not a string is handled safely, even though core guarantees
  a string.

`redactForExport` gets its own rows: `ok`, `absent`, BigInt, a throwing
`toJSON`.

**2b — publish.** Export both functions and three types from `src/kit/index.ts`.
In `docs/kit.md`:
- add a "Diagnostics readers" section;
- add an adoption-table row, **Diagnostics roster**: `readDiagnosticsRoster`: 2;
  `redactForExport`: 3;
- add a paragraph admitting the reader as an explicit exception next to
  `embed()`'s, citing §10.

`src/core/__tests__/boundary.test.ts` needs no change, because kit files are
already scanned for markers and core value imports. The subpath already exists,
so none of the "six places" wiring applies.

#### Phase 3 — adopt in `/ext/diagnostics`, byte for byte

**3a — `gather()` becomes a mapping.** It calls `readDiagnosticsRoster(api,
redactOptions)`, drops its own id, and maps each entry to a
`DiagnosticContribution`. For a failed entry it joins `name: message` exactly
as `:400-409` does today, now over halves the kit has already masked.
`{ gathered: false, error }` becomes today's `"*"` contribution with today's
sentence. `finish()` becomes a call to `redactForExport` for `sources`, and
`maskProse` loses its roster use; it keeps its other callers (`readResponsiveness`).

**3b — gate: nothing a user sees moves.** Every existing diagnostics test passes
unedited, including `countMasked`, `renderJson` and `renderMarkdown`
fixtures. Surface C stays at 7 levels. If any fixture must change, stop: the
kit semantics are wrong, not the fixture.

#### Phase 4 — adopt in `/ext/agent`

**4a — the roster.** `readDiagnostics` calls `readDiagnosticsRoster(api,
redactOptions)` and maps the result to `ExtensionDiagnostics`:
- `ok`, `absent` and `failed` pass through. `failed` keeps `errorName` separate,
  which is the agent's published shape.
- `unserialisable` becomes `status: "ok"` with
  `data: "[unserialisable]"`. This is the same tag-in-place convention
  `redact()` uses for truncated and circular values.
- `{ gathered: false }` becomes `[]`, where today the throw escapes `read()`.

Phase 1b's inline masking is deleted.

**Surface A moves from 5 levels to 7**, because `data` is now redacted at its
own root, the same as surface C. Update the pin in `phase2.test.tsx` and the
table in `docs/ext/agent.md`. A and C now agree, which the docs can say in one
sentence instead of three rows.

**4b — command results.** `runCommand` calls `redactForExport(outcome.result,
redactOptions)`:
- `ok` → `{ ok: true, result }`;
- `absent` → `{ ok: true }`, as today;
- `unserialisable` → Phase 1c's `"threw"` value.

Surface B stays at 4 levels, because the redacted root is unchanged. Phase 1c's
reporter guard stays as defence: `createAgentReporter` is exported and can
wrap a hand-built handle.

#### Phase 5 — docs and conventions

- `docs/architecture.md` §10, the "crosses core unredacted" bullet: the
  first-party readers now go through `readDiagnosticsRoster`, and a custom
  reader should too. Keep the sentence on why core cannot redact.
- `docs/ext/agent.md` §"It redacts on the way out": masked failed entries, the
  one depth table, and the unserialisable tag.
- The READMEs in `src/ext/agent/` and `src/ext/diagnostics/`: one line each on
  where masking now lives.
- The PR description for Phase 4 says surface A's depth changed. Put it in a
  footer of its own, because release-please truncates a combined one.

### Decisions made here, flag if you disagree

1. **Kit, not `/runtime`.** `/runtime` "talks to nothing in this package", so it
   would need a hand-maintained structural copy of `ExtensionDiagnostics`, which
   is the drift ADR-003 already complains about. The kit type-imports core
   legally. The cost is an admission-bar exception, recorded in `docs/kit.md`.
2. **Share the masking, not the shape.** One reader returns a kit-owned union,
   and each extension maps it to its own published type. The alternative is
   widening `AgentSnapshot`'s status to include `"unserialisable"`. That is a
   change to a published protocol shape (`AGENT_PROTOCOL_VERSION` would have to
   move) for a BigInt edge case.
3. **An unserialisable contribution is tagged in place on the agent.** The
   global could carry a BigInt, since `structuredClone` handles it, but the
   reporter cannot. One snapshot shape for the global and the wire beats
   fidelity for a value almost nobody returns.
4. **An unserialisable command result reuses `"threw"`.** No new member on the
   published `AgentRunResult` union. Its `error` text says what happened.
5. **Surface A's depth changes on purpose (5 → 7).** More survives, which is
   less truncation, not less masking: keys are masked at every depth. It is
   documented, pinned and stated in the PR.
6. **Phase 1 before Phase 2.** The leak ships in a half-day PR. Deleting the
   inline fix in 4a is the price, and it is a few lines.

---

## Plan B — one invariant suite for both runtime api adapters

### What is actually true

**`ExtensionRuntimeApi` has two adapters.**
- **Core's** is built inline in an effect, per extension, at
  `src/core/useExtensionLifecycle.ts:111-155`.
- **The fake**, `fakeExtensionApi()` in `src/testing/fakeExtensionApi.ts:47-81`,
  is published on `/testing`. Its docs say it notifies *"the way core's own
  `subscribeVisibility` does"* (`:26-27`), and `docs/testing.md:91-122` sells it
  as the place the next contract widening is absorbed. **16 extension suites**
  drive their runtimes through it: a11y (2), agent phase2, command-menu,
  diagnostics (2), environment, flags, metrics (5), overlays and
  theme-editor (2).

**The contract states the invariants** (`src/core/contract.ts:251-264`). The
callback runs post-commit and never on subscribe. Flips that cancel out within
one batch are coalesced and deliver nothing. The subscription is released when
`signal` aborts, and a second unsubscribe, or one after abort, is a no-op.

**The two adapters disagree on four of them.**

| Invariant | Core | Fake |
| --- | --- | --- |
| never on subscribe | ✓ | ✓ |
| only on a change | ✓ `lastNotifiedVisibleRef` (`useControlledToolbarState.ts:41`) | ✗ `setVisible(same)` notifies again (`:71-77`) |
| post-commit, coalesced within a batch | ✓ (`useControlledToolbarState.ts:40-46`) | ✗ synchronous, one call per `setVisible` |
| a throwing callback is contained, and later ones still run | ✓ `try/catch` + `console.error` (`useExtensionLifecycle.ts:121-131`) | ✗ escapes into the caller and starves later listeners (`:76`) |
| released on abort; unsubscribe idempotent | ✓ | ✓ (`abort()` clears the set) |
| subscribe after abort is a no-op | ✓ `return () => {}` (`:119`) | ✗ `listeners.add` runs anyway (`:52`) |
| `signal` aborts on teardown | ✓ | ✓ |

Codex confirmed rows 3, 4 and 6 (claims 3.1–3.3). Row 2 was found while
writing this plan, by reading `setVisible`: there is no change check.

**Nothing checks either adapter against the list.**
`src/testing/__tests__/fakeExtensionApi.test.ts` has seven cases and no
containment, change or post-abort case. Core's are scattered through
`src/core/__tests__/lifecycle.test.tsx`: abort-release at `:46` and
containment at `:273`. No file states the list once.

**Core's adapter is drivable without extracting it.** `renderWithToolbar`'s
handle has these members:
- `setVisible` (`src/testing/renderWithToolbar.tsx:115`);
- `register`, whose unregister is the abort path (`:123`);
- `unmount`.

An extension whose `start(api)` captures `api` is a complete harness. Codex's
objection to extracting the builder stands: an extracted builder cannot
reproduce React's commit scheduling without injecting another interface, so it
would mostly relocate code.

**Where a shared suite may live.** `src/test-utils/` holds test-only repository
helpers, is never a published entrypoint, and is excluded from coverage
(`vitest.config.ts:53`). No file there imports `vitest` yet.

### The deepened module

The module is the invariant list itself, written once and run against every
adapter. It lives in `src/test-utils/runtimeApiConformance.ts`:

```ts
/** What a test needs to drive one adapter. Test-only; never published. */
export interface RuntimeApiHarness {
  api: ExtensionRuntimeApi;
  /** Drives effective visibility, and returns once delivery has happened. */
  setVisible(next: boolean): void;
  /** Two flips inside one commit. Absent on an adapter with no batches. */
  batch?(flips: () => void): void;
  /** The teardown path `api.signal` represents. */
  abort(): void;
  /** Releases whatever the harness mounted. */
  dispose(): void;
  /** How delivery is timed. The suite asserts the matching rule. */
  delivery: "post-commit" | "synchronous";
}

/** One row per contract invariant. Each file runs them with it.each. */
export const RUNTIME_API_CASES: ReadonlyArray<{
  name: string;
  run(make: () => RuntimeApiHarness): void | Promise<void>;
}>;
```

Two files run the cases, one per adapter:
- `src/core/__tests__/runtimeApi.conformance.test.tsx` drives **core's** adapter,
  capturing `api` through `renderWithToolbar` with `storage: null`.
- `src/testing/__tests__/fakeExtensionApi.conformance.test.ts` drives **the
  fake**.

A case that only one delivery model can honour, such as coalescing, runs when
`batch` exists and is skipped otherwise. So the fake can be honest about being
synchronous without failing a rule it cannot keep. The suite's `name`s
are the contract's sentences, so a failure reads as the invariant it broke.

### Phases

#### Phase 1 — the suite, proven against core first

**1a — write the cases** from `contract.ts:245-298`, one per row of the table
above, plus:
- `isVisible()` reflects the last delivered value;
- a subscriber added during delivery does not hear that delivery, or hears it
  exactly once; the case pins whichever core does;
- the defaults of every aggregation member are callable.

The cases import `expect` from `vitest`, the first such import in `test-utils`
(decision 3).

**1b — core's harness, all green.** Every case must pass against core
**unchanged**. A failure here is a core bug the suite found. Stop and record it
as its own `fix(core)`, and do not bend the case. Then delete the now-duplicated
assertions from `lifecycle.test.tsx:46-75` and `:273-310` only if the suite
covers them word for word; otherwise leave them.

**1c — the fake's harness, red where the table says ✗.** Run it and record
exactly which cases fail. Expected: only on a change, containment, and
subscribe-after-abort. Coalescing is skipped by construction. Anything else
failing is a finding. This phase and Phase 2 land in one PR, because a
fix needs a test that fails before it.

#### Phase 2 — the fake conforms

**2a — contain a throwing callback.** Wrap each listener call and log through
`console.error` with the `[dev-toolbar/testing]` marker the package already
uses (`src/testing/lifecycle.ts:72`). Every later listener still runs.
`setVisible` never throws.

**2b — notify only on a change.** `setVisible(current)` updates nothing and
notifies nobody.

**2c — subscribe after abort is a no-op.** Return `() => {}` and retain
nothing, matching `useExtensionLifecycle.ts:119`.

**2d — say what differs, and stop claiming what doesn't.** Replace the
`:26-27` docblock with the truth: the fake follows every invariant core does
except timing. It delivers synchronously, one call per change, and it has no
batches, so it never coalesces. A runtime must not depend on either timing.

This ships as `fix(testing): make fakeExtensionApi keep the contract core
keeps`.

#### Phase 3 — the 16 suites that use the fake

Run all extension suites against the Phase 2 fake. For each failure, work out
which case it is:
- **A test that relied on a divergence** (notify-on-same-value, or a throw
  escaping `setVisible`). Fix the test and name the invariant in a comment.
- **A runtime that is wrong under core** and was hidden by the fake. That is a
  real bug. Pin it and fix it in its own `fix(ext)`, not inside this PR.

Two checks narrow the risk first. Of the 21 `setVisible(` calls in
`src/ext/*/__tests__`, the fake-driven ones are these:
- a11y `runtime.test.ts:681`
- environment `runtime.test.ts:981`
- flags `runtime.test.ts:1858`
- metrics `runtime.test.ts:115`
- overlays `runtime.test.ts:969,976`

The rest either go through a mounted toolbar, and so already see core, or
drive a different fake (agent `phase3.test.tsx:178` is a fake agent *handle*).
Also grep the 16
suites for a listener that throws on purpose.

#### Phase 4 — gated: lift core's adapter out of the effect

**Only if** one of these holds:
- Phase 1's core harness turns out flaky or slow enough to matter in the suite's
  runtime;
- a second in-core consumer of the construction appears.

Otherwise skip it and record why in the PR that closes this plan. If taken, move
it into `src/core/runtimeApi.ts` as `createRuntimeApi({ extensionId, controller,
host })`, still internal. `/testing` keeps its own adapter: it may value-import
core only through the package, and publishing a builder for this is a surface
nobody asked for.

#### Phase 5 — docs and conventions

- `docs/testing.md` §`fakeExtensionApi`: add one paragraph on what it
  guarantees (the suite) and the one thing it does not (timing).
- `docs/extension-contract.md`, near `subscribeVisibility`: link the invariant
  list as executable.
- `AGENTS.md` §Conventions, one bullet: *`ExtensionRuntimeApi` has two
  adapters, core's and `fakeExtensionApi`. A change to either, or a widening of
  the interface, runs `src/test-utils/runtimeApiConformance.ts` against both.*
  This is the constructor-side check ADR-003 says every option must name.

### Decisions made here, flag if you disagree

1. **The fake stays synchronous.** Matching core's post-commit timing would make
   every runtime test need `act()` or a flush, which undoes the fake's reason to
   exist. The suite makes timing an adapter property rather than an invariant
   the fake silently breaks.
2. **Core's harness mounts; it does not extract.** It is two adapters and one
   suite, with no new production seam. The extraction is Phase 4 and gated.
3. **`test-utils` may import `vitest`.** "Framework-free" there has meant no React
   and no DOM framework. The alternative is framework-free cases that throw
   plain `Error`s, which gives worse failure diffs and no gain. Flag this if
   the rule meant more.
4. **Fixing `/testing` is a `fix`, not a breaking change.** The fake's
   documented behaviour was already "the way core does". Tests that depended on
   the divergence were testing something core never does. The PR description
   says so and lists the three behaviour changes.
5. **No change to `contract.ts`.** The invariants are already written there;
   this plan makes them executable, not different.

---

## Cost, in one table

| Phase | Touches | New tests | Deleted | Estimate |
| --- | --- | --- | --- | --- |
| A1a | agent phase2, phase3 tests | 5 | — | 1.5 h |
| A1b | agent/runtime | — | — | 0.5 h |
| A1c | agent/report | — | — | 2 h |
| A2 | kit/diagnostics (new), kit/index, docs/kit | ~16 (it.each) | — | 0.5 d |
| A3 | diagnostics/runtime | — | `finish` body, roster masking in `gather` | 2 h |
| A4 | agent/runtime, phase2 depth pin | flips 1 pin | A1b's inline masking | 2 h |
| A5 | architecture §10, docs/ext/agent, 2 READMEs | — | two depth-table rows | 1 h |
| B1 | test-utils/runtimeApiConformance (new), 2 conformance files | ~10 cases × 2 adapters | possibly 2 lifecycle cases | 0.5 d |
| B2 | testing/fakeExtensionApi | — (B1's red cases go green) | — | 1 h |
| B3 | up to 16 ext suites | — | — | 1 h – 0.5 d, depends on B1c |
| B4 | core/runtimeApi (gated) | — | — | 0 or 0.5 d |
| B5 | docs/testing, docs/extension-contract, AGENTS | — | — | 1 h |

**PR slicing.** A1a+A1b, then A1c, then A2+A3+A4, then A5. B1+B2 go together,
then B3, then B5. B4 gets a PR only if its gate fires. Six or seven PRs, each
squash-merged with a Conventional Commits title that release-please reads.

## What would make this not worth doing

- **Plan A:** a decision that core should mask its own roster. Core may not
  import `/runtime` (AGENTS.md, ADR-001), so that means moving redaction into
  core. That reverses the layering §10 defends, and it is a much bigger change
  with a contract discussion attached. Phase 1 is worth doing regardless: it is
  a leak.
- **Plan A, Phase 3 gate:** a diagnostics fixture that must change. It means the
  kit semantics are not diagnostics' semantics. Fix the table, not the fixture.
  If it cannot be fixed, the two readers do not share masking after all, and
  Phase 4 stands alone as an in-place fix.
- **Plan B:** Phase 1b failing against core in a way that turns out to be
  intended and undocumented. Then the contract text is wrong, which is an
  ADR-003 conversation, and the suite waits for it.
- **Plan B, Phase 3:** more than a handful of suites relying on the
  divergences. That would mean the fake's behaviour is load-bearing for authors
  outside this repo too. Keep the fix, but release it with a louder note, and
  consider an opt-in `legacyNotify` for one minor. Nothing today suggests this.
- **Both:** neither needs `CONTRACT_VERSION`, a new subpath or a new
  dependency. If implementation finds that one does, stop and re-plan.
