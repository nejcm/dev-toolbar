/**
 * `<DevToolbar bindCommandShortcuts>` — opt-in binding of `ToolbarCommand.shortcut`
 * (`plans/extension-customization.md` § Phase 4).
 *
 * The default is off: existing `shortcut` strings are often display-only, and
 * some describe a host's own listener. These tests pin the six rules and the
 * three event guards that a reimplementation tends to drop.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { makeExtension } from "@nejcm/dev-toolbar/testing";
import { resetCommandWarnings } from "../commands";
import type { DevToolbarExtension, ToolbarCommand } from "../contract";
import { DevToolbar } from "../DevToolbar";
import { DEFAULT_SHORTCUT, isApplePlatform, resetShortcutWarnings } from "../shortcut";

const fireModK = (target: Window | Element = window, overrides: Record<string, unknown> = {}) =>
  fireEvent.keyDown(target, {
    key: "k",
    code: "KeyK",
    ...(isApplePlatform() ? { metaKey: true } : { ctrlKey: true }),
    ...overrides,
  });

const fireToggleShortcut = (
  target: Window | Element = window,
  overrides: Record<string, unknown> = {},
) =>
  fireEvent.keyDown(target, {
    key: ".",
    code: "Period",
    shiftKey: true,
    ...(isApplePlatform() ? { metaKey: true } : { ctrlKey: true }),
    ...overrides,
  });

const command = (
  id: string,
  run: ToolbarCommand["run"],
  extra: Partial<ToolbarCommand> = {},
): ToolbarCommand => ({
  id,
  label: id,
  run,
  ...extra,
});

const extensionWith = (
  commands: ToolbarCommand[] | (() => ToolbarCommand[]),
): DevToolbarExtension => makeExtension({ id: "hotkeys", commands });

let warn: Mock<typeof console.warn>;
let error: Mock<typeof console.error>;

beforeEach(() => {
  resetCommandWarnings();
  resetShortcutWarnings();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
});

describe("bindCommandShortcuts", () => {
  it("runs a declared Mod+K, and does nothing when the prop is absent", () => {
    const run = vi.fn();
    const extensions = [extensionWith([command("hotkeys.run", run, { shortcut: "Mod+K" })])];

    const off = render(
      <DevToolbar instanceId="bind-off" storage={null} extensions={extensions}>
        <div />
      </DevToolbar>,
    );
    fireModK();
    expect(run).not.toHaveBeenCalled();
    off.unmount();

    render(
      <DevToolbar instanceId="bind-on" storage={null} bindCommandShortcuts extensions={extensions}>
        <div />
      </DevToolbar>,
    );
    fireModK();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not bind a command that declares input", () => {
    const run = vi.fn();
    render(
      <DevToolbar
        instanceId="bind-input"
        storage={null}
        bindCommandShortcuts
        extensions={[
          extensionWith([
            command("hotkeys.form", run, {
              shortcut: "Mod+K",
              input: { fields: { q: { type: "string" } } },
            }),
          ]),
        ]}
      >
        <div />
      </DevToolbar>,
    );
    fireModK();
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the first of two commands that declare the same chord, and warns once", () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <DevToolbar
        instanceId="bind-shadow"
        storage={null}
        bindCommandShortcuts
        extensions={[
          makeExtension({
            id: "a",
            commands: [command("a.run", first, { shortcut: "Mod+K" })],
          }),
          makeExtension({
            id: "b",
            commands: [command("b.run", second, { shortcut: "Mod+K" })],
          }),
        ]}
      >
        <div />
      </DevToolbar>,
    );

    fireModK();
    fireModK();

    expect(first).toHaveBeenCalledTimes(2);
    expect(second).not.toHaveBeenCalled();
    const messages = warn.mock.calls.map((call) => String(call[0]));
    const conflicts = messages.filter((message) => message.includes("shadowed"));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain("a.run");
    expect(conflicts[0]).toContain("b.run");
  });

  it("does not let a command declaring the toggle chord shadow the toggle", () => {
    const run = vi.fn();
    render(
      <DevToolbar
        instanceId="bind-toggle"
        storage={null}
        bindCommandShortcuts
        extensions={[
          extensionWith([command("hotkeys.toggle", run, { shortcut: DEFAULT_SHORTCUT })]),
        ]}
      >
        <div />
      </DevToolbar>,
    );
    expect(document.querySelector("[data-dev-toolbar]")).not.toBeNull();

    fireToggleShortcut();

    expect(document.querySelector("[data-dev-toolbar]")).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("warns once when a command declares the toggle chord, without running it", () => {
    const run = vi.fn();
    render(
      <DevToolbar
        instanceId="bind-toggle-warn"
        storage={null}
        bindCommandShortcuts
        extensions={[
          extensionWith([command("hotkeys.toggle", run, { shortcut: DEFAULT_SHORTCUT })]),
        ]}
      >
        <div />
      </DevToolbar>,
    );

    // Once, deliberately: a second press only papered over the ordering bug,
    // where the toggle listener's `preventDefault()` made the command
    // listener bail before it could warn, until a visibility flip happened to
    // re-register the two in the other order.
    fireToggleShortcut();

    expect(run).not.toHaveBeenCalled();
    const messages = warn.mock.calls.map((call) => String(call[0]));
    const shadows = messages.filter((message) => message.includes("toolbar toggle"));
    expect(shadows).toHaveLength(1);
    expect(shadows[0]).toContain("hotkeys.toggle");
  });

  it("warns on the first press even when visibility is controlled and inert", () => {
    const run = vi.fn();
    render(
      // Controlled `visible` with no `onVisibleChange`: visibility never
      // flips, so nothing ever re-registers the listeners. The warning has to
      // come from the first press or never.
      <DevToolbar
        instanceId="bind-toggle-warn-controlled"
        storage={null}
        bindCommandShortcuts
        visible={false}
        extensions={[
          extensionWith([command("hotkeys.toggle", run, { shortcut: DEFAULT_SHORTCUT })]),
        ]}
      >
        <div />
      </DevToolbar>,
    );

    fireToggleShortcut();

    expect(run).not.toHaveBeenCalled();
    const messages = warn.mock.calls.map((call) => String(call[0]));
    const shadows = messages.filter((message) => message.includes("toolbar toggle"));
    expect(shadows).toHaveLength(1);
    expect(shadows[0]).toContain("hotkeys.toggle");
  });

  it("ignores a chord the host already handled", () => {
    const run = vi.fn();
    render(
      <DevToolbar
        instanceId="bind-prevented"
        storage={null}
        bindCommandShortcuts
        extensions={[extensionWith([command("hotkeys.run", run, { shortcut: "Mod+K" })])]}
      >
        <div />
      </DevToolbar>,
    );

    const handled = (event: KeyboardEvent) => event.preventDefault();
    document.addEventListener("keydown", handled);
    try {
      fireModK(document.body);
    } finally {
      document.removeEventListener("keydown", handled);
    }

    expect(run).not.toHaveBeenCalled();
  });

  it("ignores a chord fired mid-composition", () => {
    const run = vi.fn();
    render(
      <DevToolbar
        instanceId="bind-composing"
        storage={null}
        bindCommandShortcuts
        extensions={[extensionWith([command("hotkeys.run", run, { shortcut: "Mod+K" })])]}
      >
        <div />
      </DevToolbar>,
    );

    fireModK(window, { isComposing: true });
    expect(run).not.toHaveBeenCalled();
  });

  it("ignores auto-repeat while the chord is held", () => {
    const run = vi.fn();
    render(
      <DevToolbar
        instanceId="bind-repeat"
        storage={null}
        bindCommandShortcuts
        extensions={[extensionWith([command("hotkeys.run", run, { shortcut: "Mod+K" })])]}
      >
        <div />
      </DevToolbar>,
    );

    fireModK();
    fireModK(window, { repeat: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("binds a function-form shortcut that appears after mount, without a re-render", () => {
    const run = vi.fn();
    let declareShortcut = false;
    const extension = makeExtension({
      id: "late",
      commands: () => [command("late.run", run, declareShortcut ? { shortcut: "Mod+K" } : {})],
    });

    render(
      <DevToolbar
        instanceId="bind-late"
        storage={null}
        bindCommandShortcuts
        extensions={[extension]}
      >
        <div />
      </DevToolbar>,
    );

    fireModK();
    expect(run).not.toHaveBeenCalled();

    declareShortcut = true;
    fireModK();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("catches a rejecting run() and keeps listening", async () => {
    const boom = new Error("boom");
    let fail = true;
    const run = vi.fn(() => {
      if (fail) return Promise.reject(boom);
    });

    render(
      <DevToolbar
        instanceId="bind-reject"
        storage={null}
        bindCommandShortcuts
        extensions={[extensionWith([command("hotkeys.run", run, { shortcut: "Mod+K" })])]}
      >
        <div />
      </DevToolbar>,
    );

    fireModK();
    await act(async () => {
      await Promise.resolve();
    });
    expect(error).toHaveBeenCalledWith(
      '[dev-toolbar] command "hotkeys.run" failed from its shortcut.',
      boom,
    );

    fail = false;
    fireModK();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("catches a synchronous throw from run() and keeps listening", () => {
    const boom = new Error("sync boom");
    let fail = true;
    const run = vi.fn(() => {
      if (fail) throw boom;
    });

    render(
      <DevToolbar
        instanceId="bind-throw"
        storage={null}
        bindCommandShortcuts
        extensions={[extensionWith([command("hotkeys.run", run, { shortcut: "Mod+K" })])]}
      >
        <div />
      </DevToolbar>,
    );

    expect(() => fireModK()).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      '[dev-toolbar] command "hotkeys.run" failed from its shortcut.',
      boom,
    );

    fail = false;
    fireModK();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("fires while the bar is hidden, and from an editable target", () => {
    const run = vi.fn();
    render(
      <DevToolbar
        instanceId="bind-hidden"
        storage={null}
        bindCommandShortcuts
        defaultVisible={false}
        extensions={[extensionWith([command("hotkeys.run", run, { shortcut: "Mod+K" })])]}
      >
        <input aria-label="host input" />
      </DevToolbar>,
    );
    expect(document.querySelector("[data-dev-toolbar]")).toBeNull();

    fireModK();
    expect(run).toHaveBeenCalledTimes(1);

    const input = screen.getByLabelText("host input");
    input.focus();
    fireModK(input);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
