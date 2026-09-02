import { describe, expect, it } from "vitest";
import { COMMAND_MENU_CSS } from "../css";

// Shared across every /ext/*/css.test.ts (kept identical on purpose so they drift
// together): left/right/margin-left/margin-right/padding-left/padding-right and
// text-align: left|right pin to a physical side regardless of dir="rtl"; so does a
// four-value padding/margin shorthand, which can hide an asymmetric left/right pair
// behind logical-looking property names. inset-inline(-start|-end), text-align:
// start|end and padding-block/padding-inline flip automatically.
const PHYSICAL_CSS_PATTERN =
  /\bleft:|\bright:|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)|\b(?:padding|margin):\s*[^\s;]+\s+[^\s;]+\s+[^\s;]+\s+[^\s;]+\s*;/;

// The one whitelisted exception: cmd-dialog centres itself with
// `left: 50%` + `transform: translateX(-50%)`. That pair is symmetric and needs
// no RTL mirroring — `inset-inline-start: 50%` is NOT an equivalent here, because
// under dir="rtl" it resolves to the right edge landing at the midpoint while
// translateX(-50%) still shifts left by half the width, so the dialog would end
// up a full width off-centre. See the comment on cmd-dialog in css.ts. Removed
// here by exact text so any other left/right creeping in elsewhere is still caught.
const CENTERING_DECLARATION = "left: 50%;";

describe("command-menu stylesheet", () => {
  it("positions with logical properties so the dialog mirrors under RTL, except the deliberate horizontal centring", () => {
    const withoutComments = COMMAND_MENU_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments).toContain(CENTERING_DECLARATION);
    const sanitized = withoutComments.replace(CENTERING_DECLARATION, "");
    expect(sanitized).not.toMatch(PHYSICAL_CSS_PATTERN);
  });
});
