import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DevToolbarExtension } from "../contract";
import { OverflowBar, computeOverflow } from "../Overflow";

describe("computeOverflow", () => {
  const items = [
    { id: "a", priority: 3, width: 60 },
    { id: "b", priority: 1, width: 60 },
    { id: "c", priority: 2, width: 60 },
  ];

  it("collapses nothing when everything fits", () => {
    expect([...computeOverflow(items, 1000, 28, 2)]).toEqual([]);
  });

  it("collapses nothing when the container has not been measured", () => {
    expect([...computeOverflow(items, 0, 28, 2)]).toEqual([]);
  });

  it("collapses the lowest priority first, and only as far as needed", () => {
    expect([...computeOverflow(items, 160, 28, 2)]).toEqual(["b"]);
    expect([...computeOverflow(items, 100, 28, 2)].sort()).toEqual(["b", "c"]);
  });

  it("breaks priority ties toward the later item", () => {
    const tied = [
      { id: "a", priority: 0, width: 60 },
      { id: "b", priority: 0, width: 60 },
    ];
    expect([...computeOverflow(tied, 100, 28, 2)]).toEqual(["b"]);
  });
});

const widths: Record<string, number> = { a: 60, b: 60, c: 60, d: 60, e: 60 };
let containerWidth = 100;

const patchLayout = () => {
  const offset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
  const client = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      const id = this.dataset["dtbExtId"];
      return id ? (widths[id] ?? 50) : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset["dtbPart"] === "bar" ? containerWidth : 0;
    },
  });
  return () => {
    if (offset) Object.defineProperty(HTMLElement.prototype, "offsetWidth", offset);
    if (client) Object.defineProperty(HTMLElement.prototype, "clientWidth", client);
  };
};

/**
 * jsdom applies no stylesheet, so the bar reports no padding and no gap. This
 * stubs `getComputedStyle` with the values `src/styles.css` actually resolves
 * to, which is what makes the bar's own padding and the inter-region gap
 * observable in a test.
 */
const patchComputedStyle = ({ paddingX, gap }: { paddingX: number; gap: number }) => {
  const real = globalThis.getComputedStyle.bind(globalThis);
  vi.stubGlobal("getComputedStyle", (element: Element, pseudo?: string | null) => {
    const style = real(element, pseudo ?? undefined);
    return new Proxy(style, {
      get(target, property, receiver) {
        if (property === "paddingLeft" || property === "paddingRight") return `${paddingX}px`;
        if (property === "columnGap" || property === "gap") return `${gap}px`;
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });
};

class MockResizeObserver implements ResizeObserver {
  static instances: MockResizeObserver[] = [];
  /** What this observer is watching, so a test can tell the two apart. */
  readonly targets = new Set<Element>();
  constructor(private readonly callback: ResizeObserverCallback) {
    MockResizeObserver.instances.push(this);
  }
  observe(target: Element): void {
    this.targets.add(target);
  }
  unobserve(target: Element): void {
    this.targets.delete(target);
  }
  disconnect(): void {
    this.targets.clear();
  }
  trigger(): void {
    this.callback([], this);
  }
}

const part = (node: Element) => (node as HTMLElement).dataset["dtbPart"];

/** The observer watching the bar's own box. */
const barObserver = () =>
  MockResizeObserver.instances.find((observer) =>
    [...observer.targets].some((target) => part(target) === "bar"),
  );

/** The observer watching the individual item hosts. */
const itemObserver = () =>
  MockResizeObserver.instances.find((observer) =>
    [...observer.targets].some((target) => part(target) === "item"),
  );

let restore: (() => void) | null = null;

/**
 * The fixture geometry every collapse test below is written against: no bar
 * padding and a 2px inter-item gap. It used to arrive implicitly — jsdom
 * reports neither, so the component fell back to its own constants — which
 * quietly coupled this file's arithmetic to whatever `src/styles.css` happened
 * to default to. Pinning it here is the same environment, stated. A test that
 * needs different values calls `patchComputedStyle` again and wins.
 */
beforeEach(() => {
  patchComputedStyle({ paddingX: 0, gap: 2 });
});

afterEach(() => {
  restore?.();
  restore = null;
  MockResizeObserver.instances = [];
  vi.unstubAllGlobals();
  containerWidth = 100;
});

const ext = (id: string, priority: number): DevToolbarExtension => ({
  id,
  label: id,
  priority,
  compact: () => <span>{id}</span>,
});

const renderBar = () =>
  render(
    <OverflowBar
      startItems={[ext("a", 3), ext("b", 1), ext("c", 2)]}
      endItems={[]}
      renderItem={(extension, { isOverflowed }) => (
        <div
          key={extension.id}
          data-dtb-part="item"
          data-dtb-ext-id={extension.id}
          data-dtb-overflowed={isOverflowed ? "true" : undefined}
        >
          {extension.compact?.({
            isOverflowed,
            isPanelOpen: false,
            density: "compact",
            openPanel: () => {},
            closePanel: () => {},
            togglePanel: () => {},
          })}
        </div>
      )}
    />,
  );

/** `renderBar` with both regions under the test's control. */
const renderRegions = (
  startItems: readonly DevToolbarExtension[],
  endItems: readonly DevToolbarExtension[],
) =>
  render(
    <OverflowBar
      startItems={startItems}
      endItems={endItems}
      renderItem={(extension, { isOverflowed }) => (
        <div
          key={extension.id}
          data-dtb-part="item"
          data-dtb-ext-id={extension.id}
          data-dtb-overflowed={isOverflowed ? "true" : undefined}
        >
          {extension.id}
        </div>
      )}
    />,
  );

const regionIds = (align: "start" | "end") =>
  [
    ...document.querySelectorAll(
      `[data-dtb-part="region"][data-dtb-align="${align}"] > [data-dtb-part="item"]`,
    ),
  ].map((node) => (node as HTMLElement).dataset["dtbExtId"]);

const menuIds = () =>
  [...document.querySelectorAll('[data-dtb-part="overflow-menu-item"]')].map(
    (node) => (node as HTMLElement).dataset["dtbExtId"],
  );

describe("OverflowBar", () => {
  it("collapses low-priority items into the ⋮ menu when space runs out", () => {
    restore = patchLayout();
    vi.stubGlobal("ResizeObserver", MockResizeObserver);

    renderBar();

    const bar = document.querySelector('[data-dtb-part="bar"]')!;
    const inBar = [...bar.querySelectorAll('[data-dtb-part="item"]')].map(
      (node) => (node as HTMLElement).dataset["dtbExtId"],
    );
    expect(inBar).toEqual(["a"]);

    const button = screen.getByRole("button", {
      name: "More developer toolbar items",
    });
    fireEvent.click(button);

    const menu = document.querySelector('[data-dtb-part="overflow-menu"]')!;
    expect(
      [...menu.querySelectorAll('[data-dtb-part="overflow-menu-item"]')].map(
        (node) => (node as HTMLElement).dataset["dtbExtId"],
      ),
    ).toEqual(["b", "c"]);
  });

  it("recomputes when the ResizeObserver fires, and re-expands when space returns", () => {
    containerWidth = 1000;
    restore = patchLayout();
    vi.stubGlobal("ResizeObserver", MockResizeObserver);

    renderBar();

    const idsInBar = () =>
      [...document.querySelectorAll('[data-dtb-part="region"] > [data-dtb-part="item"]')].map(
        (node) => (node as HTMLElement).dataset["dtbExtId"],
      );

    expect(idsInBar()).toEqual(["a", "b", "c"]);

    const resize = (width: number) => {
      containerWidth = width;
      act(() => {
        for (const instance of MockResizeObserver.instances) instance.trigger();
      });
    };

    // Shrink: the observer callback drives the collapse.
    resize(100);
    expect(idsInBar()).toEqual(["a"]);
    expect(document.querySelector('[data-dtb-part="overflow-button"]')).not.toBeNull();

    // Widen again: sticky cached widths let the collapsed items come back even
    // though they were not in the DOM to be measured while collapsed.
    resize(1000);
    expect(idsInBar()).toEqual(["a", "b", "c"]);
    expect(document.querySelector('[data-dtb-part="overflow-button"]')).toBeNull();
  });

  it("dismisses the ⋮ menu on Escape and on an outside click", () => {
    restore = patchLayout();
    vi.stubGlobal("ResizeObserver", MockResizeObserver);

    renderBar();

    const open = () =>
      fireEvent.click(screen.getByRole("button", { name: "More developer toolbar items" }));
    const menu = () => document.querySelector('[data-dtb-part="overflow-menu"]');

    open();
    expect(menu()).not.toBeNull();
    expect(menu()!.querySelectorAll('[data-dtb-part="overflow-menu-item"]').length).toBe(2);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(menu()).toBeNull();

    open();
    expect(menu()).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(menu()).toBeNull();
  });

  it("keeps everything in the bar when it fits", () => {
    containerWidth = 1000;
    restore = patchLayout();
    vi.stubGlobal("ResizeObserver", MockResizeObserver);

    renderBar();

    const bar = document.querySelector('[data-dtb-part="bar"]')!;
    expect(bar.querySelectorAll('[data-dtb-part="item"]').length).toBe(3);
    expect(document.querySelector('[data-dtb-part="overflow-button"]')).toBeNull();
  });
});

/**
 * The `⋮` button lives *inside* the end region, sharing its width with
 * whatever end-aligned items stayed in the bar. Every case above passes
 * `endItems={[]}`, so none of them exercises that.
 *
 * `docs/architecture.md` §5 documents the parts these pin — `align` picks a
 * region, lowest `priority` collapses first, and the button's width is read
 * back out of the DOM so it counts against the space available. That the
 * button sits in the end region rather than a region of its own is a fact
 * about the markup (`Overflow.tsx`), not something the docs promise.
 */
describe("OverflowBar with a non-empty end region", () => {
  const setUp = (width: number) => {
    containerWidth = width;
    restore = patchLayout();
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
  };

  it("collapses across both regions by priority, ignoring which region an item is in", () => {
    // Every item is 60 wide, the gap is 2 and the ⋮ button 28. At an
    // available 160 the two lowest priorities have to go — b (start, 1) then
    // e (end, 2) — and the sums are what force it:
    //   drop b:        3×60 + 2×2 + 2 + 28 = 214 > 160, so keep going
    //   drop b and e:  2×60 + 2   + 2 + 28 = 152 ≤ 160, so stop
    // (`remaining widths + inter-item gaps + one gap before the button + the
    // button`, which is the arithmetic in `computeOverflow`.)
    setUp(160);
    renderRegions([ext("a", 3), ext("b", 1)], [ext("d", 5), ext("e", 2)]);

    expect(regionIds("start")).toEqual(["a"]);
    expect(regionIds("end")).toEqual(["d"]);

    fireEvent.click(screen.getByRole("button", { name: "More developer toolbar items" }));
    // Menu order is start-region items then end-region items, matching the bar.
    expect(menuIds()).toEqual(["b", "e"]);
  });

  it("puts the ⋮ button in the end region, after the end items that stayed", () => {
    // 60 more room than above, and one item's worth of collapse now suffices:
    //   drop b: 3×60 + 2×2 + 2 + 28 = 214 ≤ 220, so e stays in the end region
    // next to the button, which is the arrangement this test is about.
    setUp(220);
    renderRegions([ext("a", 3), ext("b", 1)], [ext("d", 5), ext("e", 2)]);

    expect(regionIds("start")).toEqual(["a"]);
    expect(regionIds("end")).toEqual(["d", "e"]);

    const region = document.querySelector(
      '[data-dtb-part="region"][data-dtb-align="end"]',
    ) as HTMLElement;
    const button = document.querySelector('[data-dtb-part="overflow-button"]') as HTMLElement;
    expect(button.parentElement).toBe(region);
    expect(button.previousElementSibling).toBe(region.querySelector('[data-dtb-ext-id="e"]'));
    expect([...region.children].at(-1)).toBe(button);
  });

  it("collapses an end-only bar into a button that shares its own region", () => {
    // Two end items, nothing in the start region:
    //   as rendered: 2×60 + 2 = 122 > 100, so something must collapse
    //   drop e:      60 + 2 + 28 = 90 ≤ 100
    setUp(100);
    renderRegions([], [ext("d", 5), ext("e", 2)]);

    expect(regionIds("start")).toEqual([]);
    expect(regionIds("end")).toEqual(["d"]);
    expect(document.querySelector('[data-dtb-part="overflow-button"]')).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "More developer toolbar items" }));
    expect(menuIds()).toEqual(["e"]);
  });

  it("re-expands the end region and drops the button when the width returns", () => {
    // Starts from the 160 case above (b and e collapsed), then widens to 1000,
    // where all four fit in 4×60 + 3×2 = 246 and nothing collapses.
    setUp(160);
    renderRegions([ext("a", 3), ext("b", 1)], [ext("d", 5), ext("e", 2)]);
    expect(regionIds("end")).toEqual(["d"]);

    containerWidth = 1000;
    act(() => {
      for (const instance of MockResizeObserver.instances) instance.trigger();
    });

    expect(regionIds("start")).toEqual(["a", "b"]);
    expect(regionIds("end")).toEqual(["d", "e"]);
    expect(document.querySelector('[data-dtb-part="overflow-button"]')).toBeNull();
  });
});

/**
 * `clientWidth` is the bar's *padding box*, and both regions are always
 * rendered with the bar's `gap` between them. Neither is free space, so
 * neither may be filled with items.
 */
describe("OverflowBar available width", () => {
  it("keeps the bar's own horizontal padding out of the collapse math", () => {
    // a, b and c are 60 wide with a 2px gap: 3×60 + 2×2 = 184, which fits the
    // 190px padding box but not the 176px it leaves for items:
    //   190 − 6 − 6 (padding) − 2 (the empty end region's gap) = 176 < 184
    //   drop b: 2×60 + 2 + 2 + 28 = 152 ≤ 176, so one item is enough
    containerWidth = 190;
    restore = patchLayout();
    patchComputedStyle({ paddingX: 6, gap: 2 });
    vi.stubGlobal("ResizeObserver", MockResizeObserver);

    renderBar();

    const bar = document.querySelector('[data-dtb-part="bar"]')!;
    expect(
      [...bar.querySelectorAll('[data-dtb-part="region"] > [data-dtb-part="item"]')].map(
        (node) => (node as HTMLElement).dataset["dtbExtId"],
      ),
    ).toEqual(["a", "c"]);
    expect(document.querySelector('[data-dtb-part="overflow-button"]')).not.toBeNull();
  });

  it("charges that gap once every start item has collapsed out of the bar", () => {
    // Both regions hold items to begin with, so the flattened item math covers
    // the gap between them. Once b collapses the start region renders empty and
    // still takes that gap, which is enough to force d out too:
    //   as rendered:  3×60 + 2×2 = 184 > 153
    //   drop b:       2×60 + 2 + 2 + 28 = 152 ≤ 153, so the first pass stops
    //   start is now empty: 153 − 2 = 151 < 152, so the next pass continues
    //   drop b and d: 60 + 2 + 28 = 90 ≤ 151
    containerWidth = 153;
    restore = patchLayout();
    patchComputedStyle({ paddingX: 0, gap: 2 });
    vi.stubGlobal("ResizeObserver", MockResizeObserver);

    renderRegions([ext("b", 1)], [ext("d", 5), ext("e", 9)]);

    expect(regionIds("start")).toEqual([]);
    expect(regionIds("end")).toEqual(["e"]);

    fireEvent.click(screen.getByRole("button", { name: "More developer toolbar items" }));
    expect(menuIds()).toEqual(["b", "d"]);
  });

  it("charges the gap the empty region still takes between the two regions", () => {
    // End-only bar, no padding this time. `computeOverflow` charges one gap
    // between adjacent items — which covers the gap *between* the regions only
    // when both hold items. Here the empty start region takes one anyway:
    //   as rendered: 2×60 + 2 = 122 ≤ 123, but 123 − 2 = 121 < 122
    //   drop e:      60 + 2 + 28 = 90 ≤ 121
    containerWidth = 123;
    restore = patchLayout();
    patchComputedStyle({ paddingX: 0, gap: 2 });
    vi.stubGlobal("ResizeObserver", MockResizeObserver);

    renderRegions([], [ext("d", 5), ext("e", 2)]);

    expect(regionIds("end")).toEqual(["d"]);

    fireEvent.click(screen.getByRole("button", { name: "More developer toolbar items" }));
    expect(menuIds()).toEqual(["e"]);
  });
});

/**
 * The `⋮` popup is a disclosure, not an ARIA menu. Each entry is an
 * extension's own compact slot, which usually renders its own button, and a
 * `menuitem` may not contain interactive content — so the promise is the
 * disclosure one: `aria-expanded` and `aria-controls` on the button, focus
 * moved into the popup on open, Escape closing it and handing focus back.
 */
describe("OverflowBar ⋮ popup", () => {
  const setUp = () => {
    restore = patchLayout();
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
  };

  const renderCompact = (compact: (id: string) => ReactNode) =>
    render(
      <OverflowBar
        startItems={[
          { id: "a", label: "a", priority: 3, compact: () => compact("a") },
          { id: "b", label: "b", priority: 1, compact: () => compact("b") },
          { id: "c", label: "c", priority: 2, compact: () => compact("c") },
        ]}
        endItems={[]}
        renderItem={(extension, { isOverflowed }) => (
          <div key={extension.id} data-dtb-part="item" data-dtb-ext-id={extension.id}>
            {extension.compact?.({
              isOverflowed,
              isPanelOpen: false,
              density: "compact",
              openPanel: () => {},
              closePanel: () => {},
              togglePanel: () => {},
            })}
          </div>
        )}
      />,
    );

  const trigger = () => screen.getByRole("button", { name: "More developer toolbar items" });
  const popup = () => document.querySelector<HTMLElement>('[data-dtb-part="overflow-menu"]');

  it("points the ⋮ button at the popup it controls", () => {
    setUp();
    renderCompact((id) => <span>{id}</span>);

    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(trigger().getAttribute("aria-controls")).toBeNull();

    fireEvent.click(trigger());

    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(trigger().getAttribute("aria-controls")).toBe(popup()!.id);
    expect(popup()!.id).not.toBe("");
  });

  it("is a labelled group rather than an ARIA menu, since its entries hold buttons", () => {
    setUp();
    renderCompact((id) => (
      <button type="button">
        {"open "}
        {id}
      </button>
    ));

    fireEvent.click(trigger());

    expect(popup()!.getAttribute("role")).toBe("group");
    expect(popup()!.getAttribute("aria-label")).toBe("More developer toolbar items");
    expect(document.querySelectorAll('[role="menu"],[role="menuitem"]').length).toBe(0);
  });

  it("moves focus to the first focusable entry when it opens", () => {
    setUp();
    renderCompact((id) => (
      <button type="button">
        {"open "}
        {id}
      </button>
    ));

    fireEvent.click(trigger());

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "open b" }));
  });

  it("focuses the popup itself when nothing inside it can take focus", () => {
    setUp();
    renderCompact((id) => <span>{id}</span>);

    fireEvent.click(trigger());

    expect(document.activeElement).toBe(popup());
  });

  it("closes on Escape and hands focus back to the ⋮ button", () => {
    setUp();
    renderCompact((id) => (
      <button type="button">
        {"open "}
        {id}
      </button>
    ));

    fireEvent.click(trigger());
    expect(popup()).not.toBeNull();

    fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });

    expect(popup()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("closes on an outside click without pulling focus back", () => {
    setUp();
    renderCompact((id) => (
      <button type="button">
        {"open "}
        {id}
      </button>
    ));

    fireEvent.click(trigger());
    fireEvent.mouseDown(document.body);

    expect(popup()).toBeNull();
    expect(document.activeElement).not.toBe(trigger());
  });
});

/**
 * Original bug: `widthsRef` was written only by a dependency-less
 * `useLayoutEffect`, i.e. only on renders of `OverflowBar` itself, and the one
 * `ResizeObserver` watched the bar — which is fixed-height and full-width, so
 * it never fires for anything a chip does. A chip that re-rendered wider on its
 * own store change therefore grew invisibly: the cached width stayed stale and
 * the bar never collapsed, so the chip clipped or pushed the row.
 *
 * The item hosts are `flex: 0 0 auto; max-width: 100%`, so unlike the
 * flex-constrained region elements they really are content-sized and a
 * `ResizeObserver` on them reports the growth.
 */
describe("OverflowBar per-item width observation", () => {
  const setUp = (width: number) => {
    containerWidth = width;
    restore = patchLayout();
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
  };

  const idsInBar = () =>
    [...document.querySelectorAll('[data-dtb-part="region"] > [data-dtb-part="item"]')].map(
      (node) => (node as HTMLElement).dataset["dtbExtId"],
    );

  /**
   * Fires the observer watching the item hosts, and nothing else.
   *
   * `MockResizeObserver` has no geometry and `trigger()` ignores what the
   * observer is actually watching, so firing every instance would let an
   * implementation that *constructs* an item observer but never `observe()`s a
   * host still pass. Selecting by recorded target closes that, and firing the
   * bar's observer as well would hand the test to the `measureWidths` call in
   * `read()` instead of the item-observer path.
   */
  const fireItems = () => act(() => itemObserver()!.trigger());

  afterEach(() => {
    widths["a"] = 60;
  });

  it("collapses when a chip grows on its own tick — the bar's own box never changes, so only the item observer can see it", () => {
    // 1000px of bar, three 60px chips: nothing collapses.
    setUp(1000);
    renderBar();
    expect(idsInBar()).toEqual(["a", "b", "c"]);

    // `a` re-renders wider entirely on its own — no prop change, no render of
    // OverflowBar, no change to the bar's own box.
    //   available 1000 − 2 (the empty end region's gap) = 998
    //   as rendered: 900 + 60 + 60 + 2×2 = 1024 > 998
    //   drop b:      900 + 60 + 2 + 2 + 28 = 992 ≤ 998
    widths["a"] = 900;

    // Only the item observer fires. The bar's own box is unchanged, so in a
    // browser its observer stays silent — and firing it here would let the
    // `measureWidths` call in `read()` carry the test, proving nothing about
    // the item-observer path this case is named for.
    fireItems();

    expect(idsInBar()).toEqual(["a", "c"]);
    expect(document.querySelector('[data-dtb-part="overflow-button"]')).not.toBeNull();
  });

  it("observes the item hosts rather than the regions — a flex-constrained region does not resize when a child grows", () => {
    setUp(1000);
    renderBar();

    const hosts = [
      ...document.querySelectorAll('[data-dtb-part="region"] > [data-dtb-part="item"]'),
    ];
    expect(hosts).toHaveLength(3);
    expect([...itemObserver()!.targets]).toEqual(hosts);
    expect([...itemObserver()!.targets].map(part)).toEqual(["item", "item", "item"]);
    expect([...barObserver()!.targets].map(part)).toEqual(["bar"]);
  });

  it("keeps the observed set in step with the rendered item hosts as items collapse and return", () => {
    setUp(100);
    renderBar();

    // b and c collapsed into the popup; only `a` is still an item host in a
    // region, and the popup copies carry a different part name.
    const observed = () =>
      [...itemObserver()!.targets].map((node) => (node as HTMLElement).dataset["dtbExtId"]);
    expect(observed()).toEqual(["a"]);

    containerWidth = 1000;
    act(() => barObserver()!.trigger());

    expect(observed()).toEqual(["a", "b", "c"]);
  });

  it("stops letting item resizes drive the collapse after four flips — a chip sized by its container must not loop", () => {
    setUp(1000);
    renderBar();
    expect(idsInBar()).toEqual(["a", "b", "c"]);

    // A chip whose width depends on whether it is collapsed: the pathological
    // case the latch exists for. Only the *item* observer fires, because the
    // bar's own box is unchanged throughout — which is the whole premise.
    const flip = (width: number) => {
      widths["a"] = width;
      act(() => itemObserver()!.trigger());
      return idsInBar();
    };

    expect(flip(900)).toEqual(["a", "c"]); // flip 1
    expect(flip(60)).toEqual(["a", "b", "c"]); // flip 2
    expect(flip(900)).toEqual(["a", "c"]); // flip 3
    expect(flip(60)).toEqual(["a", "b", "c"]); // flip 4 — the bound

    // Latched: the callback returns *before* `measureWidths`, so past the bound
    // an item resize costs no DOM read at all, let alone a recompute.
    expect(flip(900)).toEqual(["a", "b", "c"]);
    expect(flip(60)).toEqual(["a", "b", "c"]);

    // The bar's own observer reporting a *new* width reopens the latch. Its
    // `read()` re-measures, which is where the width set during the latched
    // passes is finally picked up — the latched callbacks never read it.
    containerWidth = 999;
    widths["a"] = 900;
    act(() => barObserver()!.trigger());
    expect(idsInBar()).toEqual(["a", "c"]);
  });

  it("disconnects both observers on unmount", () => {
    setUp(1000);
    const { unmount } = renderBar();

    expect(itemObserver()).toBeDefined();
    const item = itemObserver()!;
    const bar = barObserver()!;

    unmount();

    expect(item.targets.size).toBe(0);
    expect(bar.targets.size).toBe(0);
  });

  it("renders everything and observes nothing where ResizeObserver is undefined", () => {
    containerWidth = 100;
    restore = patchLayout();
    vi.stubGlobal("ResizeObserver", undefined);

    renderBar();

    expect(MockResizeObserver.instances).toEqual([]);
    // The window-resize fallback still measures, so the collapse is real; what
    // must not exist is a polling timer keeping a dead host busy.
    expect(idsInBar()).toEqual(["a"]);
  });
});
