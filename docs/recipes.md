# Recipe builder

Pick a framework and the extensions you want; copy the files. Every combination this
page can produce — every extension alone and all of them together, eager and lazy, for
both frameworks — is typechecked against the package source in CI.

Extensions are independent of each other: any subset works, in any order. Only
[`ext/a11y`](./ext/a11y.md) needs another package, the optional `axe-core` peer.
Some extensions show nothing useful until you hand them your own data — those come out
with placeholders and a note below the code.

<RecipeBuilder />

The lazy setup loads the toolbar on the dev server and leaves it out of every production
build unless you opt that build in at build time (`VITE_DEV_TOOLBAR=true` or
`NEXT_PUBLIC_DEV_TOOLBAR=true`) — a staging build is a production build, so it needs the
flag too. Unset means off. Its caveat: the chunk loads after the app's first render, so
nothing in it runs at boot. See [SSR](./ssr.md) for why the Next.js extension array lives
in a `"use client"` module.
