A standalone copy of this app runs at
<https://codesandbox.io/p/sandbox/q6269g>, linked from the root README and the docs
landing page. It consumes `@nejcm/dev-toolbar` from npm instead of `file:../..`, and it
drops `plugins/devToolbarAgent.ts` with the `report` option that feeds it — so it demos
the last release and nothing here keeps it in sync. Changing `src/` for an unreleased
feature means that copy needs updating after the release.

Open `/?geometry` for the isolated collapse geometry fixture; `main.tsx` statically imports `geometryDemo.tsx`, so it is included in the normal playground bundle.

Open `/?a11y-load-on=scan` for the `a11y` extension with `loadOn: "scan"` — the axe-core chunk is then not fetched until the first scan. The default page keeps the eager import, so every baseline measurement stands.
