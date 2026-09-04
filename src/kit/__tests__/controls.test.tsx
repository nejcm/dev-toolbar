import { createRef } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Action, Banner, Chip, EmptyState, Note, Tag } from "../controls";

afterEach(cleanup);

describe("Action", () => {
  it("renders a button with a safe default type and forwards attributes and its ref", () => {
    const ref = createRef<HTMLButtonElement>();
    const { getByRole } = render(
      <Action ref={ref} data-dtb-part="example-action" className="consumer-class">
        Reset
      </Action>,
    );

    const button = getByRole("button", { name: "Reset" });
    expect(ref.current).toBe(button);
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("data-dtb-kind")).toBe("action");
    expect(button.getAttribute("data-dtb-part")).toBe("example-action");
    expect(button.className).toBe("consumer-class");
  });
});

describe("Chip", () => {
  it("renders the dot, label and value in order with compound severity", () => {
    const ref = createRef<HTMLSpanElement>();
    const { container } = render(
      <Chip
        ref={ref}
        label="environment"
        value="production"
        severity="bad"
        data-dtb-part="example-chip"
        dotProps={{ "data-dtb-part": "example-dot" }}
        labelProps={{ "data-dtb-part": "example-label" }}
        valueProps={{ "data-dtb-part": "example-value" }}
      >
        <Tag data-dtb-part="example-tag">masked</Tag>
      </Chip>,
    );

    const chip = container.firstElementChild as HTMLSpanElement;
    expect(ref.current).toBe(chip);
    expect(chip.getAttribute("data-dtb-severity")).toBeNull();
    expect(Array.from(chip.children, (child) => child.getAttribute("data-dtb-part"))).toEqual([
      "example-dot",
      "example-label",
      "example-value",
      "example-tag",
    ]);
    expect(chip.children[0]?.getAttribute("data-dtb-severity")).toBe("bad");
    expect(chip.children[2]?.getAttribute("data-dtb-severity")).toBe("bad");
  });

  it("leaves the label unstyled by default and styles it only when asked", () => {
    const { container } = render(
      <Chip label="theme" value="3 edited" valueProps={{ "data-dtb-kind": undefined }} />,
    );

    const chip = container.firstElementChild as HTMLSpanElement;
    expect(chip.children[1]?.hasAttribute("data-dtb-kind")).toBe(false);
    expect(chip.children[2]?.hasAttribute("data-dtb-kind")).toBe(false);

    const opted = render(<Chip label="env" labelProps={{ "data-dtb-kind": "label" }} />);
    const optedChip = opted.container.firstElementChild as HTMLSpanElement;
    expect(optedChip.children[1]?.getAttribute("data-dtb-kind")).toBe("label");
  });

  it("writes no severity attribute at all when the site colours its own dot", () => {
    const { container } = render(<Chip label="theme" value="3 edited" />);

    const chip = container.firstElementChild as HTMLSpanElement;
    expect(chip.querySelectorAll("[data-dtb-severity]")).toHaveLength(0);
    expect(chip.hasAttribute("data-dtb-severity")).toBe(false);
  });

  it("omits the value node entirely when no value is supplied", () => {
    const { container } = render(<Chip label="diagnostics" severity="warn" />);

    const chip = container.firstElementChild as HTMLSpanElement;
    expect(chip.children).toHaveLength(2);
    expect(chip.children[0]?.getAttribute("data-dtb-kind")).toBe("dot");
    expect(chip.children[1]?.hasAttribute("data-dtb-kind")).toBe(false);
  });
});

describe("thin content controls", () => {
  it("forwards element choices, attributes and refs", () => {
    const noteRef = createRef<HTMLElement>();
    const bannerRef = createRef<HTMLElement>();
    const emptyRef = createRef<HTMLElement>();
    const toneRef = createRef<HTMLElement>();
    const tagRef = createRef<HTMLSpanElement>();
    const { getByText } = render(
      <>
        <Note as="label" ref={noteRef} data-dtb-part="example-note">
          Note
        </Note>
        <Banner as="div" ref={bannerRef} severity="warn" role="status">
          Warning
        </Banner>
        <Banner ref={toneRef} data-dtb-tone="info" role="status">
          Tone only
        </Banner>
        <Tag ref={tagRef} title="Masked value">
          masked
        </Tag>
        <EmptyState as="p" ref={emptyRef}>
          Nothing here
        </EmptyState>
      </>,
    );

    expect(noteRef.current?.tagName).toBe("LABEL");
    expect(noteRef.current?.getAttribute("data-dtb-kind")).toBe("note");
    expect(bannerRef.current).toBe(getByText("Warning"));
    expect(bannerRef.current?.getAttribute("data-dtb-severity")).toBe("warn");
    expect(bannerRef.current?.querySelector("[data-dtb-severity]")).toBeNull();
    // A site with its own tone vocabulary keeps it: no severity is written,
    // so the kit's bordered severity treatment never lands on top of it.
    expect(toneRef.current?.tagName).toBe("P");
    expect(toneRef.current?.hasAttribute("data-dtb-severity")).toBe(false);
    expect(toneRef.current?.getAttribute("data-dtb-tone")).toBe("info");
    expect(tagRef.current?.getAttribute("data-dtb-kind")).toBe("tag");
    expect(emptyRef.current?.tagName).toBe("P");
    expect(emptyRef.current?.getAttribute("data-dtb-kind")).toBe("empty");
  });

  it("lets a hand-written data-dtb-severity through, and prefers the prop", () => {
    const { getByText } = render(
      <>
        <Banner data-dtb-part="x-banner" data-dtb-severity="warn" role="alert">
          Hand-written
        </Banner>
        <Banner severity="bad" data-dtb-severity="warn" role="alert">
          Prop wins
        </Banner>
      </>,
    );

    const handWritten = getByText("Hand-written");
    expect(handWritten.getAttribute("data-dtb-severity")).toBe("warn");
    expect(handWritten.getAttribute("data-dtb-part")).toBe("x-banner");
    expect(getByText("Prop wins").getAttribute("data-dtb-severity")).toBe("bad");
  });
});
