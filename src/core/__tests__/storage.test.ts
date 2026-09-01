import { describe, expect, it } from "vitest";
import {
  STORAGE_PREFIX,
  createExtensionStorage,
  createInstanceStorage,
  createLocalStorage,
  createMemoryStorage,
  createNullStorage,
  resolveStorage,
} from "../storage";

describe("storage adapters", () => {
  it("round-trips through localStorage under dtb:v1:<instanceId>:*", () => {
    const storage = createInstanceStorage(createLocalStorage(), "app");
    storage.setItem("visible", "true");

    expect(window.localStorage.getItem(`${STORAGE_PREFIX}:app:visible`)).toBe("true");
    expect(storage.getItem("visible")).toBe("true");

    storage.removeItem("visible");
    expect(storage.getItem("visible")).toBeNull();
  });

  it("namespaces per extension id", () => {
    const storage = createExtensionStorage(createLocalStorage(), "app", "flags");
    storage.setItem("enabled", "1");
    expect(window.localStorage.getItem(`${STORAGE_PREFIX}:app:ext:flags:enabled`)).toBe("1");
  });

  it("round-trips in memory", () => {
    const storage = createMemoryStorage({ a: "1" });
    expect(storage.getItem("a")).toBe("1");
    storage.setItem("b", "2");
    expect(storage.getItem("b")).toBe("2");
    storage.removeItem("b");
    expect(storage.getItem("b")).toBeNull();
  });

  it("resolves undefined to localStorage and null to a no-op", () => {
    expect(resolveStorage(undefined).getItem("nope")).toBeNull();

    const disabled = resolveStorage(null);
    disabled.setItem("x", "1");
    expect(disabled.getItem("x")).toBeNull();
    expect(window.localStorage.getItem("x")).toBeNull();
  });

  it("never throws when the underlying store throws", () => {
    const hostile: Storage = {
      get length() {
        return 0;
      },
      clear() {},
      key: () => null,
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
    };
    const original = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: hostile,
    });
    try {
      const storage = createLocalStorage();
      expect(() => storage.setItem("a", "1")).not.toThrow();
      expect(storage.getItem("a")).toBeNull();
      expect(() => storage.removeItem("a")).not.toThrow();
    } finally {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });

  it("createNullStorage swallows everything", () => {
    const storage = createNullStorage();
    storage.setItem("a", "1");
    expect(storage.getItem("a")).toBeNull();
  });
});
