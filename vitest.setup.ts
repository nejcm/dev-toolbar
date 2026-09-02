import { afterEach } from "vitest";

/**
 * Everything below needs a DOM. A test file may opt into
 * `@vitest-environment node` (e.g. `src/core/__tests__/ssr.test.tsx`) to
 * verify SSR touches no DOM global for real, rather than via a mock — so this
 * guard must not run there: an unconditional shim would hand the store an
 * adapter no real server has, and eagerly importing Testing Library would
 * evaluate `screen`, which binds to `document.body` at module scope.
 */
if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  // Safety net for a bare `installToolbarLayout()` whose `restore()` was missed;
  // `renderWithToolbar` already ties cleanup to RTL's below.
  const { cleanupToolbar } = await import("@nejcm/dev-toolbar/testing");

  /**
   * Install a minimal in-memory Storage, unconditionally: Node 22+'s
   * `globalThis.localStorage` getter shadows jsdom's and is `undefined`
   * without `--localstorage-file`. jsdom's own version keeps `setItem` behind
   * a Proxy where `vi.spyOn` would record zero writes despite the write succeeding.
   */
  {
    const map = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return map.size;
      },
      clear: () => map.clear(),
      getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
      key: (index) => [...map.keys()][index] ?? null,
      removeItem: (key) => {
        map.delete(key);
      },
      setItem: (key, value) => {
        map.set(key, String(value));
      },
    };
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: new Proxy(storage, {
        ownKeys: () => [...map.keys()],
        getOwnPropertyDescriptor: (target, prop) =>
          typeof prop === "string" && map.has(prop)
            ? { configurable: true, enumerable: true, value: map.get(prop) }
            : Reflect.getOwnPropertyDescriptor(target, prop),
        get: (target, prop, receiver) =>
          typeof prop === "string" && map.has(prop) && !(prop in target)
            ? map.get(prop)
            : Reflect.get(target, prop, receiver),
      }),
    });
  }

  afterEach(() => {
    cleanupToolbar();
    cleanup();
    document.documentElement.removeAttribute("style");
    for (const style of document.head.querySelectorAll("style[data-dev-toolbar-styles]")) {
      style.remove();
    }
    window.localStorage.clear();
  });
}
