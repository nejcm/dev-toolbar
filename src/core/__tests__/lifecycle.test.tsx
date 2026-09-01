/**
 * The lifecycle rules P1 pinned down — every one of them discovered by writing
 * `/ext/metrics` against the P0 contract.
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { renderWithToolbar } from "@nejcm/dev-toolbar/testing";
import { DevToolbar } from "@nejcm/dev-toolbar";
import type { CompactSlotProps, DevToolbarExtension } from "@nejcm/dev-toolbar";

describe("hidden extensions", () => {
  it("never start — `hidden` means the extension does not exist for this actor", () => {
    const start = vi.fn();
    const { toolbar, unmount } = renderWithToolbar(null, {
      extensions: [{ id: "secret", label: "Secret", hidden: true, start }],
    });
    expect(start).not.toHaveBeenCalled();
    expect(toolbar.item("secret")).toBeNull();
    unmount();
  });

  it("are torn down when they become hidden, and start again when they return", () => {
    const dispose = vi.fn();
    const start = vi.fn(() => dispose);
    const build = (hidden: boolean): DevToolbarExtension => ({
      id: "toggling",
      label: "Toggling",
      hidden,
      start,
    });

    const { rerender, unmount } = render(
      <DevToolbar extensions={[build(false)]} storage={null} />,
    );
    expect(start).toHaveBeenCalledTimes(1);
    const signal = (start.mock.calls[0] as unknown as [{ signal: AbortSignal }])[0]
      .signal;

    rerender(<DevToolbar extensions={[build(true)]} storage={null} />);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(true);

    rerender(<DevToolbar extensions={[build(false)]} storage={null} />);
    expect(start).toHaveBeenCalledTimes(2);
    unmount();
  });
});

describe("hidden means absent everywhere, not just in the bar", () => {
  const panelExt = (hidden: boolean): DevToolbarExtension => ({
    id: "restricted",
    label: "Restricted",
    ...(hidden ? { hidden: true } : {}),
    compact: () => <span>chip</span>,
    panel: () => <div data-testid="restricted-panel">secrets</div>,
  });

  // Registered dynamically rather than passed as a prop: props win the merge
  // dedupe, so re-registering an id that is also in props is a no-op.
  const mountRegistered = (extension: DevToolbarExtension) => {
    const result = renderWithToolbar(null, { extensions: [], storage: null });
    result.toolbar.register(extension);
    return result;
  };

  it("closes and unmounts a panel that was open when it became hidden", () => {
    const { toolbar, unmount } = mountRegistered(panelExt(false));
    toolbar.openPanel("restricted");
    expect(toolbar.panel("restricted")).not.toBeNull();

    toolbar.register(panelExt(true));

    // Both halves matter: the render must stop, and the persisted
    // activePanelId must clear so a reload does not reopen it.
    expect(toolbar.panel("restricted")).toBeNull();
    expect(toolbar.activePanelId()).toBeNull();
    unmount();
  });

  it("unmounts even a keepMounted panel, and forgets it was opened", () => {
    const base = { ...panelExt(false), keepMounted: true };
    const { toolbar, unmount } = mountRegistered(base);
    toolbar.openPanel("restricted");
    toolbar.closePanel();
    // keepMounted: still in the DOM, just inactive.
    expect(toolbar.panel("restricted")).not.toBeNull();

    toolbar.register({ ...base, hidden: true });
    expect(toolbar.panel("restricted")).toBeNull();

    // Un-hiding must not resurrect pre-teardown panel state.
    toolbar.register({ ...base, hidden: false });
    expect(toolbar.panel("restricted")).toBeNull();
    unmount();
  });

  it("contributes no commands, so runCommand cannot reach them", async () => {
    const run = vi.fn();
    const { toolbar, unmount } = mountRegistered({
      ...panelExt(true),
      commands: [{ id: "restricted.copy", label: "Copy", run }],
    });
    expect(toolbar.context().commands).toEqual([]);
    await expect(toolbar.runCommand("restricted.copy")).resolves.toBe(false);
    expect(run).not.toHaveBeenCalled();
    unmount();
  });

  it("does contribute them once it is no longer hidden", async () => {
    const run = vi.fn();
    const visible = {
      ...panelExt(false),
      commands: [{ id: "restricted.copy", label: "Copy", run }],
    };
    const { toolbar, unmount } = mountRegistered(visible);
    expect(toolbar.context().commands.map((c) => c.id)).toEqual([
      "restricted.copy",
    ]);
    await expect(toolbar.runCommand("restricted.copy")).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("leaves an activePanelId alone when the extension is merely absent", () => {
    // Persistence depends on this: the id is read back before the extension
    // that owns it has registered.
    const { toolbar, unmount } = mountRegistered(panelExt(false));
    toolbar.openPanel("restricted");
    toolbar.register({
      id: "other",
      label: "Other",
      compact: () => <span>o</span>,
    });
    expect(toolbar.activePanelId()).toBe("restricted");
    unmount();
  });
});

describe("extension object identity", () => {
  const rebuilt = (): DevToolbarExtension => ({
    id: "churn",
    label: "Churn",
    // A fresh closure per call: the signature of a factory called inside render.
    start: () => () => {},
  });

  it("warns once when a started extension is rebuilt inside render", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rerender, unmount } = render(
      <DevToolbar extensions={[rebuilt()]} storage={null} />,
    );
    expect(warn).not.toHaveBeenCalled();

    rerender(<DevToolbar extensions={[rebuilt()]} storage={null} />);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("was rebuilt after it started");

    rerender(<DevToolbar extensions={[rebuilt()]} storage={null} />);
    expect(warn).toHaveBeenCalledTimes(1); // once per id, not once per render
    unmount();
    warn.mockRestore();
  });

  it("stays quiet for the legitimate `{...ext, hidden}` pattern", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const base: DevToolbarExtension = {
      id: "stable",
      label: "Stable",
      start: () => () => {},
    };
    const { rerender, unmount } = render(
      <DevToolbar extensions={[base]} storage={null} />,
    );
    // Same `start` reference: a derived object, not a rebuilt one.
    rerender(
      <DevToolbar extensions={[{ ...base, order: 5 }]} storage={null} />,
    );
    expect(warn).not.toHaveBeenCalled();
    unmount();
    warn.mockRestore();
  });
});

describe("CompactSlotProps.togglePanel", () => {
  it("is handed to every compact slot and toggles that extension's panel", () => {
    const seen: CompactSlotProps[] = [];
    const extension: DevToolbarExtension = {
      id: "toggler",
      label: "Toggler",
      compact: (props) => {
        seen.push(props);
        return (
          <button type="button" data-testid="toggler" onClick={props.togglePanel}>
            go
          </button>
        );
      },
      panel: () => <div data-testid="toggler-panel" />,
    };

    const { toolbar, unmount } = renderWithToolbar(null, {
      extensions: [extension],
    });
    expect(typeof seen[0]?.togglePanel).toBe("function");

    toolbar.togglePanel("toggler");
    expect(toolbar.activePanelId()).toBe("toggler");
    toolbar.togglePanel("toggler");
    expect(toolbar.activePanelId()).toBeNull();
    unmount();
  });
});

describe("start(api) ordering", () => {
  const probe = (order: string[]): DevToolbarExtension => ({
    id: "ordering",
    label: "Ordering",
    compact: () => {
      order.push("compact");
      return <span>x</span>;
    },
    start: () => {
      order.push("start");
    },
  });

  it("runs before the first compact render — the bar is client-mount gated", () => {
    // The portal is gated on a `mounted` flag flipped in an effect, so the
    // first commit renders no slots at all and `start` wins the race.
    const order: string[] = [];
    const { unmount } = renderWithToolbar(null, { extensions: [probe(order)] });
    expect(order[0]).toBe("start");
    expect(order).toContain("compact");
    unmount();
  });

  it("does NOT win that race when `enabled` flips true later", () => {
    // `mounted` is already true by then, so the slot renders in the same commit
    // whose effects will run start(). Extensions must therefore still build
    // their state in the factory, not in start().
    const order: string[] = [];
    const extension = probe(order);
    const { rerender, unmount } = render(
      <DevToolbar enabled={false} extensions={[extension]} storage={null} />,
    );
    expect(order).toEqual([]);
    rerender(
      <DevToolbar enabled extensions={[extension]} storage={null} />,
    );
    expect(order[0]).toBe("compact");
    expect(order).toContain("start");
    unmount();
  });
});
