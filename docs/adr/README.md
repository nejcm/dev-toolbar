# Architecture decision records

An ADR records a decision that is **hard to reverse** — one where the cost of
changing our minds later is paid by consumers, not by us. Most decisions are not
that. If a decision can be undone in a patch release without anybody noticing, it
belongs in a commit message or in [`../architecture.md`](../architecture.md), not
here.

Concretely, for this repo: anything that changes the shape of
`DevToolbarExtension`, the meaning of a `data-dtb-*` hook, the storage key layout,
or what an entry in the `exports` map is called. Those are things published
consumers have written code against.

## Format

One file per decision, `ADR-<NNN>-<kebab-name>.md`, numbered in order and never
renumbered. [`ADR-000-template.md`](https://github.com/nejcm/dev-toolbar/blob/main/docs/adr/ADR-000-template.md) is the template — the
Nygard sections: Status, Context, Decision, Consequences.

`Status` is one of:

| Status | Meaning |
| --- | --- |
| `Proposed` | Written down, not settled. The question is open and the ADR says what is undecided. |
| `Accepted` | In force. The code does this. |
| `Superseded by ADR-NNN` | Replaced. The file stays; superseded ADRs are never deleted, because the reasoning is why the replacement exists. |

Rules that matter more than the format:

- **Write the rejected alternatives, and what they would have cost.** An ADR that
  lists one option is a changelog entry wearing a costume.
- **Where a decision carries security, reliability or operational risk, accept the
  risk explicitly** — say what could go wrong, how likely it is, and what mitigates
  it. A risk nobody wrote down is a risk nobody owns.
- **A mermaid diagram is worth adding where it clarifies a flow**, and noise
  otherwise.
- An ADR is a record of a decision at a point in time. Do not edit it to match what
  the code does now; supersede it.

## The records

| # | Title | Status |
| --- | --- | --- |
| [001](./ADR-001-extensions-are-plain-objects.md) | Extensions are plain objects passed in as a prop | Accepted |
| [002](./ADR-002-light-dom.md) | The shell renders in the light DOM | Accepted |
| [003](./ADR-003-contract-version-policy.md) | `CONTRACT_VERSION` compatibility policy | Proposed |
| [004](./ADR-004-per-extension-bar-presentation.md) | Per-extension bar presentation | Accepted |
| [005](./ADR-005-docs-site-over-the-docs-tree.md) | Build the documentation site over the docs tree | Accepted |
