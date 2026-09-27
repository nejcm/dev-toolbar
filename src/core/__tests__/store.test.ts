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
    first.setDensity("comfortable");
    first.setColorScheme("dark");
    first.setExtensionSetting("metrics", { shown: false, preset: "icon-value" });
    first.openPanel("metrics");
    first.setPanelHeight(420);

    const second = createToolbarStore({ storage });
    expect(second.getSnapshot()).toMatchObject({
      visible: false,
      position: "top",
      density: "comfortable",
      colorScheme: "dark",
      extensionSettings: {
        metrics: { shown: false, preset: "icon-value" },
      },
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
      density: '"spacious"',
      colorScheme: '"sepia"',
      extensionSettings: "not json",
      panelHeight: "not json",
    });
    const store = createToolbarStore({ storage });
    expect(store.getSnapshot().position).toBe("bottom");
    expect(store.getSnapshot().density).toBeUndefined();
    expect(store.getSnapshot().colorScheme).toBeUndefined();
    expect(store.getSnapshot().extensionSettings).toEqual({});
    expect(store.getSnapshot().panelHeight).toBe(DEFAULT_PANEL_HEIGHT);
  });

  it("drops invalid extension setting entries and keeps valid siblings", () => {
    const storage = createMemoryStorage({
      extensionSettings: JSON.stringify({
        valid: { shown: false, preset: "icon" },
        shownDefault: { shown: true },
        badPreset: { preset: "wide" },
        extra: { shown: false, order: 1 },
        empty: {},
        scalar: false,
      }),
    });

    expect(createToolbarStore({ storage }).getSnapshot().extensionSettings).toEqual({
      valid: { shown: false, preset: "icon" },
      extra: { shown: false },
    });
  });

  it("stores only non-default extension settings", () => {
    const { storage, store } = makeStore();
    store.setExtensionSetting("metrics", { shown: false, preset: "icon" });
    store.setExtensionSetting("metrics", { shown: undefined });

    expect(storage.getItem("extensionSettings")).toBe(
      JSON.stringify({ metrics: { preset: "icon" } }),
    );

    store.setExtensionSetting("metrics", { preset: undefined });
    expect(store.getSnapshot().extensionSettings).toEqual({});
    expect(store.getSnapshot().extensionSettings).toBe(store.getServerSnapshot().extensionSettings);
    expect(storage.getItem("extensionSettings")).toBeNull();
  });

  it("clears density and color scheme overrides", () => {
    const { storage, store } = makeStore();
    store.setDensity("comfortable");
    store.setColorScheme("dark");

    store.setDensity(undefined);
    store.setColorScheme(undefined);

    expect(store.getSnapshot().density).toBeUndefined();
    expect(store.getSnapshot().colorScheme).toBeUndefined();
    expect(storage.getItem("density")).toBeNull();
    expect(storage.getItem("colorScheme")).toBeNull();
  });

  it("keeps empty extension settings stable across unrelated updates and clean resets", () => {
    const { store } = makeStore();
    const initial = store.getSnapshot();
    const extensionSettings = initial.extensionSettings;

    store.setVisible(false);
    expect(store.getSnapshot().extensionSettings).toBe(extensionSettings);

    const beforeReset = store.getSnapshot();
    store.resetSettings();
    expect(store.getSnapshot()).toBe(beforeReset);
  });

  it("resets viewer settings without clearing visibility, panel state or extension data", () => {
    const { storage, store } = makeStore();
    storage.setItem("ext:metrics:threshold", "12");
    store.setVisible(false);
    store.setPosition("top");
    store.setDensity("comfortable");
    store.setColorScheme("dark");
    store.setExtensionSetting("metrics", { shown: false, preset: "value" });
    store.openPanel("metrics");
    store.setPanelHeight(460);

    store.resetSettings();

    expect(store.getSnapshot()).toMatchObject({
      visible: false,
      position: "bottom",
      density: undefined,
      colorScheme: undefined,
      extensionSettings: {},
      activePanelId: "metrics",
      panelHeight: 460,
    });
    expect(storage.getItem("visible")).toBe("false");
    expect(storage.getItem("activePanel")).toBe('"metrics"');
    expect(storage.getItem("panelHeight")).toBe("460");
    expect(storage.getItem("ext:metrics:threshold")).toBe("12");
    expect(storage.getItem("position")).toBeNull();
    expect(storage.getItem("density")).toBeNull();
    expect(storage.getItem("colorScheme")).toBeNull();
    expect(storage.getItem("extensionSettings")).toBeNull();
  });
});

/**
 * Regression: `getSnapshot` was passed to `useSyncExternalStore` as the
 * server snapshot too — since the store reads storage eagerly at
 * construction, hydration's first client render saw persisted preferences
 * where the server render saw defaults, mismatching every consumer.
 */
describe("createToolbarStore server snapshot", () => {
  it("returns the resolved defaults, not what is persisted — a server cannot read the browser's storage", () => {
    const storage = createMemoryStorage({
      visible: "false",
      position: '"top"',
      density: '"comfortable"',
      colorScheme: '"dark"',
      extensionSettings: JSON.stringify({ metrics: { shown: false, preset: "icon" } }),
      activePanel: '"metrics"',
      panelHeight: "500",
    });
    const store = createToolbarStore({ storage });

    expect(store.getSnapshot()).toMatchObject({
      visible: false,
      position: "top",
      density: "comfortable",
      colorScheme: "dark",
      extensionSettings: { metrics: { shown: false, preset: "icon" } },
      activePanelId: "metrics",
      panelHeight: 500,
    });
    expect(store.getServerSnapshot()).toMatchObject({
      visible: true,
      position: "bottom",
      density: undefined,
      colorScheme: undefined,
      extensionSettings: {},
      activePanelId: null,
      panelHeight: DEFAULT_PANEL_HEIGHT,
    });
  });

  it("honours the explicit defaults on both sides, and clamps the default height", () => {
    const store = createToolbarStore({
      storage: createMemoryStorage(),
      defaultVisible: false,
      defaultPosition: "top",
      defaultPanelHeight: 5000,
    });

    expect(store.getServerSnapshot()).toMatchObject({
      visible: false,
      position: "top",
      panelHeight: MAX_PANEL_HEIGHT,
    });
    // Nothing persisted, so the two agree — which is the whole point of
    // resolving the defaults in one place.
    expect(store.getSnapshot()).toEqual(store.getServerSnapshot());
  });

  it("hands back one stable object, as useSyncExternalStore requires of a server snapshot", () => {
    const store = createToolbarStore({ storage: createMemoryStorage() });
    const first = store.getServerSnapshot();

    store.setPosition("top");
    store.setPanelHeight(400);
    store.openPanel("x");

    expect(store.getServerSnapshot()).toBe(first);
    expect(store.getServerSnapshot().position).toBe("bottom");
  });
});
