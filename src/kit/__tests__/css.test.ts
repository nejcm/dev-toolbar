import { afterEach, describe, expect, it } from "vitest";
import { STYLE_ATTRIBUTE } from "../../runtime/styles";
import { KIT_CSS, ensureKitStyles } from "../index";

const KINDS = [
  "note",
  "action",
  "chip",
  "dot",
  "glyph",
  "tag",
  "row",
  "list",
  "empty",
  "banner",
  "label",
  "value",
  "search",
  "toolbar",
  "stack",
] as const;

afterEach(() => {
  document.head.querySelectorAll(`style[${STYLE_ATTRIBUTE}="kit"]`).forEach((node) => {
    node.remove();
  });
});

describe("KIT_CSS", () => {
  it.each(KINDS)("styles the %s kind", (kind) => {
    expect(KIT_CSS).toContain(`[data-dtb-kind="${kind}"]`);
  });

  it("uses the deliberate action and note drift resolutions", () => {
    expect(KIT_CSS).toMatch(
      /\[data-dtb-kind="action"\][^{]*\{[^}]*background: transparent;[^}]*\}/s,
    );
    // The :not() guard keeps the *panel* control reset off a bar trigger; see
    // kitBarTrigger.test.ts, which resolves that cascade.
    expect(KIT_CSS).toContain(
      '[data-dtb-kind="action"]:not([data-dtb-part="trigger"]):hover:not(:disabled)',
    );
    expect(KIT_CSS).toMatch(
      /\[data-dtb-kind="note"\][^{]*\{[^}]*margin: 0;[^}]*color: var\(--dtb-muted\);[^}]*\}/s,
    );
  });

  /**
   * Both kinds that are plausible on a bar trigger and disagree with its
   * geometry carry the guard. Selector text only; `kitBarTrigger.test.ts`
   * resolves what it does, and the e2e measures it in a browser.
   */
  it.each(["action", "tag"])("keeps the %s kind off a bar trigger", (kind) => {
    expect(KIT_CSS).toContain(`[data-dtb-kind="${kind}"]:not([data-dtb-part="trigger"])`);
  });

  it.each([
    ["unknown", "--dtb-muted"],
    ["ok", "--dtb-ok"],
    ["warn", "--dtb-warn"],
    ["bad", "--dtb-danger"],
    ["override", "--dtb-accent"],
  ])("maps %s severity to %s", (severity, token) => {
    expect(KIT_CSS).toContain(`[data-dtb-severity="${severity}"]`);
    expect(KIT_CSS).toContain(`var(${token})`);
  });

  /**
   * A `ReactNode` icon may be a bare character, not just an element.
   * `line-height: 0` on the wrapper collapsed a character's box to zero height
   * and, inherited into the block child, centred it on the box's top edge —
   * so both line boxes track the clamped size instead.
   */
  it("gives the glyph wrapper and its clamped child a line box the size of the clamp", () => {
    const wrapper = KIT_CSS.match(/\[data-dtb-kind="glyph"\]\s*\{([^}]*)\}/)?.[1] ?? "";
    const child = KIT_CSS.match(/\[data-dtb-kind="glyph"\]\s*>\s*\*\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(wrapper).toContain("line-height: var(--dtb-glyph-size, 1.15em);");
    expect(wrapper).not.toContain("line-height: 0");
    expect(child).toContain("height: var(--dtb-glyph-size, 1.15em);");
    expect(child).toContain("line-height: var(--dtb-glyph-size, 1.15em);");
    expect(child).toContain("text-align: center;");
  });

  it("requires dot and value severity on the styled element", () => {
    expect(KIT_CSS).not.toMatch(
      /\[data-dtb-severity="[^"]+"\]\s+\[data-dtb-kind="(?:dot|value)"\]/,
    );
  });
});

describe("ensureKitStyles", () => {
  it("injects one kit sheet per document and keeps the first nonce", () => {
    const first = ensureKitStyles(document, "first");
    const second = ensureKitStyles(document, "second");

    expect(second).toBe(first);
    expect(first?.textContent).toBe(KIT_CSS);
    expect(first?.nonce).toBe("first");
    expect(document.head.querySelectorAll(`style[${STYLE_ATTRIBUTE}="kit"]`)).toHaveLength(1);

    const otherDocument = document.implementation.createHTMLDocument();
    const other = ensureKitStyles(otherDocument);
    expect(other).not.toBe(first);
    expect(otherDocument.head.querySelectorAll(`style[${STYLE_ATTRIBUTE}="kit"]`)).toHaveLength(1);
  });

  it("returns null without a usable document", () => {
    expect(ensureKitStyles({ head: null } as unknown as Document)).toBeNull();
  });
});
