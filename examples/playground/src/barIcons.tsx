import type { ReactNode } from "react";

/**
 * The playground's own bar icons. [playground]
 *
 * Hand-written inline `<svg>` elements, owned by this app — which *is* the
 * proof that `presentation.icon` bundles, vendors and peer-depends on nothing:
 * the library never sees an icon it did not receive as a `ReactNode`, and the
 * package still has zero runtime dependencies. Copy one of these into your own
 * app, or hand `presentation.icon` whatever your icon library returns; the kit
 * only ever renders the node.
 *
 * Every icon carries a **`viewBox`**, and that is load-bearing rather than
 * tidy. `Glyph` clamps its direct child to `--dtb-glyph-size` (1.15em) through
 * `[data-dtb-kind="glyph"] > *`, so the element is *sized* by CSS; an `<svg>`
 * with no `viewBox` has no intrinsic coordinate system to scale into and is
 * clipped to that box instead of scaled down into it.
 *
 * They are plain elements rather than components on purpose: `presentation.icon`
 * is invoked as a call and its result rendered, never as `<Icon />`, which is
 * what `react/no-unstable-nested-components` rejects in the library and what
 * would remount the icon on every render here.
 */

/** The attributes every icon below shares. One stroke weight, one coordinate system. */
const stroke = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Event-loop delay: a clock. */
const delayIcon: ReactNode = (
  <svg {...stroke}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.5V8l2.5 1.5" />
  </svg>
);

/** Dropped frames: a sawtooth. */
const jankIcon: ReactNode = (
  <svg {...stroke}>
    <path d="M1.5 12 4 4l2.5 8L9 4l2.5 8L14 4" />
  </svg>
);

/** Heap usage: a memory chip with pins. */
const memoryIcon: ReactNode = (
  <svg {...stroke}>
    <rect x="4" y="4" width="8" height="8" rx="1.5" />
    <path d="M6.5 1.5V4M9.5 1.5V4M6.5 12v2.5M9.5 12v2.5M1.5 6.5H4M1.5 9.5H4M12 6.5h2.5M12 9.5h2.5" />
  </svg>
);

/** Requests: traffic in both directions. */
const networkIcon: ReactNode = (
  <svg {...stroke}>
    <path d="M4 13V3M4 3 1.5 5.5M4 3l2.5 2.5M12 3v10M12 13l-2.5-2.5M12 13l2.5-2.5" />
  </svg>
);

/** React commit duration: a nucleus and two orbits. */
const reactIcon: ReactNode = (
  <svg {...stroke}>
    <circle cx="8" cy="8" r="1.25" fill="currentColor" stroke="none" />
    <ellipse cx="8" cy="8" rx="6.5" ry="2.75" transform="rotate(30 8 8)" />
    <ellipse cx="8" cy="8" rx="6.5" ry="2.75" transform="rotate(-30 8 8)" />
  </svg>
);

/** Web vitals: a pulse trace. */
const vitalsIcon: ReactNode = (
  <svg {...stroke}>
    <path d="M1.5 8.5h3L6 5l2.5 6L10 8h4.5" />
  </svg>
);

/**
 * One icon per metric id, for `metrics({ presentation: { icon } })`.
 *
 * The function form of `icon` is what makes this a map the *app* owns rather
 * than an `icons: Record<CollectorId, ReactNode>` option the library would have
 * had to grow: `icon: (metric) => METRIC_ICONS[metric.id]`. An id with no entry
 * returns `undefined`, which the preset reads as "no icon supplied" and paints
 * this metric's short label instead — a per-control fallback, not a per-extension one.
 */
export const METRIC_ICONS: Record<string, ReactNode> = {
  delay: delayIcon,
  jank: jankIcon,
  memory: memoryIcon,
  network: networkIcon,
  "react-profiler": reactIcon,
  "web-vitals": vitalsIcon,
};

/** Feature flags: a flag on a pole. */
export const FLAGS_ICON: ReactNode = (
  <svg {...stroke}>
    <path d="M4 14.5V2M4 2.5h8l-2 3 2 3H4" />
  </svg>
);

/**
 * The agent bridge: a robot head, antenna up.
 *
 * `/ext/agent` takes the narrowed two-knob option (`icon` and `name`, no
 * preset), so this is passed as `presentation: { icon: AGENT_ICON }` and
 * **replaces** the word `Agent` in the bar rather than joining it — that chip
 * is a readout, and the `⋮` row keeps the word. It is also the one chip that
 * becomes `role="img"` when it has an icon, which is what
 * `e2e/presentation.spec.ts` drives.
 *
 * The eyes are filled and unstroked, the way {@link reactIcon}'s nucleus is:
 * the shared `stroke` bag is `fill: none`, so a solid dot opts out locally.
 */
export const AGENT_ICON: ReactNode = (
  <svg {...stroke}>
    <rect x="2.5" y="5" width="11" height="8" rx="2" />
    <path d="M8 2v3" />
    <circle cx="5.75" cy="8.75" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="10.25" cy="8.75" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

/** Accessibility: the standing figure. */
export const A11Y_ICON: ReactNode = (
  <svg {...stroke}>
    <circle cx="8" cy="2.75" r="1.5" />
    <path d="M2.5 6h11M8 6v4M8 10l-2.5 4.5M8 10l2.5 4.5" />
  </svg>
);

/**
 * A **text** glyph, deliberately kept beside the `<svg>` ones.
 *
 * `PromotedFlag.icon` has always been "a short glyph rendered before the label.
 * Text, not an asset", and `presentation.icon` accepts the same thing — so the
 * bar can hold both kinds at once, and here it does: the flags chip takes
 * {@link FLAGS_ICON} while the promoted switch beside it takes this.
 *
 * Look at the two together before shipping a text icon of your own. They do not
 * size the same way, and cannot: the kit clamp is
 * `[data-dtb-kind="glyph"] > *`, which matches an element child and never a
 * bare text node. An `<svg>` is therefore clamped to `--dtb-glyph-size` and a
 * character is not — it is centred by the glyph's `align-items`, at whatever
 * size the font gives it, which is why an emoji reads as oversized next to
 * these and a geometric character like this one does not.
 *
 * So: pass a geometric character bare, as this one is — it needs no wrapper,
 * and the glyph's line box (`line-height: var(--dtb-glyph-size, 1.15em)`,
 * `src/kit/css.ts`) gives it a real box to sit in. Wrap it in a `<span>` only
 * when you want an oversized character clamped like an element; the wrapper is
 * what opts it into `> *`.
 */
export const PROMOTED_FLAG_ICON: ReactNode = "◈";
