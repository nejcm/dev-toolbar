Open `/?geometry` for the isolated collapse geometry fixture; `main.tsx` statically imports `geometryDemo.tsx`, so it is included in the normal playground bundle.

Open `/?a11y-load-on=scan` for the `a11y` extension with `loadOn: "scan"` — the axe-core chunk is then not fetched until the first scan. The default page keeps the eager import, so every baseline measurement stands.
