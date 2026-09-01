import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

const widths: Record<string, number> = { a: 60, b: 60, c: 60, d: 60 };
let containerWidth = 100;

const patchLayout = () => {
  const offset = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetWidth",
  );
  const client = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  );
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

class MockResizeObserver implements ResizeObserver {
  static instances: MockResizeObserver[] = [];
  constructor(private readonly callback: ResizeObserverCallback) {
    MockResizeObserver.instances.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  trigger(): void {
    this.callback([], this);
  }
}

let restore: (() => void) | null = null;

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

describe("OverflowBar", () => {
  it("collapses low-priority items into the ··· menu when space runs out", () => {
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
      [
        ...document.querySelectorAll(
          '[data-dtb-part="region"] > [data-dtb-part="item"]',
        ),
      ].map((node) => (node as HTMLElement).dataset["dtbExtId"]);

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
    expect(
      document.querySelector('[data-dtb-part="overflow-button"]'),
    ).not.toBeNull();

    // Widen again: sticky cached widths let the collapsed items come back even
    // though they were not in the DOM to be measured while collapsed.
    resize(1000);
    expect(idsInBar()).toEqual(["a", "b", "c"]);
    expect(
      document.querySelector('[data-dtb-part="overflow-button"]'),
    ).toBeNull();
  });

  it("dismisses the ··· menu on Escape and on an outside click", () => {
    restore = patchLayout();
    vi.stubGlobal("ResizeObserver", MockResizeObserver);

    renderBar();

    const open = () =>
      fireEvent.click(
        screen.getByRole("button", { name: "More developer toolbar items" }),
      );
    const menu = () => document.querySelector('[data-dtb-part="overflow-menu"]');

    open();
    expect(menu()).not.toBeNull();
    expect(
      menu()!.querySelectorAll('[role="menuitem"]').length,
    ).toBe(2);

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
    expect(
      document.querySelector('[data-dtb-part="overflow-button"]'),
    ).toBeNull();
  });
});
