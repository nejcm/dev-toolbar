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
    expect(document.head.querySelectorAll(`style[${STYLE_ATTRIBUTE}="test-entry"]`).length).toBe(1);
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

  it("does not let a quote in entry impersonate a different entry", () => {
    const first = ensureStyleSheet("ext-metrics", ".m{}");
    const spoofed = ensureStyleSheet('nope"], style[data-dev-toolbar-styles="ext-metrics', ".h{}");
    expect(spoofed).not.toBe(first);
    expect(spoofed?.getAttribute(STYLE_ATTRIBUTE)).toBe(
      'nope"], style[data-dev-toolbar-styles="ext-metrics',
    );
    expect(spoofed?.textContent).toBe(".h{}");
    first?.remove();
    spoofed?.remove();
  });

  it("does not throw on an unbalanced quote in entry", () => {
    expect(() => ensureStyleSheet('unbalanced"quote', ".u{}")).not.toThrow();
    const el = ensureStyleSheet('unbalanced"quote', ".u{}");
    expect(el?.getAttribute(STYLE_ATTRIBUTE)).toBe('unbalanced"quote');
    el?.remove();
  });

  it("sets the nonce property when provided", () => {
    const el = ensureStyleSheet("test-entry", ".a{}", document, "abc");
    expect(el?.nonce).toBe("abc");
    el?.remove();
  });
});
