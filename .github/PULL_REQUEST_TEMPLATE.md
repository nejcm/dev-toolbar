## What

<!-- What does this change do? One or two sentences. -->

## Why

<!-- What problem does it solve? Link the issue if there is one. -->

## Implementation Details

<!-- Anything a reviewer needs in order to read the diff: the approach taken,
     alternatives rejected, tricky bits. Delete if the diff speaks for itself. -->

## Screenshots

<!-- Before/after for any visible change to the toolbar UI. Delete if none. -->

## Additional Context

<!-- Follow-up work, known gaps, related PRs. Delete if none. -->

---

## Pre-review checklist

- [ ] The PR title is a Conventional Commit — it becomes the squash commit on
      `main`, and release-please reads it
- [ ] Linked to an issue, or the description explains why there isn't one
- [ ] Tests added or updated for the behaviour that changed
- [ ] `bun run verify` passes locally (typecheck, lint, build, test)
- [ ] This PR has a single goal — unrelated changes are split out
- [ ] Docs updated (`README.md`, `CONTRIBUTING.md`, or JSDoc) if behaviour changed
- [ ] If the extension contract changed, it is called out above and the
      `CONTRACT_VERSION` question is raised (see CONTRIBUTING.md — there is
      no automatic bump rule)
