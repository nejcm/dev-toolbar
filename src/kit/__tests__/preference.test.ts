/**
 * The throwing-adapter case lives here, once: every extension that persists a
 * preference reads and writes through this module, so its own suite only has
 * to prove "a throwing adapter does not break the panel", not re-prove the
 * storage guard.
 */
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { STORAGE_PREFIX as CORE_STORAGE_PREFIX, createMemoryStorage } from "@nejcm/dev-toolbar";
import {
  extensionStorageKey,
  readPreference,
  readPreferenceIfReadable,
  readStoredRecord,
  removePreference,
  resetRequested,
  writePreference,
} from "../index";
import type { Preference, PreferenceRead } from "../index";
import { STORAGE_PREFIX } from "../preference";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const TABS = ["vitals", "network"] as const;
type Tab = (typeof TABS)[number];
const isTab = (value: unknown): value is Tab | null =>
  value === null || TABS.includes(value as Tab);

/** A raw-string preference with "nothing chosen yet" as its default. */
const tab: Preference<Tab | null> = {
  key: "tab",
  encoding: "string",
  fallback: null,
  isValue: isTab,
};

/** A raw-string preference whose default is a real value. */
const format: Preference<"markdown" | "json"> = {
  key: "format",
  encoding: "string",
  fallback: "markdown",
  isValue: (value): value is "markdown" | "json" => value === "markdown" || value === "json",
};

interface Settings {
  enabled: boolean;
}
const isSettings = (value: unknown): value is Settings =>
  value !== null &&
  typeof value === "object" &&
  typeof (value as { enabled?: unknown }).enabled === "boolean";
const settings: Preference<Settings> = {
  key: "settings",
  encoding: "json",
  fallback: { enabled: false },
  isValue: isSettings,
};

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("quota");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("readPreference", () => {
  it("reads a raw string back exactly as it was stored, not JSON-wrapped", () => {
    // A consumer's `tab` persisted before the extension adopted this module:
    // the bytes are the id itself, and must still read back.
    const storage = createMemoryStorage({ tab: "network" });
    expect(readPreference(storage, tab)).toBe("network");
  });

  it("does not mistake a JSON-looking raw string for JSON", () => {
    const storage = createMemoryStorage({ format: '"json"' });
    // `"json"` with quotes is not one of the allowed formats; the guard rejects it.
    expect(readPreference(storage, format)).toBe("markdown");
  });

  it("decodes a JSON value", () => {
    const storage = createMemoryStorage({ settings: '{"enabled":true}' });
    expect(readPreference(storage, settings)).toEqual({ enabled: true });
  });

  it("falls back when nothing is stored", () => {
    expect(readPreference(createMemoryStorage(), tab)).toBeNull();
    expect(readPreference(createMemoryStorage(), format)).toBe("markdown");
    expect(readPreference(createMemoryStorage(), settings)).toBe(settings.fallback);
  });

  it("falls back when the stored value fails the type guard", () => {
    expect(readPreference(createMemoryStorage({ tab: "console" }), tab)).toBeNull();
    expect(readPreference(createMemoryStorage({ format: "yaml" }), format)).toBe("markdown");
    expect(readPreference(createMemoryStorage({ settings: '{"enabled":"yes"}' }), settings)).toBe(
      settings.fallback,
    );
  });

  it("falls back when the stored JSON does not parse", () => {
    expect(readPreference(createMemoryStorage({ settings: "{nope" }), settings)).toBe(
      settings.fallback,
    );
  });

  it("falls back when the adapter is null or undefined", () => {
    expect(readPreference(null, format)).toBe("markdown");
    expect(readPreference(undefined, settings)).toBe(settings.fallback);
  });

  it("falls back when getItem throws", () => {
    expect(readPreference(throwing, tab)).toBeNull();
    expect(readPreference(throwing, settings)).toBe(settings.fallback);
  });

  it("falls back when the guard throws", () => {
    const bad: Preference<string> = {
      key: "k",
      encoding: "string",
      fallback: "safe",
      isValue: (_value): _value is string => {
        throw new Error("bad guard");
      },
    };
    expect(readPreference(createMemoryStorage({ k: "x" }), bad)).toBe("safe");
  });
});

describe("readPreferenceIfReadable", () => {
  it("reports an adapter throw as unreadable without a value", () => {
    const result = readPreferenceIfReadable(throwing, settings);
    expect(result).toEqual({ readable: false });
    expect("value" in result).toBe(false);
  });

  it("reports null and undefined storage as readable fallback", () => {
    const nullResult = readPreferenceIfReadable(null, settings);
    expect(nullResult.readable).toBe(true);
    if (nullResult.readable) expect(nullResult.value).toBe(settings.fallback);

    const undefinedResult = readPreferenceIfReadable(undefined, settings);
    expect(undefinedResult.readable).toBe(true);
    if (undefinedResult.readable) expect(undefinedResult.value).toBe(settings.fallback);
  });

  it("reports an absent key as readable fallback", () => {
    const result = readPreferenceIfReadable(createMemoryStorage(), settings);
    expect(result.readable).toBe(true);
    if (result.readable) expect(result.value).toBe(settings.fallback);
  });

  it("reports a stored raw string that passes isValue as readable", () => {
    expect(readPreferenceIfReadable(createMemoryStorage({ tab: "network" }), tab)).toEqual({
      readable: true,
      value: "network",
    });
  });

  it("reports a decoder throw as readable fallback", () => {
    const result = readPreferenceIfReadable(createMemoryStorage({ settings: "{nope" }), settings);
    expect(result.readable).toBe(true);
    if (result.readable) expect(result.value).toBe(settings.fallback);
  });

  it("reports an isValue rejection as readable fallback", () => {
    const result = readPreferenceIfReadable(
      createMemoryStorage({ settings: '{"enabled":"yes"}' }),
      settings,
    );
    expect(result.readable).toBe(true);
    if (result.readable) expect(result.value).toBe(settings.fallback);
  });

  it("reports an isValue throw as readable fallback", () => {
    const fallback = { safe: true };
    const preference: Preference<typeof fallback> = {
      key: "throwing-validator",
      encoding: "json",
      fallback,
      isValue: (_value): _value is typeof fallback => {
        throw new Error("bad guard");
      },
    };
    const result = readPreferenceIfReadable(
      createMemoryStorage({ "throwing-validator": '{"safe":false}' }),
      preference,
    );
    expect(result.readable).toBe(true);
    if (result.readable) expect(result.value).toBe(fallback);
  });

  it("leaves readPreference unchanged over a throwing adapter", () => {
    expect(readPreference(throwing, settings)).toBe(settings.fallback);
  });
});

describe("writePreference", () => {
  it("stores a raw string as-is and reads it back", () => {
    const storage = createMemoryStorage();
    writePreference(storage, tab, "network");
    expect(storage.getItem("tab")).toBe("network");
    expect(readPreference(storage, tab)).toBe("network");
  });

  it("round-trips JSON", () => {
    const storage = createMemoryStorage();
    writePreference(storage, settings, { enabled: true });
    expect(storage.getItem("settings")).toBe('{"enabled":true}');
    expect(readPreference(storage, settings)).toEqual({ enabled: true });
  });

  it("removes the key instead of storing the default", () => {
    const storage = createMemoryStorage({ format: "json", settings: '{"enabled":true}' });
    writePreference(storage, format, "markdown");
    writePreference(storage, settings, { enabled: false });
    expect(storage.getItem("format")).toBeNull();
    expect(storage.getItem("settings")).toBeNull();
  });

  it("treats null as nothing to store for a raw-string preference", () => {
    const storage = createMemoryStorage({ tab: "vitals" });
    writePreference(storage, tab, null);
    expect(storage.getItem("tab")).toBeNull();
  });

  it("compares JSON by encoding, so an empty map removes the key", () => {
    const empty: Preference<Record<string, string>> = {
      key: "overrides",
      encoding: "json",
      fallback: {},
      isValue: (value): value is Record<string, string> =>
        typeof value === "object" && value !== null,
    };
    const storage = createMemoryStorage({ overrides: '{"a":"1"}' });
    writePreference(storage, empty, Object.create(null) as Record<string, string>);
    expect(storage.getItem("overrides")).toBeNull();
    writePreference(storage, empty, { b: "2" });
    expect(storage.getItem("overrides")).toBe('{"b":"2"}');
  });

  it("does nothing for a null or undefined adapter", () => {
    expect(() => writePreference(null, tab, "vitals")).not.toThrow();
    expect(() => writePreference(undefined, settings, { enabled: true })).not.toThrow();
  });

  it("swallows a throwing setItem", () => {
    expect(() => writePreference(throwing, tab, "vitals")).not.toThrow();
    expect(() => writePreference(throwing, settings, { enabled: true })).not.toThrow();
  });

  it("swallows a throwing removeItem when writing the default", () => {
    expect(() => writePreference(throwing, format, "markdown")).not.toThrow();
  });

  it("swallows a value JSON cannot encode", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    const loose: Preference<unknown> = {
      key: "loose",
      encoding: "json",
      fallback: {},
      isValue: (_value): _value is unknown => true,
    };
    const setItem = vi.fn();
    expect(() => writePreference({ setItem, removeItem: vi.fn() }, loose, circular)).not.toThrow();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("removes rather than stores a value with no JSON representation", () => {
    const loose: Preference<unknown> = {
      key: "loose",
      encoding: "json",
      fallback: 0,
      isValue: (_value): _value is unknown => true,
    };
    const storage = createMemoryStorage({ loose: "1" });
    writePreference(storage, loose, undefined);
    expect(storage.getItem("loose")).toBeNull();
  });
});

describe("removePreference", () => {
  it("drops the key", () => {
    const storage = createMemoryStorage({ tab: "vitals" });
    removePreference(storage, tab);
    expect(storage.getItem("tab")).toBeNull();
  });

  it("swallows a throwing removeItem and tolerates a missing adapter", () => {
    expect(() => removePreference(throwing, tab)).not.toThrow();
    expect(() => removePreference(null, tab)).not.toThrow();
    expect(() => removePreference(undefined, tab)).not.toThrow();
  });
});

describe("extensionStorageKey", () => {
  it("is the one copy of core's prefix", () => {
    // The kit may not value-import core, so the prefix is hand-maintained.
    // This is what closes the gap, the same way contract-version.test.ts
    // closes the contract number.
    expect(STORAGE_PREFIX).toBe(CORE_STORAGE_PREFIX);
  });

  it("builds the key core scopes an extension's storage to", () => {
    expect(extensionStorageKey("default", "flags", "overrides")).toBe(
      "dtb:v1:default:ext:flags:overrides",
    );
  });
});

describe("resetRequested", () => {
  const withSearch = (search: string) => {
    vi.stubGlobal("location", { search });
  };

  it.each(["reset", "clear", "off"])("is true for ?dtb-flags=%s", (value) => {
    withSearch(`?dtb-flags=${value}`);
    expect(resetRequested("dtb-flags")).toBe(true);
  });

  it("is false for another value, another param, or no location", () => {
    withSearch("?dtb-flags=on");
    expect(resetRequested("dtb-flags")).toBe(false);
    withSearch("?other=reset");
    expect(resetRequested("dtb-flags")).toBe(false);
    vi.stubGlobal("location", undefined);
    expect(resetRequested("dtb-flags")).toBe(false);
  });

  it("is disabled by null or undefined, and survives a hostile location", () => {
    withSearch("?dtb-flags=reset");
    expect(resetRequested(null)).toBe(false);
    expect(resetRequested(undefined)).toBe(false);
    vi.stubGlobal("location", {
      get search(): string {
        throw new Error("no");
      },
    });
    expect(resetRequested("dtb-flags")).toBe(false);
  });
});

describe("readStoredRecord", () => {
  const isString = (value: unknown): value is string => typeof value === "string";
  const KEY = extensionStorageKey("default", "theme-editor", "overrides");

  it("reads the extension's map from the scoped key, vetting each entry", () => {
    const storage = createMemoryStorage({
      [KEY]: '{"--a":"1px","--b":2,"__proto__":"x"}',
    });
    const result = readStoredRecord(
      { extensionId: "theme-editor", key: "overrides", storage },
      isString,
    );
    // `--b` failed the guard and was dropped; the rest survived.
    expect(Object.keys(result).sort()).toEqual(["--a", "__proto__"]);
    expect(result["--a"]).toBe("1px");
    // A plain object, so a consumer's `.hasOwnProperty()` works — and the
    // persisted `__proto__` stayed an own property rather than a prototype.
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(result, "__proto__")?.value).toBe("x");
  });

  it("hands the entry's name to the validator", () => {
    const storage = createMemoryStorage({ [KEY]: '{"keep":"1","drop":"2"}' });
    const result = readStoredRecord(
      { extensionId: "theme-editor", key: "overrides", storage },
      (value, name): value is string => isString(value) && name === "keep",
    );
    expect(result).toEqual({ keep: "1" });
  });

  it("honours instanceId", () => {
    const storage = createMemoryStorage({
      [extensionStorageKey("app", "flags", "overrides")]: '{"x":"1"}',
    });
    expect(
      readStoredRecord(
        { instanceId: "app", extensionId: "flags", key: "overrides", storage },
        isString,
      ),
    ).toEqual({ x: "1" });
    expect(readStoredRecord({ extensionId: "flags", key: "overrides", storage }, isString)).toEqual(
      {},
    );
  });

  it("returns an empty map on the reset load", () => {
    vi.stubGlobal("location", { search: "?dtb-theme=reset" });
    const storage = createMemoryStorage({ [KEY]: '{"--a":"1px"}' });
    expect(
      readStoredRecord(
        { extensionId: "theme-editor", key: "overrides", storage, resetParam: "dtb-theme" },
        isString,
      ),
    ).toEqual({});
    // Without the param, the switch is off.
    expect(
      readStoredRecord({ extensionId: "theme-editor", key: "overrides", storage }, isString),
    ).toEqual({ "--a": "1px" });
  });

  it("returns an empty map for a throwing adapter, a null adapter, and no localStorage", () => {
    expect(
      readStoredRecord(
        { extensionId: "theme-editor", key: "overrides", storage: throwing },
        isString,
      ),
    ).toEqual({});
    expect(
      readStoredRecord({ extensionId: "theme-editor", key: "overrides", storage: null }, isString),
    ).toEqual({});
    vi.stubGlobal("localStorage", undefined);
    expect(readStoredRecord({ extensionId: "theme-editor", key: "overrides" }, isString)).toEqual(
      {},
    );
  });

  it("defaults to localStorage", () => {
    vi.stubGlobal("localStorage", createMemoryStorage({ [KEY]: '{"--a":"1px"}' }));
    expect(readStoredRecord({ extensionId: "theme-editor", key: "overrides" }, isString)).toEqual({
      "--a": "1px",
    });
  });

  it("returns an empty map when the global localStorage getter throws", () => {
    vi.spyOn(globalThis, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("Site data blocked", "SecurityError");
    });
    expect(readStoredRecord({ extensionId: "flags", key: "overrides" }, isString)).toEqual({});
  });
});

describe("Preference", () => {
  it("checks writes against the descriptor's type without widening it", () => {
    writePreference(null, format, "json");
    writePreference(null, tab, null);
    writePreference(null, settings, { enabled: true });
    // @ts-expect-error The value cannot widen the descriptor's string union.
    writePreference(null, format, "yaml");
    // @ts-expect-error The value cannot add null to a non-nullable preference.
    writePreference(null, format, null);
    // @ts-expect-error The value cannot widen the descriptor's object shape.
    writePreference(null, settings, { enabled: "yes" });
    expectTypeOf(readPreference(null, format)).toEqualTypeOf<"markdown" | "json">();
    expectTypeOf(readPreferenceIfReadable(null, format)).toEqualTypeOf<
      PreferenceRead<"markdown" | "json">
    >();
    // @ts-expect-error Reads preserve the descriptor's union.
    const yaml: "yaml" = readPreference(null, format);
    void yaml;
  });

  it("admits the raw-string encoding only when T is wholly string or null", () => {
    expectTypeOf<Preference<Tab | null>["encoding"]>().toEqualTypeOf<"string" | "json">();
    expectTypeOf<Preference<"markdown" | "json">["encoding"]>().toEqualTypeOf<"string" | "json">();
    expectTypeOf<Preference<Settings>["encoding"]>().toEqualTypeOf<"json">();
    // The conditional must not distribute: a union that is not wholly string
    // would otherwise resolve to `"string" | "json"` and let `setItem` be handed
    // a number.
    expectTypeOf<Preference<string | number>["encoding"]>().toEqualTypeOf<"json">();

    // The good shapes infer at the call site without a `Preference<T>` annotation.
    const storage = createMemoryStorage();
    expectTypeOf(
      readPreference(storage, { key: "tab", encoding: "string", fallback: null, isValue: isTab }),
    ).toEqualTypeOf<Tab | null>();
    expectTypeOf(
      readPreference(storage, {
        key: "settings",
        encoding: "json",
        fallback: { enabled: false },
        isValue: isSettings,
      }),
    ).toEqualTypeOf<Settings>();

    const object: Preference<Settings> = {
      key: "settings",
      // @ts-expect-error A JSON-shaped value has no byte string to store as-is.
      encoding: "string",
      fallback: { enabled: false },
      isValue: isSettings,
    };
    const union: Preference<string | number> = {
      key: "count",
      // @ts-expect-error `string | number` is not wholly string; `setItem` would receive a number.
      encoding: "string",
      fallback: 0,
      isValue: (value): value is string | number =>
        typeof value === "string" || typeof value === "number",
    };
    void [object, union];
  });
});
