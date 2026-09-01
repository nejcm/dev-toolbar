import { afterEach, describe, expect, it } from "vitest";
import { STYLE_ATTRIBUTE, ensureStyleSheet } from "../styles";

afterEach(() => {
  document.head
    .querySelectorAll(`style[${STYLE_ATTRIBUTE}="test-entry"]`)
    .forEach((node) => node.remove());
});

describe("ensureStyleSheet", () => {
  it("injects once and returns the same element after that", () => {
    const first = ensureStyleSheet("test-entry", ".a{color:red}");
    const second = ensureStyleSheet("test-entry", ".a{color:blue}");
    expect(first).toBe(second);
    expect(
      document.head.querySelectorAll(`style[${STYLE_ATTRIBUTE}="test-entry"]`)
        .length,
    ).toBe(1);
    // The DOM is the source of truth, so the first writer wins — a second
    // bundled copy of a package must not restyle the page underneath the first.
    expect(first?.textContent).toBe(".a{color:red}");
  });

  it("keeps entries independent", () => {
    ensureStyleSheet("test-entry", ".a{}");
    const other = ensureStyleSheet("test-entry-2", ".b{}");
    expect(other?.getAttribute(STYLE_ATTRIBUTE)).toBe("test-entry-2");
    other?.remove();
  });
});
