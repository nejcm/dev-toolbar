import { describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "../storage";
import {
  DEFAULT_PANEL_HEIGHT,
  MAX_PANEL_HEIGHT,
  MIN_PANEL_HEIGHT,
  clampPanelHeight,
  createToolbarStore,
} from "../store";

const makeStore = () => {
  const storage = createMemoryStorage();
  return { storage, store: createToolbarStore({ storage }) };
};

describe("toolbar store", () => {
  it("keeps at most one panel open", () => {
    const { store } = makeStore();
    store.openPanel("a");
    expect(store.getSnapshot().activePanelId).toBe("a");
    store.openPanel("b");
    expect(store.getSnapshot().activePanelId).toBe("b");
    store.togglePanel("b");
    expect(store.getSnapshot().activePanelId).toBeNull();
  });

  it("ignores closePanel for a panel that is not active", () => {
    const { store } = makeStore();
    store.openPanel("a");
    store.closePanel("b");
    expect(store.getSnapshot().activePanelId).toBe("a");
    store.closePanel("a");
    expect(store.getSnapshot().activePanelId).toBeNull();
  });

  it("persists and rehydrates preferences", () => {
    const storage = createMemoryStorage();
    const first = createToolbarStore({ storage });
    first.setVisible(false);
    first.setPosition("top");
    first.openPanel("metrics");
    first.setPanelHeight(420);

    const second = createToolbarStore({ storage });
    expect(second.getSnapshot()).toMatchObject({
      visible: false,
      position: "top",
      activePanelId: "metrics",
      panelHeight: 420,
    });
  });

  it("clamps panel height", () => {
    expect(clampPanelHeight(10)).toBe(MIN_PANEL_HEIGHT);
    expect(clampPanelHeight(10_000)).toBe(MAX_PANEL_HEIGHT);
    expect(clampPanelHeight(Number.NaN)).toBe(DEFAULT_PANEL_HEIGHT);
  });

  it("notifies subscribers only on change", () => {
    const { store } = makeStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.setVisible(true); // already true
    expect(listener).not.toHaveBeenCalled();
    store.setVisible(false);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.setVisible(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("registers and unregisters extensions dynamically", () => {
    const { store } = makeStore();
    const extension = { id: "x", label: "X" };
    const unregister = store.register(extension);
    expect(store.getSnapshot().registered).toEqual([extension]);
    unregister();
    expect(store.getSnapshot().registered).toEqual([]);
  });

  it("re-registering an existing id updates it in place instead of moving it to the end", () => {
    const { store } = makeStore();
    const a = { id: "a", label: "A" };
    const b = { id: "b", label: "B" };
    const c = { id: "c", label: "C" };
    store.register(a);
    store.register(b);
    store.register(c);

    const updatedB = { id: "b", label: "B updated" };
    store.register(updatedB);

    expect(store.getSnapshot().registered).toEqual([a, updatedB, c]);
  });

  it("survives a storage adapter that throws", () => {
    const hostile = {
      getItem() {
        throw new Error("nope");
      },
      setItem() {
        throw new Error("nope");
      },
      removeItem() {
        throw new Error("nope");
      },
    };
    const store = createToolbarStore({ storage: hostile });
    expect(store.getSnapshot().visible).toBe(true);
    expect(() => store.setVisible(false)).not.toThrow();
    expect(store.getSnapshot().visible).toBe(false);
  });

  it("ignores corrupt persisted values", () => {
    const storage = createMemoryStorage({
      position: '"sideways"',
      panelHeight: "not json",
    });
    const store = createToolbarStore({ storage });
    expect(store.getSnapshot().position).toBe("bottom");
    expect(store.getSnapshot().panelHeight).toBe(DEFAULT_PANEL_HEIGHT);
  });
});
