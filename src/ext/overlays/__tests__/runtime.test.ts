/**
 * The parts of `/ext/overlays` that need no toolbar: the DOM *reading* helpers
 * and the one thing this extension writes to a document it does not own.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BOXES_REFS_ATTRIBUTE,
  BOXES_STYLE_ENTRY,
  createOverlaysRuntime,
  setHostOutlines,
} from "../runtime";
import {
  NO_OVERLAYS,
  OVERLAY_IDS,
  OVERLAY_META,
  accessibleName,
  countEnabled,
  describeElement,
  isInToolbar,
  isPaintedRect,
  normalizeGrid,
  parseFlags,
  sameSnapshot,
  serializeFlags,
  tabIndexOf,
} from "../types";
import type { OverlaysSnapshot } from "../types";

const html = (markup: string): HTMLElement => {
  const host = document.createElement("div");
  host.innerHTML = markup;
  document.body.appendChild(host);
  return host;
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("the catalogue", () => {
  it("describes every overlay it ships, cost included", () => {
    expect(OVERLAY_IDS).toEqual(["boxes", "grid", "inspect", "focus"]);
    for (const id of OVERLAY_IDS) {
      const meta = OVERLAY_META[id];
      expect(meta.id).toBe(id);
      expect(meta.label).not.toBe("");
      // The cost line is rendered in the panel. An overlay that arrives without
      // one is an overlay whose cost nobody had to think about.
      expect(meta.cost.length).toBeGreaterThan(20);
    }
    expect(countEnabled({ ...NO_OVERLAYS, grid: true, focus: true })).toBe(2);
  });
});

describe("persistence", () => {
  it("round-trips the flag map", () => {
    const flags = { ...NO_OVERLAYS, grid: true, inspect: true };
    expect(parseFlags(serializeFlags(flags))).toEqual(flags);
  });

  it("fails closed on anything it cannot read", () => {
    for (const raw of [
      null,
      "",
      "{",
      "null",
      "[]",
      '"boxes"',
      '{"boxes":"yes"}',
      '{"boxes":1}',
      '{"nonsense":true}',
    ]) {
      expect(parseFlags(raw)).toEqual(NO_OVERLAYS);
    }
    // A stored `true` for an id this version no longer ships must not survive
    // as anything, and must not disturb the ids that do.
    expect(parseFlags('{"stacking":true,"grid":true}')).toEqual({
      ...NO_OVERLAYS,
      grid: true,
    });
  });
});

describe("describing an element", () => {
  it("reads like a selector, and truncates a long class list", () => {
    const host = html(`<div id="main" class="a b c d e"></div><span class="x"></span><i></i>`);
    const [div, span, italic] = [...host.children];
    expect(describeElement(div as Element)).toBe("div#main.a.b.c+2");
    expect(describeElement(span as Element)).toBe("span.x");
    expect(describeElement(italic as Element)).toBe("i");
  });
});

describe("accessible names", () => {
  const name = (markup: string): string | null => {
    const host = html(markup);
    return accessibleName(host.firstElementChild as Element);
  };

  it("prefers aria-label, then aria-labelledby, then content", () => {
    expect(name(`<button aria-label="Close">×</button>`)).toBe("Close");
    expect(name(`<button aria-labelledby="t">×</button><span id="t">Save</span>`)).toBe("Save");
    expect(name(`<button>  Save   changes </button>`)).toBe("Save changes");
  });

  it("finds the label of a form control, wrapping or not", () => {
    const host = html(
      `<label for="e">Email</label><input id="e"><label>Age <input id="a"></label>`,
    );
    expect(accessibleName(host.querySelector("#e") as Element)).toBe("Email");
    expect(accessibleName(host.querySelector("#a") as Element)).toBe("Age");
  });

  it("treats an empty alt as a decision and a missing one as the bug", () => {
    expect(name(`<img alt="">`)).toBe("");
    expect(name(`<img alt="A cat">`)).toBe("A cat");
    expect(name(`<img src="x.png">`)).toBeNull();
  });

  it("names an icon-only button from its labelled child", () => {
    expect(name(`<button><svg aria-label="Delete"></svg></button>`)).toBe("Delete");
    expect(name(`<button><svg></svg></button>`)).toBeNull();
  });

  it("falls back to title, and reports nothing rather than guessing", () => {
    expect(name(`<div title="Tip" role="note"></div>`)).toBe("Tip");
    expect(name(`<div></div>`)).toBeNull();
  });
});

describe("reading the document", () => {
  it("recognises anything inside any dev toolbar", () => {
    const host = html(`<div data-dev-toolbar><span id="inside"></span></div><b id="outside"></b>`);
    expect(isInToolbar(host.querySelector("#inside"))).toBe(true);
    expect(isInToolbar(host.querySelector("[data-dev-toolbar]"))).toBe(true);
    expect(isInToolbar(host.querySelector("#outside"))).toBe(false);
    expect(isInToolbar(null)).toBe(false);
    // A text node reaches this through elementFromPoint's neighbours; it must
    // resolve through its parent rather than throwing.
    expect(
      isInToolbar(
        (host.querySelector("#inside") as Element).appendChild(document.createTextNode("x")),
      ),
    ).toBe(true);
  });

  it("parses tabindex, and only when it is a number", () => {
    const host = html(`<a tabindex="3"></a><b tabindex="-1"></b><i tabindex="wat"></i><u></u>`);
    const [a, b, i, u] = [...host.children];
    expect(tabIndexOf(a as Element)).toBe(3);
    expect(tabIndexOf(b as Element)).toBe(-1);
    expect(tabIndexOf(i as Element)).toBeNull();
    expect(tabIndexOf(u as Element)).toBeNull();
  });

  it("counts a rect as painted only when it has a box and is on screen", () => {
    const viewport = { width: 100, height: 100 };
    expect(isPaintedRect({ x: 0, y: 0, width: 0, height: 0 }, viewport)).toBe(false);
    expect(isPaintedRect({ x: 0, y: 0, width: 10, height: 10 }, viewport)).toBe(true);
    expect(isPaintedRect({ x: 0, y: 200, width: 10, height: 10 }, viewport)).toBe(false);
    expect(isPaintedRect({ x: 0, y: -20, width: 10, height: 10 }, viewport)).toBe(false);
    // Partly on screen still counts: half a badge is information.
    expect(isPaintedRect({ x: 0, y: -5, width: 10, height: 10 }, viewport)).toBe(true);
  });
});

describe("the grid", () => {
  it("clamps values a hand-written config could break the maths with", () => {
    expect(normalizeGrid({ columns: 0 }).columns).toBe(1);
    expect(normalizeGrid({ columns: 999 }).columns).toBe(48);
    expect(normalizeGrid({ gutter: -10 }).gutter).toBe(0);
    expect(normalizeGrid({ maxWidth: 1 }).maxWidth).toBe(120);
    expect(normalizeGrid({ baseline: -1 }).baseline).toBe(0);
    expect(normalizeGrid()).toEqual({
      columns: 12,
      gutter: 24,
      maxWidth: 1200,
      baseline: 8,
    });
  });
});

describe("the host stylesheet", () => {
  const sheets = () =>
    document.head.querySelectorAll(`style[data-dev-toolbar-styles="${BOXES_STYLE_ENTRY}"]`);

  it("adds exactly one, however many times it is asked", () => {
    setHostOutlines(true);
    setHostOutlines(true);
    expect(sheets()).toHaveLength(1);
    expect((sheets()[0] as HTMLStyleElement).textContent).toContain("outline");
  });

  it("releases every copy it can see, and releasing twice is not an error", () => {
    setHostOutlines(true);
    // A second element with the same key, as a second bundled copy would leave.
    // It carries no count, so it reads as one holder — which is why the single
    // release below takes both away rather than only the counted one. That is
    // the intended behaviour, not the coincidence the test's old name implied:
    // release walks every matching element and decrements each, and a sheet
    // nobody counted has nobody left to hold it after one release.
    const stray = document.createElement("style");
    stray.setAttribute("data-dev-toolbar-styles", BOXES_STYLE_ENTRY);
    document.head.appendChild(stray);
    expect(sheets()).toHaveLength(2);
    expect((sheets()[0] as HTMLElement).getAttribute(BOXES_REFS_ATTRIBUTE)).toBe("1");
    expect((sheets()[1] as HTMLElement).getAttribute(BOXES_REFS_ATTRIBUTE)).toBeNull();

    setHostOutlines(false);
    expect(sheets()).toHaveLength(0);
    // And again on an empty document: a release with nothing to release is a
    // no-op, which is what makes the teardown path safe to run twice.
    setHostOutlines(false);
    expect(sheets()).toHaveLength(0);
  });

  it("never outlines a toolbar", () => {
    setHostOutlines(true);
    const css = (sheets()[0] as HTMLStyleElement).textContent as string;
    expect(css).toContain(":not([data-dev-toolbar])");
    expect(css).toContain(":not([data-dev-toolbar] *)");
    // Outline, never border or padding: an overlay that reflowed the layout it
    // is describing would be worse than no overlay.
    expect(css).not.toMatch(/\bborder\b|\bpadding\b|\bmargin\b/);
  });
});

describe("the runtime on its own", () => {
  it("starts with everything off, and honours supplied defaults", () => {
    expect(createOverlaysRuntime().enabled()).toEqual(NO_OVERLAYS);
    expect(createOverlaysRuntime({ defaults: { grid: true } }).enabled()).toEqual({
      ...NO_OVERLAYS,
      grid: true,
    });
  });

  it("ignores an id it does not ship", () => {
    const runtime = createOverlaysRuntime();
    runtime.set("nonsense" as never, true);
    runtime.toggle("nonsense" as never);
    expect(runtime.enabled()).toEqual(NO_OVERLAYS);
  });

  it("draws nothing and observes nothing before start()", () => {
    const runtime = createOverlaysRuntime({ defaults: { boxes: true } });
    expect(runtime.store.peek().ready).toBe(false);
    expect(runtime.store.peek().active).toBe(false);
    expect(
      document.head.querySelectorAll(`style[data-dev-toolbar-styles="${BOXES_STYLE_ENTRY}"]`),
    ).toHaveLength(0);
  });
});

describe("snapshot equality", () => {
  const base: OverlaysSnapshot = {
    enabled: { ...NO_OVERLAYS },
    activeCount: 0,
    hover: null,
    focusItems: [],
    focusTruncated: false,
    unnamedCount: 0,
    ready: true,
    active: true,
    error: null,
  };
  const hover = {
    rect: { x: 1, y: 2, width: 3, height: 4 },
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    description: "div",
    size: "3 × 4",
    name: null,
    role: null,
    pinned: false,
  };

  it("is what stops a stationary pointer re-rendering the page", () => {
    // The pointer moves inside one element: same rect, same label, nothing to
    // repaint. Without this the overlay tree would re-render every frame.
    expect(sameSnapshot({ ...base, hover }, { ...base, hover: { ...hover } })).toBe(true);
    expect(
      sameSnapshot(
        { ...base, hover },
        { ...base, hover: { ...hover, rect: { ...hover.rect, x: 2 } } },
      ),
    ).toBe(false);
  });

  it("notices a padding change that does not move the border box", () => {
    // Under `box-sizing: border-box` — most applications — a hover state or an
    // inline style can change padding while the border rect stays put. The
    // inspector draws the padding and margin boxes from these, so comparing
    // only `rect` left it drawing stale ones until the pointer moved on.
    const padded = {
      ...hover,
      padding: { top: 8, right: 8, bottom: 8, left: 8 },
    };
    expect(sameSnapshot({ ...base, hover }, { ...base, hover: padded })).toBe(false);
    const marginned = {
      ...hover,
      margin: { top: 0, right: 0, bottom: 12, left: 0 },
    };
    expect(sameSnapshot({ ...base, hover }, { ...base, hover: marginned })).toBe(false);
    // And the two labels the inspector prints from.
    expect(sameSnapshot({ ...base, hover }, { ...base, hover: { ...hover, role: "button" } })).toBe(
      false,
    );
    expect(sameSnapshot({ ...base, hover }, { ...base, hover: { ...hover, pinned: true } })).toBe(
      false,
    );
  });

  it("notices every field a surface reads", () => {
    expect(sameSnapshot(base, { ...base, active: false })).toBe(false);
    expect(sameSnapshot(base, { ...base, error: "x" })).toBe(false);
    expect(sameSnapshot(base, { ...base, unnamedCount: 1 })).toBe(false);
    expect(sameSnapshot(base, { ...base, focusTruncated: true })).toBe(false);
    expect(
      sameSnapshot(base, {
        ...base,
        enabled: { ...NO_OVERLAYS, grid: true },
        activeCount: 1,
      }),
    ).toBe(false);
    const item = {
      key: "1:BUTTON",
      index: 1,
      rect: { x: 0, y: 0, width: 10, height: 10 },
      tag: "button",
      name: "Save",
      tabIndex: null,
    };
    expect(
      sameSnapshot({ ...base, focusItems: [item] }, { ...base, focusItems: [{ ...item }] }),
    ).toBe(true);
    expect(
      sameSnapshot(
        { ...base, focusItems: [item] },
        { ...base, focusItems: [{ ...item, name: null }] },
      ),
    ).toBe(false);
  });
});
