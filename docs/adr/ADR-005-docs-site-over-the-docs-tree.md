# ADR-005 — Build the documentation site over the docs tree

**Status:** Accepted.

## Context

The reference already lives under `docs/`, one Markdown page per entry point,
extension and decision. A separate site tree would either duplicate those pages or
make the repository reference point somewhere other than its source files.

VitePress treats `docs/` as its source root. Two existing link patterns need explicit
handling: `docs/README.md` is the documentation index rather than the site home, and
relative links cannot reach files outside the source root during a site build.

A `rewrites` entry does not rewrite inbound links. Rewriting `README.md` to
`overview.md` emits the page at `/overview.html` while the eighteen `./README.md`
footers across `docs/` still render as `README.html`, which no longer exists.

## Decision

The VitePress site uses the existing `docs/` tree as its source. The root
`docs/README.md` is not rewritten: it serves at `/README.html`, so the footers keep
working in both renderers. Every `docs/<folder>/README.md` intended to serve at
`/<folder>/` needs an explicit `<folder>/README.md` to `<folder>/index.md` rewrite, and
no file under `docs/` may link to a rewritten README by name. Links from a file under
`docs/` to a repository file outside `docs/` use absolute GitHub URLs.

### Alternatives considered

| Option | Why not |
| --- | --- |
| Keep a separate `site/` tree | It would duplicate the reference or add a content-sync step. |
| Rewrite `README.md` to `overview.md` for a prettier URL | The eighteen in-docs `README.md` footers would all deploy as 404s; only the emitted route moves, not the links into it. |
| Move the reference into a new site tree | Existing repository links point at `docs/`, and moving the files adds no capability. |

### Risk accepted

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| A new link leaves `docs/` as a relative path | Medium | The VitePress build fails on the dead link | `bun run verify:docs` builds the site before deployment. |
| A folder index lacks an explicit rewrite | Low | A `/<folder>/` link deploys as a 404 while the page exists at `/<folder>/README.html` | Add a rewrite for every folder README used as a route index. |

## Consequences

- Repository readers and the site read the same Markdown files.
- The documentation index remains `docs/README.md` on GitHub and is served as
  `/README.html` on the site, at the cost of a prettier URL.
- Folder READMEs used as route indexes have explicit rewrites; VitePress does not infer them.
- Links that leave `docs/` must remain absolute GitHub URLs.
