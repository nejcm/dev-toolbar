import { describe, expect, it } from "vitest";
import { ENVIRONMENT_CSS } from "../css";

// Shared across every /ext/*/css.test.ts (kept identical on purpose so they drift
// together): left/right/margin-left/margin-right/padding-left/padding-right and
// text-align: left|right pin to a physical side regardless of dir="rtl"; so does a
// four-value padding/margin shorthand, which can hide an asymmetric left/right pair
// behind logical-looking property names. inset-inline(-start|-end), text-align:
// start|end and padding-block/padding-inline flip automatically.
const PHYSICAL_CSS_PATTERN =
  /\bleft:|\bright:|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)|\b(?:padding|margin):\s*[^\s;]+\s+[^\s;]+\s+[^\s;]+\s+[^\s;]+\s*;/;

describe("environment stylesheet", () => {
  it("positions with logical properties so the chip and panel mirror under RTL", () => {
    // No exceptions today — whitelist any future one here with a comment saying
    // why it is direction-agnostic (see /ext/command-menu and /ext/overlays for
    // the pattern: horizontal centring via left: 50% + translateX(-50%)).
    expect(ENVIRONMENT_CSS).not.toMatch(PHYSICAL_CSS_PATTERN);
  });
});
