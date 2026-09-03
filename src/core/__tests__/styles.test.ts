/**
 * Core's own style injector. Deliberately the same shape as
 * `src/runtime/styles.ts` — core may not import `runtime/`, so the two are
 * hand-kept in step and `src/runtime/__tests__/styles.test.ts` is this file's
 * sibling.
 */
import { afterEach, describe, expect, it } from "vitest";
import { CORE_CSS, ensureStyles } from "../styles";

const STYLE_ATTRIBUTE = "data-dev-toolbar-styles";

afterEach(() => {
  for (const node of document.head.querySelectorAll(`style[${STYLE_ATTRIBUTE}]`)) node.remove();
});

const entries = () =>
  [...document.head.querySelectorAll(`style[${STYLE_ATTRIBUTE}]`)].map((node) =>
    node.getAttribute(STYLE_ATTRIBUTE),
  );

describe("ensureStyles", () => {
  it("injects core's stylesheet once and returns the same element after that", () => {
    const first = ensureStyles();
    const second = ensureStyles();
    expect(first).toBe(second);
    expect(entries()).toEqual(["core"]);
    expect(first?.textContent).toBe(CORE_CSS);
  });

  /**
   * Original bug: `entry` was interpolated raw into
   * `style[data-dev-toolbar-styles="${entry}"]`. A `"` in it closed the
   * attribute value early, so the selector either changed meaning or — more
   * usually — was invalid and `querySelector` threw a `SyntaxError` straight
   * out of the effect that called it.
   */
  it("dedupes an entry containing a quote instead of throwing an invalid selector", () => {
    const hostile = 'a"], style[data-dev-toolbar-styles="b';

    const first = ensureStyles(hostile, ".x{}");
    const second = ensureStyles(hostile, ".y{}");

    expect(first).not.toBeNull();
    expect(first).toBe(second);
    expect(entries()).toEqual([hostile]);
    expect(first?.getAttribute(STYLE_ATTRIBUTE)).toBe(hostile);
    expect(first?.textContent).toBe(".x{}");
  });

  it("matches the attribute exactly, so one entry is not mistaken for another", () => {
    ensureStyles("ext", ".a{}");
    const other = ensureStyles("ext-two", ".b{}");
    expect(entries()).toEqual(["ext", "ext-two"]);
    expect(other?.textContent).toBe(".b{}");
  });

  /**
   * Original bug: `ensureStyles` took no nonce at all, so under a
   * `style-src 'self' 'nonce-…'` policy the injected sheet was dropped and the
   * bar rendered unstyled with nothing but a CSP report to go on.
   */
  it("sets the nonce property on the element it creates", () => {
    const style = ensureStyles("nonced", ".a{}", document, "abc123");
    expect(style?.nonce).toBe("abc123");
  });

  it("leaves an existing sheet's nonce alone — the nonce is evaluated at insertion", () => {
    const first = ensureStyles("nonced", ".a{}", document, "first");
    const second = ensureStyles("nonced", ".a{}", document, "second");
    expect(second).toBe(first);
    expect(second?.nonce).toBe("first");
  });

  it("sets no nonce attribute when none is given", () => {
    const style = ensureStyles("plain", ".a{}");
    expect(style?.nonce).toBe("");
  });

  it("injects into the document it is given", () => {
    const other = document.implementation.createHTMLDocument("other");
    const style = ensureStyles("core", ".a{}", other);
    expect(style?.ownerDocument).toBe(other);
    expect(entries()).toEqual([]);
  });
});
