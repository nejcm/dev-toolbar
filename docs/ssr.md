# Server-side rendering

Safe by construction. `children` server-render untouched; the bar is client-only and
never appears in server HTML, so there is nothing to hydrate and nothing to mismatch.
`<DevToolbarInset>` holds its defaults until the client has mounted, so the first
client render always agrees with the server.

Built entries carry a `"use client"` banner, so an app-router page can import them
from a server component without adding a directive of its own.

**Build the extension array in a client module, though.** The banner makes each built
entry a *client* module, and RSC forbids a server component from **calling** a function
that lives in one — so `<DevToolbar>` renders fine from a server component, while
`metrics()` in the same file fails the build with *"Attempted to call metrics() from
the server but metrics is on the client"*. One small file with the directive fixes it,
and it is where the extension array should live anyway, since the contract requires the
objects to be built once outside render:

```tsx
// app/dev-tools.tsx
"use client";
import { DevToolbar } from "@nejcm/dev-toolbar";
import { metrics } from "@nejcm/dev-toolbar/ext/metrics";
import type { ReactNode } from "react";

const extensions = [metrics()];

export function DevTools({ children }: { children: ReactNode }) {
  return <DevToolbar extensions={extensions}>{children}</DevToolbar>;
}
```

```tsx
// app/layout.tsx — stays a server component
import { DevTools } from "./dev-tools";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DevTools>{children}</DevTools>
      </body>
    </html>
  );
}
```

Verified against Next 16 app router, `reactStrictMode: true`, in both `next dev` and a
production `next build && next start`: the server HTML contains the page and none of
the bar, and the browser console is clean — no hydration warning.

Persisted preferences (visibility, position, active panel, panel height) are read on
the client only. If you inject your own `storage` adapter on the server, make it a
no-op — or pass `storage={null}`.


---

[Documentation index](./README.md)
