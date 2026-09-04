/** Phase 0 coverage: registry isolation, teardown, redaction, and `allowRun`. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { makeExtension, renderWithToolbar } from "@nejcm/dev-toolbar/testing";
import { agentBridge } from "../index";
import { AGENT_PROTOCOL_VERSION, DEFAULT_GLOBAL_NAME } from "../types";
import type { AgentHandle, AgentRegistry } from "../types";

const scope = globalThis as unknown as Record<string, unknown>;

const registry = (name: string = DEFAULT_GLOBAL_NAME): AgentRegistry =>
  scope[name] as AgentRegistry;

/** The handle for one instance, asserted present so a test failure names the missing key. */
function handleFor(instanceId: string, name?: string): AgentHandle {
  const found = registry(name).instances[instanceId];
  expect(found, `no handle for instanceId "${instanceId}"`).toBeDefined();
  return found as AgentHandle;
}

afterEach(() => {
  cleanup();
  delete scope[DEFAULT_GLOBAL_NAME];
  delete scope["__OTHER__"];
  vi.restoreAllMocks();
});

describe("installation", () => {
  it("touches no global until the toolbar mounts", () => {
    // The factory may run during SSR, before any client global exists (decision 5).
    const extension = agentBridge();
    expect(scope[DEFAULT_GLOBAL_NAME]).toBeUndefined();
    expect(typeof extension.start).toBe("function");
    expect(extension.panel).toBeUndefined();
    expect(extension.overlay).toBeUndefined();
  });

  it("publishes a handle under the instanceId it was given", () => {
    renderWithToolbar(undefined, {
      instanceId: "playground",
      extensions: [agentBridge({ instanceId: "playground" })],
    });

    expect(registry().protocolVersion).toBe(AGENT_PROTOCOL_VERSION);
    const handle = handleFor("playground");
    expect(handle.instanceId).toBe("playground");
    expect(handle.contractVersion).toBe(2);
    expect(handle.read().instanceId).toBe("playground");
  });

  it("honours a custom globalName and leaves the default one alone", () => {
    renderWithToolbar(undefined, {
      instanceId: "one",
      extensions: [agentBridge({ instanceId: "one", globalName: "__OTHER__" })],
    });

    expect(scope[DEFAULT_GLOBAL_NAME]).toBeUndefined();
    expect(handleFor("one", "__OTHER__").instanceId).toBe("one");
  });

  it("refuses to install over a foreign global rather than overwriting it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    scope[DEFAULT_GLOBAL_NAME] = { mine: true };

    renderWithToolbar(undefined, { extensions: [agentBridge()] });

    expect(scope[DEFAULT_GLOBAL_NAME]).toEqual({ mine: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("already taken"));
    delete scope[DEFAULT_GLOBAL_NAME];
  });
});

describe("a second mounted toolbar", () => {
  it("does not clobber the first", () => {
    const first = renderWithToolbar(undefined, {
      instanceId: "first",
      extensions: [
        agentBridge({ instanceId: "first" }),
        makeExtension({ id: "only-in-first", diagnostics: () => ({ which: "first" }) }),
      ],
    });
    renderWithToolbar(undefined, {
      instanceId: "second",
      extensions: [
        agentBridge({ instanceId: "second" }),
        makeExtension({ id: "only-in-second", diagnostics: () => ({ which: "second" }) }),
      ],
    });

    // Both handles exist, and each reads its *own* toolbar — a singleton
    // global would have let the second mount silently win.
    expect(Object.keys(registry().instances).sort()).toEqual(["first", "second"]);
    const ids = (instanceId: string) =>
      handleFor(instanceId)
        .read()
        .diagnostics.map((entry) => entry.id);
    expect(ids("first")).toContain("only-in-first");
    expect(ids("first")).not.toContain("only-in-second");
    expect(ids("second")).toContain("only-in-second");

    first.unmount();
    expect(Object.keys(registry().instances)).toEqual(["second"]);
    expect(registry().default.instanceId).toBe("second");
  });

  it("has no default, and says which ids to pick from", () => {
    renderWithToolbar(undefined, {
      instanceId: "first",
      extensions: [agentBridge({ instanceId: "first" })],
    });
    renderWithToolbar(undefined, {
      instanceId: "second",
      extensions: [agentBridge({ instanceId: "second" })],
    });

    expect(() => registry().default).toThrow(/2 toolbars are mounted \(first, second\)/);
  });

  it("refuses a duplicate instanceId instead of replacing the first handle", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderWithToolbar(undefined, {
      instanceId: "same",
      extensions: [
        agentBridge({ instanceId: "same" }),
        makeExtension({ id: "only-in-first", diagnostics: () => ({}) }),
      ],
    });
    renderWithToolbar(undefined, {
      instanceId: "same",
      extensions: [agentBridge({ instanceId: "same" })],
    });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("already registered"));
    expect(
      handleFor("same")
        .read()
        .diagnostics.map((entry) => entry.id),
    ).toContain("only-in-first");
  });
});

describe("teardown", () => {
  it("removes the global entirely when the last instance unmounts", () => {
    const { unmount } = renderWithToolbar(undefined, { extensions: [agentBridge()] });
    expect(scope[DEFAULT_GLOBAL_NAME]).toBeDefined();

    unmount();

    // Not an empty registry left behind: a name that still resolves reads as
    // "a toolbar is mounted" to anything probing for one.
    expect(scope[DEFAULT_GLOBAL_NAME]).toBeUndefined();
  });

  it("throws a useful message from `default` once nothing is mounted", () => {
    const registryObject = (() => {
      const { unmount } = renderWithToolbar(undefined, { extensions: [agentBridge()] });
      const captured = registry();
      unmount();
      return captured;
    })();

    expect(() => registryObject.default).toThrow(/no toolbar is mounted/);
  });
});

describe("read()", () => {
  it("masks an access_token URL on the way out", () => {
    renderWithToolbar(undefined, {
      extensions: [
        agentBridge(),
        makeExtension({
          id: "leaky",
          diagnostics: () => ({
            lastRequest: "https://api.example.com/v1/me?access_token=sk-live-abc123&page=2",
            apiKey: "sk-live-abc123",
          }),
        }),
      ],
    });

    const entry = registry()
      .default.read()
      .diagnostics.find((row) => row.id === "leaky");
    const data = entry?.data as { lastRequest: string; apiKey: string };
    expect(data.lastRequest).not.toContain("sk-live-abc123");
    expect(data.lastRequest).toContain("[redacted]");
    // The rest of the URL survives — masking is not deletion.
    expect(data.lastRequest).toContain("page=2");
    expect(data.apiKey).toBe("[redacted]");
  });

  it("masks a consumer's own key shape through extraKeys", () => {
    renderWithToolbar(undefined, {
      extensions: [
        agentBridge({ extraKeys: ["tenantcode"] }),
        makeExtension({ id: "tenant", diagnostics: () => ({ tenantCode: "acme-42" }) }),
      ],
    });

    const entry = registry()
      .default.read()
      .diagnostics.find((row) => row.id === "tenant");
    const data = entry?.data as { tenantCode: string } | undefined;
    expect(data?.tenantCode).toBe("[redacted]");
  });

  it("inherits `hidden` from the aggregations rather than reimplementing it", () => {
    renderWithToolbar(undefined, {
      extensions: [
        agentBridge(),
        makeExtension({
          id: "ghost",
          hidden: true,
          diagnostics: () => ({ secretive: true }),
          commands: [{ id: "ghost.run", label: "Ghost", run: () => {} }],
        }),
      ],
    });

    const snapshot = registry().default.read();
    expect(snapshot.diagnostics.some((row) => row.id === "ghost")).toBe(false);
    expect(snapshot.commands.some((command) => command.id === "ghost.run")).toBe(false);
  });

  it("reports commands as data, visibility, and the allowRun setting", () => {
    renderWithToolbar(undefined, {
      extensions: [
        agentBridge(),
        makeExtension({
          id: "jobs",
          commands: [
            {
              id: "jobs.drain",
              label: "Drain the queue",
              group: "Jobs",
              keywords: ["queue"],
              shortcut: "Mod+D",
              run: () => {},
            },
          ],
        }),
      ],
    });

    const snapshot = registry().default.read();
    expect(snapshot.visible).toBe(true);
    expect(snapshot.allowRun).toBe(false);
    expect(snapshot.commands).toContainEqual({
      id: "jobs.drain",
      label: "Drain the queue",
      group: "Jobs",
      keywords: ["queue"],
      shortcut: "Mod+D",
    });
    // No `run` crosses the boundary: structured clone would drop it anyway.
    expect(snapshot.commands.every((command) => !("run" in command))).toBe(true);
    expect(registry().default.listCommands()).toEqual(snapshot.commands);
  });
});

describe("allowRun", () => {
  const ran = { count: 0 };
  const runnable = () =>
    makeExtension({
      id: "jobs",
      commands: [
        {
          id: "jobs.drain",
          label: "Drain",
          run: () => {
            ran.count += 1;
          },
        },
        {
          id: "jobs.explode",
          label: "Explode",
          run: () => {
            // The message *is* the URL, which is what `fetch` and axios
            // throw: `redact()` anchors its value matching to the whole
            // string, so a credential mid-sentence is not maskable and the
            // bridge deliberately does not pretend otherwise.
            throw new TypeError("https://api.example.com/v1?access_token=sk-live-abc");
          },
        },
      ],
    });

  it("exposes no way to run anything when off", () => {
    ran.count = 0;
    renderWithToolbar(undefined, { extensions: [agentBridge(), runnable()] });

    const handle = registry().default;
    expect(handle.allowRun).toBe(false);
    expect(handle.runCommand).toBeUndefined();
    expect("runCommand" in handle).toBe(false);
    // Check every own function, not only `runCommand`, for an accidental run path.
    for (const value of Object.values(handle as unknown as Record<string, unknown>)) {
      if (typeof value === "function") (value as () => unknown)();
    }
    expect(ran.count).toBe(0);
    expect(Object.keys(handle).sort()).toEqual([
      "allowRun",
      "contractVersion",
      "instanceId",
      "listCommands",
      "read",
    ]);
  });

  it("runs a command when on, and reports the result as a value", async () => {
    ran.count = 0;
    renderWithToolbar(undefined, { extensions: [agentBridge({ allowRun: true }), runnable()] });

    const handle = registry().default;
    expect(handle.allowRun).toBe(true);
    expect(handle.read().allowRun).toBe(true);
    await expect(handle.runCommand?.("jobs.drain")).resolves.toEqual({ ok: true });
    expect(ran.count).toBe(1);
  });

  it("resolves unknown-command rather than rejecting", async () => {
    renderWithToolbar(undefined, { extensions: [agentBridge({ allowRun: true }), runnable()] });

    // A rejection crossing `page.evaluate` has no useful shape to branch on.
    await expect(registry().default.runCommand?.("nope.nothing")).resolves.toEqual({
      ok: false,
      reason: "unknown-command",
    });
  });

  it("turns a throwing command into a value, with the message masked", async () => {
    renderWithToolbar(undefined, { extensions: [agentBridge({ allowRun: true }), runnable()] });

    const result = await registry().default.runCommand?.("jobs.explode");
    expect(result).toMatchObject({ ok: false, reason: "threw", errorName: "TypeError" });
    const message = (result as { error: string }).error;
    expect(message).not.toContain("sk-live-abc");
    expect(message).toContain("[redacted]");
  });
});

describe("the chip", () => {
  it("says whether the mounted global can run commands", () => {
    const { toolbar, unmount } = renderWithToolbar(undefined, {
      extensions: [agentBridge({ allowRun: true })],
    });

    const chip = toolbar.item("agent")?.querySelector("[data-dtb-agent-mode]");
    expect(chip?.getAttribute("data-dtb-agent-mode")).toBe("run-enabled");
    expect(chip?.getAttribute("title")).toContain("can run commands");
    expect(chip?.textContent).toBe("Agent");
    unmount();

    const readOnly = renderWithToolbar(undefined, { extensions: [agentBridge()] });
    const span = readOnly.toolbar.item("agent")?.querySelector("[data-dtb-agent-mode]");
    expect(span?.getAttribute("data-dtb-agent-mode")).toBe("read-only");
    expect(span?.getAttribute("title")).toContain("reads state only");
  });

  it("collapses into the overflow menu before an ordinary extension does", () => {
    // The bridge is a transport: when the bar runs out of room its chip must
    // yield before a metrics sparkline or an environment badge, both of which
    // sit at core's default priority of 0. Lowest priority collapses first, so
    // the default here has to be *below* 0 — `1` did the exact opposite.
    const { toolbar } = renderWithToolbar(undefined, {
      instanceId: "narrow",
      extensions: [
        makeExtension({ id: "ordinary", label: "Ordinary" }),
        agentBridge({ instanceId: "narrow" }),
      ],
      layout: { barWidth: 400, itemWidth: 150 },
    });

    expect(toolbar.overflowedIds()).toEqual([]);

    toolbar.resize(200);
    expect(toolbar.overflowedIds()).toEqual(["agent"]);
    expect(toolbar.isOverflowed("ordinary")).toBe(false);
  });
});

describe("a captured handle", () => {
  it("refuses to answer once its toolbar has unmounted", async () => {
    const { unmount } = renderWithToolbar(undefined, {
      extensions: [agentBridge({ allowRun: true }), makeExtension({ id: "jobs" })],
    });
    const handle = registry().default;

    unmount();

    // Deleting the registry entry stops anyone *finding* it; `api` outlives
    // the mount, so the handle has to refuse for itself.
    expect(() => handle.read()).toThrow(/after its toolbar unmounted/);
    expect(() => handle.listCommands()).toThrow(/after its toolbar unmounted/);
    // Runs keep the errors-as-values rule instead of throwing.
    await expect(handle.runCommand?.("jobs.anything")).resolves.toEqual({
      ok: false,
      reason: "torn-down",
    });
  });
});

describe("the registry object", () => {
  it("stays walkable when there is no default", () => {
    // `default` throws whenever the count is not exactly one. Enumerable, it
    // would take `{...registry}`, `Object.entries` and `JSON.stringify` down
    // with it — a trap for any in-page tooling that walks the global.
    renderWithToolbar(undefined, {
      instanceId: "first",
      extensions: [agentBridge({ instanceId: "first" })],
    });
    renderWithToolbar(undefined, {
      instanceId: "second",
      extensions: [agentBridge({ instanceId: "second" })],
    });

    const live = registry();
    expect(() => live.default).toThrow();
    expect(() => ({ ...live })).not.toThrow();
    expect(() => Object.entries(live)).not.toThrow();
    expect(() => JSON.stringify(live)).not.toThrow();
    expect(Object.keys(live)).toEqual(["protocolVersion", "instances"]);
  });
});
