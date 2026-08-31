import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DevToolbarExtension } from "../contract";
import { Bar, sortExtensions } from "../Bar";

const ext = (
  id: string,
  overrides: Partial<DevToolbarExtension> = {},
): DevToolbarExtension => ({
  id,
  label: id,
  compact: () => <span data-testid={`compact-${id}`}>{id}</span>,
  ...overrides,
});

const ids = (list: readonly DevToolbarExtension[]) =>
  list.map((extension) => extension.id);

describe("sortExtensions", () => {
  it("splits by align and sorts by order", () => {
    const { start, end } = sortExtensions([
      ext("c", { order: 2 }),
      ext("z", { align: "end", order: 1 }),
      ext("a", { order: -1 }),
      ext("y", { align: "end", order: -5 }),
      ext("b"),
    ]);
    expect(ids(start)).toEqual(["a", "b", "c"]);
    expect(ids(end)).toEqual(["y", "z"]);
  });

  it("defaults align to start and order to 0, keeping insertion order on ties", () => {
    const { start, end } = sortExtensions([ext("one"), ext("two"), ext("three")]);
    expect(ids(start)).toEqual(["one", "two", "three"]);
    expect(end).toEqual([]);
  });

  it("drops hidden extensions", () => {
    const { start } = sortExtensions([ext("a"), ext("b", { hidden: true })]);
    expect(ids(start)).toEqual(["a"]);
  });
});

describe("Bar", () => {
  const renderBar = (extensions: DevToolbarExtension[]) =>
    render(
      <Bar
        extensions={extensions}
        density="compact"
        activePanelId={null}
        openPanel={vi.fn()}
        closePanel={vi.fn()}
        togglePanel={vi.fn()}
      />,
    );

  it("renders items into their align regions in order", () => {
    renderBar([
      ext("second", { order: 2 }),
      ext("first", { order: 1 }),
      ext("right", { align: "end" }),
    ]);

    const start = document.querySelector('[data-dtb-align="start"]');
    const end = document.querySelector('[data-dtb-align="end"]');
    expect(
      [...start!.querySelectorAll("[data-dtb-ext-id]")].map(
        (node) => (node as HTMLElement).dataset["dtbExtId"],
      ),
    ).toEqual(["first", "second"]);
    expect(
      [...end!.querySelectorAll("[data-dtb-ext-id]")].map(
        (node) => (node as HTMLElement).dataset["dtbExtId"],
      ),
    ).toEqual(["right"]);
  });

  it("falls back to a label trigger when the extension has no compact slot", () => {
    renderBar([{ id: "plain", label: "Plain", panel: () => <div /> }]);
    expect(screen.getByRole("button", { name: "Plain" })).toBeTruthy();
  });
});
