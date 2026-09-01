/**
 * `/ext/flags`'s non-React half: the override map, the adapter contract, the
 * redaction pass and the fail-closed guarantees.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { createMemoryStorage } from "../../../core/storage";
import { createFlagsRuntime, OVERRIDES_KEY, parseOverrides } from "../runtime";
import { parseValue, severityFor } from "../types";
import type { FlagReading, FlagValue, FlagView } from "../types";
import type { ExtensionRuntimeApi, ToolbarStorage } from "../../../core/contract";

const CATALOGUE: FlagReading[] = [
  { key: "ui-facelift", type: "boolean", defaultValue: false, value: false },
  { key: "new-header", type: "boolean", defaultValue: false, value: true, source: "cohort" },
  { key: "checkout.copy", type: "string", defaultValue: "old", value: "old" },
  {
    key: "search.rank",
    type: "number",
    defaultValue: 1,
    value: 2,
    reloadBehavior: "full-reload",
  },
];

function fakeApi(storage: ToolbarStorage): {
  api: ExtensionRuntimeApi;
  abort(): void;
  setVisible(visible: boolean): void;
} {
  const controller = new AbortController();
  const listeners = new Set<(visible: boolean) => void>();
  return {
    api: {
      signal: controller.signal,
      isVisible: () => true,
      subscribeVisibility(callback) {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
      getCommands: () => [],
      getDiagnostics: () => [],
      runCommand: async () => false,
      storage,
    },
    abort: () => controller.abort(),
    setVisible: (visible) => listeners.forEach((listener) => listener(visible)),
  };
}

let consoleError: Mock<typeof console.error>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("the snapshot", () => {
  it("is built in the factory, before start() has ever run", () => {
    const runtime = createFlagsRuntime({ flags: CATALOGUE });
    expect(runtime.store.getSnapshot().flags).toHaveLength(4);
    expect(runtime.storage()).toBeNull();
  });

  it("keeps the application's own value visible next to the override", () => {
    const applied: [string, FlagValue | undefined][] = [];
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: (key, value) => applied.push([key, value]),
    });
    runtime.setOverride("checkout.copy", "new");

    const view = runtime.store.getSnapshot().flags.find((entry) => entry.key === "checkout.copy");
    expect(view?.effectiveText).toBe("new");
    // The honest half: the app's own value is still on screen.
    expect(view?.baseText).toBe("old");
    expect(view?.defaultText).toBe("old");
    expect(view?.overridden).toBe(true);
    expect(view?.source).toBe("local-override");
    expect(applied).toEqual([["checkout.copy", "new"]]);
  });

  it("marks the override from its own map, not by comparing values", () => {
    // A consumer who folds overrides back into the store they read `value`
    // from makes base === effective. The badge must still be right.
    let base = false;
    const runtime = createFlagsRuntime({
      flags: () => [{ key: "ui-facelift", type: "boolean", value: base }],
      onOverride: (_key, value) => {
        base = value === undefined ? false : value === true;
      },
    });
    runtime.setOverride("ui-facelift", true);
    const view = runtime.store.getSnapshot().flags[0];
    expect(view?.base).toBe(true);
    expect(view?.effective).toBe(true);
    expect(view?.overridden).toBe(true);
  });

  it("reports `unknown` and an empty list when nothing was supplied", () => {
    const snapshot = createFlagsRuntime().store.getSnapshot();
    expect(snapshot.supplied).toBe(false);
    expect(snapshot.flags).toEqual([]);
    expect(snapshot.writable).toBe(false);
  });
});

describe("overrides", () => {
  it("clears one and tells the adapter to fall back", () => {
    const applied: [string, FlagValue | undefined][] = [];
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: (key, value) => applied.push([key, value]),
    });
    runtime.setOverride("ui-facelift", true);
    runtime.clearOverride("ui-facelift");
    expect(applied).toEqual([
      ["ui-facelift", true],
      ["ui-facelift", undefined],
    ]);
    expect(runtime.overrides()).toEqual({});
    expect(runtime.store.getSnapshot().overriddenCount).toBe(0);
  });

  it("clears them all — the escape hatch", () => {
    const applied: [string, FlagValue | undefined][] = [];
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: (key, value) => applied.push([key, value]),
    });
    runtime.setOverride("ui-facelift", true);
    runtime.setOverride("checkout.copy", "new");
    applied.length = 0;
    runtime.clearAll();
    expect(applied.map(([key]) => key).sort()).toEqual(["checkout.copy", "ui-facelift"]);
    expect(applied.every(([, value]) => value === undefined)).toBe(true);
    expect(runtime.overrides()).toEqual({});
  });

  it("toggling back to the application's own value leaves no override behind", () => {
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: () => {},
    });
    runtime.toggle("new-header"); // app says true → override false
    expect(runtime.overrides()).toEqual({ "new-header": false });
    runtime.toggle("new-header"); // back to true, which is what the app says
    expect(runtime.overrides()).toEqual({});
  });

  it("marks a non-live flag as needing a reload", () => {
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: () => {},
    });
    runtime.setOverride("search.rank", 9);
    expect(runtime.store.getSnapshot().reloadPending).toEqual(["search.rank"]);
    runtime.setOverride("checkout.copy", "new"); // live — no new entry
    expect(runtime.store.getSnapshot().reloadPending).toEqual(["search.rank"]);
    runtime.acknowledgeReload();
    expect(runtime.store.getSnapshot().reloadPending).toEqual([]);
  });
});

describe("read-only mode", () => {
  it("changes nothing at all without an adapter", () => {
    const runtime = createFlagsRuntime({ flags: CATALOGUE });
    runtime.setOverride("ui-facelift", true);
    runtime.toggle("ui-facelift");
    runtime.clearAll();
    expect(runtime.overrides()).toEqual({});
    expect(runtime.store.getSnapshot().writable).toBe(false);
    expect(runtime.store.getSnapshot().overriddenCount).toBe(0);
  });

  it("does not persist anything either", () => {
    const storage = createMemoryStorage();
    const runtime = createFlagsRuntime({ flags: CATALOGUE });
    const { api } = fakeApi(storage);
    runtime.start(api);
    runtime.setOverride("ui-facelift", true);
    expect(storage.getItem(OVERRIDES_KEY)).toBeNull();
  });
});

describe("persistence", () => {
  it("writes the override map and removes the key when it empties", () => {
    const storage = createMemoryStorage();
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: () => {},
    });
    runtime.start(fakeApi(storage).api);
    runtime.setOverride("ui-facelift", true);
    expect(JSON.parse(storage.getItem(OVERRIDES_KEY) as string)).toEqual({
      "ui-facelift": true,
    });
    runtime.clearAll();
    expect(storage.getItem(OVERRIDES_KEY)).toBeNull();
  });

  it("restores on the next mount and re-applies through the adapter", () => {
    const storage = createMemoryStorage({
      [OVERRIDES_KEY]: JSON.stringify({ "ui-facelift": true }),
    });
    const applied: [string, FlagValue | undefined][] = [];
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: (key, value) => applied.push([key, value]),
    });
    // Before start(), the app has its own values and nothing is overridden.
    expect(runtime.store.getSnapshot().overriddenCount).toBe(0);
    runtime.start(fakeApi(storage).api);
    expect(applied).toEqual([["ui-facelift", true]]);
    expect(runtime.store.getSnapshot().overriddenCount).toBe(1);
  });

  it("drops junk rather than trusting it", () => {
    expect(parseOverrides(null)).toEqual({});
    expect(parseOverrides("not json")).toEqual({});
    expect(parseOverrides("[1,2]")).toEqual({});
    expect(parseOverrides('{"a":true,"b":{"nested":1},"c":"x"}')).toEqual({
      a: true,
      c: "x",
    });
  });

  it("round-trips a __proto__ key as data, in both directions", () => {
    const restored = parseOverrides('{"__proto__":"x","a":1}');
    // Data, not a prototype: nothing is polluted and nothing is silently lost.
    expect(Object.getPrototypeOf(restored)).toBeNull();
    expect(Object.keys(restored).sort()).toEqual(["__proto__", "a"]);
    expect(({} as Record<string, unknown>)["x"]).toBeUndefined();

    const storage = createMemoryStorage();
    const runtime = createFlagsRuntime({
      flags: [{ key: "__proto__", type: "string", value: "base" }],
      onOverride: () => {},
    });
    runtime.start(fakeApi(storage).api);
    runtime.setOverride("__proto__", "x");
    const persisted = parseOverrides(storage.getItem(OVERRIDES_KEY));
    expect(Object.keys(persisted)).toEqual(["__proto__"]);
    expect(persisted["__proto__"]).toBe("x");

    // And it renders as itself. `redact()` used to rebuild into a plain object,
    // where writing `__proto__` is swallowed by the prototype's setter, so the
    // row read back through `Object.prototype` and displayed "[object Object]"
    // for every value — with a "masked" badge, because the two rendered forms
    // differed. Fixed in /runtime; /ext/environment had it too.
    const view = runtime.store.getSnapshot().flags.find((entry) => entry.key === "__proto__");
    expect(view?.effectiveText).toBe("x");
    expect(view?.baseText).toBe("base");
    expect(view?.masked).toBe(false);
    expect(({} as Record<string, unknown>)["x"]).toBeUndefined();
  });

  it("survives a storage adapter that throws on every method", () => {
    const hostile: ToolbarStorage = {
      getItem: () => {
        throw new Error("nope");
      },
      setItem: () => {
        throw new Error("nope");
      },
      removeItem: () => {
        throw new Error("nope");
      },
    };
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: () => {},
    });
    expect(() => runtime.start(fakeApi(hostile).api)).not.toThrow();
    expect(() => runtime.setOverride("ui-facelift", true)).not.toThrow();
  });
});

describe("orphaned overrides", () => {
  const orphaned = () =>
    createMemoryStorage({
      [OVERRIDES_KEY]: JSON.stringify({ "checkout.v2": "on", "ui-facelift": true }),
    });

  it("are counted, not hidden, because they are still being applied", () => {
    const applied: [string, FlagValue | undefined][] = [];
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: (key, value) => applied.push([key, value]),
    });
    runtime.start(fakeApi(orphaned()).api);
    // Both were applied to the application…
    expect(applied.map(([key]) => key).sort()).toEqual(["checkout.v2", "ui-facelift"]);
    const snapshot = runtime.store.getSnapshot();
    // …so both are counted, and the orphan has a row of its own.
    expect(snapshot.overriddenCount).toBe(2);
    const orphan = snapshot.flags.find((view) => view.key === "checkout.v2");
    expect(orphan?.orphaned).toBe(true);
    expect(orphan?.effectiveText).toBe("on");
    expect(orphan?.baseText).toBe("—");
    expect(orphan?.source).toBe("local-override");
  });

  it("grade as warn — stale state to clean up, not a deliberate override", () => {
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: () => {},
    });
    runtime.start(fakeApi(orphaned()).api);
    const snapshot = runtime.store.getSnapshot();
    const orphan = snapshot.flags.find((v) => v.key === "checkout.v2");
    const live = snapshot.flags.find((v) => v.key === "ui-facelift");
    expect(severityFor(orphan as FlagView)).toBe("warn");
    // …and a live override still grades as one, so the two are distinguishable.
    expect(severityFor(live as FlagView)).toBe("override");
  });

  it("still grade bad when their own clear or apply failed", () => {
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: (key) => {
        if (key === "checkout.v2") throw new Error("offline");
      },
    });
    runtime.start(fakeApi(orphaned()).api);
    const orphan = runtime.store.getSnapshot().flags.find((v) => v.key === "checkout.v2");
    expect(severityFor(orphan as FlagView)).toBe("bad");
  });

  it("are removed by clearAll and by their own clear", () => {
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: () => {},
    });
    const storage = orphaned();
    runtime.start(fakeApi(storage).api);
    runtime.clearOverride("checkout.v2");
    expect(runtime.store.getSnapshot().overriddenCount).toBe(1);
    runtime.clearAll();
    expect(storage.getItem(OVERRIDES_KEY)).toBeNull();
    expect(runtime.store.getSnapshot().flags.every((v) => !v.orphaned)).toBe(true);
  });

  it("stop being orphans the moment the catalogue lists them again", () => {
    let extended = false;
    const runtime = createFlagsRuntime({
      flags: () =>
        extended ? [...CATALOGUE, { key: "checkout.v2", type: "string", value: "off" }] : CATALOGUE,
      onOverride: () => {},
    });
    runtime.start(fakeApi(orphaned()).api);
    expect(runtime.store.getSnapshot().flags.find((v) => v.key === "checkout.v2")?.orphaned).toBe(
      true,
    );
    extended = true;
    runtime.refresh();
    runtime.store.flush();
    const view = runtime.store.getSnapshot().flags.find((v) => v.key === "checkout.v2");
    expect(view?.orphaned).toBe(false);
    expect(view?.baseText).toBe("off");
    expect(view?.overridden).toBe(true);
  });
});

describe("the kill switch", () => {
  it("drops every stored override when the URL asks", () => {
    const storage = createMemoryStorage({
      [OVERRIDES_KEY]: JSON.stringify({ "ui-facelift": true }),
    });
    const applied: string[] = [];
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: (key) => applied.push(key),
    });
    const original = window.location.search;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, search: "?dtb-flags=reset" },
    });
    try {
      runtime.start(fakeApi(storage).api);
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { ...window.location, search: original },
      });
    }
    expect(runtime.overrides()).toEqual({});
    expect(storage.getItem(OVERRIDES_KEY)).toBeNull();
    // Nothing was applied — the wedging override never reached the app.
    expect(applied).toEqual([]);
  });
});

describe("failing closed", () => {
  it("does not throw out of the factory when the flags getter throws", () => {
    const runtime = createFlagsRuntime({
      flags: () => {
        throw new Error("consumer getter exploded");
      },
    });
    expect(runtime.store.getSnapshot().flags).toEqual([]);
    expect(consoleError).toHaveBeenCalled();
  });

  it("does not throw out of the factory when a flag reading has a throwing getter", () => {
    const hostile = [
      {
        key: "boom",
        get value(): never {
          throw new Error("getter exploded");
        },
      },
    ] as unknown as FlagReading[];
    const runtime = createFlagsRuntime({ flags: hostile });
    const snapshot = runtime.store.getSnapshot();
    expect(snapshot.flags).toEqual([]);
    expect(snapshot.readError).toContain("could not be read");
  });

  it("records a throwing adapter instead of swallowing it or propagating it", () => {
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: () => {
        throw new Error("provider is offline");
      },
    });
    expect(() => runtime.setOverride("ui-facelift", true)).not.toThrow();
    const snapshot = runtime.store.getSnapshot();
    expect(snapshot.adapterErrors["ui-facelift"]).toContain("provider is offline");
    expect(snapshot.flags.find((view) => view.key === "ui-facelift")?.applyError).toContain(
      "provider is offline",
    );
    expect(consoleError).toHaveBeenCalled();
  });

  it("keeps one key's failure when another key succeeds", () => {
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: (key) => {
        if (key === "ui-facelift") throw new Error("provider is offline");
      },
    });
    runtime.setOverride("ui-facelift", true);
    runtime.setOverride("checkout.copy", "new");
    const snapshot = runtime.store.getSnapshot();
    // A single error slot was erased here by the unrelated success, taking the
    // only warning off screen while the row kept claiming to be overridden.
    expect(snapshot.adapterErrors["ui-facelift"]).toContain("provider is offline");
    expect(snapshot.adapterErrors["checkout.copy"]).toBeUndefined();
    expect(snapshot.flags.find((v) => v.key === "ui-facelift")?.applyError).toBeDefined();
    expect(snapshot.flags.find((v) => v.key === "checkout.copy")?.applyError).toBeUndefined();
  });

  it("keeps a failure raised while re-applying stored overrides on mount", () => {
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: (key) => {
        if (key === "ui-facelift") throw new Error("provider is offline");
      },
    });
    runtime.start(
      fakeApi(
        createMemoryStorage({
          [OVERRIDES_KEY]: JSON.stringify({
            "ui-facelift": true,
            "checkout.copy": "new",
          }),
        }),
      ).api,
    );
    // The load where it matters most: the first stored override failed and the
    // second succeeded, and the failure must survive that.
    expect(runtime.store.getSnapshot().adapterErrors["ui-facelift"]).toContain(
      "provider is offline",
    );
  });

  it("clears a key's failure only on that key's own success", () => {
    let broken = true;
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: (key) => {
        if (broken && key === "ui-facelift") throw new Error("offline");
      },
    });
    runtime.setOverride("ui-facelift", true);
    expect(runtime.store.getSnapshot().adapterErrors).toHaveProperty("ui-facelift");
    broken = false;
    runtime.setOverride("ui-facelift", false);
    expect(runtime.store.getSnapshot().adapterErrors).toEqual({});
  });

  it("does not throw out of start()'s poll when the getter starts throwing later", () => {
    let healthy = true;
    const runtime = createFlagsRuntime({
      flags: () => {
        if (!healthy) throw new Error("later failure");
        return CATALOGUE;
      },
      onOverride: () => {},
    });
    runtime.start(fakeApi(createMemoryStorage()).api);
    healthy = false;
    expect(() => runtime.refresh()).not.toThrow();
    expect(runtime.store.peek().flags).toEqual([]);
  });
});

describe("redaction", () => {
  const SENSITIVE: FlagReading[] = [
    { key: "checkout.apiToken", type: "string", value: "tok-abcdef123456" },
    // An innocent key whose *value* is credential-shaped: only the value pass
    // finds this one.
    { key: "checkout.header", type: "string", value: "Bearer abcdef123456" },
    {
      key: "billing.mode",
      type: "string",
      value: "sandbox",
      sensitive: true,
    },
    { key: "search.rank", type: "number", value: 3 },
  ];

  it("masks credential-shaped keys and values on the way in", () => {
    const runtime = createFlagsRuntime({ flags: SENSITIVE });
    const byKey = Object.fromEntries(
      runtime.store.getSnapshot().flags.map((view) => [view.key, view]),
    );
    expect(byKey["checkout.apiToken"]?.effectiveText).toBe("[redacted]");
    expect(byKey["checkout.apiToken"]?.masked).toBe(true);
    // A sensitive *key* masks the whole value; a credential-shaped *value*
    // under an innocent key keeps its scheme and loses its secret.
    expect(byKey["checkout.header"]?.effectiveText).toBe("Bearer [redacted]");
    // `sensitive: true` is the manual override for a value only you know about.
    expect(byKey["billing.mode"]?.effectiveText).toBe("[redacted]");
    // Numbers cannot carry a credential and are left readable.
    expect(byKey["search.rank"]?.effectiveText).toBe("3");
    expect(byKey["search.rank"]?.masked).toBe(false);
    expect(runtime.store.getSnapshot().maskedCount).toBe(3);
  });

  it("keeps the raw value out of the recipe and the JSON dump", () => {
    const runtime = createFlagsRuntime({
      flags: SENSITIVE,
      onOverride: () => {},
    });
    runtime.setOverride("checkout.apiToken", "tok-zzzzzz999999");
    const recipe = runtime.recipeText();
    expect(recipe).not.toContain("tok-zzzzzz999999");
    expect(recipe).not.toContain("tok-abcdef123456");
    expect(recipe).toContain("[redacted]");
    const dump = JSON.stringify(runtime.diagnostics());
    expect(dump).not.toContain("tok-zzzzzz999999");
    expect(dump).toContain("[redacted]");
  });

  it("says so when there is nothing to share", () => {
    const runtime = createFlagsRuntime({ flags: CATALOGUE, onOverride: () => {} });
    expect(runtime.recipeText()).toContain("No local flag overrides");
  });
});

describe("promotion", () => {
  it("promotes only inside the window and only for the audience", () => {
    const at = Date.parse("2026-06-01T00:00:00.000Z");
    const make = (promoted: Parameters<typeof createFlagsRuntime>[0]) =>
      createFlagsRuntime({ ...promoted, flags: CATALOGUE, now: () => at });

    expect(
      make({ promoted: { flagKey: "ui-facelift" } }).store.getSnapshot().promoted,
    ).toHaveLength(1);
    expect(
      make({
        promoted: { flagKey: "ui-facelift", startAt: "2026-09-01" },
      }).store.getSnapshot().promoted,
    ).toHaveLength(0);
    expect(
      make({
        promoted: { flagKey: "ui-facelift", expiresAt: "2026-01-01" },
      }).store.getSnapshot().promoted,
    ).toHaveLength(0);
    expect(
      make({
        promoted: { flagKey: "ui-facelift", audience: ["staff"] },
        audience: ["contractor"],
      }).store.getSnapshot().promoted,
    ).toHaveLength(0);
    expect(
      make({
        promoted: { flagKey: "ui-facelift", audience: ["staff"] },
        audience: ["staff"],
      }).store.getSnapshot().promoted,
    ).toHaveLength(1);
  });

  it("keeps bar order as declared, not as the panel sorts", () => {
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: () => {},
      promoted: [{ flagKey: "new-header" }, { flagKey: "ui-facelift" }],
    });
    // Overriding bubbles ui-facelift to the top of the *panel* list…
    runtime.setOverride("ui-facelift", true);
    expect(runtime.store.getSnapshot().flags[0]?.key).toBe("ui-facelift");
    // …and leaves the bar exactly where the consumer put it.
    expect(runtime.store.getSnapshot().promoted.map((v) => v.key)).toEqual([
      "new-header",
      "ui-facelift",
    ]);
  });

  it("ignores a promotion naming a flag that does not exist", () => {
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      promoted: { flagKey: "nope" },
    });
    expect(runtime.store.getSnapshot().promoted).toEqual([]);
  });
});

describe("the flag list signature", () => {
  it("republishes when only the default or the source changed", () => {
    let extra = false;
    const runtime = createFlagsRuntime({
      flags: () => [
        {
          key: "a",
          type: "string",
          value: "x",
          ...(extra
            ? { defaultValue: "changed", source: "cohort" as const }
            : { defaultValue: "x", source: "server-rule" as const }),
        },
      ],
    });
    expect(runtime.store.getSnapshot().flags[0]?.source).toBe("server-rule");
    extra = true;
    runtime.refresh();
    runtime.store.flush();
    const view = runtime.store.getSnapshot().flags[0];
    expect(view?.defaultText).toBe("changed");
    expect(view?.source).toBe("cohort");
  });
});

describe("revision", () => {
  it("advances on publish, not on every read", () => {
    const runtime = createFlagsRuntime({ flags: CATALOGUE, onOverride: () => {} });
    const before = runtime.store.getSnapshot().revision;
    runtime.recipeText();
    runtime.diagnostics();
    expect(runtime.store.getSnapshot().revision).toBe(before);
    runtime.setOverride("ui-facelift", true);
    expect(runtime.store.getSnapshot().revision).toBeGreaterThan(before);
  });
});

describe("parseValue", () => {
  it("refuses what it cannot parse rather than coercing it", () => {
    expect(parseValue("number", "abc")).toBeUndefined();
    expect(parseValue("number", "")).toBeUndefined();
    expect(parseValue("number", "1e")).toBeUndefined();
    expect(parseValue("number", " 12 ")).toBe(12);
    expect(parseValue("boolean", "yes")).toBeUndefined();
    expect(parseValue("boolean", "true")).toBe(true);
    expect(parseValue("string", "null")).toBeNull();
    expect(parseValue("string", "anything")).toBe("anything");
  });
});

describe("teardown", () => {
  it("stops the poll on abort and keeps the store alive across StrictMode", () => {
    vi.useFakeTimers();
    try {
      let reads = 0;
      const runtime = createFlagsRuntime({
        flags: () => {
          reads += 1;
          return CATALOGUE;
        },
        onOverride: () => {},
        pollMs: 250,
      });
      const first = fakeApi(createMemoryStorage());
      const dispose = runtime.start(first.api);
      dispose();
      vi.advanceTimersByTime(2000);
      const after = reads;
      vi.advanceTimersByTime(2000);
      expect(reads).toBe(after);
      // The store survived: a second start still publishes into it.
      runtime.start(fakeApi(createMemoryStorage()).api);
      runtime.setOverride("ui-facelift", true);
      expect(runtime.store.getSnapshot().overriddenCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
