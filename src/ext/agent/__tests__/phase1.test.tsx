/**
 * The Phase 1 "done when" list (`plans/agent-readable-toolbar.md`): the seven
 * first-party extensions publish, through their existing `diagnostics()`, the
 * state the skill's `probe.js` used to scrape off the DOM — and the bridge
 * reports the shell facts nobody owns.
 *
 * The headline case is the last one the plan names: **a flag override is
 * observable without opening the flags panel.** Everything here reads through
 * `window.__DEV_TOOLBAR__` and never queries an extension's markup, which is
 * the same standard the rewritten skill is held to — if a fact needs a
 * selector, the extension publishing it is the thing to fix.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup } from "@testing-library/react";
import { renderWithToolbar } from "@nejcm/dev-toolbar/testing";
import { agentBridge } from "../index";
import { readShell } from "../runtime";
import { DEFAULT_GLOBAL_NAME } from "../types";
import { commandMenu } from "../../command-menu/index";
import { diagnostics } from "../../diagnostics/index";
import { environment } from "../../environment/index";
import { flags } from "../../flags/index";
import { metrics } from "../../metrics/index";
import { overlays } from "../../overlays/index";
import { themeEditor } from "../../theme-editor/index";
import type { AgentHandle, AgentRegistry } from "../types";
import type { FlagReading, FlagValue } from "../../flags/types";

const scope = globalThis as unknown as Record<string, unknown>;

const handle = (instanceId = "test"): AgentHandle => {
  const registry = scope[DEFAULT_GLOBAL_NAME] as AgentRegistry;
  const found = registry?.instances[instanceId];
  expect(found, `no handle for instanceId "${instanceId}"`).toBeDefined();
  return found as AgentHandle;
};

/** One extension's published `data`, asserted `ok` so a failure names the id. */
function published<T = Record<string, unknown>>(id: string, instanceId = "test"): T {
  const entry = handle(instanceId)
    .read()
    .diagnostics.find((candidate) => candidate.id === id);
  expect(entry, `no diagnostics entry for "${id}"`).toBeDefined();
  expect(entry?.status, `${id} did not publish: ${entry?.error ?? "(no error)"}`).toBe("ok");
  return entry?.data as T;
}

afterEach(() => {
  cleanup();
  delete scope[DEFAULT_GLOBAL_NAME];
});

/* -------------------------------------------------------------------------- */

const CATALOGUE: FlagReading[] = [
  { key: "new-header", type: "boolean", defaultValue: false, value: true, source: "server-rule" },
  {
    key: "checkout.apiToken",
    type: "string",
    defaultValue: null,
    value: "tok-live-abcdef123456",
    source: "server-rule",
  },
  { key: "search.rank", type: "number", defaultValue: 1, value: 2 },
  {
    key: "legacy.checkout",
    type: "boolean",
    defaultValue: false,
    value: false,
    reloadBehavior: "full-reload",
  },
];

function mountFlags() {
  const applied: [string, FlagValue | undefined][] = [];
  const result = renderWithToolbar(undefined, {
    instanceId: "test",
    extensions: [
      agentBridge({ instanceId: "test", allowRun: true }),
      flags({
        flags: CATALOGUE,
        onOverride: (key, value) => {
          applied.push([key, value]);
        },
      }),
    ],
  });
  return { applied, ...result };
}

interface PublishedFlag {
  key: string;
  type: string;
  source: string;
  overridden: boolean;
  masked: boolean;
  effective: unknown;
  base: unknown;
  default: unknown;
  tags: string[];
}

const flagRow = (key: string): PublishedFlag => {
  const rows = published<{ flags: PublishedFlag[] }>("flags").flags;
  const found = rows.find((row) => row.key === key);
  expect(found, `no published flag "${key}"`).toBeDefined();
  return found as PublishedFlag;
};

describe("a flag override, without opening the flags panel", () => {
  it("is observable through the bridge alone", async () => {
    const { applied } = mountFlags();
    const bridge = handle();

    // Baseline: no panel has been opened, nothing has been clicked.
    expect(bridge.read().shell.activePanel).toBeNull();
    expect(flagRow("new-header")).toMatchObject({
      effective: true,
      base: true,
      default: false,
      source: "server-rule",
      overridden: false,
      tags: [],
    });

    // The override is set through the command registry — the id is stable and
    // public — not by clicking a switch in a panel.
    const ran = await bridge.runCommand?.("flags.toggle.new-header");
    expect(ran).toEqual({ ok: true });

    const after = flagRow("new-header");
    expect(after.effective).toBe(false);
    // The base value is still the app's own, which is what makes this an
    // override rather than a changed reading.
    expect(after.base).toBe(true);
    expect(after.source).toBe("local-override");
    expect(after.overridden).toBe(true);
    expect(after.tags).toContain("override");

    // …and it really reached the application's adapter.
    expect(applied).toEqual([["new-header", false]]);
    // Still no panel.
    expect(handle().read().shell.activePanel).toBeNull();
  });

  it("publishes typed values, not the panel's display strings", () => {
    mountFlags();
    expect(flagRow("search.rank").effective).toBe(2);
    expect(flagRow("new-header").effective).toBe(true);
  });

  it("keeps a masked flag masked — there is no unmasked path out here either", () => {
    mountFlags();
    const row = flagRow("checkout.apiToken");
    expect(row.masked).toBe(true);
    expect(row.tags).toContain("masked");
    expect(JSON.stringify(row)).not.toContain("tok-live-abcdef123456");
  });

  it("marks the flags waiting on a reload", async () => {
    mountFlags();
    await handle().runCommand?.("flags.toggle.legacy.checkout");
    expect(flagRow("legacy.checkout").tags).toContain("reload");
  });
});

/* -------------------------------------------------------------------------- */

describe("the roster the bridge reads", () => {
  const mountAll = () =>
    renderWithToolbar(undefined, {
      instanceId: "test",
      extensions: [
        agentBridge({ instanceId: "test", allowRun: true }),
        flags({ flags: CATALOGUE }),
        metrics(),
        environment({
          context: { environment: "staging", userId: "u_1", apiEndpoint: "https://api.test" },
        }),
        overlays(),
        commandMenu(),
        themeEditor(),
        diagnostics(),
      ],
    });

  it("has every first-party extension publishing something", () => {
    mountAll();
    const entries = handle().read().diagnostics;
    for (const id of [
      "flags",
      "metrics",
      "environment",
      "overlays",
      "command-menu",
      "theme-editor",
      "diagnostics",
    ]) {
      const entry = entries.find((candidate) => candidate.id === id);
      expect(entry?.status, `${id} is ${entry?.status ?? "missing"}`).toBe("ok");
    }
  });

  it("publishes metrics as numbers with a unit and a severity", () => {
    mountAll();
    const rows = published<{ metrics: { id: string; value: number | null; unit: string }[] }>(
      "metrics",
    ).metrics;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(typeof row.id).toBe("string");
      expect(row.value === null || typeof row.value === "number").toBe(true);
      expect(typeof row.unit).toBe("string");
      // The formatted display string is deliberately not published.
      expect(row).not.toHaveProperty("display");
    }
  });

  it("publishes environment rows as key/value/markers, already masked", () => {
    mountAll();
    const data = published<{
      severity: string;
      fields: { id: string; value: string; markers: string[]; group: string }[];
    }>("environment");
    const endpoint = data.fields.find((field) => field.id === "apiEndpoint");
    expect(endpoint?.value).toBe("https://api.test");
    expect(endpoint?.group).toBe("build");
    const route = data.fields.find((field) => field.id === "route");
    expect(route?.markers).toContain("detected");
    expect(data.severity).toBe("warn");
  });

  it("publishes which overlay layers are on", async () => {
    mountAll();
    expect(published<{ on: string[] }>("overlays").on).toEqual([]);
    await handle().runCommand?.("overlays.toggle.grid");
    expect(published<{ on: string[] }>("overlays").on).toEqual(["grid"]);
  });

  it("publishes whether the palette is open and what is typed in it", () => {
    mountAll();
    expect(published<{ open: boolean; query: string }>("command-menu")).toMatchObject({
      open: false,
      query: "",
    });
  });

  it("publishes the theme tokens that have been edited", () => {
    mountAll();
    expect(
      published<{ overriddenCount: number; overrides: unknown[] }>("theme-editor"),
    ).toMatchObject({
      overriddenCount: 0,
      overrides: [],
    });
  });
});

/* -------------------------------------------------------------------------- */

describe("/ext/diagnostics publishes a summary, not the snapshot", () => {
  const mount = () =>
    renderWithToolbar(undefined, {
      instanceId: "test",
      extensions: [
        agentBridge({ instanceId: "test", allowRun: true }),
        flags({ flags: CATALOGUE }),
        diagnostics(),
      ],
    });

  it("says nothing has been captured yet", () => {
    mount();
    expect(published("diagnostics")).toMatchObject({
      captured: false,
      revision: 0,
      capturedAt: null,
      contributionCount: 0,
      omissionCount: 0,
      omissions: [],
    });
  });

  it("summarises the capture without embedding it", async () => {
    mount();
    await handle().runCommand?.("diagnostics.capture");

    const summary = published<Record<string, unknown>>("diagnostics");
    expect(summary).toMatchObject({ captured: true, revision: 1, gathered: true });
    expect(summary["contributionCount"]).toBeGreaterThan(0);
    expect(typeof summary["generatedAt"]).toBe("string");

    // The trap the plan names: a snapshot inside the next snapshot. The
    // summary carries no `contributions`, no `page`, no `responsiveness`.
    expect(summary).not.toHaveProperty("contributions");
    expect(summary).not.toHaveProperty("page");
    expect(summary).not.toHaveProperty("app");

    // And it stays small: a nested snapshot would be kilobytes.
    expect(JSON.stringify(summary).length).toBeLessThan(400);
  });
});

/* -------------------------------------------------------------------------- */

describe("shell facts, which no extension owns", () => {
  it("reports position, density, colour scheme and the height variable", () => {
    renderWithToolbar(undefined, {
      instanceId: "test",
      extensions: [agentBridge({ instanceId: "test" })],
    });

    const shell = handle().read().shell;
    expect(shell.mounted).toBe(true);
    expect(shell.position).toBe("bottom");
    expect(shell.density).toBe("compact");
    expect(shell.colorScheme).toBe("system");
    expect(shell.heightVariable.name).toBe("--dev-toolbar-height-test");
  });

  it("lists bar membership and which panel is open", () => {
    renderWithToolbar(undefined, {
      instanceId: "test",
      extensions: [agentBridge({ instanceId: "test" }), flags({ flags: CATALOGUE })],
    });

    const shell = handle().read().shell;
    expect(shell.bar.map((item) => item.id)).toContain("flags");
    expect(shell.bar.every((item) => item.panelOpen === false)).toBe(true);
    expect(shell.activePanel).toBeNull();
    expect(shell.overflow).toEqual({ present: false, open: false, items: [] });
  });

  /**
   * The empty cases above pass just as well when `readShell` finds nothing at
   * all, so on their own they pin no attribute. These two do: `activePanel`
   * hangs off `[data-dtb-part="panel"][data-dtb-active="true"]` and the menu
   * items off `[data-dtb-part="overflow-menu-item"][data-dtb-ext-id]`, and a
   * rename of either would leave the fields reading `null` / `[]` forever
   * while every "nothing is open" assertion still passed.
   */
  it("names the open panel, not just the absence of one", () => {
    const { toolbar } = renderWithToolbar(undefined, {
      instanceId: "test",
      extensions: [agentBridge({ instanceId: "test" }), flags({ flags: CATALOGUE })],
    });

    act(() => {
      toolbar.openPanel("flags");
    });

    const shell = handle().read().shell;
    expect(shell.activePanel).toBe("flags");
    expect(shell.bar.find((item) => item.id === "flags")?.panelOpen).toBe(true);
  });

  it("names the collapsed extensions once the ··· menu is open", () => {
    const { toolbar } = renderWithToolbar(undefined, {
      instanceId: "test",
      // A bar too narrow for the items forces the collapse the fake layout
      // measures; `overlays` has the lowest priority here, so it goes first.
      layout: { barWidth: 200, itemWidth: 120 },
      extensions: [
        agentBridge({ instanceId: "test" }),
        flags({ flags: CATALOGUE }),
        overlays({ priority: 1 }),
      ],
    });

    act(() => {
      toolbar.resize(200);
    });
    expect(handle().read().shell.overflow.present).toBe(true);
    expect(toolbar.overflowedIds().length).toBeGreaterThan(0);

    act(() => {
      toolbar.openOverflow();
    });

    const overflow = handle().read().shell.overflow;
    expect(overflow.open).toBe(true);
    expect(overflow.items.length).toBeGreaterThan(0);
    // The ids core actually collapsed, not merely "something non-empty".
    // Compared as sets: the menu renders in bar order (start region, then
    // end), while `overflowedIds()` follows the extension list.
    expect([...overflow.items].sort()).toEqual([...toolbar.overflowedIds()].sort());
    // And they are gone from the bar, which is the other half of the claim.
    const barIds = handle()
      .read()
      .shell.bar.map((item) => item.id);
    for (const id of overflow.items) expect(barIds).not.toContain(id);
  });

  it("folds an instance id that is not a CSS identifier, the way core does", () => {
    expect(readShell("my instance").heightVariable.name).toBe("--dev-toolbar-height-my_instance");
  });

  it("answers `mounted: false` rather than throwing when nothing is mounted", () => {
    expect(readShell("nobody")).toMatchObject({
      mounted: false,
      position: null,
      bar: [],
      activePanel: null,
    });
  });

  it("does not confuse one instance's root with another's", () => {
    renderWithToolbar(undefined, {
      instanceId: "first",
      extensions: [agentBridge({ instanceId: "first" }), flags({ flags: CATALOGUE })],
    });
    expect(readShell("first").mounted).toBe(true);
    expect(readShell("second").mounted).toBe(false);
  });
});

describe("a hidden bar", () => {
  it("keeps answering: `visible` false, `shell.mounted` false", async () => {
    const { toolbar } = renderWithToolbar(undefined, {
      instanceId: "test",
      extensions: [agentBridge({ instanceId: "test" }), flags({ flags: CATALOGUE })],
    });
    expect(handle().read().visible).toBe(true);

    await act(async () => {
      toolbar.context().setVisible(false);
    });

    // Core never pauses an extension for visibility, so the handle survives —
    // it is the *rendered* shell that goes, which is why the skill reads
    // `visible` beside `shell.mounted` rather than either alone.
    const snapshot = handle().read();
    expect(snapshot.visible).toBe(false);
    expect(snapshot.shell.mounted).toBe(false);
    expect(snapshot.diagnostics.some((entry) => entry.id === "flags")).toBe(true);
  });
});
