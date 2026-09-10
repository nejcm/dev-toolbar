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
    expect(KIT_CSS).toContain('[data-dtb-kind="action"]:hover:not(:disabled)');
    expect(KIT_CSS).toMatch(
      /\[data-dtb-kind="note"\][^{]*\{[^}]*margin: 0;[^}]*color: var\(--dtb-muted\);[^}]*\}/s,
    );
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
