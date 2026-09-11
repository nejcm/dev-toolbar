# Bar presentation

Each extension factory takes one `presentation` option — a preset, an icon the
*consumer* supplies as a `ReactNode`, a render callback and an accessible-name
override. The playground exercises it on `metrics`, `flags` and `a11y` with
inline `<svg>`s it owns itself (`examples/playground/src/barIcons.tsx`), which
is the proof no icon library is bundled, vendored or peer-depended. Four things
here are invisible to jsdom: the icon is scaled rather than clipped, an
icon-only control is several times narrower than the chip it replaced, the
collapse decision has to settle after that swing, and an icon-only control
still has to be named.

## Sub-features

- `presentation-icon` paints a consumer `ReactNode` in the bar control.
- `presentation-clamp` sizes that node to `--dtb-glyph-size` (1.15em), whatever
  it arrived as — the `Glyph` clamps its direct child.
- `presentation-preset` selects which parts a control paints: `icon`,
  `icon-value`, `icon-label`, `label`, `value`, or `default` (unchanged).
- `presentation-flip` survives the option changing at runtime — a new extension
  object for the same id, on a remounted toolbar — and settles on a stable
  collapse decision with every extension's runtime still live.
- `presentation-name` keeps every control's accessible name when its text is
  gone.
- `presentation-text-glyph` is the other kind of icon: a character rather than
  an element, which the clamp does **not** reach.

## How to get to it (user POV)

- Click **Bar icons** in the playground header. It cycles
  `default → icon-value → icon`, rebuilding `metrics`, `flags` and `a11y` with
  that preset and remounting the toolbar (`key`) so the new objects actually
  start. The other fourteen are the same objects, stopped and started again.
- Watch the bar: short words become icons, then the values go too and the
  chips collapse to glyphs.
- Narrow the window in each mode — more chips fit once they are icons.

## Driving it with the Browser pane

Preconditions:

- Baseline per [README](./README.md), viewport pinned to 1280×800.
- **The resting playground is `default`**, deliberately: it passes no
  `presentation` at all, so every width the rest of this map measured still
  holds. Anything measured after a click on **Bar icons** is a different bar,
  and a report that quotes a chip list must say which mode it was in.
- The pane must be **displayed** for the flip: the collapse runs off a
  `ResizeObserver`, and a hidden pane delivers no frames (see
  [shell.md](./shell.md)). Hidden, follow every click with
  `computer {"action":"screenshot"}` before reading, and say so.

State is `read().shell.bar` / `read().shell.overflow`; the icons themselves are
pixels and come from the page read.

- **Resting state.** Read. No `[data-dtb-kind="glyph"]` inside
  `[data-dtb-part="bar"]` carries an `<svg>`; the flags chip paints `flags` and
  its promoted switch paints the `◈` it has always painted.
- **Flip to `icon-value`.** Click `[data-testid="toggle-bar-icons"]` once; the
  button reports `Bar icons: icon-value`. Page-read
  `[data-dtb-part="bar"] [data-dtb-kind="glyph"] > svg`: each one's
  `getBoundingClientRect()` is square and ~13px at the compact density's 11px
  font — **the clamp, not the asset**. The `<svg>`s in `barIcons.tsx` are
  `viewBox="0 0 16 16"`; drop the `viewBox` from one and it is clipped to the
  box instead of scaled into it, which is the failure worth knowing.
- **The text glyph beside them.** In the same bar, the promoted flag's glyph is
  the character `◈`, not an element. The kit clamp is
  `[data-dtb-kind="glyph"] > *`, which matches an element child and never a
  text node, and the `Glyph` is `line-height: 0` — so the character is centred
  at whatever size the font gives it while the `<svg>`s beside it are clamped.
  Compare them in one screenshot; an emoji in that slot reads as oversized.
  Wrapping a character in a `<span>` opts it into the clamp — **and that is not
  the whole fix**. Measured in this playground at the compact density: the span
  does take the clamp's box, 12.64×12.64 exactly like the `<svg>`s beside it,
  but the character inside paints at 13px tall from `top` 771.17 to 784.17 while
  the box runs 778.17 to 790.81. `line-height: 0` is inherited into a
  `display: block` child, so the glyph is centred on the box's *top edge* and
  rides about half its height above its neighbours. The wrapper needs its own
  `line-height` and centring (the `Glyph`'s own `inline-flex` + `align-items:
  center`) before the advice is worth giving.
- **Flip to `icon`.** Click again. The values go; the controls are glyphs.
  Re-read until `shell.bar` reports the same ids twice running. It **settles**
  — that is the assertion — but it need not settle *minimally*: the flip
  changes no box of the bar's own, so the machine reads it as items reacting to
  the decision rather than the world changing, and its cycle guard can hold an
  item that would now fit (`src/core/collapse.ts`, and the exogenous-flip case
  in `src/core/__tests__/collapse.test.ts`). Nudge the viewport by a pixel for
  an honest reading and it recomputes minimally.
- **Nothing is lost.** Open the `⋮`. `shell.bar` plus `shell.overflow.items` is
  the same roster it was before the flip; only the collapse line moved.
- **Nothing is dead.** Read the console: no `[dev-toolbar] … was rebuilt after
  it started`. Then read `diagnostics`: `a11y`'s `axeVersion` is a version
  string again (poll — axe loads on the new runtime's first scan), and at least
  one `metrics` entry reports a non-null `value`. Both are `null` when the flip
  left the rendered stores orphaned, which is exactly what the remount fixes.
- **Names survive.** Every `[data-dtb-part="trigger"]` in the bar has a
  non-empty `aria-label` or non-empty text. Then run `/ext/a11y` per
  [a11y.md](./a11y.md) with the bar in `icon` mode: axe scans the toolbar's own
  bar, and an unnamed icon-only button would be its finding.
- **Restore.** Click once more, back to `Bar icons: default`.

## Gotchas

- `presentation` is a **factory option**, held in the extension's closure, so
  flipping it means handing `<DevToolbar>` a *new extension object* for that id
  — **and remounting the toolbar**. Core never restarts a same-id extension: it
  keeps the first object's `start()`, warns `extension "<id>" was rebuilt after
  it started`, and the new closure's runtime never runs, so the bar renders a
  store nothing is driving (no axe, no collectors, no flag poll) while
  `diagnostics()` reads the new, dead object. The playground therefore passes
  `key={barPresentation}` to `<DevToolbar>`; it also caches one roster array per
  mode, since rebuilding an array per render is the other thing core warns
  about. The remount costs what a remount costs — `a11y`'s scan results, the
  metric samples — while the flag overrides survive in `localStorage`.
- A `[dev-toolbar] … was rebuilt after it started` warning during a flip is the
  failure, not noise: it means the runtime behind the chips is dead. The spec
  fails the run on it, and proves the other way round too — a metric value and
  `a11y`'s `axeVersion` are non-null *after* the flip.
- `e2e/presentation.spec.ts` is this recipe's spec. It asserts settling and
  reachability, never an exact chip list at one width: both move whenever the
  playground gains an extension.
- A stable-set poll that reads twice in a row can catch a transient. Pair it
  with an error listener installed *before* the flip — the `ResizeObserver
  loop` failure is an `ErrorEvent` with no `Error` object and never reaches the
  console.
- `default` is byte-identical to the pre-option output by construction
  (`resolveCompactParts` returns `null` for it), so a difference there is a
  library finding, not a playground one.
