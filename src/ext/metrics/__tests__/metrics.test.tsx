/**
 * `/ext/metrics` against the real shell — the contract's pressure test.
 *
 * Everything here goes through `@nejcm/dev-toolbar/testing`, the same surface a
 * stranger writing an extension would use.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { cleanupToolbar, mountToolbar } from "@nejcm/dev-toolbar/testing";
import { metrics } from "../index";

const memoryRead = () => ({
  usedJSHeapSize: 48 * 1024 * 1024,
  totalJSHeapSize: 64 * 1024 * 1024,
  jsHeapSizeLimit: 128 * 1024 * 1024,
});

const mount = (options: Parameters<typeof metrics>[0] = {}) => {
  const extension = metrics({
    only: ["memory"],
    memory: { read: memoryRead, sampleMs: 50 },
    ...options,
  });
  const result = mountToolbar(null, {
    extensions: [extension],
    layout: { barWidth: 900, itemWidth: 200 },
  });
  return { extension, ...result };
};

afterEach(cleanupToolbar);

describe("metrics extension in the bar", () => {
  it("renders a live chip whose value comes from the collector", () => {
    const { toolbar } = mount();
    const item = toolbar.item("metrics");
    expect(item).not.toBeNull();
    expect(item?.querySelector('[data-dtb-part="metrics-label"]')?.textContent).toBe("mem");
    expect(item?.querySelector('[data-dtb-part="metrics-value"]')?.textContent).toBe("48 MB");
    // 48/128 = 37.5% of the limit.
    expect(
      item?.querySelector('[data-dtb-part="metrics-chip"]')?.getAttribute("data-dtb-severity"),
    ).toBe("ok");
  });

  it("injects its stylesheet once, keyed on the DOM", () => {
    mount();
    mount({ id: "metrics-2" });
    expect(
      document.head.querySelectorAll('style[data-dev-toolbar-styles="ext-metrics"]').length,
    ).toBe(1);
  });

  it("honours injectStyles: false", () => {
    document.head
      .querySelectorAll('style[data-dev-toolbar-styles="ext-metrics"]')
      .forEach((node) => node.remove());
    mount({ injectStyles: false });
    expect(document.head.querySelector('style[data-dev-toolbar-styles="ext-metrics"]')).toBeNull();
  });

  it("toggles its own panel from the chip, through CompactSlotProps.togglePanel", () => {
    const { toolbar } = mount();
    const trigger = toolbar
      .item("metrics")
      ?.querySelector<HTMLButtonElement>('[data-dtb-part="trigger"]');
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");

    act(() => trigger?.click());
    expect(toolbar.activePanelId()).toBe("metrics");
    expect(toolbar.panel("metrics")).not.toBeNull();

    act(() =>
      toolbar
        .item("metrics")
        ?.querySelector<HTMLButtonElement>('[data-dtb-part="trigger"]')
        ?.click(),
    );
    expect(toolbar.activePanelId()).toBeNull();
  });

  it("renders the panel with a sparkline and detail rows", () => {
    const { toolbar } = mount();
    toolbar.openPanel("metrics");
    const panel = toolbar.panel("metrics");
    expect(panel?.querySelector('[data-dtb-part="metrics-headline-value"]')?.textContent).toBe(
      "48 MB",
    );
    expect(panel?.querySelector('[data-dtb-part="metrics-sparkline"]')).not.toBeNull();
    const labels = [...(panel?.querySelectorAll('[data-dtb-part="metrics-rows"] dt') ?? [])].map(
      (node) => node.textContent,
    );
    expect(labels).toContain("Heap limit");
    expect(labels).toContain("Share of limit");
  });

  it("spells the metrics out when it collapses into the ··· menu", () => {
    const { toolbar } = mount({ only: ["memory", "jank"] });
    toolbar.resize(60);
    expect(toolbar.isOverflowed("metrics")).toBe(true);
    toolbar.openOverflow();
    const rows = toolbar.overflowMenu()?.querySelectorAll('[data-dtb-part="metrics-overflow-row"]');
    expect(rows?.length).toBe(2);
    expect(rows?.[0]?.textContent).toContain("Memory");
  });

  it("contributes its commands to the core aggregate", async () => {
    const { toolbar } = mount();
    expect(toolbar.context().commands.map((command) => command.id)).toEqual([
      "metrics.reset",
      "metrics.copy",
    ]);
    await expect(toolbar.runCommand("metrics.reset")).resolves.toBe(true);
  });

  it("degrades a Chromium-only metric to NA without breaking the chip", () => {
    const { toolbar } = mount({ memory: { read: () => null } });
    const item = toolbar.item("metrics");
    expect(toolbar.errorChip("metrics")).toBeNull();
    expect(item?.querySelector('[data-dtb-part="metrics-value"]')?.textContent).toBe("NA");
    expect(
      item?.querySelector('[data-dtb-part="metrics-chip"]')?.getAttribute("data-dtb-severity"),
    ).toBe("unknown");

    toolbar.openPanel("metrics");
    expect(toolbar.panel("metrics")?.textContent).toContain("unsupported here");
  });

  it("survives being mounted with every metric switched off", () => {
    const { toolbar } = mount({ only: [] });
    expect(toolbar.errorChip("metrics")).toBeNull();
    toolbar.openPanel("metrics");
    expect(toolbar.panel("metrics")).not.toBeNull();
  });
});

describe("metrics lifecycle against the shell", () => {
  it("keeps collecting while the bar is hidden — core reports, never pauses", () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn(memoryRead);
      const { toolbar } = mount({ memory: { read, sampleMs: 20 } });
      toolbar.setVisible(false);
      const before = read.mock.calls.length;
      vi.advanceTimersByTime(200);
      expect(read.mock.calls.length).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never starts when the consumer marked it hidden", () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn(memoryRead);
      mount({ hidden: true, memory: { read, sampleMs: 20 } });
      const atMount = read.mock.calls.length;
      vi.advanceTimersByTime(500);
      // One call happens in the factory to probe support; nothing after that.
      expect(read.mock.calls.length).toBe(atMount);
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers a restricted actor no chip, no panel and no copy command", () => {
    const { toolbar } = mount({ hidden: true });
    expect(toolbar.item("metrics")).toBeNull();
    toolbar.openPanel("metrics");
    expect(toolbar.panel("metrics")).toBeNull();
    // The command is the back door that "just not rendering it" leaves open:
    // metrics.copy puts the request table on the clipboard.
    expect(toolbar.context().commands).toEqual([]);
  });

  it("stops sampling when the toolbar unmounts", () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn(memoryRead);
      const { unmount } = mount({ memory: { read, sampleMs: 20 } });
      vi.advanceTimersByTime(100);
      unmount();
      const after = read.mock.calls.length;
      vi.advanceTimersByTime(500);
      expect(read.mock.calls.length).toBe(after);
    } finally {
      vi.useRealTimers();
    }
  });
});

/*
 * A1 regression: metrics tabs were plain buttons with no ids, aria-controls,
 * roving tabindex, arrow-key focus, or a labelled tabpanel.
 */
describe("accessibility", () => {
  it("wires tabs to the panel, roves tabindex, and moves focus on arrow keys", () => {
    const { toolbar } = mount({
      only: ["memory", "jank"],
      memory: { read: memoryRead, sampleMs: 50 },
    });
    act(() => toolbar.openPanel("metrics"));
    const panel = toolbar.panel("metrics");
    const tabs = () => [
      ...(panel?.querySelectorAll<HTMLButtonElement>('[data-dtb-part="metrics-tab"]') ?? []),
    ];
    const tabpanel = panel?.querySelector<HTMLElement>('[role="tabpanel"]');

    expect(tabs()).toHaveLength(2);

    for (const tab of tabs()) {
      expect(tab.id).not.toBe("");
      expect(tab.getAttribute("aria-controls")).toBe(tabpanel?.id);
    }
    expect(tabpanel?.getAttribute("aria-labelledby")).toBe(tabs()[0]?.id);

    const [memory, jank] = tabs();
    expect(memory?.getAttribute("aria-selected")).toBe("true");
    expect(memory?.tabIndex).toBe(0);
    expect(jank?.getAttribute("aria-selected")).toBe("false");
    expect(jank?.tabIndex).toBe(-1);

    act(() => memory?.focus());
    act(() => fireEvent.keyDown(memory as HTMLButtonElement, { key: "ArrowRight" }));

    expect(document.activeElement).toBe(jank);
    expect(jank?.getAttribute("aria-selected")).toBe("true");
    expect(jank?.tabIndex).toBe(0);
    expect(memory?.getAttribute("aria-selected")).toBe("false");
    expect(memory?.tabIndex).toBe(-1);
    expect(tabpanel?.getAttribute("aria-labelledby")).toBe(jank?.id);
    expect(tabpanel?.getAttribute("data-dtb-metric")).toBe("jank");
  });
});
