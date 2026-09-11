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

`context` takes three shapes. An **object** for what is fixed for the page's life. A
**function** for anything that changes — a sync status, a switched workspace — re-read
every `pollMs` (default 4 s), plus on `online`/`offline`, `resize`, `popstate` and
`hashchange`. Or anything with `read()`/`subscribe()` — a
[`Readable`](../kit.md#live-input) from `@nejcm/dev-toolbar/kit`, or a Zustand/Redux
store's `{ getState, subscribe }` as-is — re-read **when it notifies**, with no timer
of its own. The re-read is synchronous; publication still goes through the snapshot
store's 250 ms throttle, which publishes the first change of a burst immediately and
coalesces the rest into one trailing publish at the end of the window, so the bar sees
at most two updates per 250 ms and never misses the last value:

```tsx
import { createSource, derive, useSource } from "@nejcm/dev-toolbar/kit";

// Module scope, next to the extensions.
const user = createSource<User | undefined>(undefined);
const session = derive([user, useAppStore], () => ({
  environment: config.env,
  userId: user.read()?.id,
  region: useAppStore.getState().region,
}));
const extensions = [environment({ context: session })];

// In the component that knows who is signed in.
useSource(user, currentUser);
```

**Two values, two panels.** What you put in `context` is what the app is *actually
doing* — a local flag override included. This panel reports facts, and a fact that
says `designVersion: v1` while the page renders `v2` is wrong however the `v2` came
about. The one place that wants the *pre*-override value is
[`flags()`](./flags.md#two-values-two-panels), because it layers its own overrides on
top and shows both; feed it the same post-override value and its row can never show
what the app would do without the override. [`diagnostics()`](./diagnostics.md) follows
this panel's rule, not that one.

This is how React-owned state reaches an object built at module scope. The same
`session` can feed [`diagnostics`](./diagnostics.md) too, as a getter — `diagnostics({
app: () => session.read() })` — because `app` is resolved at capture time, not
subscribed to; passing the `Readable` itself would capture the object. The detection
timer still runs whenever
`detect` is on, whatever shape `context` is, because `history.pushState` — how every
SPA router navigates — fires no event anyone can listen for, and the Route row would
otherwise be stale indefinitely.

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
  presentation: "icon-value",                    // see Bar presentation, below
});
```

Commands aggregated into `useToolbarCommands()`: `environment.copy`,
`environment.copyJson`, `environment.refresh`. Like `/ext/metrics`, it ships its own
stylesheet — pair `injectStyles={false}` on `<DevToolbar>` with
`environment({ injectStyles: false })` and deliver `ENVIRONMENT_CSS` yourself.
`styleNonce` on `<DevToolbar>` is forwarded to the sheet via the slot;
`environment({ styleNonce })` overrides it.

## Bar presentation

```tsx
environment({ presentation: { preset: "icon-value", icon: (s) => ICONS[s.kind] } });
```

`presentation` changes how the bar control looks, never what it reports.
The four knobs — a preset, your own `ReactNode` icon, a `render` callback and an
accessible-name override — the preset-by-preset table and the rules every extension
shares are in [kit.md](../kit.md#presentation). Two of those rules are worth repeating
before the specifics: `"default"` is byte-identical to what shipped before the option
existed, and `presentation`, like every factory option, is **fixed when the factory is
called** — to change it at runtime, remount the toolbar or reload.

What is specific to this extension:

- **The short bar word is `env`**, and `"default"` paints it in **both** places — the bar
  and the `⋮` menu — where the other kit chips swing to their full `label` when
  overflowed. That is what this chip has always shipped. Any *preset* still forces the
  full `label` in the menu, which is the library-wide overflow rule.
- **The icon lands in `data-dtb-part="env-icon"`**, a new part; the word keeps the
  `env-label` it has always had.
- **It renders two button wrappers** — the bar `trigger` and the `⋮` row
  `env-overflow`, which deliberately carries no `aria-expanded` — and one `presentation`
  drives both, the name override included. The fork is about the element, never the
  presentation.
- **`kindLabel(snapshot)` is exported** so a `render` callback can paint the same value
  word the preset does instead of re-deriving the `supplied && kind !== "unknown"` rule.
- **The dot's severity and the `impersonating` marker render outside the preset and the
  callback**, under every preset including `"icon"`.

---

[Documentation index](../README.md) · [Extension contract](../extension-contract.md) · [Runtime](../runtime.md)
