/**
 * The downstream-author view of the package.
 *
 * Nothing in this file reaches into `src/core/*` by relative path: it imports
 * `@nejcm/dev-toolbar` and `@nejcm/dev-toolbar/testing` exactly as a third-party
 * extension author would. Vitest maps those specifiers onto the entry modules
 * that `package.json#exports` publishes, so a missing or misnamed export shows
 * up here as a resolution failure.
 */
import { describe, expect, it, vi } from "vitest";
import { CONTRACT_VERSION, DevToolbarInset } from "@nejcm/dev-toolbar";
import type { DevToolbarExtension } from "@nejcm/dev-toolbar";
import { createMockBus, makeExtension, renderWithToolbar } from "@nejcm/dev-toolbar/testing";

describe("@nejcm/dev-toolbar/testing", () => {
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

  it("reports collapsed ids without opening the ··· menu (the documented snippet)", () => {
    // This is verbatim the snippet in README.md and plans/architecture.md. It
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
    expect(CONTRACT_VERSION).toBe(1);
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
