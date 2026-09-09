import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DevToolbarExtension } from "../contract";
import { OverflowBar } from "../Overflow";
import { installToolbarLayout, type ToolbarLayoutHandle } from "@nejcm/dev-toolbar/testing";

const part = (node: Element) => (node as HTMLElement).dataset["dtbPart"];
let layout: ToolbarLayoutHandle | undefined;

// 60px items, 2px gap, no button measurement so core keeps its 28px fallback.
const layoutOf = (barWidth: number, paddingX = 0) =>
  installToolbarLayout({ barWidth, itemWidth: 60, overflowButtonWidth: 0, paddingX, gap: 2 });

/**
 * Select by targets so constructing an observer without observing hosts cannot pass.
 * Item-resize tests flush only the item observer: firing the bar would let
 * `measureWidths` in `read()` carry the test instead of the item-observer path.
 */
const observerOf = (targetPart: "item" | "bar") =>
  layout!
    .getObservers()
    .find((observer) => observer.getTargets().some((target) => part(target) === targetPart))!;

afterEach(() => {
  // Unstub first: `restore()` deletes the fake ResizeObserver, and a later
  // `unstubAllGlobals()` would put it straight back with no install behind it.
  vi.unstubAllGlobals();
  layout?.restore();
  layout = undefined;
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
    layout = layoutOf(100);

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
    layout = layoutOf(1000);

    renderBar();

    const idsInBar = () =>
      [...document.querySelectorAll('[data-dtb-part="region"] > [data-dtb-part="item"]')].map(
        (node) => (node as HTMLElement).dataset["dtbExtId"],
      );

    expect(idsInBar()).toEqual(["a", "b", "c"]);

    const resize = (width: number) => {
      act(() => layout!.resize(width));
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
    layout = layoutOf(100);

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
    layout = layoutOf(1000);

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
    layout = layoutOf(width);
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

    act(() => layout!.resize(1000));

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
    layout = layoutOf(190, 6);

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
    layout = layoutOf(153);

    renderRegions([ext("b", 1)], [ext("d", 5), ext("e", 9)]);

    expect(regionIds("start")).toEqual([]);
    expect(regionIds("end")).toEqual(["e"]);

    fireEvent.click(screen.getByRole("button", { name: "More developer toolbar items" }));
    expect(menuIds()).toEqual(["b", "d"]);
  });

  it("recollapses when --dtb-padding-x is overridden after mount, because the bar's own reading carries it", () => {
    // The bar's padding is read back out of the DOM on every reading of the
    // bar, not once at mount: a `--dtb-padding-x` override applied later is
    // the bar's own box changing, and the collapse math has to follow it.
    //   200 − 2 (the empty end region's gap) = 198 ≥ 3×60 + 2×2 = 184
    layout = layoutOf(200);
    renderBar();
    expect(regionIds("start")).toEqual(["a", "b", "c"]);

    // 40 a side. Nothing resizes an item and the padding box is unchanged, so
    // the only reading that can see this is the bar's own — which now reports
    // its padding alongside its width.
    //   200 − 80 (padding) − 2 = 118 < 184
    //   drop b:       2×60 + 2 + 2 + 28 = 152 > 118, so one item is not enough
    //   drop b and c: 60 + 2 + 28 = 90 ≤ 118
    act(() => layout!.setPaddingX(40));

    expect(regionIds("start")).toEqual(["a"]);
    fireEvent.click(screen.getByRole("button", { name: "More developer toolbar items" }));
    expect(menuIds()).toEqual(["b", "c"]);

    // And back: the override is a live reading, not a one-way ratchet.
    act(() => layout!.setPaddingX(0));
    expect(regionIds("start")).toEqual(["a", "b", "c"]);
    expect(document.querySelector('[data-dtb-part="overflow-button"]')).toBeNull();
  });

  it("recollapses when a bar reading sees a --dtb-item-gap override after mount", () => {
    layout = layoutOf(200);
    renderBar();
    expect(regionIds("start")).toEqual(["a", "b", "c"]);

    // A wider gap costs the items twice over: once between each adjacent pair,
    // and once for the gap the empty end region still takes.
    //   200 − 30 = 170 < 3×60 + 2×30 = 240
    //   drop b:       2×60 + 30 + 30 + 28 = 208 > 170
    //   drop b and c: 60 + 30 + 28 = 118 ≤ 170
    act(() => layout!.setGap(30));

    expect(regionIds("start")).toEqual(["a"]);
    fireEvent.click(screen.getByRole("button", { name: "More developer toolbar items" }));
    expect(menuIds()).toEqual(["b", "c"]);

    act(() => layout!.setGap(2));
    expect(regionIds("start")).toEqual(["a", "b", "c"]);
  });

  it("charges the gap the empty region still takes between the two regions", () => {
    // End-only bar, no padding this time. `computeOverflow` charges one gap
    // between adjacent items — which covers the gap *between* the regions only
    // when both hold items. Here the empty start region takes one anyway:
    //   as rendered: 2×60 + 2 = 122 ≤ 123, but 123 − 2 = 121 < 122
    //   drop e:      60 + 2 + 28 = 90 ≤ 121
    layout = layoutOf(123);

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
    layout = layoutOf(100);
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
    layout = layoutOf(width);
  };

  const idsInBar = () =>
    [...document.querySelectorAll('[data-dtb-part="region"] > [data-dtb-part="item"]')].map(
      (node) => (node as HTMLElement).dataset["dtbExtId"],
    );

  it("collapses when a chip grows on its own tick — the bar's own box never changes, so only the item observer can see it", () => {
    // 1000px of bar, three 60px chips: nothing collapses.
    setUp(1000);
    renderBar();
    const item = observerOf("item");
    expect(idsInBar()).toEqual(["a", "b", "c"]);

    // `a` re-renders wider entirely on its own — no prop change, no render of
    // OverflowBar, no change to the bar's own box.
    //   available 1000 − 2 (the empty end region's gap) = 998
    //   as rendered: 900 + 60 + 60 + 2×2 = 1024 > 998
    //   drop b:      900 + 60 + 2 + 2 + 28 = 992 ≤ 998
    layout!.setItemWidth("a", 900, false);

    // Only the item observer fires. The bar's own box is unchanged, so in a
    // browser its observer stays silent — and firing it here would let the
    // `measureWidths` call in `read()` carry the test, proving nothing about
    // the item-observer path this case is named for.
    act(() => item.flush());

    expect(idsInBar()).toEqual(["a", "c"]);
    expect(document.querySelector('[data-dtb-part="overflow-button"]')).not.toBeNull();
  });

  it("observes the item hosts and both regions — neither box alone sees every change", () => {
    setUp(1000);
    renderBar();
    const item = observerOf("item");
    const bar = observerOf("bar");

    // The hosts, because a flex-constrained region does not resize when a
    // child grows. The regions, because the gap is taken out of them: an item
    // is `max-width: 100%` of its region, so several hosts sharing one keep
    // their widths while a wider gap shrinks the region under them.
    const hosts = [
      ...document.querySelectorAll('[data-dtb-part="region"] > [data-dtb-part="item"]'),
    ];
    const regions = [...document.querySelectorAll('[data-dtb-part="region"]')];
    expect(hosts).toHaveLength(3);
    expect(regions).toHaveLength(2);
    expect([...item.getTargets()]).toEqual([...hosts, ...regions]);
    expect([...item.getTargets()].map(part)).toEqual(["item", "item", "item", "region", "region"]);
    expect([...bar.getTargets()].map(part)).toEqual(["bar"]);
  });

  it("keeps the observed set in step with the rendered item hosts as items collapse and return", () => {
    setUp(100);
    renderBar();
    const item = observerOf("item");
    const bar = observerOf("bar");

    // b and c collapsed into the popup; only `a` is still an item host in a
    // region, and the popup copies carry a different part name. The two
    // regions stay observed throughout — they are not roster-dependent.
    const observed = () =>
      [...item.getTargets()]
        .filter((node) => part(node) === "item")
        .map((node) => (node as HTMLElement).dataset["dtbExtId"]);
    const regionsObserved = () => [...item.getTargets()].filter((n) => part(n) === "region").length;
    expect(observed()).toEqual(["a"]);
    expect(regionsObserved()).toBe(2);

    layout!.resize(1000, false);
    act(() => bar.flush());

    expect(observed()).toEqual(["a", "b", "c"]);
    expect(regionsObserved()).toBe(2);
  });

  it("settles a chip sized by its own collapse on the decision that fits, and still hears it grow for real", () => {
    setUp(1000);
    renderBar();
    const item = observerOf("item");
    const bar = observerOf("bar");
    expect(idsInBar()).toEqual(["a", "b", "c"]);

    // A chip whose width depends on whether it is collapsed: the pathological
    // case cycle detection exists for, with no fixed point to settle on. Only
    // the *item* observer fires, because the bar's own box is unchanged
    // throughout — which is the whole premise.
    //   available: 1000 − 2 (the empty end region's gap) = 998
    //   a at 900, everything in the bar: 900 + 60 + 60 + 2×2 = 1024 > 998
    //   a at 900, b collapsed:          900 + 60 + 2 + 2 + 28 = 992 ≤ 998
    const flip = (width: number) => {
      layout!.setItemWidth("a", width, false);
      act(() => item.flush());
      return idsInBar();
    };

    expect(flip(900)).toEqual(["a", "c"]);

    // The other half of the 2-cycle is a *return* to a decision already held
    // since the bar last reported its own width, while the one in hand fits.
    // That is the cycle, and it is refused — so the bar settles on the side
    // that fits rather than on whichever side a flip count happened to land
    // on, and no further delivery moves it.
    expect(flip(60)).toEqual(["a", "c"]);
    expect(flip(900)).toEqual(["a", "c"]);
    expect(flip(60)).toEqual(["a", "c"]);

    // Settled is not frozen. A chip that genuinely *grows* never returns to a
    // decision already held, so it is heard even mid-cycle — the case a flat
    // flip count could not tell from the cycle, and where it left 314px of
    // chips clipped in a bar with no `⋮` to reach them.
    //   a at 950, b collapsed:      950 + 60 + 2 + 2 + 28 = 1042 > 998
    //   a at 950, b and c collapsed: 950 + 2 + 28 = 980 ≤ 998
    expect(flip(950)).toEqual(["a"]);

    // The bar's own observer reporting a new width forgets the cycle outright,
    // and its `read()` re-measures — which is where a width set during the
    // refused passes is finally acted on.
    layout!.resize(999, false);
    layout!.setItemWidth("a", 900, false);
    act(() => bar.flush());
    expect(idsInBar()).toEqual(["a", "c"]);
  });

  it("terminates on the decision that fits when a chip's width changes synchronously with the collapse — the case no observer delivery separates", () => {
    setUp(1000);
    renderBar();
    const item = observerOf("item");
    const bar = observerOf("bar");
    expect(idsInBar()).toEqual(["a", "b", "c"]);

    // `a` is 900 wide exactly while `b` is in the bar and 60 once `b` has
    // collapsed: measurably different on the very next layout, with no
    // ResizeObserver delivery in between. Before the layout effect's readings
    // were filtered too this looped straight into React's "Maximum update
    // depth exceeded" and an unmounted tree. An instance getter, so the fake
    // layout in `src/testing/layout.ts` is untouched.
    const host = document.querySelector<HTMLElement>('[data-dtb-ext-id="a"]')!;
    Object.defineProperty(host, "offsetWidth", {
      configurable: true,
      get: () =>
        document.querySelector('[data-dtb-part="region"] > [data-dtb-ext-id="b"]') ? 900 : 60,
    });

    // One delivery starts it, and it converges inside the act: ∅ → {b} → ∅ →
    // {b}, and the next return to ∅ is refused because ∅ was already held and
    // {b} fits (992 ≤ 998, against 1024 > 998 for everything in the bar).
    act(() => item.flush());
    expect(idsInBar()).toEqual(["a", "c"]);

    // Settled: more deliveries change nothing, and the tree is still mounted.
    act(() => item.flush());
    expect(idsInBar()).toEqual(["a", "c"]);

    // The bar's own observer forgets the cycle, so the loop runs again — and
    // lands on the fitting side again (992 ≤ 997 at the narrower bar).
    layout!.resize(999, false);
    act(() => bar.flush());
    expect(idsInBar()).toEqual(["a", "c"]);
    expect(document.querySelector('[data-dtb-part="bar"]')).not.toBeNull();
  });

  it("disconnects both observers on unmount", () => {
    setUp(1000);
    const { unmount } = renderBar();
    const item = observerOf("item");
    const bar = observerOf("bar");

    expect(item).toBeDefined();

    unmount();

    expect(item.getTargets().length).toBe(0);
    expect(bar.getTargets().length).toBe(0);
  });

  it("renders everything and observes nothing where ResizeObserver is undefined", () => {
    layout = layoutOf(100);
    vi.stubGlobal("ResizeObserver", undefined);

    renderBar();

    expect(layout!.getObservers()).toEqual([]);
    // The window-resize fallback still measures, so the collapse is real; what
    // must not exist is a polling timer keeping a dead host busy.
    expect(idsInBar()).toEqual(["a"]);
  });
});
