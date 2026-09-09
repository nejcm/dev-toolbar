/**
 * The downstream-author view of the package.
 *
 * Nothing in this file reaches into `src/core/*` by relative path: it imports
 * `@nejcm/dev-toolbar` and `@nejcm/dev-toolbar/testing` exactly as a third-party
 * extension author would. Vitest maps those specifiers onto the entry modules
 * that `package.json#exports` publishes, so a missing or misnamed export shows
 * up here as a resolution failure.
 */
import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_VERSION, DevToolbarInset } from "@nejcm/dev-toolbar";
import type { DevToolbarExtension } from "@nejcm/dev-toolbar";
import {
  cleanupToolbar,
  createMockBus,
  installToolbarLayout,
  makeExtension,
  mountToolbar,
  renderWithToolbar,
} from "@nejcm/dev-toolbar/testing";

describe("@nejcm/dev-toolbar/testing", () => {
  afterEach(cleanupToolbar);
  it("renders an extension the way its author would test it", () => {
    const counter: DevToolbarExtension = makeExtension({
      id: "counter",
      label: "Counter",
      compact: "12 ms",
      panel: "counter detail",
    });

    const { toolbar, unmount } = renderWithToolbar(<main>app</main>, {
      extensions: [counter],
    });

    expect(toolbar.root()).not.toBeNull();
    expect(toolbar.item("counter")?.textContent).toBe("12 ms");
    expect(toolbar.panel("counter")).toBeNull();

    toolbar.openPanel("counter");
    expect(toolbar.panel("counter")?.textContent).toContain("counter detail");
    expect(toolbar.activePanelId()).toBe("counter");

    toolbar.closePanel();
    expect(toolbar.panel("counter")).toBeNull();
    unmount();
  });

  it("keeps a keepMounted panel in the DOM while it is closed", () => {
    // The documented caveat on `panel()`: it answers presence, which is the
    // same thing as *open* for an ordinary panel — but a `keepMounted` one is
    // still there, `hidden`, after `closePanel()`. `activePanelId()` is the
    // question to ask when open is what you mean.
    const sticky: DevToolbarExtension = {
      ...makeExtension({ id: "sticky", label: "Sticky", panel: "sticky detail" }),
      keepMounted: true,
    };

    const { toolbar, unmount } = renderWithToolbar(null, { extensions: [sticky] });

    toolbar.openPanel("sticky");
    expect(toolbar.panel("sticky")?.hidden).toBe(false);

    toolbar.closePanel();
    expect(toolbar.activePanelId()).toBeNull();
    expect(toolbar.panel("sticky")).not.toBeNull();
    expect(toolbar.panel("sticky")?.hidden).toBe(true);
    unmount();
  });

  it("contains a throwing extension in an error chip", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { toolbar, unmount } = renderWithToolbar(null, {
      extensions: [
        makeExtension({ id: "ok", label: "OK" }),
        makeExtension({ id: "broken", label: "Broken", throwInCompact: true }),
      ],
    });

    expect(toolbar.errorChip("broken")?.textContent).toBe("Broken: error");
    expect(toolbar.item("ok")).not.toBeNull();
    expect(toolbar.bar()).not.toBeNull();

    error.mockRestore();
    unmount();
  });

  it("reports collapsed ids without opening the ⋮ menu (the documented snippet)", () => {
    // This is verbatim the snippet in README.md and docs/architecture.md. It
    // must keep working exactly as written — no openOverflow() first.
    const myExtension = makeExtension({
      id: "my-extension",
      label: "Mine",
      priority: 1,
    });

    const { toolbar, unmount } = renderWithToolbar(<div>App</div>, {
      extensions: [myExtension, makeExtension({ id: "pinned", label: "Pinned", priority: 100 })],
      layout: { barWidth: 600, itemWidth: 80 },
    });

    toolbar.openPanel("my-extension");
    expect(toolbar.panel("my-extension")).toBeNull(); // no panel slot declared

    toolbar.resize(160);
    expect(toolbar.overflowedIds()).toContain("my-extension");
    expect(toolbar.isOverflowed("my-extension")).toBe(true);
    expect(toolbar.isOverflowed("pinned")).toBe(false);
    // The menu is still closed, so the collapsed item is genuinely not in the DOM.
    expect(toolbar.overflowMenu()).toBeNull();
    expect(toolbar.item("my-extension")).toBeNull();

    // …and it appears once the menu is opened.
    toolbar.openOverflow();
    expect(toolbar.item("my-extension")).not.toBeNull();
    expect(toolbar.overflowedIds()).toContain("my-extension");

    unmount();
  });

  it("collapses low-priority items under a measured layout", () => {
    const extensions = [
      makeExtension({ id: "high", label: "high", priority: 100 }),
      makeExtension({ id: "mid", label: "mid", priority: 50 }),
      makeExtension({ id: "low", label: "low", priority: 1 }),
    ];

    const { toolbar, unmount } = renderWithToolbar(null, {
      extensions,
      layout: { barWidth: 1000, itemWidth: 100 },
    });

    expect(toolbar.barIds()).toEqual(["high", "mid", "low"]);
    expect(toolbar.overflowButton()).toBeNull();

    toolbar.resize(150);
    expect(toolbar.barIds()).toEqual(["high"]);

    expect(toolbar.overflowedIds().sort()).toEqual(["low", "mid"]);
    toolbar.openOverflow();
    expect(toolbar.overflowedIds().sort()).toEqual(["low", "mid"]);

    toolbar.resize(1000);
    expect(toolbar.barIds()).toEqual(["high", "mid", "low"]);
    unmount();
  });

  it("accounts for padding and gap when collapsing a mounted toolbar", () => {
    const { toolbar } = mountToolbar(null, {
      extensions: [
        makeExtension({ id: "high", label: "high", priority: 100 }),
        makeExtension({ id: "mid", label: "mid", priority: 50 }),
        makeExtension({ id: "low", label: "low", priority: 1 }),
      ],
      layout: { barWidth: 220, itemWidth: 60, paddingX: 12, gap: 8 },
    });

    expect(toolbar.barIds()).toEqual(["high", "mid"]);
    expect(toolbar.overflowedIds()).toEqual(["low"]);
    toolbar.resize(228);
    expect(toolbar.barIds()).toEqual(["high", "mid", "low"]);
    expect(toolbar.overflowButton()).toBeNull();
  });

  it.each([
    { gap: undefined, collapsed: ["low"] },
    { gap: 0, collapsed: [] },
  ])("preserves the default collapse threshold with gap=$gap", ({ gap, collapsed }) => {
    const geometry = { barWidth: 160, itemWidth: 80 };
    const { toolbar } = mountToolbar(null, {
      extensions: [
        makeExtension({ id: "high", priority: 100 }),
        makeExtension({ id: "low", priority: 1 }),
      ],
      layout: gap === undefined ? geometry : { ...geometry, gap },
    });
    expect(toolbar.overflowedIds()).toEqual(collapsed);
  });

  it("drives item-only growth through cycle detection and reopens it with a bar resize", () => {
    const layout = installToolbarLayout({ barWidth: 1000, itemWidth: 60, paddingX: 0, gap: 2 });
    const { toolbar } = mountToolbar(null, {
      extensions: [
        makeExtension({ id: "a", priority: 3 }),
        makeExtension({ id: "b", priority: 1 }),
        makeExtension({ id: "c", priority: 2 }),
      ],
    });
    const observers = layout.getObservers();
    const items = observers.find((observer) => observer.getTargets().includes(toolbar.item("a")!))!;
    const bar = observers.find((observer) => observer.getTargets().includes(toolbar.bar()!))!;
    const flip = (width: number) => {
      layout.setItemWidth("a", width, false);
      act(() => items.flush());
      return toolbar.barIds();
    };

    // `a` is wider in the bar than beside a collapsed `b`, so there is no
    // fixed point. Cycle detection settles it on the side that fits:
    //   available: 1000 − 2 (the empty end region's gap) = 998
    //   a at 900, all three in the bar: 900 + 60 + 60 + 2×2 = 1024 > 998
    //   a at 900, b collapsed:         900 + 60 + 2 + 2 + 28 = 992 ≤ 998
    // A return to the state that does not fit is refused, however many
    // deliveries ask for it.
    expect(flip(900)).toEqual(["a", "c"]);
    expect(flip(60)).toEqual(["a", "c"]);
    expect(flip(900)).toEqual(["a", "c"]);
    expect(flip(60)).toEqual(["a", "c"]);

    // Genuine growth is not a return, so it is still heard while settled:
    //   a at 950, b and c collapsed: 950 + 2 + 28 = 980 ≤ 998
    expect(flip(950)).toEqual(["a"]);

    layout.setItemWidth("a", 900, false);
    layout.resize(999, false);
    act(() => bar.flush());
    expect(toolbar.barIds()).toEqual(["a", "c"]);
  });

  it("inspects actual item hosts as they collapse, return and disconnect", () => {
    const layout = installToolbarLayout({ barWidth: 1000, itemWidth: 60, paddingX: 0, gap: 2 });
    const { toolbar, unmount } = mountToolbar(null, {
      extensions: [
        makeExtension({ id: "a", priority: 3 }),
        makeExtension({ id: "b", priority: 1 }),
        makeExtension({ id: "c", priority: 2 }),
      ],
    });
    const observers = layout.getObservers();
    const items = observers.find((observer) => observer.getTargets().includes(toolbar.item("a")!))!;
    const bar = observers.find((observer) => observer.getTargets().includes(toolbar.bar()!))!;
    const hosts = () =>
      Array.from(
        toolbar.bar()!.querySelectorAll('[data-dtb-part="region"] > [data-dtb-part="item"]'),
      );
    expect(items.getTargets()).toEqual(hosts());
    expect(items.getTargets()).toHaveLength(3);
    expect(bar.getTargets()).toEqual([toolbar.bar()]);

    layout.resize(100, false);
    act(() => bar.flush());
    expect(items.getTargets()).toEqual([toolbar.item("a")]);
    expect(items.getTargets()).toEqual(hosts());
    layout.resize(1000, false);
    act(() => bar.flush());
    expect(items.getTargets()).toEqual(hosts());
    expect(items.getTargets()).toHaveLength(3);

    unmount();
    expect(items.getTargets()).toEqual([]);
    expect(bar.getTargets()).toEqual([]);
    expect(layout.getObservers()).toEqual(observers);
  });

  it("publishes --dev-toolbar-height and drives DevToolbarInset", () => {
    const { toolbar, container, unmount } = renderWithToolbar(
      <DevToolbarInset data-testid="inset">content</DevToolbarInset>,
      { layout: { rootHeight: 30 } },
    );

    expect(toolbar.height()).toBe("30px");
    const inset = container.querySelector<HTMLElement>('[data-dtb-part="inset"]');
    expect(inset?.style.paddingBottom).toBe(
      "var(--dev-toolbar-height-test, var(--dev-toolbar-height, 0px))",
    );

    toolbar.setVisible(false);
    expect(toolbar.root()).toBeNull();
    expect(inset?.style.paddingBottom).toBe("0px");
    unmount();
  });

  it("round-trips preferences through the injected storage adapter", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    };

    const first = renderWithToolbar(null, {
      storage,
      instanceId: "app",
      extensions: [makeExtension({ id: "p", label: "P", panel: true })],
    });
    first.toolbar.openPanel("p");
    first.toolbar.setPosition("top");
    first.toolbar.setPanelHeight(420);
    first.unmount();

    expect([...map.keys()].every((key) => key.startsWith("dtb:v1:app:"))).toBe(true);

    const second = renderWithToolbar(null, {
      storage,
      instanceId: "app",
      extensions: [makeExtension({ id: "p", label: "P", panel: true })],
    });
    expect(second.toolbar.activePanelId()).toBe("p");
    expect(second.toolbar.position()).toBe("top");
    expect(second.toolbar.panelHeight()).toBe(420);
    second.unmount();
  });

  it("exposes the contract version the extension author compiles against", () => {
    expect(CONTRACT_VERSION).toBe(2);
  });

  it("drives a collector with the mock bus's controllable clock", () => {
    const bus = createMockBus({ now: 1_000 });
    const seen: number[] = [];
    bus.on<number>("tick", (value) => seen.push(value));

    let ticks = 0;
    const stop = bus.clock.setInterval(() => {
      ticks += 1;
      bus.emit("tick", ticks);
    }, 100);

    expect(seen).toEqual([]);
    bus.clock.advance(250);
    expect(seen).toEqual([1, 2]);
    expect(bus.events("tick").map((event) => event.at)).toEqual([1_100, 1_200]);

    stop();
    bus.clock.advance(1_000);
    expect(seen).toEqual([1, 2]);
    expect(bus.clock.now()).toBe(2_250);
    expect(bus.clock.pending()).toBe(0);
  });
});
