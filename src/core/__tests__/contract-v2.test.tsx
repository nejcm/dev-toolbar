/**
 * Contract v2, from core's side (`plans/agent-readable-toolbar.md` § Phase 2).
 *
 * The plan's line is "compatibility is the real work, not the type", so the
 * headline case here is a **v1-shaped extension** — written the way an author
 * would have written it before this change, declaring `contractVersion: 1`,
 * with zero-argument `run()`s and no `input` anywhere — mounted in a v2 host.
 * It is deliberately *not* a v2 extension with fields omitted: the point is
 * that source written against the old shape still works, and a v2 object with
 * optional fields left out would not test that.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderWithToolbar } from "@nejcm/dev-toolbar/testing";
import { CONTRACT_VERSION } from "../contract";
import { collectCommands, invokeCommand, resetCommandWarnings, runCommand } from "../commands";
import type { DevToolbarExtension, ToolbarCommand } from "../contract";

afterEach(() => {
  cleanup();
  resetCommandWarnings();
  vi.restoreAllMocks();
});

describe("the version", () => {
  it("is 2", () => {
    expect(CONTRACT_VERSION).toBe(2);
  });

  // The matching assertion — that every first-party extension declares
  // this same number — lives in `src/ext/__tests__/contract-version.test.ts`.
  // It cannot live here: `boundary.test.ts` forbids anything under `src/core`
  // from naming `ext/`, tests included, and that rule is worth more than the
  // convenience of one file.
});

/* -------------------------------------------------------------------------- */
/* A v1 extension still works                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Written against contract v1 and left alone. Nothing here mentions `input`,
 * `description`, a `run` parameter or a return value, and it declares `1`.
 *
 * The type annotations are v1's too: `ToolbarCommand[]`, which under v2 means
 * `ToolbarCommand<void, void>[]`. That this still compiles *is* half the
 * assertion, and it is checked by `tsc`, not by an expectation below.
 */
function makeV1Extension(ran: string[]): DevToolbarExtension {
  const commands: ToolbarCommand[] = [
    {
      id: "legacy.sync",
      label: "Sync",
      group: "Legacy",
      keywords: ["v1"],
      shortcut: "Mod+Shift+S",
      run: () => {
        ran.push("legacy.sync");
      },
    },
    {
      id: "legacy.slow",
      label: "Slow",
      run: async () => {
        await Promise.resolve();
        ran.push("legacy.slow");
      },
    },
  ];
  return {
    id: "legacy",
    label: "Legacy",
    contractVersion: 1,
    compact: () => "legacy",
    commands,
    diagnostics: () => ({ era: "v1" }),
    start() {
      ran.push("legacy.start");
      return () => ran.push("legacy.stop");
    },
  };
}

describe("a v1 extension in a v2 host", () => {
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("starts, renders, contributes commands and diagnostics", async () => {
    const ran: string[] = [];
    const { toolbar } = renderWithToolbar(undefined, {
      extensions: [makeV1Extension(ran)],
    });

    expect(ran).toContain("legacy.start");
    expect(toolbar.getCommands().map((command) => command.id)).toEqual([
      "legacy.sync",
      "legacy.slow",
    ]);
    expect(await toolbar.runCommand("legacy.sync")).toBe(true);
    expect(await toolbar.runCommand("legacy.slow")).toBe(true);
    expect(ran).toEqual(["legacy.start", "legacy.sync", "legacy.slow"]);
  });

  it("says so, once, rather than refusing to render", () => {
    const ran: string[] = [];
    const extension = makeV1Extension(ran);
    const { rerender } = renderWithToolbar(undefined, { extensions: [extension] });
    rerender();
    rerender();

    const mismatches = warn.mock.calls.filter((call) =>
      String(call[0]).includes("targets contract version"),
    );
    // Once per extension id, not once per render — and it named both numbers,
    // so the reader can tell which side is old.
    expect(mismatches).toHaveLength(1);
    expect(String(mismatches[0]?.[0])).toMatch(/targets contract version 1.*implements 2/s);
    // The warning is all that happens. ADR-003: core has no basis to decide
    // what a mismatch means, and refusing would turn a warning into an outage.
    expect(ran).toContain("legacy.start");
  });

  it("is reachable through the v2 verbs it never heard of", async () => {
    const ran: string[] = [];
    renderWithToolbar(undefined, { extensions: [makeV1Extension(ran)] });

    // Input a v1 `run()` does not declare is simply ignored: the parameter is
    // not in its signature, so it never sees it.
    expect(await invokeCommand("legacy.sync", { input: { anything: true } })).toEqual({
      ok: true,
      result: undefined,
    });
    expect(ran).toContain("legacy.sync");
  });

  it("declares no `input`, so the aggregation reports none", () => {
    const ran: string[] = [];
    const commands = collectCommands([makeV1Extension(ran)]);
    expect(commands.every((command) => command.input === undefined)).toBe(true);
    expect(commands.every((command) => command.description === undefined)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* invokeCommand                                                               */
/* -------------------------------------------------------------------------- */

describe("invokeCommand", () => {
  it("carries input through to run() and resolves what it returned", async () => {
    const command: ToolbarCommand<{ n: number }, number> = {
      id: "math.double",
      label: "Double",
      input: { fields: { n: { type: "number", required: true } } },
      run: ({ n }) => n * 2,
    };
    const scope = collectCommands([{ id: "math", label: "Math", commands: [command] }]);

    expect(await invokeCommand<number>("math.double", { input: { n: 21 }, scope })).toEqual({
      ok: true,
      result: 42,
    });
  });

  it("awaits an async result", async () => {
    const command: ToolbarCommand<void, string> = {
      id: "slow.value",
      label: "Slow",
      run: async () => {
        await Promise.resolve();
        return "done";
      },
    };
    const scope = collectCommands([{ id: "slow", label: "Slow", commands: [command] }]);
    expect(await invokeCommand<string>("slow.value", { scope })).toEqual({
      ok: true,
      result: "done",
    });
  });

  it("reports an unknown id as a value, and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await invokeCommand("nope.missing", { scope: [] })).toEqual({
      ok: false,
      reason: "unknown-command",
    });
    expect(warn).toHaveBeenCalled();
  });

  it("rejects with the command's own error, like runCommand", async () => {
    const boom = new TypeError("nope");
    const scope = collectCommands([
      {
        id: "x",
        label: "X",
        commands: [
          {
            id: "x.explode",
            label: "Explode",
            run: () => {
              throw boom;
            },
          },
        ],
      },
    ]);
    await expect(invokeCommand("x.explode", { scope })).rejects.toBe(boom);
  });

  it("does not reinterpret runCommand's second argument", async () => {
    // The whole reason `invokeCommand` takes an options bag: `runCommand(id, scope)`
    // is published, and a third positional `input` would have made every
    // existing two-argument call mean something new.
    const ran: string[] = [];
    const scope = collectCommands([
      {
        id: "y",
        label: "Y",
        commands: [{ id: "y.go", label: "Go", run: () => void ran.push("y.go") }],
      },
    ]);
    // Still resolves a boolean, still searches `scope` from position two.
    expect(await runCommand("y.go", scope)).toBe(true);
    expect(await runCommand("y.missing", scope)).toBe(false);
    expect(ran).toEqual(["y.go"]);
  });

  it("is on the context and on the api, scoped to the mounted toolbar", async () => {
    const seen: unknown[] = [];
    const setter: ToolbarCommand<{ value: string }, string> = {
      id: "store.set",
      label: "Set",
      description: "Stores a value and hands back what it stored.",
      input: { fields: { value: { type: "string", required: true } } },
      run: ({ value }) => {
        seen.push(value);
        return value.toUpperCase();
      },
    };
    const { toolbar } = renderWithToolbar(undefined, {
      extensions: [{ id: "store", label: "Store", compact: () => "s", commands: [setter] }],
    });

    expect(await toolbar.invokeCommand<string>("store.set", { value: "hi" })).toEqual({
      ok: true,
      result: "HI",
    });
    expect(seen).toEqual(["hi"]);
  });
});

/* -------------------------------------------------------------------------- */
/* hidden is still absent, for the new verb too                                */
/* -------------------------------------------------------------------------- */

describe("hidden means does not exist, for invokeCommand as well", () => {
  it("cannot be reached through the new verb either", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ran: string[] = [];
    const { toolbar } = renderWithToolbar(undefined, {
      extensions: [
        {
          id: "secret",
          label: "Secret",
          hidden: true,
          commands: [
            {
              id: "secret.exfiltrate",
              label: "Exfiltrate",
              input: { fields: { where: { type: "string" } } },
              run: () => void ran.push("secret.exfiltrate"),
            },
          ],
        },
      ],
    });

    expect(await toolbar.invokeCommand("secret.exfiltrate", { where: "anywhere" })).toEqual({
      ok: false,
      reason: "unknown-command",
    });
    expect(ran).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});
