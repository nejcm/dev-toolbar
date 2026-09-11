import type { ReactNode } from "react";

/**
 * The playground's own bar icons. [playground]
 *
 * Hand-written inline `<svg>` elements, owned by this app: the library never
 * sees an icon it did not receive as a `ReactNode`, and has zero runtime
 * dependencies. `presentation.icon` only ever renders the node it's given.
 *
 * Every icon carries a `viewBox` — load-bearing, not tidy. `Glyph` clamps its
 * direct child to `--dtb-glyph-size` via `[data-dtb-kind="glyph"] > *`, so an
 * `<svg>` with no `viewBox` has no coordinate system to scale into and gets
 * clipped instead.
 *
 * Plain elements, not components: `presentation.icon` is invoked as a call
 * and its result rendered, never as `<Icon />` — which `react/no-unstable-
 * nested-components` rejects and would remount the icon on every render.
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
 * One icon per metric id, for `metrics({ presentation: { icon } })` via
 * `icon: (metric) => METRIC_ICONS[metric.id]`. An id with no entry returns
 * `undefined`, which the preset reads as "no icon" and paints that metric's
 * short label instead — a per-control fallback, not a per-extension one.
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

/** Accessibility: the standing figure. */
export const A11Y_ICON: ReactNode = (
  <svg {...stroke}>
    <circle cx="8" cy="2.75" r="1.5" />
    <path d="M2.5 6h11M8 6v4M8 10l-2.5 4.5M8 10l2.5 4.5" />
  </svg>
);

/**
 * A **text** glyph, deliberately kept beside the `<svg>` ones — the flags
 * chip takes {@link FLAGS_ICON}, the promoted switch beside it takes this.
 *
 * They don't size the same way: the kit clamp `[data-dtb-kind="glyph"] > *`
 * matches an element child, never a bare text node, so an `<svg>` is clamped
 * to `--dtb-glyph-size` and a character is not — it's centred by the glyph's
 * `align-items` at the font's own size, which is why an emoji reads oversized
 * next to these while a geometric character doesn't.
 *
 * Pass a geometric character bare, as here — the glyph's line box
 * (`line-height: var(--dtb-glyph-size, 1.15em)`, `src/kit/css.ts`) gives it a
 * real box to sit in. Wrap it in a `<span>` only to opt an oversized
 * character into the `> *` clamp.
 */
export const PROMOTED_FLAG_ICON: ReactNode = "◈";
