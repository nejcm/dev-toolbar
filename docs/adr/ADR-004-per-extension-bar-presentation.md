# ADR-004 — Per-extension bar presentation

**Status:** Accepted. All nine extension factories ship the `presentation` option, the
kit holds the vocabulary, and the playground proves it in a browser.

## Context

Every first-party extension hand-writes its bar control, and how that control is
presented is baked into the extension. `/ext/a11y` picks its own bar text
(`label={isOverflowed ? label : "a11y"}`), `/ext/metrics` always paints short-label
plus value, and the only thing in the package resembling an icon is
`PromotedFlag.icon?: string` — documented as *"a short glyph rendered before the label.
Text, not an asset."*

So a consumer cannot say "icons only", "icon plus value", or "render my memory chip my
way". The bar cannot be made to look like the host app it is injected into, and a
third-party extension author's only route to a native-looking control is copying JSX
out of the docs — the playground itself hand-rolls a local `Chip` for exactly that
reason.

This is hard to reverse. Presentation is configured through the **factory options** of
nine published subpath entry points, and those option bags are the published API a
consumer writes against just as much as `DevToolbarExtension` is. A shape chosen wrong
here is nine simultaneous deprecations later.

Two constraints bound the answer before any design starts:

- **Zero runtime dependencies is a rule** (`AGENTS.md`). Whatever ships must not bundle,
  vendor or peer-depend on an icon library. Icons are the consumer's assets, passed in.
- **`src/core/` is not touched.** A global presentation default on `<DevToolbar>` would
  need a new field on `CompactSlotProps`, which is a contract change, which reopens the
  `CONTRACT_VERSION` question [ADR-003](./ADR-003-contract-version-policy.md)
  deliberately leaves open. That constraint is load-bearing: it is what keeps this
  change additive and un-versioned.

## Decision

Each extension factory gains **one** option, `presentation`, holding four knobs: a
`preset`, a consumer-supplied `ReactNode` icon (or a function returning one), an
optional `render` callback over that extension's own view data, and an optional
accessible-name override — of which two of the nine publish a narrowed pair, as the
Group C subsection below records. Presentation becomes the consumer's decision, per
extension, while the extension keeps the trigger element, its `data-dtb-*` state
attributes and its accessible name.

The vocabulary — `CompactPreset`, `CompactPresentation<TView>`, a `Glyph` control and
the `resolveCompactParts` / `resolvePresentation` / `resolveCompactControl` /
`renderCompact` helpers — lives in `src/kit/`,
which is where shared extension glue belongs and which is already a published subpath.
`src/core/` gains nothing, `CONTRACT_VERSION` does not move, and no icon asset enters
the package.

The option is named `presentation`, not `compact`: `compact` already names the slot on
`DevToolbarExtension`, and two things called `compact` is a vocabulary collision.

`"default"` is a member of the preset enum and resolves to `null`, so each extension
reads `parts === null ? <today's tree> : <driven tree>`. That makes "today's output is
byte-identical" a structural property of the resolver rather than a truth-table
coincidence — which is what makes the compatibility claim provable.

### Group C takes two knobs, not four

Seven of the nine take the whole interface. `/ext/agent` and `/ext/command-menu` publish
`Pick<CompactPresentation<TView>, "icon" | "name">` instead. Neither control has a
value, and neither has a short bar word distinct from its full label — the agent chip is
one text, the command-menu trigger is a symbol plus a hotkey hint — so every preset
member but `"default"` would resolve to a no-op or a lie, and a `render` callback over a
view that never changes is a `ReactNode` with extra steps.

The narrowing is **visible rather than silent**: the bare-preset shorthand
(`presentation: "icon"`) is a **compile error** on those two, not an option that quietly
does nothing. It stays a `Pick` of the shared interface rather than a lookalike of its
own, so `icon` and `name` mean there exactly what they mean on the other seven and a
widening later is additive. This is a published-types decision on two of the nine option
bags, which is why it is recorded here rather than only in the JSDoc;
[docs/kit.md](../kit.md#the-narrowed-option-agent-and-command-menu) states it for
consumers.

Two further facts about the agent chip are recorded because both are changes on its
**icon path only** — with no icon supplied it is the span it has always been, down to
the byte:

- **`role="img"` is conditional.** An `aria-label` on a role-less span names nothing,
  which is how that chip came to be exempt from the "named by an attribute" rule while
  it had no icon. Supplying an icon gives it the role, so the `aria-label` the `name`
  knob feeds actually counts — and the role hides the `⋮` row's duplicate word from the
  announcement.
- **`/ext/agent` injects `KIT_CSS` on that path.** It is the one extension in the
  test roster's `STYLELESS` set — no panel and no stylesheet of its own — and the glyph
  clamp (`--dtb-glyph-size`) lives in the kit sheet, so an icon needs it. The no-icon
  branch injects nothing, so a consumer who supplies none still gets a styleless
  extension.

### Hard rule: a `ReactNode` never enters a store snapshot

The extension stores are signature-based — the flags runtime builds a **string**
signature and republishes only when it changes; environment, metrics and theme-editor
use the same mechanism. A `ReactNode` cannot be signed: left out of the signature it
never publishes, `JSON.stringify`'d into it it republishes on every tick.

**Therefore `PromotedFlag.icon` is not widened to `ReactNode`.** It is copied into the
snapshot as `FlagView.promotedIcon`, so widening it would put a React element inside a
published snapshot — safe *today* only because `diagnostics()` happens to enumerate
fields by hand, which is one refactor away from a circular-structure throw inside a
click handler. Rich icons arrive instead via `PromotedFlag.presentation.icon`, and
`PromotedFlag` is config held in the factory closure, never a snapshot member. Icons
and callbacks travel as props, exactly as `label`, `injectStyles` and `styleNonce`
already do. The existing `icon?: string` stays for back-compat emoji glyphs.

### Deliberate deviation: the `⋮` menu always paints text — except under `render`

The overflow menu paints full text under every **preset**, enforced inside
`resolveCompactParts` and nowhere else, so it holds by construction. It is **not**
enforced for `render`: a callback is honoured in the bar and in the menu alike, with
`ctx.isOverflowed` as the hook.

This is a knowing inconsistency. A preset is the library's opinion and should be safe
by construction; a callback is the consumer taking the wheel, and silently discarding
their output in one of two locations is a worse surprise than a documented sharp edge.

The residual harm is **not** bounded to "only visually bare", and an earlier draft of
this record said it was. A menu row keeps the element the extension gave it — its
`<button>`, its `onClick` and its `title` — but not every row carries an
`aria-label`: `/ext/metrics`' per-metric `⋮` rows are named by their content, with
`title` as the fallback, because a row named after the metric alone would replace the
announced *"Memory 48 MB"* with *"Memory"*. So a callback that paints no text in the
menu leaves that row named by its `title` and nothing else — the weak fallback the
accessible-names step removed from the four unnamed triggers, reintroduced by consumer
choice on one row. Naming those rows outright is a separate decision, **left open**: it
would change the default DOM and the announced name for every user under `"default"` —
*"Memory 48 MB"* becomes whatever is chosen — to cure an edge a consumer has to opt into,
so it belongs in a step with its own e2e rather than this one. What this change ships
instead is documentation: `docs/kit.md` names the edge and gives `ctx.isOverflowed` as
the escape hatch, under
[`render`, and what it may not take](../kit.md#render-and-what-it-may-not-take).

Reversing the deviation itself — ignoring `render` when overflowed — is a two-line
change if the guarantee is later preferred over the consistency.

### Recorded decision: `Chip`'s `icon` / `iconProps` slots stay, with an expected first-party count of zero

The kit `Chip` gained `icon` and `iconProps` because the "Kit surface" section of the
approved plan specifies them. The Group A extensions — the five that route their bar
control through `Chip` — then went the other way and paint their icon and text as
`Chip`'s **children**, so those two props finish the rollout with no first-party
importer.

That is deliberate, and it is not a slot-versus-children style preference.
`ctx.fallback` has to be a children tree: it is the one construction, handed to a
`render` callback and rendered when there is none, so `render: (_, ctx) => ctx.fallback`
is exact by construction rather than by two pieces of markup kept in step. Building the
preset path out of `Chip`'s slots would need a second tree just for `fallback`, and
`render` would then be replacing the whole `Chip` — taking the dot and
`data-dtb-status` with it, which is precisely what this shape exists to prevent.

So `icon` / `iconProps` remain as **third-party surface**, for an author whose control
genuinely *is* a plain slotted chip with no `render` to honour. They are kept rather
than deleted because the approved plan specifies them explicitly, and removing mandated
API on a zero-count argument is the caller's decision, not the implementer's.

The count is measured, not predicted: the expected first-party importer count is zero,
and kit's admission bar is "three users, or a third party asking". If no third party
asks, removal stays a live option — and because that is the standing reason, it belongs
here rather than in a comment in `src/ext/a11y/ui.tsx`.

### Alternatives considered

| Option | Why not |
| --- | --- |
| Bundle an icon set | A runtime dependency, or thousands of inlined glyphs in a package whose whole pitch is that it ships none. |
| Vendor icon path data into the package | The dependency without the upstream: our bytes, our licence audit, our staleness, and still the wrong icons for somebody's design system. |
| An optional icon peer dependency | Buys an import the consumer can already write, and adds a third optional peer next to `axe-core` and `@testing-library/react`, which earn their place. Consumers pass `ReactNode`; they need nothing from us. |
| Four sibling options — `preset` + `icon` + `render` + `name` | Four names × nine extensions is 36 new option-bag entries, and `MetricsOptions` already has 15 fields. The four are meaningless apart: `icon` without a preset that paints it does nothing. Grouping also buys the shorthand — `presentation: "icon"` is the 90% case in one word. |
| `presentation: CompactPreset \| ((data, ctx) => ReactNode)` | The union cannot express *both*, and both is a real case: "custom when severity is bad, the preset otherwise" needs `preset` and `render` together. It also leaves nowhere to put `icon`. |
| A composable `{ icon, label, value }` record instead of a preset enum | Reads as more flexible and is worse: three independent axes (`icon` on/off × `label` none/short/full × `value` on/off) is 12 combinations, most meaningless, all of which the resolver and its tests would owe an answer. A closed enum of six is the six that make sense, named. |
| A global `presentation` default on `<DevToolbar>` | Needs a new `CompactSlotProps` field, so a contract change and the ADR-003 question. Nine per-extension options are more typing and no new versioning debt. |
| Expose `runtime` on the returned extension object | Would make the callback tier redundant — a consumer with the runtime can render whatever they like. Rejected because it promotes `MetricsRuntime` from "exported type" to "the thing consumers render against", which is a far larger and more permanent published surface than a typed `render` parameter. |

### Risk accepted

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| **Contravariance.** A view type that is only *read* may gain and lose optional fields freely; as a `render`/`icon`/`name` parameter it becomes contravariant, so renaming a field breaks consumer callbacks, not just consumer readers | High — these types change often | A field rename becomes a breaking change for seven extensions at once | Pass an existing view type only where it genuinely *is* a display type (`MetricView`, `FlagView`); purpose-build a narrow one otherwise, as `DiagnosticsBarView` does rather than welding `DiagnosticsSnapshotState` into the API |
| A `render` callback paints an icon-only control in the `⋮` menu, giving a visually blank row | Medium — it is what the deviation above permits | A menu row with no visible text, and — on a row named by its content, as `/ext/metrics`' per-metric rows are — named by its `title` alone | The row keeps its `<button>`, its `onClick` and its `title`, so it stays operable and explained; documented as a sharp edge with `ctx.isOverflowed` as the escape hatch. Whether such rows should carry an `aria-label` of their own is left open: it changes the default DOM and the announced name for every user, to cure an opt-in edge |
| A future refactor widens something into a snapshot that carries a `ReactNode` | Low, but silent until it throws | A circular-structure throw inside a click handler, or a store that republishes every 250 ms | The hard rule above, plus a serialisation test that promotes a flag with a JSX icon and asserts `JSON.stringify(runtime.diagnostics())` succeeds and contains no React element |
| Collapse settling. `"icon"` can be ~4× narrower than `"default"`, so nine extensions can each swing tens of pixels between bar and overflow | Medium at one specific window width | Chips appear to flicker, or more items stay in `⋮` than need to | The collapse machine terminates the 2-cycle by design and reports `latched`; a `collapse.test.ts` case drives a 4× swing on one id and asserts it settles |
| An icon-only preset on a trigger with no `aria-label` leaves a button named only by `title` | Certain, on the four triggers that have none today | An unnamed control — which `/ext/a11y` would flag on the toolbar's own bar | Accessible names are fixed **first**, as their own step with no new API, and a test asserts a non-empty computed name for every trigger across all nine |

## Consequences

- Presentation is configured **per extension, next to the control it presents** —
  including `PromotedFlag.presentation`, because a promoted flag is its own bar control.
  There is no one place to restyle the whole bar; that is the price of not touching
  `src/core/`.
- The nine factory option bags become a published API surface that changes more often
  than the contract does. A PR touching them says so in its description even though
  `CONTRACT_VERSION` has not moved.
- `data-dtb-part`, `data-dtb-severity`, `data-dtb-status` and the rest **never** depend
  on the preset: a preset changes text, not state. Severity children — diagnostics'
  badge, environment's `impersonating`, overlays' error `Tag` — render outside both the
  preset and `render`, under every preset including `"icon"`. Consumer CSS and the
  Playwright specs select on those hooks.
- **Every Group A text span is named**, and the icon-plus-text fragment lives in kit.
  The four chips that put their parts into `Chip`'s children first — a11y, diagnostics,
  overlays, theme-editor — wrote a bare `<span>` to keep their bytes identical, while
  environment and metrics already wrote a named one. That divergence was resolved by
  naming the four rather than un-naming the two: `data-dtb-part` is additive public API,
  and `preset: "icon-label"` is precisely the option that makes a consumer want a CSS
  hook on the word. The four carry a `data-dtb-part` and deliberately **no**
  `data-dtb-kind="label"` — the kit sheet tints `[data-dtb-kind="label"]` with
  `--dtb-muted`, so adding it would recolour four chips, and whether they should be
  tinted is a separate visual decision. Overlays is named `ovl-chip-label`, not
  `ovl-label`: that part was already its inspector's floating hover label, which
  `css.ts` positions absolutely. With the divergence gone the fragment reduced to one
  function, `renderCompactParts` in `/kit`, taking a `(short, full)` text pair and a
  `textProps` bag; the value span and the severity children stay each extension's own,
  which is what keeps the "kit answers which parts, the extension paints" line intact.
  The promotion was gated on the byte-identity literals passing unchanged after the
  swap, not on the shape looking right.
- Every new preset value costs tests. Nine preset branches plus seven callbacks is
  exactly the shape that drains the `branches` and `functions` coverage floors, and the
  floors are a ratchet.
- `--dtb-glyph-size` defaults to `1.15em` inside the kit sheet rather than becoming a
  token in `src/styles.css`, so glyphs inherit the density font-size switch for free and
  the byte-identity ritual between `src/styles.css` and `src/core/css.ts` stays out of
  this change.
- The `BUG:`-marked flags test pinning "a promoted icon alone does not publish" is now
  permanent by design rather than a fixable bug, and says so.
