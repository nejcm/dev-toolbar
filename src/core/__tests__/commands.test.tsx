/**
 * The `commands` contract, widened by P2's third extension to `array | (() => array)`.
 *
 * The thing being pinned down is not "a function is called" — it is that a
 * function which lies, throws or returns junk cannot reach the host
 * application, and that an extension whose command list *grows after mount* is
 * reachable without a reload. That was the whole reason for the change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { renderWithToolbar, makeExtension } from "@nejcm/dev-toolbar/testing";
import {
  collectCommands,
  resetCommandWarnings,
  resolveExtensionCommands,
  runCommand,
} from "../commands";
import type { DevToolbarExtension, ToolbarCommand } from "../contract";

let unmountAll: (() => void)[] = [];
let errors: unknown[][] = [];
let warns: unknown[][] = [];

beforeEach(() => {
  resetCommandWarnings();
  errors = [];
  warns = [];
  vi.spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args);
  });
  vi.spyOn(console, "warn").mockImplementation((...args) => {
    warns.push(args);
  });
});

afterEach(() => {
  for (const unmount of unmountAll.splice(0)) unmount();
  vi.restoreAllMocks();
});

const mount = (extensions: DevToolbarExtension[]) => {
  const result = renderWithToolbar(null, { extensions });
  unmountAll.push(result.unmount);
  return result;
};

const command = (id: string, run: () => void = () => {}): ToolbarCommand => ({
  id,
  label: id,
  run,
});

describe("collectCommands", () => {
  it("still takes a static array", () => {
    const extension = makeExtension({
      id: "a",
      commands: [command("a.one"), command("a.two")],
    });
    expect(collectCommands([extension]).map((c) => c.id)).toEqual([
      "a.one",
      "a.two",
    ]);
  });

  it("calls the function form on every pass, so a later command is enumerated", () => {
    let extra = false;
    const extension = makeExtension({
      id: "a",
      commands: () => (extra ? [command("a.one"), command("a.two")] : [command("a.one")]),
    });
    expect(collectCommands([extension]).map((c) => c.id)).toEqual(["a.one"]);
    extra = true;
    expect(collectCommands([extension]).map((c) => c.id)).toEqual([
      "a.one",
      "a.two",
    ]);
  });

  it("orders by extension, then declaration, and drops later duplicate ids", () => {
    const first = makeExtension({
      id: "a",
      commands: () => [command("shared"), command("a.one")],
    });
    const second = makeExtension({
      id: "b",
      commands: [command("b.one"), command("shared")],
    });
    expect(collectCommands([first, second]).map((c) => c.id)).toEqual([
      "shared",
      "a.one",
      "b.one",
    ]);
    // Stable across passes: a palette's cursor must not move under it.
    expect(collectCommands([first, second]).map((c) => c.id)).toEqual([
      "shared",
      "a.one",
      "b.one",
    ]);
  });

  it("contains a throwing commands() and keeps the rest of the aggregation", () => {
    const broken = makeExtension({
      id: "broken",
      commands: () => {
        throw new Error("nope");
      },
    });
    const fine = makeExtension({ id: "fine", commands: [command("fine.one")] });

    expect(collectCommands([broken, fine]).map((c) => c.id)).toEqual([
      "fine.one",
    ]);
    expect(errors).toHaveLength(1);
    expect(String(errors[0]?.[0])).toContain("broken");

    // Once per extension id, not once per pass — this runs during render.
    collectCommands([broken, fine]);
    collectCommands([broken, fine]);
    expect(errors).toHaveLength(1);
  });

  it("tells a throwing commands() and a malformed one apart when it reports them", () => {
    let call = 0;
    const both = makeExtension({
      id: "both",
      commands: (() => {
        call += 1;
        if (call === 1) throw new Error("first");
        return "not an array";
      }) as unknown as () => ToolbarCommand[],
    });
    collectCommands([both]);
    collectCommands([both]);
    // Two defects, two reports. Keyed by id alone they would share one
    // suppression slot, so fixing the throw would hide the shape error.
    expect(errors).toHaveLength(2);
    expect(String(errors[0]?.[0])).toContain("threw from commands()");
    expect(String(errors[1]?.[0])).toContain("an array was expected");
  });

  it("contains a commands() that returns something that is not an array", () => {
    const wrong = makeExtension({
      id: "wrong",
      commands: (() => "not an array") as unknown as () => ToolbarCommand[],
    });
    expect(collectCommands([wrong])).toEqual([]);
    expect(String(errors[0]?.[0])).toContain("an array was expected");
  });

  it("drops entries that are not runnable commands", () => {
    const junk = makeExtension({
      id: "junk",
      commands: () =>
        [
          null,
          { id: "no-run" },
          { run: () => {} },
          { id: "", run: () => {} },
          command("ok"),
        ] as unknown as ToolbarCommand[],
    });
    expect(collectCommands([junk]).map((c) => c.id)).toEqual(["ok"]);
  });

  it("takes nothing from a hidden extension, function form included", () => {
    const enumerated = vi.fn(() => [command("h.one")]);
    const hidden = makeExtension({ id: "h", hidden: true, commands: enumerated });
    expect(collectCommands([hidden])).toEqual([]);
    // Not merely filtered afterwards: a hidden extension's enumerator is never
    // even called, so `hidden` cannot be observed by the extension as traffic.
    expect(enumerated).not.toHaveBeenCalled();
  });

  it("refuses to recurse when commands() aggregates", () => {
    const recursive: DevToolbarExtension = {
      id: "r",
      label: "R",
      commands: () => collectCommands([recursive]),
    };
    expect(collectCommands([recursive])).toEqual([]);
    expect(String(errors[0]?.[0])).toContain("inside a commands()");
    // Once, not once per render: this is reached during render, and StrictMode
    // would double it.
    collectCommands([recursive]);
    collectCommands([recursive]);
    expect(errors).toHaveLength(1);
  });
});

describe("resolveExtensionCommands", () => {
  it("returns [] for an extension that declares none", () => {
    expect(resolveExtensionCommands(makeExtension({ id: "n" }))).toEqual([]);
  });
});

describe("aggregation through a mounted toolbar", () => {
  it("re-enumerates on getCommands(), so a later command is runnable without a reload", async () => {
    const ran: string[] = [];
    let grown = false;
    const extension = makeExtension({
      id: "grow",
      commands: () =>
        grown
          ? [command("grow.one", () => ran.push("one")), command("grow.late", () => ran.push("late"))]
          : [command("grow.one", () => ran.push("one"))],
    });
    const { toolbar } = mount([extension]);

    expect(toolbar.getCommands().map((c) => c.id)).toEqual(["grow.one"]);
    expect(await toolbar.runCommand("grow.late")).toBe(false);

    grown = true;

    // No re-render, no remount: the extension list has not changed at all.
    expect(toolbar.getCommands().map((c) => c.id)).toEqual([
      "grow.one",
      "grow.late",
    ]);
    await act(async () => {
      expect(await toolbar.runCommand("grow.late")).toBe(true);
    });
    expect(ran).toEqual(["late"]);

    // The module-level entry point resolves through the same live host.
    await act(async () => {
      expect(await runCommand("grow.late")).toBe(true);
    });
  });

  it("hands the same live aggregation to an extension through its api", async () => {
    let seen: readonly ToolbarCommand[] = [];
    let ranByExtension = false;
    let grown = false;

    const reader: DevToolbarExtension = {
      id: "reader",
      label: "Reader",
      start(api) {
        seen = api.getCommands();
        void api.runCommand("other.one");
        // Later, after the other extension has grown.
        queueMicrotask(() => {
          ranByExtension = api
            .getCommands()
            .some((c) => c.id === "other.late");
        });
      },
    };
    const other = makeExtension({
      id: "other",
      commands: () =>
        grown
          ? [command("other.one"), command("other.late")]
          : [command("other.one")],
    });

    mount([reader, other]);
    expect(seen.map((c) => c.id)).toEqual(["other.one"]);
    grown = true;
    await act(async () => {
      await Promise.resolve();
    });
    expect(ranByExtension).toBe(true);
  });

  it("keeps useToolbarCommands()'s snapshot stable until the extension list changes", () => {
    const extension = makeExtension({ id: "a", commands: () => [command("a.one")] });
    const { toolbar } = mount([extension]);
    const first = toolbar.context().commands;
    act(() => {
      toolbar.setPanelHeight(240);
    });
    expect(toolbar.context().commands).toBe(first);

    const unregister = toolbar.register(
      makeExtension({ id: "b", commands: [command("b.one")] }),
    );
    expect(toolbar.context().commands.map((c) => c.id)).toEqual([
      "a.one",
      "b.one",
    ]);
    unregister();
  });

  it("stops resolving an extension's commands once it is unmounted", async () => {
    const { toolbar, unmount } = mount([
      makeExtension({ id: "a", commands: () => [command("a.one")] }),
    ]);
    expect(await toolbar.runCommand("a.one")).toBe(true);
    unmountAll = unmountAll.filter((fn) => fn !== unmount);
    unmount();
    expect(await runCommand("a.one")).toBe(false);
    expect(String(warns.at(-1)?.[0])).toContain("no command registered");
  });
});
