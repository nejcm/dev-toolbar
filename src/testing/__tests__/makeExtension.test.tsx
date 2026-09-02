import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupToolbar, mountToolbar } from "../lifecycle";
import { makeCommand, makeExtension, resetExtensionIds } from "../makeExtension";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanupToolbar();
  vi.restoreAllMocks();
});

/** Tracked by `mountToolbar`, so the `afterEach` above tears every mount down. */
const mount = mountToolbar;

describe("makeExtension", () => {
  it("only consumes a counter value when generating an id", () => {
    resetExtensionIds();

    const explicit = makeExtension({ id: "explicit" });
    expect(explicit.id).toBe("explicit");

    // The explicit id above must not have consumed a counter slot: the first
    // generated id is still "fake-1", not "fake-2".
    const generated = makeExtension();
    expect(generated.id).toBe("fake-1");

    const explicitAgain = makeExtension({ id: "explicit-2" });
    expect(explicitAgain.id).toBe("explicit-2");

    const generatedAgain = makeExtension();
    expect(generatedAgain.id).toBe("fake-2");
  });

  it("contains a throwing panel in an error chip while the rest of the bar keeps working", () => {
    const { toolbar } = mount(null, {
      extensions: [
        makeExtension({ id: "ok", label: "OK" }),
        makeExtension({ id: "broken", label: "Broken", throwInPanel: true }),
      ],
    });

    expect(toolbar.panel("broken")).toBeNull();
    toolbar.openPanel("broken");

    const chip = toolbar.errorChip("broken");
    expect(chip?.textContent).toBe("Broken: error");
    expect(chip?.title).toBe('[test] extension "broken" panel threw');
    // The panel container is now mounted (it hosts the boundary).
    expect(toolbar.panel("broken")).not.toBeNull();
    // The compact slot for the throwing extension is untouched by the panel throw.
    expect(toolbar.item("broken")).not.toBeNull();
    // The other extension is unaffected.
    expect(toolbar.item("ok")).not.toBeNull();
    expect(toolbar.bar()).not.toBeNull();
  });

  it("contains a throwing overlay in an inert error chip", () => {
    const boom = new Error("kaboom");
    const { toolbar } = mount(null, {
      extensions: [
        makeExtension({ id: "ok", label: "OK" }),
        makeExtension({ id: "broken", label: "Broken", throwInOverlay: boom }),
      ],
    });

    // Overlays are never collapsed and render without opening anything.
    const chip = toolbar.errorChip("broken");
    expect(chip?.textContent).toBe("Broken: error");
    expect(chip?.title).toBe("kaboom");
    expect(chip?.getAttribute("data-dtb-slot")).toBe("overlay");
    // The overlay chip is inert: no retry button, unlike compact/panel chips.
    expect(chip?.querySelector('[data-dtb-part="error-retry"]')).toBeNull();
    expect(toolbar.overlay("broken")).not.toBeNull();
    expect(toolbar.item("ok")).not.toBeNull();
  });

  it("logs and isolates a throwing start() without degrading the rest of the extension", () => {
    const { toolbar } = mount(null, {
      extensions: [
        makeExtension({ id: "ok", label: "OK" }),
        makeExtension({ id: "broken", label: "Broken", throwInStart: true }),
      ],
    });

    // start() has no visible surface of its own: a throw there is reported to
    // the console, not turned into an error chip, and the extension's other
    // slots keep rendering.
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("threw from start()"),
      expect.any(Error),
    );
    expect(toolbar.errorChip("broken")).toBeNull();
    expect(toolbar.item("broken")).not.toBeNull();
    expect(toolbar.item("ok")).not.toBeNull();
  });

  it("uses the provided Error as the thrown value for throwIn* options", () => {
    const boom = new Error("kaboom");
    mount(null, {
      extensions: [makeExtension({ id: "broken", label: "Broken", throwInStart: boom })],
    });

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("threw from start()"), boom);
  });
});

describe("makeCommand", () => {
  it("fills in sensible defaults", () => {
    resetExtensionIds();
    const command = makeCommand();

    expect(command.id).toBe("fake-command-1");
    expect(command.label).toBe(command.id);
    expect(typeof command.run).toBe("function");
    expect(command.run()).toBeUndefined();
  });

  it("only consumes a counter value when generating an id, independently of makeExtension", () => {
    resetExtensionIds();

    const explicit = makeCommand({ id: "explicit" });
    expect(explicit.id).toBe("explicit");

    const generated = makeCommand();
    expect(generated.id).toBe("fake-command-1");

    // makeExtension's counter is separate: unaffected by the makeCommand calls above.
    const extension = makeExtension();
    expect(extension.id).toBe("fake-1");

    const generatedAgain = makeCommand();
    expect(generatedAgain.id).toBe("fake-command-2");
  });

  it("lets every field and the run spy be overridden", () => {
    const run = vi.fn();
    const command = makeCommand({
      id: "save",
      label: "Save",
      group: "File",
      keywords: ["persist"],
      shortcut: "Mod+S",
      run,
    });

    expect(command).toEqual({
      id: "save",
      label: "Save",
      group: "File",
      keywords: ["persist"],
      shortcut: "Mod+S",
      run,
    });
    command.run();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("resetExtensionIds", () => {
  it("resets both the extension and command counters back to zero", () => {
    makeExtension();
    makeExtension();
    makeCommand();
    resetExtensionIds();

    expect(makeExtension().id).toBe("fake-1");
    expect(makeCommand().id).toBe("fake-command-1");
  });
});
