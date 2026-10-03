import { describe, expect, it, vi } from "vitest";
import type { DevToolbarExtension } from "../contract";
import { createMemoryStorage } from "../storage";
import { createToolbarStore } from "../store";
import {
  acceptedPreset,
  createViewerSettingActions,
  isShownInBar,
  resolveSections,
  resolveViewerSettings,
} from "../viewerSettings";

const allOn = resolveSections(undefined);
const options = {
  sections: allOn,
  position: undefined,
  defaultPosition: "bottom" as const,
  density: "compact" as const,
  colorScheme: "system" as const,
};
const stored = {
  position: "top" as const,
  density: "comfortable" as const,
  colorScheme: "dark" as const,
  extensionSettings: { metrics: { shown: false as const, preset: "icon" as const } },
};

describe("resolveSections", () => {
  it("turns every section on by default, off for false, and allowlists an object", () => {
    expect(resolveSections(undefined)).toEqual(allOn);
    expect(Object.values(resolveSections(false))).toEqual([false, false, false, false]);
    expect(resolveSections({ density: true })).toEqual({
      position: false,
      density: true,
      colorScheme: false,
      extensions: false,
    });
  });
});

describe("resolveViewerSettings", () => {
  it("lets a stored Setting win over an uncontrolled Option", () => {
    expect(resolveViewerSettings(options, stored)).toMatchObject({
      enabled: true,
      position: "top",
      density: "comfortable",
      colorScheme: "dark",
      extensionSettings: stored.extensionSettings,
    });
  });

  it("lets a controlled position win over the stored Setting", () => {
    expect(resolveViewerSettings({ ...options, position: "bottom" }, stored).position).toBe(
      "bottom",
    );
  });

  it("ignores what is stored for a section that is off", () => {
    const resolved = resolveViewerSettings(
      { ...options, sections: resolveSections(false) },
      stored,
    );
    expect(resolved).toMatchObject({
      enabled: false,
      position: "bottom",
      density: "compact",
      colorScheme: "system",
      extensionSettings: {},
    });
  });
});

describe("acceptedPreset / isShownInBar", () => {
  const metrics: DevToolbarExtension = { id: "metrics", label: "Metrics", presets: ["icon"] };

  it("accepts a stored preset only while the extension still declares it", () => {
    expect(acceptedPreset(metrics, stored.extensionSettings)).toBe("icon");
    expect(acceptedPreset({ ...metrics, presets: ["value"] }, stored.extensionSettings)).toBe(
      undefined,
    );
  });

  it("hides on shown: false or hidden: true", () => {
    expect(isShownInBar(metrics, stored.extensionSettings)).toBe(false);
    expect(isShownInBar({ ...metrics, id: "other" }, stored.extensionSettings)).toBe(true);
    expect(isShownInBar({ ...metrics, id: "other", hidden: true }, {})).toBe(false);
  });
});

describe("createViewerSettingActions", () => {
  const setup = (position?: "top" | "bottom") => {
    const store = createToolbarStore({ storage: createMemoryStorage() });
    const setControlledPosition = vi.fn((next: "top" | "bottom") => store.setPosition(next));
    const actions = createViewerSettingActions(
      store,
      { ...options, position },
      setControlledPosition,
    );
    return { store, actions, setControlledPosition };
  };

  it("clears the stored Setting when the Option's own value is picked", () => {
    const { store, actions } = setup();
    actions.setDensity("comfortable");
    actions.setColorScheme("dark");
    actions.setPosition("top");
    expect(store.getSnapshot()).toMatchObject({
      density: "comfortable",
      colorScheme: "dark",
      position: "top",
    });

    actions.setDensity("compact");
    actions.setColorScheme("system");
    actions.setPosition("bottom");
    expect(store.getSnapshot()).toMatchObject({
      density: undefined,
      colorScheme: undefined,
      position: "bottom",
    });
  });

  it("routes a controlled position through the controlled setter, even to the default", () => {
    const { actions, setControlledPosition } = setup("top");
    actions.setPosition("bottom");
    expect(setControlledPosition).toHaveBeenCalledWith("bottom");
  });

  it("stores shown only when hidden and clears the preset on Extension default", () => {
    const { store, actions } = setup();
    actions.setShown("metrics", false);
    actions.setPreset("metrics", "icon");
    expect(store.getSnapshot().extensionSettings).toEqual({
      metrics: { shown: false, preset: "icon" },
    });
    actions.setShown("metrics", true);
    actions.setPreset("metrics", undefined);
    expect(store.getSnapshot().extensionSettings).toEqual({});
  });
});
