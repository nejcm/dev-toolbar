import { describe, expect, it } from "vitest";
import { OVERLAYS_CSS } from "../css";

// Shared across every /ext/*/css.test.ts (kept identical on purpose so they drift
// together): left/right/margin-left/margin-right/padding-left/padding-right and
// text-align: left|right pin to a physical side regardless of dir="rtl"; so does a
// four-value padding/margin shorthand, which can hide an asymmetric left/right pair
// behind logical-looking property names. inset-inline(-start|-end), text-align:
// start|end and padding-block/padding-inline flip automatically.
const PHYSICAL_CSS_PATTERN =
  /\bleft:|\bright:|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)|\b(?:padding|margin):\s*[^\s;]+\s+[^\s;]+\s+[^\s;]+\s+[^\s;]+\s*;/;

// Two whitelisted exceptions, both horizontal centring, both symmetric and
// needing no RTL mirroring:
//  - ovl-grid-columns: `left: 50%; right: auto;` + `transform: translateX(-50%)`
//  - ovl-notice:        `left: 50%;` + `transform: translateX(-50%)`
// `inset-inline-start: 50%` is NOT an equivalent for either — under dir="rtl" it
// resolves to the right edge landing at the midpoint while translateX(-50%) still
// shifts left by half the width, so the element ends up a full width off-centre
// (visibly so for ovl-grid-columns, which has an explicit width). See the
// comments on those rules in css.ts. Also on this drawing surface: the box and
// label parts (`ovl-box`, `ovl-label`, `ovl-focus-box`, `ovl-focus-badge`) are
// positioned by inline `left`/`top` styles set in ui.tsx from
// getBoundingClientRect() — a physical, viewport-relative measurement — which
// never appear in this exported CSS string, so they need no whitelisting here.
describe("overlays stylesheet", () => {
  it("positions with logical properties so the grid, notice and panel mirror under RTL, except the deliberate horizontal centring", () => {
    const withoutComments = OVERLAYS_CSS.replace(/\/\*[\s\S]*?\*\//g, "");

    const leftMatches = withoutComments.match(/left: 50%;/g) ?? [];
    expect(leftMatches).toHaveLength(2); // ovl-grid-columns, ovl-notice
    const rightMatches = withoutComments.match(/right: auto;/g) ?? [];
    expect(rightMatches).toHaveLength(1); // ovl-grid-columns

    const sanitized = withoutComments.replaceAll("left: 50%;", "").replaceAll("right: auto;", "");
    expect(sanitized).not.toMatch(PHYSICAL_CSS_PATTERN);
  });
});
