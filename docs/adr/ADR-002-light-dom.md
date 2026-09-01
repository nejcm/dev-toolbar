# ADR-002 — The shell renders in the light DOM

**Status:** Accepted. Shipped in `0.1.0`. Reverses the Shadow DOM recommendation in
the original product design.

## Context

A developer toolbar is injected into somebody else's application and must not collide
with it — neither the app's CSS reaching in, nor the toolbar's reaching out. The
standard answer is a shadow root, and that is what the product design originally
called for.

It is the wrong answer here, because of [ADR-001](./ADR-001-extensions-are-plain-objects.md):
extensions are **user code**, and they render inside the toolbar. Inside a shadow root,

- Tailwind and every other utility framework stops working — its rules live in
  `document.head` and do not cross the boundary;
- most CSS-in-JS runtimes inject into `document.head` too, so styled components render
  unstyled;
- an extension's own `createPortal` target (`document.body`) escapes the shadow root
  and loses the styles it expected;
- design-system components that measure themselves, or read `:root` variables, behave
  differently than they do anywhere else in the app.

The isolation would be enjoyed by the shell's own styles, and paid for by every
extension author.

This is hard to reverse in both directions. Moving to a shadow root later would break
every extension that styles itself the way the app does; the light DOM is also what
makes the `--dtb-*` token surface and the `data-dtb-part` hooks meaningful, and those
are published API.

## Decision

The shell renders in the light DOM, in a portal on `document.body`, and buys its
isolation from the cascade instead:

```css
@layer dev-toolbar {
  [data-dev-toolbar] { … }
}
```

Two properties follow, and they are the whole style contract:

1. **Scoping.** Every core rule is prefixed with `[data-dev-toolbar]`, so core never
   touches app markup.
2. **Losing on purpose.** Every core rule sits inside a cascade layer, and unlayered
   author CSS beats *any* layered rule regardless of specificity — so a consumer's
   one-class selector overrides core's two-attribute selector with no `!important`
   anywhere.

The published styling surface is then three things, in the order to reach for them:
`--dtb-*` custom properties, `data-dtb-part` attributes, and a narrow `classNames`
map. Core's class names are not API.

### Alternatives considered

| Option | Why not |
| --- | --- |
| Shadow DOM | Breaks Tailwind, CSS-in-JS, portals and self-measuring components for every extension author. The original recommendation; reversed. |
| Light DOM with high-specificity selectors or `!important` | Isolation by escalation. It wins the fights core should lose — a consumer restyling the bar would have to escalate in turn, and `!important` has no next step. |
| An iframe | Full isolation, and a different document: no shared React tree, no portals into the app, no overlays drawn over the page, layout and font inheritance all hand-plumbed. It would make `/ext/overlays` impossible. |

### Risk accepted

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| A host application's own unlayered CSS bleeds into the toolbar and breaks its layout | Medium — a broad `button { }` or `* { box-sizing }` rule is enough | Cosmetic to unusable, in the consumer's app only | This is the accepted cost of losing on purpose: the same mechanism that lets consumers restyle the bar lets them break it. Core sets its own properties explicitly rather than inheriting where it can, and the escape hatch is `injectStyles={false}` plus the shipped `styles.css`. |
| Toolbar CSS escapes and affects the app | Low | Visual regression in the app | Every rule is scoped by `[data-dev-toolbar]`; the playground is the standing check. |
| A consumer styles core's internal class names, which then change | Low | Breaks on a patch release | `data-dtb-part` is documented as the supported hook and class names as explicitly unsupported. |
| `--dtb-z-index` (`2147483000`) loses to something in the app | Low | Bar renders under a modal | It is a token; override it. |

## Consequences

- Restyling works from the consumer's own stylesheet without `!important`, which is
  the headline feature of the styling surface.
- Extensions can use Tailwind, CSS-in-JS, their own portals and their own design
  system, and behave the same inside the toolbar as anywhere else. The playground
  carries a Tailwind-classed extension as the standing regression test.
- Core owns the unprefixed `data-dtb-part` names, so an extension that ships CSS must
  namespace its parts by kind (`metrics-chip`, not `chip`), or the attribute stops
  being a stable hook the moment two extensions pick the same word.
- Style injection has to be idempotent across duplicate bundled copies, so the
  deduplication key is a DOM element (`style[data-dev-toolbar-styles]`), not a module
  flag.
- `/ext/overlays` and `/ext/theme-editor` — the two extensions that touch the host page
  — are possible at all because of this. They are also the two that have to be most
  careful about it.
