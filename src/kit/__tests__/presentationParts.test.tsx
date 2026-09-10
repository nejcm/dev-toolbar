/**
 * `renderCompactParts`, the one function in `presentation.tsx` that paints.
 *
 * The rest of that module is pure and lives in `presentation.test.ts`; this is
 * a `.tsx` file because these assertions are about markup. What they pin is the
 * fragment six extensions used to write by hand: which of the two texts is
 * painted, that `parts.value` is none of this function's business, and that an
 * omitted `textProps` still writes the bare `<span>` the four Group A chips
 * shipped before their spans were named.
 */
import type { ReactNode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderCompactParts } from "../presentation";
import type { CompactParts } from "../presentation";

afterEach(cleanup);

const ICON = <svg data-icon="example" />;

const parts = (over: Partial<CompactParts> = {}): CompactParts => ({
  icon: false,
  text: "none",
  value: false,
  ...over,
});

const html = (node: ReactNode): string => {
  const { container } = render(<span data-dtb-part="host">{node}</span>);
  return (container.firstElementChild as HTMLElement).innerHTML;
};

describe("renderCompactParts", () => {
  it("paints the short word for short and the full identity for full", () => {
    expect(
      html(
        renderCompactParts({
          parts: parts({ text: "short" }),
          icon: ICON,
          short: "a11y",
          full: "Accessibility",
        }),
      ),
    ).toBe("<span>a11y</span>");
    expect(
      html(
        renderCompactParts({
          parts: parts({ text: "full" }),
          icon: ICON,
          short: "a11y",
          full: "Accessibility",
        }),
      ),
    ).toBe("<span>Accessibility</span>");
  });

  it('paints no span at all for "none"', () => {
    expect(
      html(
        renderCompactParts({ parts: parts(), icon: ICON, short: "a11y", full: "Accessibility" }),
      ),
    ).toBe("");
  });

  it("paints the icon inside a Glyph only when parts.icon says so", () => {
    expect(
      html(
        renderCompactParts({
          parts: parts({ icon: true }),
          icon: ICON,
          iconProps: { "data-dtb-part": "a11y-icon" },
          short: "a11y",
          full: "Accessibility",
        }),
      ),
      // The `Glyph` contract, not a bare wrapper: hidden from assistive
      // technology and carrying the kind its clamp rule selects on.
    ).toBe(
      '<span data-dtb-part="a11y-icon" aria-hidden="true" data-dtb-kind="glyph"><svg data-icon="example"></svg></span>',
    );

    expect(
      html(
        renderCompactParts({
          parts: parts({ icon: false, text: "short" }),
          icon: ICON,
          iconProps: { "data-dtb-part": "a11y-icon" },
          short: "a11y",
          full: "Accessibility",
        }),
      ),
    ).toBe("<span>a11y</span>");
  });

  it("spreads textProps onto the text span, and writes a bare one without them", () => {
    expect(
      html(
        renderCompactParts({
          parts: parts({ text: "short" }),
          icon: null,
          short: "env",
          full: "Environment",
          textProps: { "data-dtb-part": "env-label", "data-dtb-kind": "label" },
        }),
      ),
    ).toBe('<span data-dtb-part="env-label" data-dtb-kind="label">env</span>');

    // The four Group A chips carry a part and deliberately no kind — the kit
    // sheet tints `[data-dtb-kind="label"]`, and that is a separate decision.
    expect(
      html(
        renderCompactParts({
          parts: parts({ text: "short" }),
          icon: null,
          short: "a11y",
          full: "Accessibility",
          textProps: { "data-dtb-part": "a11y-label" },
        }),
      ),
    ).toBe('<span data-dtb-part="a11y-label">a11y</span>');
  });

  it("ignores parts.value — the value span is the extension's own", () => {
    expect(
      html(
        renderCompactParts({
          parts: parts({ icon: true, text: "short", value: true }),
          icon: ICON,
          iconProps: { "data-dtb-part": "m-icon" },
          short: "mem",
          full: "Memory",
          textProps: { "data-dtb-part": "m-label" },
        }),
      ),
    ).toBe(
      '<span data-dtb-part="m-icon" aria-hidden="true" data-dtb-kind="glyph"><svg data-icon="example"></svg></span>' +
        '<span data-dtb-part="m-label">mem</span>',
    );
  });

  it("paints the icon and the text in that order, icon first", () => {
    const { container } = render(
      <span>
        {renderCompactParts({
          parts: parts({ icon: true, text: "full" }),
          icon: ICON,
          iconProps: { "data-dtb-part": "x-icon" },
          short: "x",
          full: "Example",
          textProps: { "data-dtb-part": "x-label" },
        })}
      </span>,
    );
    const children = [...(container.firstElementChild as HTMLElement).children];
    expect(children.map((node) => node.getAttribute("data-dtb-part"))).toEqual([
      "x-icon",
      "x-label",
    ]);
  });
});
