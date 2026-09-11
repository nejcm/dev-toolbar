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
  `[data-dtb-kind="glyph"] > *`, which matches an element child and never a text
  node — so the character is laid out at whatever size the font gives it while
  the `<svg>`s beside it are clamped to `--dtb-glyph-size`. Compare them in one
  screenshot; an emoji in that slot reads as oversized, and that part has not
  changed. What *did* change is that both kinds now sit on the same line:
  the `Glyph`'s own `line-height` is `var(--dtb-glyph-size, 1.15em)` rather than
  `0`, and the clamped child carries the same `line-height` plus
  `text-align: center` (`src/kit/css.ts`).
  Measured in this playground at the compact density, 2600×800, Chromium, the
  bar's 11px font resolving `1.15em` to **12.65px** — and re-measured after the
  fix, with a `<span>`-wrapped `◈` injected into a real bar `Glyph` beside the
  `<svg>`s and the character's ink read back through a `Range`:

  | | box | character ink | ink vs box centre |
  | --- | --- | --- | --- |
  | `<svg>` child (before **and** after) | 12.65×12.65, `top` 778.17 → `bottom` 790.81 | — | — |
  | `<span>`-wrapped `◈`, **before** | 12.65×12.65, 778.17 → 790.81 | 13px tall, 771.17 → 784.17 | **6.82px high** |
  | `<span>`-wrapped `◈`, **after** | 12.65×12.65, 778.17 → 790.81 | 13px tall, 777.17 → 790.17 | 0.82px high |
  | bare `◈` text node, **before** | **0px tall**, 784.50 → 784.50 | 13px tall, 777.50 → 790.50 | — (box measured nothing) |
  | bare `◈` text node, **after** | 6.63×12.65, 778.17 → 790.83 | 13px tall, 777.17 → 790.17 | 0.82px high |

  The visible defect was the **wrapped** character: `line-height: 0` was
  inherited into the `display: block` child, so the character was centred on the
  box's *top edge* and rode about half its height (6.82px) above its neighbours.
  A **bare** character never misrendered — the zero line box sat at the chip's
  centre and the character overflowed it symmetrically, so its ink moved only
  0.17px under the fix and no item or `⋮` row height changed. What the fix buys
  there is a box that exists at all: a zero-height wrapper breaks hit-testing,
  any background or outline on the glyph, and any consumer measuring it. Both
  kinds now land in the same place, and the residual 0.82px is ordinary text
  centring: half-leading centres the font's ascent+descent box, not this
  character's ink. **Measure the `<svg>`s in the same read**: 12.65×12.65 at
  `top` 778.17 is the number that must not move.
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
  non-empty `aria-label` or non-empty text. A stock `/ext/a11y` scan cannot
  prove this — its default context is `exclude: [["[data-dev-toolbar]"]]`
  (`src/ext/a11y/runtime.ts`), so the toolbar is exactly what it does *not*
  look at. Point axe at the bar yourself instead: with the bar in `icon` mode,
  run `axe.run` over an include-the-bar context — `{ include:
  [["[data-dev-toolbar]"]] }` — which is what a consumer would have to pass
  through the runtime's public `context` option. An unnamed icon-only button is
  its finding.
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
