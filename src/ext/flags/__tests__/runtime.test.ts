/**
 * `/ext/flags`'s non-React half: the override map, the adapter contract, the
 * redaction pass and the fail-closed guarantees.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSource } from "@nejcm/dev-toolbar/kit";
import { fakeExtensionApi } from "@nejcm/dev-toolbar/testing";
import type { Mock } from "vitest";
import { createMemoryStorage } from "../../../core/storage";
import { withLocation } from "../../../test-utils/location";
import {
  createFlagsRuntime,
  OVERRIDES_KEY,
  parseOverrides,
  resetDuplicateCatalogueKeyWarnings,
  vetOverrides,
} from "../runtime";
import { parseValue, severityFor } from "../types";
import type { FlagReading, FlagValue, FlagView, PromotedFlag } from "../types";
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
  const fake = fakeExtensionApi({ storage });
  return { api: fake.api, abort: fake.abort, setVisible: fake.setVisible };
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

  /*
   * Regression: read-only panels loaded stored overrides on start() and claimed
   * source: "local-override" even though apply() is a no-op — the app never saw them.
   */
  it("does not load stored overrides on start when there is no adapter", () => {
    const storage = createMemoryStorage({
      [OVERRIDES_KEY]: JSON.stringify({ "ui-facelift": true }),
    });
    const runtime = createFlagsRuntime({ flags: CATALOGUE });
    runtime.start(fakeApi(storage).api);
    expect(runtime.overrides()).toEqual({});
    const view = runtime.store.getSnapshot().flags.find((entry) => entry.key === "ui-facelift");
    expect(view?.overridden).toBe(false);
    expect(view?.source).not.toBe("local-override");
    expect(view?.source).toBe("default");
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

  /*
   * Regression: persisted overrides were union-vetted but not per-flag typed;
   * a string stored for a boolean flag reached the adapter with the wrong type.
   */
  it("drops type-mismatched overrides on start rather than applying them", () => {
    const storage = createMemoryStorage({
      [OVERRIDES_KEY]: JSON.stringify({ "ui-facelift": "true", "search.rank": "9" }),
    });
    const applied: [string, FlagValue | undefined][] = [];
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: (key, value) => applied.push([key, value]),
    });
    runtime.start(fakeApi(storage).api);
    expect(applied).toEqual([]);
    expect(runtime.overrides()).toEqual({});
    expect(runtime.store.getSnapshot().overriddenCount).toBe(0);
  });

  it("drops variant overrides outside the declared list on start", () => {
    const catalogue: FlagReading[] = [
      {
        key: "theme",
        type: "variant",
        variants: ["light", "dark", null],
        value: "light",
      },
    ];
    const storage = createMemoryStorage({
      [OVERRIDES_KEY]: JSON.stringify({ theme: "neon" }),
    });
    const applied: [string, FlagValue | undefined][] = [];
    const runtime = createFlagsRuntime({
      flags: catalogue,
      onOverride: (key, value) => applied.push([key, value]),
    });
    runtime.start(fakeApi(storage).api);
    expect(applied).toEqual([]);
    expect(runtime.overrides()).toEqual({});
  });

  it("keeps variant overrides that are declared", () => {
    const catalogue: FlagReading[] = [
      {
        key: "theme",
        type: "variant",
        variants: ["light", "dark", null],
        value: "light",
      },
    ];
    const storage = createMemoryStorage({
      [OVERRIDES_KEY]: JSON.stringify({ theme: "dark" }),
    });
    const applied: [string, FlagValue | undefined][] = [];
    const runtime = createFlagsRuntime({
      flags: catalogue,
      onOverride: (key, value) => applied.push([key, value]),
    });
    runtime.start(fakeApi(storage).api);
    expect(applied).toEqual([["theme", "dark"]]);
    expect(runtime.overrides()).toEqual({ theme: "dark" });
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

    // Regression: `redact()` used to rebuild into a plain object, where writing
    // `__proto__` is swallowed by the prototype's setter — every value then
    // read back as "[object Object]" and wrongly showed as masked.
    const view = runtime.store.getSnapshot().flags.find((entry) => entry.key === "__proto__");
    expect(view?.effectiveText).toBe("x");
    expect(view?.baseText).toBe("base");
    expect(view?.masked).toBe(false);
    expect(({} as Record<string, unknown>)["x"]).toBeUndefined();
  });

  it("keeps session overrides across a restart when every storage call throws", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    const storage = { getItem: blocked, setItem: blocked, removeItem: blocked };

    const onOverride = vi.fn();
    const perKeyRuntime = createFlagsRuntime({ flags: CATALOGUE, onOverride });
    const stopPerKey = perKeyRuntime.start(fakeApi(storage).api);
    perKeyRuntime.setOverride("ui-facelift", true);
    expect(perKeyRuntime.store.getSnapshot().overriddenCount).toBe(1);
    stopPerKey();
    onOverride.mockClear();

    const stopPerKeyAgain = perKeyRuntime.start(fakeApi(storage).api);
    const perKeySnapshot = perKeyRuntime.store.getSnapshot();
    stopPerKeyAgain();

    const onOverridesChange = vi.fn();
    const bulkRuntime = createFlagsRuntime({ flags: CATALOGUE, onOverridesChange });
    const stopBulk = bulkRuntime.start(fakeApi(storage).api);
    bulkRuntime.setOverride("ui-facelift", true);
    expect(bulkRuntime.store.getSnapshot().overriddenCount).toBe(1);
    stopBulk();
    onOverridesChange.mockClear();

    const stopBulkAgain = bulkRuntime.start(fakeApi(storage).api);
    const bulkSnapshot = bulkRuntime.store.getSnapshot();
    stopBulkAgain();

    expect.soft(perKeySnapshot.overriddenCount).toBe(1);
    expect
      .soft(perKeySnapshot.flags.find((view) => view.key === "ui-facelift")?.overridden)
      .toBe(true);
    expect.soft(onOverride).toHaveBeenCalledWith("ui-facelift", true);
    expect.soft(bulkSnapshot.overriddenCount).toBe(1);
    expect
      .soft(bulkSnapshot.flags.find((view) => view.key === "ui-facelift")?.overridden)
      .toBe(true);
    expect.soft(onOverridesChange).toHaveBeenCalledWith({ "ui-facelift": true });
  });

  it("clears the session map on a restart when readable storage has no overrides", () => {
    const storage = createMemoryStorage();
    const runtime = createFlagsRuntime({ flags: CATALOGUE, onOverride: () => {} });
    const stop = runtime.start(fakeApi(storage).api);
    runtime.setOverride("ui-facelift", true);
    stop();
    storage.removeItem(OVERRIDES_KEY);

    const stopAgain = runtime.start(fakeApi(storage).api);
    expect(runtime.store.getSnapshot().overriddenCount).toBe(0);
    stopAgain();
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

function withResetParam<T>(fn: () => T): T {
  return withLocation({ search: "?dtb-flags=reset" }, fn);
}

describe("the kill switch", () => {
  it("drops every stored override when the URL asks", () => {
    const storage = createMemoryStorage({
      [OVERRIDES_KEY]: JSON.stringify({ "ui-facelift": true }),
    });
    const applied: [string, FlagValue | undefined][] = [];
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: (key, value) => applied.push([key, value]),
    });
    withResetParam(() => runtime.start(fakeApi(storage).api));
    expect(runtime.overrides()).toEqual({});
    expect(storage.getItem(OVERRIDES_KEY)).toBeNull();
    // No *value* was applied — the wedging override never reached the app.
    expect(applied.filter(([, value]) => value !== undefined)).toEqual([]);
  });

  it("tells the adapter about every override it drops", () => {
    const storage = createMemoryStorage({
      [OVERRIDES_KEY]: JSON.stringify({ "ui-facelift": true, "checkout.copy": "new" }),
    });
    const applied: [string, FlagValue | undefined][] = [];
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: (key, value) => applied.push([key, value]),
    });
    withResetParam(() => runtime.start(fakeApi(storage).api));
    expect(applied.sort()).toEqual([
      ["checkout.copy", undefined],
      ["ui-facelift", undefined],
    ]);
    expect(storage.getItem(OVERRIDES_KEY)).toBeNull();
  });

  it("hands a bulk mirror the empty map, after the per-key clears", () => {
    const storage = createMemoryStorage({
      [OVERRIDES_KEY]: JSON.stringify({ "ui-facelift": true }),
    });
    const events: string[] = [];
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: (key, value) => events.push(`${key}=${String(value)}`),
      onOverridesChange: (overrides) => events.push(`all:${JSON.stringify(overrides)}`),
    });
    withResetParam(() => runtime.start(fakeApi(storage).api));
    expect(events).toEqual(["ui-facelift=undefined", "all:{}"]);
  });

  it("un-applies session overrides on a reset load even when storage cannot be read", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    const storage = { getItem: blocked, setItem: blocked, removeItem: blocked };
    const mapsAtClear: Record<string, FlagValue>[] = [];
    const onOverride = vi.fn((_key: string, value: FlagValue | undefined) => {
      if (value === undefined) mapsAtClear.push(runtime.overrides());
    });
    const runtime = createFlagsRuntime({ flags: CATALOGUE, onOverride });
    const stop = runtime.start(fakeApi(storage).api);
    runtime.setOverride("ui-facelift", true);
    stop();
    onOverride.mockClear();

    const stopAgain = withResetParam(() => runtime.start(fakeApi(storage).api));
    const resetOverrides = runtime.overrides();
    const resetSnapshot = runtime.store.getSnapshot();
    stopAgain();

    expect.soft(onOverride).toHaveBeenCalledWith("ui-facelift", undefined);
    expect.soft(mapsAtClear).toEqual([{}]);
    expect.soft(resetOverrides).toEqual({});
    expect.soft(resetSnapshot.overriddenCount).toBe(0);
  });

  it("still clears the store when no adapter was supplied", () => {
    const storage = createMemoryStorage({
      [OVERRIDES_KEY]: JSON.stringify({ "ui-facelift": true }),
    });
    const runtime = createFlagsRuntime({ flags: CATALOGUE });
    withResetParam(() => runtime.start(fakeApi(storage).api));
    expect(storage.getItem(OVERRIDES_KEY)).toBeNull();
  });

  it("does nothing on a server", () => {
    // `location` is read defensively; a missing one is "no reset asked for".
    const runtime = createFlagsRuntime({ flags: CATALOGUE, onOverride: () => {} });
    const storage = createMemoryStorage({
      [OVERRIDES_KEY]: JSON.stringify({ "ui-facelift": true }),
    });
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: undefined });
    try {
      runtime.start(fakeApi(storage).api);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
    expect(runtime.overrides()).toEqual({ "ui-facelift": true });
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
    // A single error slot would be erased by the unrelated success, hiding the
    // warning while the row keeps claiming to be overridden.
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
    // The first stored override fails, the second succeeds — the failure must survive that.
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

  it("uses the flags default when pollMs is non-finite", () => {
    vi.useFakeTimers();
    try {
      let reads = 0;
      const runtime = createFlagsRuntime({
        flags: () => {
          reads += 1;
          return CATALOGUE;
        },
        pollMs: Number.NaN,
      });
      const stop = runtime.start(fakeApi(createMemoryStorage()).api);
      const afterStart = reads;

      vi.advanceTimersByTime(999);
      expect(reads).toBe(afterStart);
      vi.advanceTimersByTime(1);
      expect(reads).toBe(afterStart + 1);
      stop();
    } finally {
      vi.useRealTimers();
    }
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

  it("masks the variants a sensitive flag publishes and throws", () => {
    const runtime = createFlagsRuntime({
      flags: [
        {
          key: "billing.gateway",
          type: "variant",
          variants: ["live-sk-abcdef123456", "test-sk-abcdef123456"],
          value: "live-sk-abcdef123456",
          sensitive: true,
        },
      ],
      onOverride: () => {},
    });
    const view = runtime.store.getSnapshot().flags[0];
    // Numbered, not N identical `[redacted]` rows nobody can choose between.
    expect(view?.variantTexts).toEqual(["variant 1 (masked)", "variant 2 (masked)"]);
    // The raw values stay on the view — the UI commits by index — but nothing
    // that renders or serialises may read them.
    expect(JSON.stringify(view?.variantTexts)).not.toContain("live-sk");

    // The refusal message is thrown out to the agent bridge, which redacts it
    // as one whole string: a credential mid-sentence matches no anchored shape.
    expect(() => runtime.applyOverride("billing.gateway", "nope")).toThrow(
      '(variants: ["[redacted]","[redacted]"])',
    );
    expect(() => runtime.applyOverride("billing.gateway", "nope")).not.toThrow(/live-sk/);
    runtime.store.destroy();
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
  /* Regression: variants alone was omitted from FlagView's signature, hiding list changes while effectiveText stayed put. */
  it.each([
    { before: ["a", "b"], after: ["a", "c"] },
    { before: ["a,b"], after: ["a", "b"] },
  ])("republishes once when only variants change from $before to $after", ({ before, after }) => {
    let variants = before;
    const runtime = createFlagsRuntime({
      flags: () => [{ key: "choice", type: "variant", value: "a", variants }],
    });
    const notify = vi.fn();
    const unsubscribe = runtime.store.subscribe(notify);
    expect(runtime.store.getSnapshot().flags[0]?.variants).toEqual(before);

    variants = after;
    runtime.refresh();
    runtime.store.flush();

    expect(runtime.store.getSnapshot().flags[0]?.variants).toEqual(after);
    expect(notify).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  /* Regression: fixing the omitted variants field must preserve snapshot identity when effectiveText and variants stay put. */
  it("does not notify for unchanged variants and reordered unrelated flag fields", () => {
    let unrelated: FlagReading = { key: "other", type: "boolean", value: false };
    const runtime = createFlagsRuntime({
      flags: () => [
        { key: "choice", type: "variant", value: "a", variants: ["a", "b"] },
        unrelated,
      ],
    });
    const before = runtime.store.getSnapshot();
    const notify = vi.fn();
    const unsubscribe = runtime.store.subscribe(notify);

    unrelated = { value: false, type: "boolean", key: "other" };
    runtime.refresh();
    runtime.store.flush();

    // Fresh variants and advancing at test equality; field order is lost when FlagView is rebuilt.
    expect(runtime.store.getSnapshot()).toBe(before);
    expect(notify).not.toHaveBeenCalled();
    unsubscribe();
  });

  /*
   * Regression: duplicate catalogue keys produced two rows under one React key.
   */
  it("keeps the first of a duplicated catalogue key and warns once per key", () => {
    resetDuplicateCatalogueKeyWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runtime = createFlagsRuntime({
      flags: [
        { key: "dup", type: "boolean", value: true, label: "first" },
        { key: "dup", type: "boolean", value: false, label: "second" },
      ],
    });
    const snapshot = runtime.store.getSnapshot();
    expect(snapshot.flags).toHaveLength(1);
    expect(snapshot.flags[0]?.label).toBe("first");
    expect(snapshot.flags[0]?.effective).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('duplicate catalogue key "dup"');
    runtime.refresh();
    runtime.store.flush();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("warns once for each distinct duplicate catalogue key", () => {
    resetDuplicateCatalogueKeyWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createFlagsRuntime({
      flags: [
        { key: "a", type: "boolean", value: true },
        { key: "a", type: "boolean", value: false },
        { key: "b", type: "boolean", value: true },
        { key: "b", type: "boolean", value: false },
      ],
    });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]?.[0])).toContain('"a"');
    expect(String(warn.mock.calls[1]?.[0])).toContain('"b"');
    warn.mockRestore();
  });

  it("republishes when label or masked metadata changes", () => {
    let label = "Alpha";
    const runtime = createFlagsRuntime({
      flags: () => [{ key: "a", type: "string", value: "secret-token-abc", label }],
    });
    const before = runtime.store.getSnapshot().revision;
    label = "Beta";
    runtime.refresh();
    runtime.store.flush();
    expect(runtime.store.getSnapshot().revision).toBeGreaterThan(before);
    expect(runtime.store.getSnapshot().flags[0]?.label).toBe("Beta");
  });

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

describe("vetOverrides", () => {
  it("drops catalogue entries whose value does not match the declared type", () => {
    expect(
      vetOverrides({ "ui-facelift": "true" }, [
        { key: "ui-facelift", type: "boolean", value: false },
      ]),
    ).toEqual({});
  });

  it("keeps orphans and valid catalogue overrides", () => {
    expect(
      vetOverrides({ orphan: "on", "ui-facelift": true }, [
        { key: "ui-facelift", type: "boolean", value: false },
      ]),
    ).toEqual({ orphan: "on", "ui-facelift": true });
  });

  it("vets against the first catalogue entry when a key is duplicated", () => {
    expect(
      vetOverrides({ x: "on" }, [
        { key: "x", type: "boolean", value: false },
        { key: "x", type: "string", value: "off" },
      ]),
    ).toEqual({});
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

describe("publication guarantees", () => {
  const initial: FlagReading = {
    key: "feature",
    label: "Feature",
    description: "Description",
    owner: "Team A",
    type: "variant",
    variants: ["a", "b"],
    value: "a",
    defaultValue: "a",
    source: "default",
    reloadBehavior: "live",
    projectUrl: "https://example.test/a",
    expiresAt: "2030-01-01T00:00:00.000Z",
  };

  const assertViewPublication = (
    field: string,
    value: unknown,
    count: 0 | 1,
    // Fields the view *derives* from the changed one, which the generic
    // `{ ...before, [field]: value }` patch cannot know about.
    derived: Record<string, unknown> = {},
  ) => {
    let reading: FlagReading = { ...initial };
    const runtime = createFlagsRuntime({ flags: () => [reading], now: () => 0 });
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    reading = { ...reading, [field]: value };
    runtime.refresh();
    runtime.store.flush();
    expect(runtime.store.peek().flags).toEqual([
      { ...before.flags[0], [field]: value, ...derived },
    ]);
    expect(listener).toHaveBeenCalledTimes(count);
    expect(runtime.store.getSnapshot()).toBe(count ? runtime.store.peek() : before);
    runtime.store.destroy();
  };

  it.each([
    ["key", "renamed", 1],
    ["label", "Renamed", 1],
    ["description", "Changed", 1],
    ["type", "string", 1],
    ["variants", ["a", "c"], 1, { variantTexts: ["a", "c"] }],
    ["source", "cohort", 1],
    ["projectUrl", "https://example.test/b", 1],
    ["expiresAt", "2031-01-01T00:00:00.000Z", 1],
  ] as const)("view.%s publishes once", assertViewPublication);

  // Pins fields missing from signature(): owner/reloadBehavior leave the UI
  // stale until covered (then flip these to 1 call and toBe(peek())).
  // recentlyUsed alone is not a UI defect — a visible reorder republishes
  // through the ordered-keys path, pinned separately below.
  it.each([
    ["owner", "Team B", 0],
    ["reloadBehavior", "full-reload", 0],
    ["recentlyUsed", true, 0],
  ] as const)("BUG: view.%s changes without publishing", assertViewPublication);

  // Pins `expired` missing from signature(), which leaves the expiry tag stale;
  // when covered, invert to toHaveBeenCalledTimes(1) and getSnapshot() toBe(peek()).
  it("BUG: crossing expiresAt changes only expired, without publishing", () => {
    let now = Date.parse("2029-12-31T23:59:59Z");
    const runtime = createFlagsRuntime({ flags: [initial], now: () => now });
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    now += 2000;
    runtime.refresh();
    runtime.store.flush();
    expect(runtime.store.peek().flags).toEqual([{ ...before.flags[0], expired: true }]);
    expect(listener).not.toHaveBeenCalled();
    expect(runtime.store.getSnapshot()).toBe(before);
    runtime.store.destroy();
  });

  // Deliberate and permanent: promotedLabel/promotedIcon are left out of
  // signature(), so mutating `promoted` after flags() ran does not republish.
  // What the runtime decides (eligibility, promotedIndex) is signed; what the
  // consumer handed over verbatim (label, icon, and presentation's ReactNode,
  // which can never be signed) is not. Rebuild the extension instead.
  it.each(["label", "icon"] as const)(
    "promoted %s alone does not publish — config is not live",
    (field) => {
      const promoted: PromotedFlag = { flagKey: "feature", label: "Pinned", icon: "A" };
      const runtime = createFlagsRuntime({ flags: [initial], promoted: [promoted] });
      const before = runtime.store.getSnapshot();
      const listener = vi.fn();
      runtime.store.subscribe(listener);
      promoted[field] = "Changed";
      runtime.refresh();
      runtime.store.flush();
      const viewField = field === "label" ? "promotedLabel" : "promotedIcon";
      expect(runtime.store.peek().flags).toEqual([{ ...before.flags[0], [viewField]: "Changed" }]);
      expect(runtime.store.peek().promoted).toEqual(runtime.store.peek().flags);
      expect(listener).not.toHaveBeenCalled();
      expect(runtime.store.getSnapshot()).toBe(before);
      runtime.store.destroy();
    },
  );

  it("publishes promotion eligibility alone once", () => {
    let now = 0;
    const runtime = createFlagsRuntime({
      flags: [initial],
      now: () => now,
      promoted: [{ flagKey: "feature", startAt: "1970-01-01T00:00:01Z" }],
    });
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    now = 2000;
    runtime.refresh();
    runtime.store.flush();
    expect(runtime.store.getSnapshot().flags).toEqual([
      { ...before.flags[0], promoted: true, promotedIndex: 0, promotedLabel: "Feature" },
    ]);
    expect(runtime.store.getSnapshot().promoted).toEqual(runtime.store.getSnapshot().flags);
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.store.destroy();
  });

  it.each(["effectiveText", "baseText", "defaultText"] as const)(
    "publishes %s with its raw value",
    (field) => {
      let reading = { ...initial };
      const runtime = createFlagsRuntime({ flags: () => [reading], onOverride: () => {} });
      runtime.setOverride("feature", "a");
      const before = runtime.store.getSnapshot();
      const listener = vi.fn();
      runtime.store.subscribe(listener);
      if (field === "effectiveText") runtime.setOverride("feature", "b");
      else {
        reading = { ...reading, [field === "baseText" ? "value" : "defaultValue"]: "b" };
        runtime.refresh();
        runtime.store.flush();
      }
      const raw =
        field === "effectiveText"
          ? { effective: "b", override: "b" }
          : field === "baseText"
            ? { base: "b" }
            : { defaultValue: "b" };
      expect(runtime.store.getSnapshot().flags).toEqual([
        { ...before.flags[0], ...raw, [field]: "b" },
      ]);
      expect(listener).toHaveBeenCalledTimes(1);
      runtime.store.destroy();
    },
  );

  // Pins boolean `effective` missing from signature(): equal masked text hides
  // the change, leaving the on/checked state stale. When covered, invert to
  // toHaveBeenCalledTimes(1) and getSnapshot() toBe(peek()).
  it("BUG: masked boolean effective state changes without a notification", () => {
    const runtime = createFlagsRuntime({
      flags: [{ key: "feature", type: "boolean", value: false, sensitive: true }],
      onOverride: () => {},
    });
    runtime.setOverride("feature", false);
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    runtime.setOverride("feature", true);
    expect(runtime.store.peek().flags).toEqual([
      { ...before.flags[0], effective: true, override: true },
    ]);
    expect(listener).not.toHaveBeenCalled();
    expect(runtime.store.getSnapshot()).toBe(before);
    runtime.store.destroy();
  });

  it("publishes masking alone with its count", () => {
    let sensitive = false;
    const runtime = createFlagsRuntime({
      flags: () => [{ key: "feature", value: "[redacted]", defaultValue: "[redacted]", sensitive }],
    });
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    sensitive = true;
    runtime.refresh();
    runtime.store.flush();
    expect(runtime.store.getSnapshot().flags).toEqual([{ ...before.flags[0], masked: true }]);
    expect(runtime.store.getSnapshot().maskedCount).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.store.destroy();
  });

  it("publishes override, orphan and adapter-error transitions and their aggregate UI state", () => {
    let readings: FlagReading[] = [
      { key: "feature", type: "string", value: null, defaultValue: null },
    ];
    let fail = false;
    const runtime = createFlagsRuntime({
      flags: () => readings,
      onOverride: () => {
        if (fail) throw new Error("apply failed");
      },
    });
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    runtime.setOverride("feature", null);
    expect(runtime.store.getSnapshot()).toMatchObject({
      overriddenCount: 1,
      flags: [{ overridden: true, source: "local-override" }],
    });
    expect(listener).toHaveBeenCalledTimes(1);
    fail = true;
    runtime.setOverride("feature", null);
    expect(runtime.store.getSnapshot().flags[0]?.applyError).toContain("apply failed");
    expect(Object.keys(runtime.store.getSnapshot().adapterErrors)).toEqual(["feature"]);
    expect(listener).toHaveBeenCalledTimes(2);
    readings = [];
    runtime.refresh();
    runtime.store.flush();
    expect(runtime.store.getSnapshot()).toMatchObject({
      supplied: false,
      flags: [{ orphaned: true }],
    });
    expect(listener).toHaveBeenCalledTimes(3);
    runtime.store.destroy();
  });

  it("refresh updates peek immediately; writes flush synchronously; idle attempts consume revisions", async () => {
    vi.useFakeTimers();
    let value = "a";
    const runtime = createFlagsRuntime({
      flags: () => [{ key: "feature", value }],
      onOverride: () => {},
    });
    try {
      const listener = vi.fn();
      runtime.store.subscribe(listener);
      value = "b";
      runtime.refresh();
      expect(runtime.store.getSnapshot()).toBe(runtime.store.peek());
      expect(listener).toHaveBeenCalledTimes(1);
      const first = runtime.store.getSnapshot();
      value = "c";
      runtime.refresh();
      expect(runtime.store.peek().flags[0]?.effectiveText).toBe("c");
      expect(runtime.store.getSnapshot()).toBe(first);
      await Promise.resolve();
      expect(runtime.store.getSnapshot()).toBe(first);
      vi.advanceTimersByTime(249);
      expect(listener).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      expect(listener).toHaveBeenCalledTimes(2);
      runtime.setOverride("feature", "d");
      expect(runtime.store.getSnapshot()).toBe(runtime.store.peek());
      expect(listener).toHaveBeenCalledTimes(3);
      const stable = runtime.store.getSnapshot();
      runtime.recipeText();
      runtime.diagnostics();
      expect(runtime.store.peek()).toBe(stable);
      runtime.refresh();
      runtime.store.flush();
      expect(runtime.store.peek().revision).toBe(stable.revision + 1);
      expect(runtime.store.getSnapshot()).toBe(stable);
      expect(listener).toHaveBeenCalledTimes(3);
    } finally {
      runtime.store.destroy();
      vi.useRealTimers();
    }
  });
});

describe("publication of flag status", () => {
  it("publishes reloadPending alone when the acknowledgement clears it", () => {
    const runtime = createFlagsRuntime({
      flags: [{ key: "feature", type: "boolean", value: false, reloadBehavior: "full-reload" }],
      onOverride: () => {},
    });
    runtime.setOverride("feature", true);
    const before = runtime.store.getSnapshot();
    expect(before.reloadPending).toEqual(["feature"]);
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    runtime.acknowledgeReload();
    expect(runtime.store.getSnapshot()).toEqual({
      ...before,
      reloadPending: [],
      revision: before.revision + 1,
      at: expect.any(Number),
    });
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.store.destroy();
  });

  it("publishes readError alone while invalid and failed readings both yield no rows", () => {
    let fail = false;
    const runtime = createFlagsRuntime({
      flags: [
        {
          get key() {
            if (fail) throw new Error("unreadable");
            return "";
          },
        },
      ],
    });
    const before = runtime.store.getSnapshot();
    expect(before.readError).toBeNull();
    expect(before.supplied).toBe(true);
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    fail = true;
    runtime.refresh();
    runtime.store.flush();
    expect(runtime.store.getSnapshot()).toEqual({
      ...before,
      readError: "The flag list could not be read — it threw. See the console.",
      revision: before.revision + 1,
      at: expect.any(Number),
    });
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.store.destroy();
  });
});

describe("isolated flag publication fields", () => {
  it("publishes orphaned with unchanged UI text and supplied state", () => {
    const anchor: FlagReading = { key: "anchor", value: "a" };
    let readings: FlagReading[] = [
      anchor,
      { key: "feature", type: "string", value: "—", defaultValue: "—" },
    ];
    const runtime = createFlagsRuntime({ flags: () => readings, onOverride: () => {} });
    runtime.setOverride("feature", "a");
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    readings = [anchor];
    runtime.refresh();
    runtime.store.flush();
    expect(runtime.store.getSnapshot()).toEqual({
      ...before,
      flags: before.flags.map((flag) =>
        flag.key === "feature" ? { ...flag, base: null, defaultValue: null, orphaned: true } : flag,
      ),
      revision: before.revision + 1,
      at: expect.any(Number),
    });
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.store.destroy();
  });

  it("publishes overridden alone in the UI when source and effective value already match", () => {
    const runtime = createFlagsRuntime({
      flags: [{ key: "feature", value: "a", source: "local-override" }],
      onOverride: () => {},
    });
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    runtime.setOverride("feature", "a");
    expect(runtime.store.getSnapshot().flags).toEqual([
      { ...before.flags[0], override: "a", overridden: true },
    ]);
    expect(runtime.store.getSnapshot().overriddenCount).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.store.destroy();
  });
});

describe.each(["unreadable", "readable"] as const)(
  "adapter-error publication with %s catalogue rows",
  (catalogue) => {
    const setup = () => {
      const onOverride = vi.fn((): void => {
        throw new Error("adapter failed");
      });
      const runtime = createFlagsRuntime({
        flags: [
          {
            key: "feature",
            type: "string",
            get label(): string {
              if (catalogue === "unreadable") throw new Error("unreadable label");
              return "Feature";
            },
          },
        ],
        onOverride,
      });
      return { runtime, onOverride };
    };

    // Fallback rows carry no applyError, so the panel needs adapterErrors to publish independently.
    it("publishes a failed override and exposes its error key", () => {
      const { runtime } = setup();
      const before = runtime.store.getSnapshot();
      if (catalogue === "unreadable") {
        expect(before.flags).toEqual([]);
        expect(before.readError).not.toBeNull();
      } else {
        expect(before.flags).toHaveLength(1);
        expect(before.readError).toBeNull();
      }
      const listener = vi.fn();
      runtime.store.subscribe(listener);
      runtime.setOverride("feature", "a");
      if (catalogue === "unreadable") {
        expect(runtime.store.peek()).toEqual({
          ...before,
          adapterErrors: { feature: expect.stringContaining("adapter failed") },
          revision: before.revision + 1,
          at: expect.any(Number),
        });
      }
      expect(listener).toHaveBeenCalledTimes(1);
      expect(runtime.store.getSnapshot()).toBe(runtime.store.peek());
      expect(runtime.store.getSnapshot()).not.toBe(before);
      expect(Object.keys(runtime.store.getSnapshot().adapterErrors)).toEqual(["feature"]);
      expect(runtime.store.getSnapshot().adapterErrors.feature).toContain("adapter failed");
      runtime.store.destroy();
    });

    it("publishes a changed adapter error for the same override", () => {
      const { runtime, onOverride } = setup();
      runtime.setOverride("feature", "a");
      const before = runtime.store.getSnapshot();
      const listener = vi.fn();
      runtime.store.subscribe(listener);
      onOverride.mockImplementation(() => {
        throw new Error("adapter still unavailable");
      });
      runtime.setOverride("feature", "a");
      expect(listener).toHaveBeenCalledTimes(1);
      expect(runtime.store.getSnapshot()).toBe(runtime.store.peek());
      expect(runtime.store.getSnapshot()).not.toBe(before);
      expect(runtime.store.getSnapshot().adapterErrors).toEqual({
        feature: expect.stringContaining("adapter still unavailable"),
      });
      runtime.store.destroy();
    });

    it("publishes a cleared adapter error after successfully applying the same override", () => {
      const { runtime, onOverride } = setup();
      runtime.setOverride("feature", "a");
      const before = runtime.store.getSnapshot();
      const listener = vi.fn();
      runtime.store.subscribe(listener);
      onOverride.mockImplementation(() => {});
      runtime.setOverride("feature", "a");
      expect(listener).toHaveBeenCalledTimes(1);
      expect(runtime.store.getSnapshot()).toBe(runtime.store.peek());
      expect(runtime.store.getSnapshot()).not.toBe(before);
      expect(runtime.store.getSnapshot().adapterErrors).toEqual({});
      expect(Object.keys(runtime.store.getSnapshot().adapterErrors)).toEqual([]);
      runtime.store.destroy();
    });

    it("does not publish unchanged adapter errors on refresh or repeated failure", () => {
      const { runtime } = setup();
      runtime.setOverride("feature", "a");
      const before = runtime.store.getSnapshot();
      const listener = vi.fn();
      runtime.store.subscribe(listener);
      runtime.refresh();
      runtime.store.flush();
      runtime.setOverride("feature", "a");
      expect(runtime.store.peek().revision).toBeGreaterThan(before.revision);
      expect(runtime.store.peek().adapterErrors).toEqual(before.adapterErrors);
      expect(listener).not.toHaveBeenCalled();
      expect(runtime.store.getSnapshot()).toBe(before);
      runtime.store.destroy();
    });
  },
);

describe("published flag ordering", () => {
  it("publishes a recentlyUsed change when it changes the visible row order", () => {
    let recentlyUsed = false;
    const runtime = createFlagsRuntime({
      flags: () => [
        { key: "a", value: false },
        { key: "b", value: false, recentlyUsed },
      ],
    });
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    recentlyUsed = true;
    runtime.refresh();
    runtime.store.flush();
    expect(runtime.store.getSnapshot().flags).toEqual([
      { ...before.flags[1], recentlyUsed: true },
      before.flags[0],
    ]);
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.store.destroy();
  });

  // Was pinned as a bug: promoted order was invisible to signature(). Now
  // promotedIndex — each view's position, added so a control can find its
  // eligible entry's presentation — moves the signature on reorder. label
  // and icon still aren't signed; this is a by-product, not a promise.
  it("publishes a reordered promotion configuration", () => {
    const promoted = [{ flagKey: "a" }, { flagKey: "b" }];
    const runtime = createFlagsRuntime({
      flags: [
        { key: "a", value: false },
        { key: "b", value: false },
      ],
      promoted,
    });
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    promoted.reverse();
    runtime.refresh();
    runtime.store.flush();
    const after = runtime.store.getSnapshot();
    expect(after).toBe(runtime.store.peek());
    expect(after).not.toBe(before);
    expect(after.promoted.map((view) => view.key)).toEqual(["b", "a"]);
    expect(after.promoted.map((view) => view.promotedIndex)).toEqual([0, 1]);
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.store.destroy();
  });
});

describe("recording a hostile adapter failure", () => {
  const BOOLEANS: FlagReading[] = [
    { key: "ui-facelift", type: "boolean", defaultValue: false, value: false },
  ];

  it("masks a credential-carrying URL with the extension's own redactOptions", () => {
    const runtime = createFlagsRuntime({
      flags: BOOLEANS,
      // `ticket` is not a default sensitive key: only the consumer's options mask it.
      redactOptions: { extraKeys: ["ticket"] },
      onOverride: () => {
        throw new Error("failed for https://x/?ticket=abc");
      },
    });
    runtime.setOverride("ui-facelift", true);
    const recorded = runtime.store.getSnapshot().adapterErrors["ui-facelift"];
    expect(recorded).toContain("failed for https://x/?ticket=[redacted]");
    expect(recorded).not.toContain("abc");
  });

  it("records a message getter that throws instead of throwing out of setOverride()", () => {
    const runtime = createFlagsRuntime({
      flags: BOOLEANS,
      onOverride: () => {
        throw Object.defineProperty(new Error("x"), "message", {
          get() {
            throw new Error("no");
          },
        });
      },
    });
    expect(() => runtime.setOverride("ui-facelift", true)).not.toThrow();
    expect(runtime.store.getSnapshot().adapterErrors["ui-facelift"]).toContain("[unreadable]");
  });

  it("describes a non-string message by its tag, as a string", () => {
    const runtime = createFlagsRuntime({
      flags: BOOLEANS,
      onOverride: () => {
        throw Object.assign(new Error("x"), { message: 42 });
      },
    });
    expect(() => runtime.setOverride("ui-facelift", true)).not.toThrow();
    expect(runtime.store.getSnapshot().adapterErrors["ui-facelift"]).toContain("[object Error]");
  });

  it("records the failure when the consumer's redactOptions throw on read", () => {
    // A boolean-only catalogue: rendering a string flag would consult these
    // options first, which is a separate hazard — this pins the catch alone.
    const runtime = createFlagsRuntime({
      flags: BOOLEANS,
      redactOptions: {
        get extraKeys(): string[] {
          throw new Error("no");
        },
      },
      onOverride: () => {
        throw new Error("failed for https://x/?token=abc");
      },
    });
    expect(() => runtime.setOverride("ui-facelift", true)).not.toThrow();
    const recorded = runtime.store.getSnapshot().adapterErrors["ui-facelift"];
    expect(recorded).toContain("[unreadable]");
    expect(recorded).not.toContain("abc");
  });
});

describe("a Readable catalogue", () => {
  const keys = (runtime: ReturnType<typeof createFlagsRuntime>) =>
    runtime.store.getSnapshot().flags.map((view) => view.key);

  it("republishes on notify and never starts the poller", () => {
    vi.useFakeTimers();
    try {
      const source = createSource<readonly FlagReading[]>(CATALOGUE);
      const read = vi.spyOn(source, "read");
      const runtime = createFlagsRuntime({ flags: source, pollMs: 250 });
      const { api, abort } = fakeApi(createMemoryStorage());
      const dispose = runtime.start(api);
      const afterStart = read.mock.calls.length;

      vi.advanceTimersByTime(60_000);
      expect(read.mock.calls.length).toBe(afterStart);

      source.set([...CATALOGUE, { key: "late-arrival", type: "boolean", value: true }]);
      runtime.store.flush();
      expect(keys(runtime)).toContain("late-arrival");

      dispose();
      abort();
      source.set([]);
      runtime.store.flush();
      // Unsubscribed: the last published catalogue stands.
      expect(keys(runtime)).toContain("late-arrival");
    } finally {
      vi.useRealTimers();
    }
  });

  it("unsubscribes exactly once when core aborts and then calls the cleanup", () => {
    const source = createSource<readonly FlagReading[]>(CATALOGUE);
    const unsubscribe = vi.fn(source.subscribe(() => {}));
    const subscribe = vi.fn(() => unsubscribe);
    const runtime = createFlagsRuntime({ flags: { getState: source.read, subscribe } });
    const { api, abort } = fakeApi(createMemoryStorage());
    const dispose = runtime.start(api);
    expect(subscribe).toHaveBeenCalledTimes(1);

    // The order core's stopExtension uses: abort the signal, then the returned cleanup.
    abort();
    dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("finishes tearing down when the unsubscribe throws", () => {
    const source = createSource<readonly FlagReading[]>(CATALOGUE);
    const read = vi.fn(source.read);
    const runtime = createFlagsRuntime({
      flags: {
        read,
        subscribe: (listener) => {
          source.subscribe(listener);
          return () => {
            throw new Error("released twice");
          };
        },
      },
    });
    const { api, setVisible } = fakeApi(createMemoryStorage());
    const dispose = runtime.start(api);
    const afterStart = read.mock.calls.length;

    expect(() => dispose()).not.toThrow();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("unsubscribe threw"),
      expect.any(Error),
    );

    // The visibility subscription was still released: a flip no longer re-reads.
    setVisible(false);
    expect(read.mock.calls.length).toBe(afterStart);
  });

  it("vets stored overrides against what the readable holds at start", () => {
    const storage = createMemoryStorage();
    const runtime = createFlagsRuntime({ flags: CATALOGUE, onOverride: () => {} });
    runtime.start(fakeApi(storage).api);
    runtime.setOverride("ui-facelift", true);
    runtime.setOverride("checkout.copy", "new");

    const applied: [string, FlagValue | undefined][] = [];
    const second = createFlagsRuntime({
      flags: createSource<readonly FlagReading[]>([CATALOGUE[0] as FlagReading]),
      onOverride: (key, value) => applied.push([key, value]),
    });
    second.start(fakeApi(storage).api);
    // Both replay — the orphan too, so a renamed flag is still applied and clearable —
    // and the row for the missing key is the orphan tag, not a dropped override.
    expect(applied.map(([key]) => key).sort()).toEqual(["checkout.copy", "ui-facelift"]);
    const view = second.store.getSnapshot().flags.find((entry) => entry.key === "checkout.copy");
    expect(view?.orphaned).toBe(true);
  });

  it("accepts a { getState, subscribe } store as-is", () => {
    const source = createSource<readonly FlagReading[]>(CATALOGUE);
    const runtime = createFlagsRuntime({
      flags: { getState: source.read, subscribe: source.subscribe },
    });
    runtime.start(fakeApi(createMemoryStorage()).api);
    expect(keys(runtime)).toHaveLength(4);
    source.set([]);
    runtime.store.flush();
    expect(keys(runtime)).toHaveLength(0);
  });
});

describe("onOverridesChange", () => {
  const stored = () =>
    createMemoryStorage({
      [OVERRIDES_KEY]: JSON.stringify({ "ui-facelift": true, "checkout.copy": "new" }),
    });

  it("is an adapter on its own: the panel is writable without onOverride", () => {
    const maps: Record<string, FlagValue>[] = [];
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverridesChange: (overrides) => maps.push({ ...overrides }),
    });
    expect(runtime.store.getSnapshot().writable).toBe(true);
    runtime.start(fakeApi(createMemoryStorage()).api);
    runtime.setOverride("ui-facelift", true);
    runtime.setOverride("checkout.copy", "new");
    runtime.clearOverride("ui-facelift");
    runtime.toggle("new-header");
    runtime.applyOverride("search.rank", 5);
    runtime.applyOverride("search.rank");
    runtime.clearAll();
    expect(maps).toEqual([
      {}, // the start() replay of an empty store
      { "ui-facelift": true },
      { "ui-facelift": true, "checkout.copy": "new" },
      { "checkout.copy": "new" },
      { "checkout.copy": "new", "new-header": false },
      { "checkout.copy": "new", "new-header": false, "search.rank": 5 },
      { "checkout.copy": "new", "new-header": false },
      {},
    ]);
  });

  it("hands the start() replay the vetted map, after the per-key calls", () => {
    const storage = createMemoryStorage({
      [OVERRIDES_KEY]: JSON.stringify({
        "ui-facelift": "true", // a string for a boolean flag — vetted out
        "checkout.copy": "new",
        orphan: 1,
      }),
    });
    const events: string[] = [];
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: (key, value) => events.push(`${key}=${String(value)}`),
      onOverridesChange: (overrides) => events.push(`all:${JSON.stringify(overrides)}`),
    });
    runtime.start(fakeApi(storage).api);
    expect(events).toEqual([
      "checkout.copy=new",
      "orphan=1",
      'all:{"checkout.copy":"new","orphan":1}',
    ]);
  });

  it("follows every per-key call of the same change, for clearAll too", () => {
    const events: string[] = [];
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: (key, value) => events.push(`${key}=${String(value)}`),
      onOverridesChange: (overrides) => events.push(`all:${Object.keys(overrides).length}`),
    });
    runtime.start(fakeApi(stored()).api);
    events.length = 0;
    runtime.clearAll();
    expect(events).toEqual(["ui-facelift=undefined", "checkout.copy=undefined", "all:0"]);
  });

  it("is not called when nothing changed", () => {
    const onOverridesChange = vi.fn();
    const runtime = createFlagsRuntime({ flags: CATALOGUE, onOverridesChange });
    runtime.start(fakeApi(createMemoryStorage()).api);
    onOverridesChange.mockClear();
    runtime.clearOverride("ui-facelift");
    runtime.clearAll();
    runtime.applyOverride("ui-facelift");
    expect(onOverridesChange).not.toHaveBeenCalled();
  });

  it("hands over an ordinary, detached copy", () => {
    let received: Record<string, FlagValue> | null = null;
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverridesChange: (overrides) => {
        received = overrides as Record<string, FlagValue>;
      },
    });
    runtime.start(fakeApi(createMemoryStorage()).api);
    runtime.setOverride("ui-facelift", true);
    expect(Object.getPrototypeOf(received)).toBe(Object.prototype);
    (received as unknown as Record<string, FlagValue>)["ui-facelift"] = false;
    expect(runtime.overrides()).toEqual({ "ui-facelift": true });
  });

  it("records a throw as one map-wide error, not against the rows it touched", () => {
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: () => {},
      onOverridesChange: () => {
        throw new Error("mirror is down");
      },
    });
    runtime.start(fakeApi(createMemoryStorage()).api);
    runtime.setOverride("ui-facelift", true);
    const snapshot = runtime.store.getSnapshot();
    expect(snapshot.bulkError).toMatch(/mirror is down/);
    // A whole-map failure is not a fact about any one row.
    expect(snapshot.adapterErrors).toEqual({});
    expect(snapshot.flags.find((entry) => entry.key === "ui-facelift")?.applyError).toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    // The map still changed and was persisted: the panel says so.
    expect(runtime.overrides()).toEqual({ "ui-facelift": true });
    expect(runtime.diagnostics()).toMatchObject({
      bulkError: expect.stringMatching(/mirror is down/),
    });
  });

  it("clears the map-wide error when a later delivery succeeds through another key", () => {
    // The successful call received the whole map, `ui-facelift` included, so
    // nothing about `ui-facelift` is still unapplied.
    let failing = true;
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: () => {},
      onOverridesChange: () => {
        if (failing) throw new Error("mirror is down");
      },
    });
    runtime.start(fakeApi(createMemoryStorage()).api);
    runtime.setOverride("ui-facelift", true);
    expect(runtime.store.getSnapshot().bulkError).toMatch(/mirror is down/);

    failing = false;
    runtime.setOverride("checkout.copy", "new");
    const snapshot = runtime.store.getSnapshot();
    expect(snapshot.bulkError).toBeNull();
    expect(snapshot.adapterErrors).toEqual({});
    expect(snapshot.flags.find((entry) => entry.key === "ui-facelift")?.applyError).toBeUndefined();
  });

  it("keeps an unresolved per-key failure when the map-wide one recovers", () => {
    let bulkFailing = true;
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverride: (key) => {
        if (key === "ui-facelift") throw new Error("provider is offline");
      },
      onOverridesChange: () => {
        if (bulkFailing) throw new Error("mirror is down");
      },
    });
    runtime.start(fakeApi(createMemoryStorage()).api);
    runtime.setOverride("ui-facelift", true);
    let snapshot = runtime.store.getSnapshot();
    expect(snapshot.adapterErrors["ui-facelift"]).toMatch(/provider is offline/);
    expect(snapshot.bulkError).toMatch(/mirror is down/);

    bulkFailing = false;
    runtime.setOverride("checkout.copy", "new");
    snapshot = runtime.store.getSnapshot();
    expect(snapshot.bulkError).toBeNull();
    expect(snapshot.adapterErrors).toEqual({
      "ui-facelift": expect.stringMatching(/provider is offline/),
    });
    expect(snapshot.flags.find((entry) => entry.key === "ui-facelift")?.applyError).toMatch(
      /provider is offline/,
    );
  });

  it("surfaces a throw on the empty start() replay", () => {
    // Nothing was touched, but a mirror that failed to receive `{}` may still
    // be applying a map the panel says is empty.
    const runtime = createFlagsRuntime({
      flags: CATALOGUE,
      onOverridesChange: () => {
        throw new Error("mirror is down");
      },
    });
    runtime.start(fakeApi(createMemoryStorage()).api);
    expect(runtime.store.getSnapshot().bulkError).toMatch(/mirror is down/);
    expect(runtime.store.getSnapshot().adapterErrors).toEqual({});
  });
});
