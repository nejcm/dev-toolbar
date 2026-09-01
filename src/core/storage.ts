import type { ToolbarStorage } from "./contract";

export const STORAGE_PREFIX = "dtb:v1";

/** Storage that swallows everything. Used when `storage={null}`. */
export function createNullStorage(): ToolbarStorage {
  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}

/** In-memory adapter. Handy in tests and non-browser hosts. */
export function createMemoryStorage(seed?: Record<string, string>): ToolbarStorage {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/**
 * `localStorage` adapter that never throws — SSR, private mode and
 * quota-exceeded all degrade to a no-op rather than taking the app down.
 */
export function createLocalStorage(): ToolbarStorage {
  const read = (): Storage | null => {
    try {
      if (typeof globalThis === "undefined") return null;
      const store = (globalThis as { localStorage?: Storage }).localStorage;
      return store ?? null;
    } catch {
      return null;
    }
  };

  return {
    getItem(key) {
      try {
        return read()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        read()?.setItem(key, value);
      } catch {
        /* quota, disabled storage, sandboxed iframe */
      }
    },
    removeItem(key) {
      try {
        read()?.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

/** Prefixes every key of `base`. Used for instance and per-extension scoping. */
export function createScopedStorage(base: ToolbarStorage, prefix: string): ToolbarStorage {
  const scope = (key: string) => `${prefix}${key}`;
  return {
    getItem: (key) => base.getItem(scope(key)),
    setItem: (key, value) => base.setItem(scope(key), value),
    removeItem: (key) => base.removeItem(scope(key)),
  };
}

/** `dtb:v1:<instanceId>:` scope for core preferences. */
export function createInstanceStorage(base: ToolbarStorage, instanceId: string): ToolbarStorage {
  return createScopedStorage(base, `${STORAGE_PREFIX}:${instanceId}:`);
}

/** `dtb:v1:<instanceId>:ext:<extensionId>:` scope handed to `start(api)`. */
export function createExtensionStorage(
  base: ToolbarStorage,
  instanceId: string,
  extensionId: string,
): ToolbarStorage {
  return createScopedStorage(base, `${STORAGE_PREFIX}:${instanceId}:ext:${extensionId}:`);
}

/** Resolves the `storage` prop: `undefined` → localStorage, `null` → disabled. */
export function resolveStorage(storage: ToolbarStorage | null | undefined): ToolbarStorage {
  if (storage === null) return createNullStorage();
  return storage ?? createLocalStorage();
}

export function readJson<T>(
  storage: ToolbarStorage,
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): T {
  // A custom adapter is consumer code: a throwing getItem must not take down
  // store creation, which happens during render.
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return fallback;
  }
  if (raw === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(storage: ToolbarStorage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
