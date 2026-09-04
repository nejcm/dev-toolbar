# `@nejcm/dev-toolbar/ext/environment`

Which environment am I in, what is deployed, and who am I acting as.

**Everything it shows is supplied by you.** Core has no `ctx`, this extension invents
none, it reads no `process.env` and looks for no global. Supply nothing and the chip
says `unknown` — not `local`, and nothing guessed from the hostname.

```tsx
import { environment } from "@nejcm/dev-toolbar/ext/environment";

// Once, at module scope. Not inside render.
const extensions = [
  environment({
    context: {
      environment: "production",        // local | preview | staging | production | your own
      release: __RELEASE__,
      commit: __COMMIT__,
      branch: __BRANCH__,
      deployment: process.env.VERCEL_DEPLOYMENT_ID,
      region: "ap-southeast-1",
      apiEndpoint: API_BASE,
      builtAt: __BUILT_AT__,            // ISO string, epoch ms or a Date
      userId: user.id,
      workspaceId: workspace.id,
      internal: user.isStaff,
      impersonating: session.impersonating,   // true, or { actor, subject }
      roles: user.roles,
      syncStatus: connection.state,
      extra: { tenantTier: plan },      // anything else worth a row
    },
  }),
];
```

Pass a **function** instead of an object for anything that changes — a sync status, a
switched workspace — and it is re-read every `pollMs` (default 4 s), plus on
`online`/`offline`, `resize`, `popstate` and `hashchange`. The same timer runs
whenever `detect` is on even with a static object, because `history.pushState` — how
every SPA router navigates — fires no event anyone can listen for, and the Route row
would otherwise be stale indefinitely.

The compact slot is a dot and the environment name; production is red on purpose, and
an active impersonation says so in the bar. The panel is the detail table, with three
rows the browser answers for itself — route, viewport, connection — tagged `detected`
so they are never read as something the deployment asserted. A field nobody supplied
says *not supplied* rather than being quietly absent.

## What it does with your data

Session context is the most sensitive thing a toolbar puts on a screen, so:

- every value goes through [`redact()`](../runtime.md) on the way *in*, and
  email addresses are masked on top of it (`n***@example.com`). The panel, "Copy
  summary", "Copy JSON" and the aggregated commands all read that same redacted
  snapshot — there is no path that reaches the raw context;
- the masking is **visible**: a masked row is tagged `masked`, and the count sits next
  to the copy buttons. A redaction nobody can see is indistinguishable from a value
  that was never supplied;
- `fields: ["environment", "release"]` is an allowlist for a restricted view —
  everything else is *dropped*, not hidden, and that includes `extra` entries, which
  are named `extra:<key>`. For an actor who should not see the extension at all,
  leave it out of the `extensions` array — that is your decision to make, not
  something core enforces;
- structured `extra` values are redacted **as objects** and serialised afterwards, so
  a credential nested inside one (`extra: { user: { authToken } }`) is masked like a
  top-level one. `redact()` matches key names by walking a graph; handing it a JSON
  string instead would hide every inner key from it.

```ts
environment({
  context: () => ({ environment: "staging", syncStatus: connection.state }),
  pollMs: 2000,
  fields: ["environment", "release", "extra:tier"],  // restricted view
  detect: false,                                 // no route/viewport/connection
  maskPii: false,                                // stop masking email addresses
  redactOptions: { extraKeys: ["tenantcode"] },  // mask more key names
});
```

Commands aggregated into `useToolbarCommands()`: `environment.copy`,
`environment.copyJson`, `environment.refresh`. Like `/ext/metrics`, it ships its own
stylesheet — pair `injectStyles={false}` on `<DevToolbar>` with
`environment({ injectStyles: false })` and deliver `ENVIRONMENT_CSS` yourself.

---

[Documentation index](../README.md) · [Extension contract](../extension-contract.md) · [Runtime](../runtime.md)
