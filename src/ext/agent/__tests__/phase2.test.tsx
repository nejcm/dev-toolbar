/**
 * The Phase 2 "done when" list (`plans/agent-readable-toolbar.md`):
 *
 * 1. an agent sets a specific flag to a specific value **in one call**;
 * 2. `diagnostics.capture` resolves the snapshot it captured;
 * 3. the palette does not offer a command it cannot run;
 * 4. a v1 extension still works.
 *
 * (4) lives in `src/core/__tests__/contract-v2.test.tsx`, because it is a core
 * property rather than a bridge one. The rest are here: the bridge is the only
 * caller that can supply input, and the only one that reads a result back.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup } from "@testing-library/react";
import { renderWithToolbar } from "@nejcm/dev-toolbar/testing";
import { agentBridge } from "../index";
import { DEFAULT_GLOBAL_NAME } from "../types";
import { commandMenu } from "../../command-menu/index";
import { createCommandMenuRuntime } from "../../command-menu/runtime";
import { diagnostics } from "../../diagnostics/index";
import { createDiagnosticsRuntime, renderJson } from "../../diagnostics/runtime";
import { flags } from "../../flags/index";
import { themeEditor } from "../../theme-editor/index";
import type { AgentHandle, AgentRegistry, AgentRunResult } from "../types";
import type { FlagReading, FlagValue } from "../../flags/types";
import type { DesignTokenDefinition } from "../../theme-editor/types";

const scope = globalThis as unknown as Record<string, unknown>;

const handle = (instanceId = "test"): AgentHandle => {
  const registry = scope[DEFAULT_GLOBAL_NAME] as AgentRegistry;
  const found = registry?.instances[instanceId];
  expect(found, `no handle for instanceId "${instanceId}"`).toBeDefined();
  return found as AgentHandle;
};

/** `runCommand` is optional on the handle; every case here mounts with `allowRun`. */
const run = (id: string, input?: unknown): Promise<AgentRunResult> => {
  const bridge = handle();
  expect(bridge.runCommand, "the bridge was mounted without allowRun").toBeDefined();
  return (bridge.runCommand as NonNullable<AgentHandle["runCommand"]>)(id, input);
};

function published<T = Record<string, unknown>>(id: string): T {
  const entry = handle()
    .read()
    .diagnostics.find((candidate) => candidate.id === id);
  expect(entry, `no diagnostics entry for "${id}"`).toBeDefined();
  expect(entry?.status, `${id} did not publish: ${entry?.error ?? "(no error)"}`).toBe("ok");
  return entry?.data as T;
}

afterEach(() => {
  cleanup();
  delete scope[DEFAULT_GLOBAL_NAME];
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* 1. One call sets a specific flag to a specific value                        */
/* -------------------------------------------------------------------------- */

const CATALOGUE: FlagReading[] = [
  { key: "new-header", type: "boolean", defaultValue: false, value: true, source: "server-rule" },
  { key: "search.rank", type: "number", defaultValue: 1, value: 2 },
  { key: "theme.name", type: "string", defaultValue: "light", value: "light" },
  {
    key: "checkout.tier",
    type: "variant",
    variants: ["free", "pro"],
    defaultValue: "free",
    value: "free",
  },
];

function mountFlags(onOverride?: (key: string, value: FlagValue | undefined) => void) {
  const applied: [string, FlagValue | undefined][] = [];
  const result = renderWithToolbar(undefined, {
    instanceId: "test",
    extensions: [
      agentBridge({ instanceId: "test", allowRun: true }),
      flags({
        flags: CATALOGUE,
        onOverride:
          onOverride ??
          ((key, value) => {
            applied.push([key, value]);
          }),
      }),
    ],
  });
  return { applied, ...result };
}

interface PublishedFlag {
  key: string;
  overridden: boolean;
  effective: unknown;
  base: unknown;
  source: string;
}

const flagRow = (key: string): PublishedFlag => {
  const rows = published<{ flags: PublishedFlag[] }>("flags").flags;
  const found = rows.find((row) => row.key === key);
  expect(found, `no published flag "${key}"`).toBeDefined();
  return found as PublishedFlag;
};

describe("an agent sets a specific flag to a specific value in one call", () => {
  it("sets a number flag — which no per-flag command could ever reach", async () => {
    const { applied } = mountFlags();

    // The pre-v2 enumeration only produced `flags.toggle.<key>` for boolean,
    // non-orphaned flags, so this row had no one-call path at all.
    expect(
      handle()
        .listCommands()
        .map((command) => command.id),
    ).not.toContain("flags.toggle.search.rank");

    expect(await run("flags.set", { key: "search.rank", value: 9 })).toEqual({ ok: true });

    expect(flagRow("search.rank")).toMatchObject({
      effective: 9,
      base: 2,
      overridden: true,
      source: "local-override",
    });
    // …and it reached the application, not just the extension's own map.
    expect(applied).toEqual([["search.rank", 9]]);
    // No panel was opened to do it.
    expect(handle().read().shell.activePanel).toBeNull();
  });

  it("sets a specific boolean value rather than flipping whatever was there", async () => {
    mountFlags();
    // `false` twice: a toggle would land on `true` the second time. The point
    // of an input-carrying command is that the caller states the value.
    expect(await run("flags.set", { key: "new-header", value: false })).toEqual({ ok: true });
    expect(flagRow("new-header").effective).toBe(false);
    expect(await run("flags.set", { key: "new-header", value: false })).toEqual({ ok: true });
    expect(flagRow("new-header").effective).toBe(false);
  });

  it("sets a string and a variant flag", async () => {
    mountFlags();
    expect(await run("flags.set", { key: "theme.name", value: "midnight" })).toEqual({ ok: true });
    expect(flagRow("theme.name").effective).toBe("midnight");
    expect(await run("flags.set", { key: "checkout.tier", value: "pro" })).toEqual({ ok: true });
    expect(flagRow("checkout.tier").effective).toBe("pro");
  });

  it("clears the override when `value` is omitted — `null` is a value, not an absence", async () => {
    mountFlags();
    await run("flags.set", { key: "theme.name", value: "midnight" });
    expect(flagRow("theme.name").overridden).toBe(true);

    expect(await run("flags.set", { key: "theme.name" })).toEqual({ ok: true });
    expect(flagRow("theme.name").overridden).toBe(false);
    expect(flagRow("theme.name").effective).toBe("light");
  });

  it("refuses `value: null` on a boolean, string or number flag, and says why", async () => {
    const { applied } = mountFlags();

    // `null` is a `FlagValue`, so it gets past `isFlagValue` — and is then
    // refused by the flag's own declared type, because `typeof null` is
    // "object". That refusal is the correct behaviour: `vetOverrides` would
    // discard such an override on the next reload, so accepting it here would
    // make an override that silently vanishes. The bug this test pins is the
    // schema and the docs having claimed the opposite.
    for (const key of ["new-header", "theme.name", "search.rank"]) {
      const result = await run("flags.set", { key, value: null });
      expect(result, `${key} accepted null`).toMatchObject({ ok: false, reason: "threw" });
      expect((result as { error: string }).error).toMatch(
        /is a (boolean|string|number) flag; null is not a valid/,
      );
      expect(flagRow(key).overridden, `${key} was written`).toBe(false);
    }
    // Nothing reached the application on any of the three.
    expect(applied).toEqual([]);
  });

  it("accepts `value: null` only for a variant flag that lists it", async () => {
    const applied: [string, FlagValue | undefined][] = [];
    renderWithToolbar(undefined, {
      instanceId: "test",
      extensions: [
        agentBridge({ instanceId: "test", allowRun: true }),
        flags({
          flags: [
            {
              key: "banner.variant",
              type: "variant",
              variants: [null, "a", "b"],
              defaultValue: "a",
              value: "a",
            },
          ],
          onOverride: (key, value) => {
            applied.push([key, value]);
          },
        }),
      ],
    });

    expect(await run("flags.set", { key: "banner.variant", value: null })).toEqual({ ok: true });
    expect(flagRow("banner.variant")).toMatchObject({ effective: null, overridden: true });
    expect(applied).toEqual([["banner.variant", null]]);
  });

  it("distinguishes clearing from setting null, on the one flag that can do both", async () => {
    const applied: [string, FlagValue | undefined][] = [];
    renderWithToolbar(undefined, {
      instanceId: "test",
      extensions: [
        agentBridge({ instanceId: "test", allowRun: true }),
        flags({
          flags: [
            {
              key: "banner.variant",
              type: "variant",
              variants: [null, "a", "b"],
              defaultValue: "a",
              value: "b",
            },
          ],
          onOverride: (key, value) => {
            applied.push([key, value]);
          },
        }),
      ],
    });

    await run("flags.set", { key: "banner.variant", value: null });
    expect(flagRow("banner.variant")).toMatchObject({ effective: null, overridden: true });

    // Omitting `value` is what clears — it falls back to the app's own "b",
    // not to `null`. This is the pair the docs previously got backwards.
    expect(await run("flags.set", { key: "banner.variant" })).toEqual({ ok: true });
    expect(flagRow("banner.variant")).toMatchObject({ effective: "b", overridden: false });
    expect(applied).toEqual([
      ["banner.variant", null],
      ["banner.variant", undefined],
    ]);
  });

  it("refuses a value of the wrong type rather than coercing it, as a value", async () => {
    const { applied } = mountFlags();
    const result = await run("flags.set", { key: "new-header", value: "yes" });

    expect(result).toMatchObject({ ok: false, reason: "threw" });
    expect((result as { error: string }).error).toMatch(/boolean flag/);
    // Nothing was written, and the application was never called.
    expect(flagRow("new-header").overridden).toBe(false);
    expect(applied).toEqual([]);
  });

  it("refuses a variant outside the declared set", async () => {
    mountFlags();
    const result = await run("flags.set", { key: "checkout.tier", value: "enterprise" });
    expect(result).toMatchObject({ ok: false, reason: "threw" });
    expect(flagRow("checkout.tier").overridden).toBe(false);
  });

  it("refuses an unknown key, and names what it does know", async () => {
    mountFlags();
    const result = await run("flags.set", { key: "nope", value: true });
    expect(result).toMatchObject({ ok: false, reason: "threw" });
    expect((result as { error: string }).error).toMatch(/No flag named "nope"/);
    expect((result as { error: string }).error).toMatch(/new-header/);
  });

  it("refuses when the consumer supplied no adapter, instead of pretending", async () => {
    renderWithToolbar(undefined, {
      instanceId: "test",
      extensions: [
        agentBridge({ instanceId: "test", allowRun: true }),
        // No `onOverride`: the panel is read-only, so a command must be too.
        flags({ flags: CATALOGUE }),
      ],
    });
    const result = await run("flags.set", { key: "new-header", value: false });
    expect(result).toMatchObject({ ok: false, reason: "threw" });
    expect((result as { error: string }).error).toMatch(/read-only/);
  });

  it("publishes the schema a caller needs to build the call", () => {
    mountFlags();
    const view = handle()
      .listCommands()
      .find((command) => command.id === "flags.set");
    expect(view?.description).toMatch(/Overrides one flag by key/);
    expect(view?.input?.fields.key).toEqual({
      type: "string",
      required: true,
      description: expect.any(String) as unknown as string,
    });
    // The polymorphic field is described as a union rather than as a lie.
    expect(view?.input?.fields.value).toMatchObject({
      type: ["boolean", "string", "number"],
    });
    // And `null` is *not* advertised, because the command refuses it for every
    // non-variant flag — see the `value: null` cases below. A schema field
    // saying otherwise would send an agent straight into a guaranteed throw.
    const value = view?.input?.fields.value;
    expect(value).toBeDefined();
    expect(value).not.toHaveProperty("nullable");
    // The description carries the rule instead, since it is conditional on the
    // named flag and no field of this schema could express it.
    expect(value?.description).toMatch(/`null` is refused/);
    expect(value?.description).toMatch(/Omit this field to clear/);
  });

  it("keeps the per-flag enumeration alongside it", () => {
    mountFlags();
    const ids = handle()
      .listCommands()
      .map((command) => command.id);
    // Both ship. `flags.set` is the tool call; `flags.toggle.<key>` is what a
    // human finds by typing a flag's name into the palette, which skips every
    // command carrying `input`.
    expect(ids).toContain("flags.set");
    expect(ids).toContain("flags.toggle.new-header");
  });
});

/* -------------------------------------------------------------------------- */
/* theme-editor: the command that could not be expressed at all before v2      */
/* -------------------------------------------------------------------------- */

const TOKENS: DesignTokenDefinition[] = [
  { name: "--app-accent", type: "color", value: "#111111" },
  { name: "--app-gap", type: "length", value: "8px" },
];

function mountTheme() {
  return renderWithToolbar(undefined, {
    instanceId: "test",
    extensions: [
      agentBridge({ instanceId: "test", allowRun: true }),
      themeEditor({ tokens: TOKENS }),
    ],
  });
}

describe("theme-editor.setToken", () => {
  it("sets an open-ended value, which no enumeration could have offered", async () => {
    mountTheme();
    expect(await run("theme-editor.setToken", { name: "--app-accent", value: "#3b82f6" })).toEqual({
      ok: true,
    });

    const edits = published<{ overrides: { name: string; value: string }[] }>(
      "theme-editor",
    ).overrides;
    expect(edits).toContainEqual(expect.objectContaining({ name: "--app-accent" }));
  });

  it("clears one token's edit when `value` is omitted", async () => {
    mountTheme();
    await run("theme-editor.setToken", { name: "--app-accent", value: "#3b82f6" });
    expect(await run("theme-editor.setToken", { name: "--app-accent" })).toEqual({ ok: true });
    const edits = published<{ overrides: { name: string }[] }>("theme-editor").overrides;
    expect(edits.map((edit) => edit.name)).not.toContain("--app-accent");
  });

  it("refuses a value the editor would refuse, and says which", async () => {
    mountTheme();
    const result = await run("theme-editor.setToken", {
      name: "--app-gap",
      value: "12px; } body { display: none",
    });
    expect(result).toMatchObject({ ok: false, reason: "threw" });
    expect((result as { error: string }).error).toMatch(/--app-gap/);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. `diagnostics.capture` resolves the snapshot it captured                  */
/* -------------------------------------------------------------------------- */

describe("diagnostics.capture resolves the snapshot it captured", () => {
  it("hands the caller the object, not just `ok`", async () => {
    renderWithToolbar(undefined, {
      instanceId: "test",
      extensions: [
        agentBridge({ instanceId: "test", allowRun: true }),
        diagnostics(),
        flags({ flags: CATALOGUE }),
      ],
    });

    const result = await run("diagnostics.capture");
    expect(result.ok).toBe(true);
    const snapshot = (result as { result: Record<string, unknown> }).result;

    // The pre-v2 answer was `true` and a caller had to open the panel or read
    // the DOM to find out what had been captured.
    expect(snapshot).toBeTypeOf("object");
    expect(snapshot).toHaveProperty("generatedAt");
    expect(snapshot).toHaveProperty("toolbar");
    // It really is a snapshot of *this* toolbar's roster.
    expect(JSON.stringify(snapshot)).toContain("flags");

    // And it is the same one the extension stored, not a parallel capture: its
    // published summary now says something was captured.
    expect(published<{ captured: boolean }>("diagnostics").captured).toBe(true);
  });

  it("survives the structured clone a `page.evaluate` reader would apply", async () => {
    renderWithToolbar(undefined, {
      instanceId: "test",
      extensions: [agentBridge({ instanceId: "test", allowRun: true }), diagnostics()],
    });
    const result = await run("diagnostics.capture");
    // Not a Map, a class instance or anything carrying a function: those
    // arrive as `undefined` or throw on the far side of `page.evaluate`.
    expect(() => structuredClone((result as { result: unknown }).result)).not.toThrow();
  });

  it("omits `result` rather than publishing `undefined` for a command that returns nothing", async () => {
    renderWithToolbar(undefined, {
      instanceId: "test",
      extensions: [
        agentBridge({ instanceId: "test", allowRun: true }),
        flags({ flags: CATALOGUE, onOverride: () => {} }),
      ],
    });
    const result = await run("flags.refresh");
    expect(result).toEqual({ ok: true });
    expect("result" in result).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* The measured cost of redacting on the way out                               */
/* -------------------------------------------------------------------------- */

/** `n` nested `{ d: … }` objects wrapping a leaf, so depth is countable. */
const nest = (n: number): unknown => (n === 0 ? { leaf: "SENTINEL" } : { d: nest(n - 1) });

/**
 * `redact()` walks its argument from depth 0 and replaces any object at depth
 * >= `maxDepth` (8) with `"[truncated]"`. A contribution's `data` therefore
 * survives a different number of levels depending on **how deep inside the
 * redacted root it sits**, and there are three surfaces, not two:
 *
 * | Path | `data` sits at | Levels kept below its own root |
 * | --- | --- | --- |
 * | A. bridge `read().diagnostics` — `redact(getDiagnostics())` | depth 2 | 5 |
 * | B. bridge `runCommand("diagnostics.capture").result` — `redact(snapshot)` | depth 3 | 4 |
 * | C. bug-report JSON — `renderJson(capture())` | depth 0 | 7 |
 *
 * C is the **most** permissive, not the least: `/ext/diagnostics` redacts each
 * contribution at its own root inside `finish()` and never re-redacts the
 * assembled snapshot, and `renderJson` is a plain `JSON.stringify`. B is the
 * strictest because it is that already-redacted snapshot put through a
 * *second* pass by the bridge, three levels down.
 *
 * All three numbers are quoted in `README.md` and `src/ext/agent/runtime.ts`,
 * so all three are pinned here. Prose with no test behind it is what produced
 * the `nullable` bug in `flags.set`'s schema, and an earlier version of this
 * very block measured B correctly while calling it C.
 */
describe("re-redaction truncates deep contributions, at three pinned depths", () => {
  it("path A — the bridge's roster read keeps five levels and drops the sixth", () => {
    renderWithToolbar(undefined, {
      instanceId: "test",
      extensions: [
        agentBridge({ instanceId: "test", allowRun: true }),
        ...[4, 5, 6].map((n) => ({
          id: `deep${n}`,
          label: `deep ${n}`,
          diagnostics: () => nest(n),
        })),
      ],
    });

    const kept = (id: string): boolean => JSON.stringify(published(id)).includes("SENTINEL");
    expect(kept("deep4")).toBe(true);
    expect(kept("deep5")).toBe(true);
    expect(kept("deep6")).toBe(false);
    expect(JSON.stringify(published("deep6"))).toContain("[truncated]");
  });

  it("path B — the bridge's capture result keeps four, one fewer than its roster read", () => {
    renderWithToolbar(undefined, {
      instanceId: "test",
      extensions: [
        agentBridge({ instanceId: "test", allowRun: true }),
        diagnostics(),
        ...[4, 5].map((n) => ({
          id: `deep${n}`,
          label: `deep ${n}`,
          diagnostics: () => nest(n),
        })),
      ],
    });

    const contributions = async (): Promise<{ id: string; data?: unknown }[]> => {
      const result = await run("diagnostics.capture");
      expect(result.ok).toBe(true);
      const snapshot = (result as { result: unknown }).result as {
        contributions?: { id: string; data?: unknown }[];
      };
      expect(snapshot.contributions, "the snapshot carried no contributions").toBeDefined();
      return snapshot.contributions ?? [];
    };

    return contributions().then((entries) => {
      const data = (id: string): string =>
        JSON.stringify(entries.find((entry) => entry.id === id)?.data ?? null);
      expect(data("deep4")).toContain("SENTINEL");
      // The same contribution the roster read above kept: this surface is a
      // *second* redaction pass over an already-redacted snapshot, applied
      // three levels down instead of two, so it loses one more level.
      expect(data("deep5")).not.toContain("SENTINEL");
      expect(data("deep5")).toContain("[truncated]");
    });
  });

  it("path C — the bug-report JSON keeps seven, the most permissive of the three", () => {
    // Built directly rather than through a mounted toolbar because this is the
    // one path the bridge cannot reach: `renderJson(capture())` is what
    // `diagnostics.copyJson` and `diagnostics.download` write, and nothing
    // redacts the assembled snapshot — `finish()` already redacted each
    // contribution at its own root (depth 0), which is why seven survive.
    const controller = new AbortController();
    const runtime = createDiagnosticsRuntime({ id: "diagnostics" });
    runtime.start({
      signal: controller.signal,
      isVisible: () => true,
      subscribeVisibility: () => () => {},
      storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      getCommands: () => [],
      runCommand: async () => false,
      invokeCommand: async () => ({ ok: false, reason: "unknown-command" }) as const,
      getDiagnostics: () =>
        [5, 7, 8].map((n) => ({
          id: `deep${n}`,
          label: `deep ${n}`,
          status: "ok" as const,
          data: nest(n),
        })),
    });

    const parsed = JSON.parse(renderJson(runtime.capture())) as {
      contributions?: { id: string; data?: unknown }[];
    };
    const data = (id: string): string =>
      JSON.stringify(parsed.contributions?.find((entry) => entry.id === id)?.data ?? null);

    // Five — which the bridge's capture result (path B) has already lost.
    expect(data("deep5")).toContain("SENTINEL");
    expect(data("deep7")).toContain("SENTINEL");
    expect(data("deep8")).not.toContain("SENTINEL");
    expect(data("deep8")).toContain("[truncated]");

    controller.abort();
  });
});

/* -------------------------------------------------------------------------- */
/* 3. The palette does not offer a command it cannot run                       */
/* -------------------------------------------------------------------------- */

describe("the palette does not offer a command it cannot run", () => {
  it("skips every command that declares `input`, while the bridge keeps them", async () => {
    renderWithToolbar(undefined, {
      instanceId: "test",
      extensions: [
        agentBridge({ instanceId: "test", allowRun: true }),
        // `apple: false` pins the chord to Ctrl+K so the keypress below does
        // not depend on jsdom's `navigator.platform`.
        commandMenu({ apple: false }),
        flags({ flags: CATALOGUE, onOverride: () => {} }),
        themeEditor({ tokens: TOKENS }),
      ],
    });

    // The palette enumerates on open, so open it. It publishes nothing until
    // it has.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });

    const bridgeIds = handle()
      .listCommands()
      .map((command) => command.id);
    expect(bridgeIds).toContain("flags.set");
    expect(bridgeIds).toContain("theme-editor.setToken");

    const palette = published<{ commandCount: number }>("command-menu");
    // The palette's own count is what it could run, and it is short by exactly
    // the two input-carrying commands.
    expect(palette.commandCount).toBe(bridgeIds.length - 2);
  });

  it("filters in the runtime's enumeration, so the snapshot never lists one", () => {
    const runtime = createCommandMenuRuntime({ shortcut: null });
    const controller = new AbortController();
    const withInput = {
      id: "needs.input",
      label: "Needs input",
      input: { fields: { key: { type: "string" as const } } },
      run: () => {},
    };
    const plain = { id: "plain.run", label: "Plain", run: () => {} };
    const stop = runtime.start({
      signal: controller.signal,
      isVisible: () => true,
      subscribeVisibility: () => () => {},
      storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      getCommands: () => [withInput, plain],
      runCommand: async () => true,
      invokeCommand: async () => ({ ok: false, reason: "unknown-command" }) as const,
      getDiagnostics: () => [],
    });

    runtime.open();
    const snapshot = runtime.store.peek();
    expect(snapshot.commands.map((command) => command.id)).toEqual(["plain.run"]);
    expect(snapshot.results.map((match) => match.command.id)).toEqual(["plain.run"]);
    stop();
    controller.abort();
  });
});
