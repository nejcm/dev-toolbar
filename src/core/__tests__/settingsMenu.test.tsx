import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "../storage";
import type { CompactSlotProps, DevToolbarExtension } from "../contract";
import { makeCommand, makeExtension, renderWithToolbar } from "@nejcm/dev-toolbar/testing";

const menu = () => document.querySelector<HTMLElement>('[data-dtb-part="settings-menu"]');

function accessibleName(control: HTMLButtonElement | HTMLInputElement | HTMLSelectElement): string {
  const explicit = control.getAttribute("aria-label");
  if (explicit) return explicit;
  if (control instanceof HTMLButtonElement) return control.textContent ?? "";
  return Array.from(control.labels ?? [])
    .map((label) => label.textContent ?? "")
    .join(" ");
}

describe("SettingsMenu disclosure", () => {
  it("labels the cog and every control, and applies the settings class names", () => {
    const extension = makeExtension({
      id: "metrics",
      label: "Metrics",
      presets: ["default", "icon", "value"],
    });
    const { toolbar } = renderWithToolbar(null, {
      extensions: [extension],
      classNames: {
        settingsButton: "custom-settings-button",
        settingsMenu: "custom-settings-menu",
      },
    });

    const button = screen.getByRole("button", { name: "Toolbar settings" });
    expect(button).toBe(toolbar.settingsButton());
    expect(button.classList.contains("custom-settings-button")).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-controls")).not.toBe("");

    toolbar.openSettings();

    const popup = screen.getByRole("group", { name: "Toolbar settings" });
    expect(popup).toBe(menu());
    expect(popup.id).toBe(button.getAttribute("aria-controls"));
    expect(popup.classList.contains("custom-settings-menu")).toBe(true);
    const controls = [...popup.querySelectorAll("button,input,select")] as (
      | HTMLButtonElement
      | HTMLInputElement
      | HTMLSelectElement
    )[];
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) expect(accessibleName(control).trim()).not.toBe("");
  });

  it("moves focus in, closes on Escape and outside press, and returns focus only for Escape", () => {
    const { toolbar } = renderWithToolbar();
    const button = toolbar.settingsButton()!;

    toolbar.openSettings();
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Top" }));

    fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(button);

    toolbar.openSettings();
    fireEvent.mouseDown(document.body);
    expect(menu()).toBeNull();
    expect(document.activeElement).not.toBe(button);
  });

  it("does not render a cog when settings are disabled", () => {
    const { toolbar } = renderWithToolbar(null, { settings: false });
    expect(toolbar.settingsButton()).toBeNull();
    expect(() => toolbar.openSettings()).toThrow(
      "[dev-toolbar/testing] viewer settings are disabled; there is no settings button to open.",
    );
  });

  it("renders only allowlisted sections", () => {
    const { toolbar } = renderWithToolbar(null, {
      settings: { density: true },
      extensions: [makeExtension({ id: "metrics", presets: ["icon"] })],
    });
    toolbar.openSettings();

    expect(screen.getByRole("group", { name: "Density" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Position" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Colour scheme" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Extensions" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("omits the Extensions section when no extensions are present", () => {
    const { toolbar } = renderWithToolbar(null, {
      settings: { extensions: true },
      extensions: [],
    });
    toolbar.openSettings();

    expect(screen.queryByRole("group", { name: "Extensions" })).toBeNull();
  });

  it("omits the preset control when an extension declares no presets", () => {
    const extension = makeExtension({ id: "metrics", label: "Metrics", presets: [] });
    const { toolbar } = renderWithToolbar(null, {
      settings: { extensions: true },
      extensions: [extension],
    });
    toolbar.openSettings();

    expect(screen.getByRole("group", { name: "Extensions" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Metrics shown in bar" })).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("keeps only one toolbar disclosure open", () => {
    const extensions = [
      makeExtension({ id: "first", priority: 2 }),
      makeExtension({ id: "second", priority: 1 }),
    ];
    const { toolbar } = renderWithToolbar(null, {
      extensions,
      layout: { barWidth: 100, itemWidth: 60, gap: 2 },
    });

    toolbar.openOverflow();
    expect(toolbar.overflowMenu()).not.toBeNull();
    toolbar.openSettings();
    expect(toolbar.overflowMenu()).toBeNull();
    expect(menu()).not.toBeNull();

    toolbar.openOverflow();
    expect(menu()).toBeNull();
    expect(toolbar.overflowMenu()).not.toBeNull();
  });

  it("keeps disclosure coordination off document", () => {
    const onOpen = vi.fn();
    document.addEventListener("dtb:disclosure-open", onOpen);
    const { toolbar } = renderWithToolbar();

    toolbar.openSettings();

    expect(onOpen).not.toHaveBeenCalled();
    document.removeEventListener("dtb:disclosure-open", onOpen);
  });
});

describe("SettingsMenu values", () => {
  it("removes an extension from the bar and overflow without removing its commands", () => {
    const extension = makeExtension({
      id: "metrics",
      label: "Metrics",
      priority: 1,
      commands: [makeCommand({ id: "metrics.capture" })],
    });
    const pinned = makeExtension({ id: "pinned", priority: 100 });
    const { toolbar } = renderWithToolbar(null, {
      extensions: [extension, pinned],
      layout: { barWidth: 150, itemWidth: 80, gap: 2 },
    });

    expect(toolbar.overflowedIds()).toContain("metrics");
    expect(toolbar.settingsButton()).not.toBeNull();
    expect(toolbar.settingsButton()?.previousElementSibling).toBe(toolbar.overflowButton());
    toolbar.openOverflow();
    expect(
      document.querySelector('[data-dtb-part="overflow-menu-item"][data-dtb-ext-id="metrics"]'),
    ).not.toBeNull();

    toolbar.openSettings();
    fireEvent.click(screen.getByRole("checkbox", { name: "Metrics shown in bar" }));

    expect(document.querySelector('[data-dtb-part="item"][data-dtb-ext-id="metrics"]')).toBeNull();
    expect(
      document.querySelector('[data-dtb-part="overflow-menu-item"][data-dtb-ext-id="metrics"]'),
    ).toBeNull();
    expect(toolbar.overflowedIds()).not.toContain("metrics");
    expect(toolbar.getCommands().map((command) => command.id)).toContain("metrics.capture");
  });

  it("passes only declared, in-list preset settings to compact slots", () => {
    const storage = createMemoryStorage({
      "dtb:v1:test:extensionSettings": JSON.stringify({
        valid: { preset: "icon" },
        undeclared: { preset: "icon" },
        outside: { preset: "icon" },
      }),
    });
    const received = new Map<string, CompactSlotProps>();
    const extension = (
      id: string,
      presets?: DevToolbarExtension["presets"],
    ): DevToolbarExtension => ({
      id,
      label: id,
      ...(presets ? { presets } : {}),
      compact: (props) => {
        received.set(id, props);
        return <span>{id}</span>;
      },
    });

    const { toolbar } = renderWithToolbar(null, {
      storage,
      extensions: [
        extension("valid", ["icon", "label"]),
        extension("undeclared"),
        extension("outside", ["label"]),
      ],
    });

    expect(received.get("valid")?.preset).toBe("icon");
    expect(received.get("undeclared")).not.toHaveProperty("preset");
    expect(received.get("outside")).not.toHaveProperty("preset");

    toolbar.openSettings();
    fireEvent.change(screen.getByRole("combobox", { name: "valid presentation preset" }), {
      target: { value: "label" },
    });
    expect(received.get("valid")?.preset).toBe("label");

    fireEvent.change(screen.getByRole("combobox", { name: "valid presentation preset" }), {
      target: { value: "" },
    });
    expect(received.get("valid")).not.toHaveProperty("preset");
  });

  it("clears stored toolbar overrides when the consumer option is selected", () => {
    const storage = createMemoryStorage({
      "dtb:v1:test:position": '"top"',
      "dtb:v1:test:density": '"comfortable"',
      "dtb:v1:test:colorScheme": '"dark"',
    });
    const { toolbar } = renderWithToolbar(null, {
      storage,
      defaultPosition: "bottom",
      density: "compact",
      colorScheme: "system",
    });
    toolbar.openSettings();

    fireEvent.click(screen.getByRole("radio", { name: "Bottom" }));
    fireEvent.click(screen.getByRole("radio", { name: "Compact" }));
    fireEvent.click(screen.getByRole("radio", { name: "System" }));

    expect(storage.getItem("dtb:v1:test:position")).toBeNull();
    expect(storage.getItem("dtb:v1:test:density")).toBeNull();
    expect(storage.getItem("dtb:v1:test:colorScheme")).toBeNull();
  });

  it("routes controlled position changes through onPositionChange without persisting", () => {
    const storage = createMemoryStorage();
    const onPositionChange = vi.fn();
    const { toolbar } = renderWithToolbar(null, {
      storage,
      position: "bottom",
      onPositionChange,
    });
    toolbar.openSettings();

    fireEvent.click(screen.getByRole("radio", { name: "Top" }));

    expect(onPositionChange).toHaveBeenCalledOnce();
    expect(onPositionChange).toHaveBeenCalledWith("top");
    expect(toolbar.position()).toBe("bottom");
    expect(storage.getItem("dtb:v1:test:position")).toBeNull();
  });

  it("does not clear a seeded position when the controlled option is chosen", () => {
    const storage = createMemoryStorage({
      "dtb:v1:test:position": '"top"',
    });
    const onPositionChange = vi.fn();
    const { toolbar } = renderWithToolbar(null, {
      storage,
      position: "top",
      onPositionChange,
    });
    toolbar.openSettings();

    const top = screen.getByRole<HTMLInputElement>("radio", { name: "Top" });
    top.checked = false;
    fireEvent.click(top);

    expect(onPositionChange).not.toHaveBeenCalled();
    expect(storage.getItem("dtb:v1:test:position")).toBe('"top"');
  });

  it("resets settings without closing the active panel", () => {
    const storage = createMemoryStorage({
      "dtb:v1:test:position": '"top"',
      "dtb:v1:test:density": '"comfortable"',
      "dtb:v1:test:colorScheme": '"dark"',
      "dtb:v1:test:extensionSettings": JSON.stringify({ metrics: { shown: false } }),
    });
    const extension = makeExtension({ id: "metrics", label: "Metrics", panel: true });
    const { toolbar } = renderWithToolbar(null, { storage, extensions: [extension] });
    toolbar.openPanel("metrics");

    toolbar.openSettings();
    expect(toolbar.activePanelId()).toBe("metrics");
    fireEvent.click(screen.getByRole("button", { name: "Reset toolbar settings" }));

    expect(toolbar.position()).toBe("bottom");
    expect(toolbar.root()?.dataset["dtbDensity"]).toBe("compact");
    expect(toolbar.root()?.dataset["dtbColorScheme"]).toBe("system");
    expect(toolbar.item("metrics")).not.toBeNull();
    expect(toolbar.activePanelId()).toBe("metrics");
    for (const key of ["position", "density", "colorScheme", "extensionSettings"]) {
      expect(storage.getItem(`dtb:v1:test:${key}`)).toBeNull();
    }
  });

  it("focuses the cog when a panel closes after its item was hidden from the bar", () => {
    const extension = makeExtension({ id: "metrics", label: "Metrics", panel: true });
    const { toolbar } = renderWithToolbar(null, { extensions: [extension] });
    toolbar.openPanel("metrics");
    toolbar.openSettings();
    expect(toolbar.activePanelId()).toBe("metrics");

    fireEvent.click(screen.getByRole("checkbox", { name: "Metrics shown in bar" }));
    fireEvent.click(screen.getByRole("button", { name: "Close Metrics panel" }));

    expect(toolbar.activePanelId()).toBeNull();
    expect(document.activeElement).toBe(toolbar.settingsButton());
  });
});
