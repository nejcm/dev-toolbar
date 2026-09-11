import { createRef } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  Action,
  Banner,
  Chip,
  EmptyState,
  Field,
  Glyph,
  hasPaintableIcon,
  Note,
  Row,
  Rows,
  SearchField,
  Select,
  Tag,
  TextInput,
} from "../controls";

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

  it("renders the icon after the dot and before the label", () => {
    const { container } = render(
      <Chip icon={<svg data-dtb-part="example-icon" />} label="metrics" value="42" />,
    );

    const chip = container.firstElementChild as HTMLSpanElement;
    expect(Array.from(chip.children, (child) => child.getAttribute("data-dtb-kind"))).toEqual([
      "dot",
      "glyph",
      null,
      "value",
    ]);
    expect(chip.children[1]?.firstElementChild?.getAttribute("data-dtb-part")).toBe("example-icon");
  });

  it("takes props for the icon wrapper", () => {
    const { container } = render(
      <Chip icon="*" iconProps={{ "data-dtb-part": "example-icon" }} label="metrics" />,
    );

    const glyph = container.querySelector('[data-dtb-kind="glyph"]');
    expect(glyph?.getAttribute("data-dtb-part")).toBe("example-icon");
  });

  it.each([undefined, null])(
    "omits the label node entirely for %s, so the gap does not shift an icon-only chip",
    (label) => {
      const { container } = render(<Chip icon="*" label={label} value="42" />);

      const chip = container.firstElementChild as HTMLSpanElement;
      expect(Array.from(chip.children, (child) => child.getAttribute("data-dtb-kind"))).toEqual([
        "dot",
        "glyph",
        "value",
      ]);
    },
  );

  it("omits the icon node entirely when no icon is supplied", () => {
    const { container } = render(<Chip label="metrics" />);

    const chip = container.firstElementChild as HTMLSpanElement;
    expect(chip.querySelector('[data-dtb-kind="glyph"]')).toBeNull();
    expect(chip.children).toHaveLength(2);
  });

  // hasPaintableIcon's emptiness rule, not a presence test: `icon={enabled &&
  // <I />}` is `false` half the time, and a presence test would still paint it.
  it.each([false, true, ""])("takes %p as no icon at all, not as an icon", (icon) => {
    const { container } = render(<Chip icon={icon} label="metrics" />);

    expect(container.querySelector('[data-dtb-kind="glyph"]')).toBeNull();
  });

  // Emptiness, not falsiness: React paints `0` as the character.
  it("paints 0 as an icon", () => {
    const { container } = render(<Chip icon={0} label="metrics" />);

    expect(container.querySelector('[data-dtb-kind="glyph"]')?.textContent).toBe("0");
  });
});

describe("Glyph", () => {
  it("hides itself from assistive technology by default and forwards its ref", () => {
    const ref = createRef<HTMLSpanElement>();
    const { container } = render(
      <Glyph ref={ref} data-dtb-part="example-icon">
        <svg />
      </Glyph>,
    );

    const glyph = container.firstElementChild as HTMLSpanElement;
    expect(ref.current).toBe(glyph);
    expect(glyph.getAttribute("data-dtb-kind")).toBe("glyph");
    expect(glyph.getAttribute("aria-hidden")).toBe("true");
    expect(glyph.getAttribute("data-dtb-part")).toBe("example-icon");
  });

  it("lets a site that names the icon itself opt out of aria-hidden", () => {
    const { getByRole } = render(
      <Glyph aria-hidden={false} role="img" aria-label="memory">
        <svg />
      </Glyph>,
    );

    expect(getByRole("img", { name: "memory" }).getAttribute("data-dtb-kind")).toBe("glyph");
  });
});

describe("hasPaintableIcon", () => {
  // The five primitives React paints nothing for. `0` paints the character.
  it.each([[undefined], [null], [false], [true], [""]])("%j is not an icon", (empty) => {
    expect(hasPaintableIcon(empty)).toBe(false);
  });

  it.each([[0], ["*"], ["0"], [NaN]])("%j is an icon", (node) => {
    expect(hasPaintableIcon(node)).toBe(true);
  });

  // The boundary, pinned so the rule stays the narrow one: a node that paints
  // nothing (an empty array, a component returning null) still counts as an
  // icon — deciding otherwise needs rendering it, which this can't do.
  it.each([[[]], [[null]], [[undefined, false]]])("%j is a node, so it counts", (node) => {
    expect(hasPaintableIcon(node)).toBe(true);
  });

  // /ext/flags has painted its legacy string | undefined icon on truthiness
  // since it existed; the two rules must agree over that type.
  it("agrees with truthiness over the legacy glyph's string | undefined", () => {
    for (const glyph of [undefined, "", "★", " "]) {
      expect(hasPaintableIcon(glyph)).toBe(Boolean(glyph));
    }
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

describe("SearchField", () => {
  it("is a named type=search input that reports the value, not the event", () => {
    const ref = createRef<HTMLInputElement>();
    const seen: string[] = [];
    const { getByRole } = render(
      <SearchField
        ref={ref}
        label="Search flags"
        placeholder="Search 3 flags"
        value="dark"
        onChange={(next) => seen.push(next)}
        data-dtb-part="example-search"
      />,
    );

    const input = getByRole("searchbox", { name: "Search flags" });
    expect(ref.current).toBe(input);
    expect(input.getAttribute("type")).toBe("search");
    expect(input.getAttribute("data-dtb-kind")).toBe("search");
    expect(input.getAttribute("data-dtb-part")).toBe("example-search");
    expect(input.getAttribute("placeholder")).toBe("Search 3 flags");
    expect((input as HTMLInputElement).value).toBe("dark");

    fireEvent.change(input, { target: { value: "light" } });
    expect(seen).toEqual(["light"]);
  });

  it("keeps its name when the site points at a heading instead", () => {
    const { container } = render(
      <>
        <h2 id="tokens-heading">Tokens</h2>
        <SearchField
          label="Search tokens"
          aria-labelledby="tokens-heading"
          value=""
          onChange={() => {}}
        />
      </>,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    // Both survive: aria-labelledby wins in the accessibility tree, and the
    // required `label` means the control is never nameless.
    expect(input.getAttribute("aria-labelledby")).toBe("tokens-heading");
    expect(input.getAttribute("aria-label")).toBe("Search tokens");
  });
});

describe("Rows and Row", () => {
  it("renders a dl whose pairs stay its direct children", () => {
    const ref = createRef<HTMLDListElement>();
    const { container } = render(
      <Rows ref={ref} data-dtb-part="example-rows">
        <Row label="build">abc123</Row>
        <Row
          label="host"
          labelProps={{ "data-dtb-part": "example-row-label" }}
          valueProps={{ "data-dtb-part": "example-row-value", "data-dtb-masked": "true" }}
        >
          example.test
        </Row>
      </Rows>,
    );

    const list = container.querySelector("dl") as HTMLDListElement;
    expect(ref.current).toBe(list);
    expect(list.getAttribute("data-dtb-kind")).toBe("rows");
    expect(list.getAttribute("data-dtb-part")).toBe("example-rows");
    // Direct children, or the two-column grid would not line up.
    expect([...list.children].map((node) => node.tagName)).toEqual(["DT", "DD", "DT", "DD"]);

    const labels = [...list.querySelectorAll("dt")];
    const values = [...list.querySelectorAll("dd")];
    expect(labels.map((node) => node.getAttribute("data-dtb-kind"))).toEqual(["label", "label"]);
    expect(labels.map((node) => node.textContent)).toEqual(["build", "host"]);
    expect(values.map((node) => node.textContent)).toEqual(["abc123", "example.test"]);
    // The slot props do not cost the site the kit's treatment.
    expect(values.map((node) => node.getAttribute("data-dtb-kind"))).toEqual(["value", "value"]);
    expect(values[1]?.getAttribute("data-dtb-part")).toBe("example-row-value");
    expect(values[1]?.getAttribute("data-dtb-masked")).toBe("true");
  });

  it("spreads an unexpected prop onto the value cell rather than dropping it", () => {
    const { container } = render(
      <Rows>
        <Row
          label="build"
          data-dtb-kind="custom"
          data-dtb-part="example-row-value"
          title="the commit"
        >
          abc123
        </Row>
      </Rows>,
    );
    const value = container.querySelector("dd");
    expect(value?.getAttribute("data-dtb-part")).toBe("example-row-value");
    expect(value?.getAttribute("data-dtb-kind")).toBe("value");
    expect(value?.getAttribute("title")).toBe("the commit");
    expect(container.querySelector("dt")?.hasAttribute("data-dtb-part")).toBe(false);
  });

  it("lets valueProps win over a colliding spread prop", () => {
    const { container } = render(
      <Rows>
        <Row label="build" data-dtb-part="spread" valueProps={{ "data-dtb-part": "explicit" }}>
          abc123
        </Row>
      </Rows>,
    );
    expect(container.querySelector("dd")?.getAttribute("data-dtb-part")).toBe("explicit");
  });

  it("lets a slot opt out of the kit kind", () => {
    const { container } = render(
      <Rows>
        <Row label="raw" valueProps={{ "data-dtb-kind": undefined }}>
          text
        </Row>
      </Rows>,
    );
    expect(container.querySelector("dd")?.hasAttribute("data-dtb-kind")).toBe(false);
  });
});

describe("Field", () => {
  it("names its control by wrapping it, with no id to keep in sync", () => {
    const ref = createRef<HTMLLabelElement>();
    const { getByRole, container } = render(
      <Field ref={ref} label="export" data-dtb-part="example-note">
        <Select value="css" onChange={() => {}}>
          <option value="css">CSS</option>
        </Select>
      </Field>,
    );

    const label = container.querySelector("label") as HTMLLabelElement;
    expect(ref.current).toBe(label);
    expect(label.getAttribute("data-dtb-kind")).toBe("note");
    expect(label.getAttribute("data-dtb-part")).toBe("example-note");
    expect(label.textContent).toBe("export CSS");
    // No `for`/`id` pair exists to drift out of sync — the nesting is the wiring.
    expect(label.hasAttribute("for")).toBe(false);
    expect(getByRole("combobox", { name: "export" })).toBe(container.querySelector("select"));
  });

  it("lets the control inside override the visible text for a screen reader", () => {
    const { getByRole } = render(
      <Field label="surface">
        <Select aria-label="Surface the edits apply to" value="a" onChange={() => {}}>
          <option value="a">A</option>
        </Select>
      </Field>,
    );
    expect(getByRole("combobox", { name: "Surface the edits apply to" })).not.toBeNull();
  });
});

describe("TextInput and Select", () => {
  it("report the value, not the event, and carry the shared field hook", () => {
    const ref = createRef<HTMLInputElement>();
    const typed: string[] = [];
    const { container } = render(
      <TextInput
        ref={ref}
        aria-label="Override dark"
        value="1"
        onChange={(next) => typed.push(next)}
        data-dtb-part="example-input"
      />,
    );

    const input = container.querySelector("input") as HTMLInputElement;
    expect(ref.current).toBe(input);
    expect(input.getAttribute("type")).toBe("text");
    expect(input.getAttribute("data-dtb-kind")).toBe("field");
    expect(input.getAttribute("data-dtb-part")).toBe("example-input");

    fireEvent.change(input, { target: { value: "2" } });
    expect(typed).toEqual(["2"]);
  });

  it("keeps an explicit type and stays read-only when no handler is given", () => {
    const { container } = render(
      <TextInput type="email" readOnly value="a@b.test" aria-label="Contact" />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.getAttribute("type")).toBe("email");
    // No `onChange` prop means React gets none either, rather than a no-op that
    // would make a read-only field look editable to a test.
    fireEvent.change(input, { target: { value: "c@d.test" } });
    expect(input.value).toBe("a@b.test");
  });

  it("selects report the chosen value and forward their ref", () => {
    const ref = createRef<HTMLSelectElement>();
    const chosen: string[] = [];
    const { container } = render(
      <Select
        ref={ref}
        aria-label="Export format"
        value="css"
        onChange={(next) => chosen.push(next)}
        data-dtb-part="example-select"
      >
        <option value="css">CSS</option>
        <option value="json">JSON</option>
      </Select>,
    );

    const select = container.querySelector("select") as HTMLSelectElement;
    expect(ref.current).toBe(select);
    expect(select.getAttribute("data-dtb-kind")).toBe("field");
    expect(select.getAttribute("data-dtb-part")).toBe("example-select");

    fireEvent.change(select, { target: { value: "json" } });
    expect(chosen).toEqual(["json"]);
  });

  it("renders a select with no handler without throwing on change", () => {
    const { container } = render(
      <Select aria-label="Frozen" value="css">
        <option value="css">CSS</option>
      </Select>,
    );
    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select.getAttribute("data-dtb-kind")).toBe("field");
    fireEvent.change(select, { target: { value: "css" } });
    expect(select.value).toBe("css");
  });
});
