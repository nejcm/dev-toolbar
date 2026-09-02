import { afterEach } from "vitest";

/**
 * Everything below needs a DOM. A test file may opt into
 * `@vitest-environment node` — `src/core/__tests__/ssr.test.tsx` does, so that
 * "the server render touches no DOM global" is enforced by their genuine
 * absence rather than by a mock. Guarding here is what keeps that environment
 * bare: an unconditional `localStorage` shim would hand the store an adapter no
 * real server has, and importing Testing Library eagerly would evaluate
 * `@testing-library/dom`'s `screen`, which binds to `document.body` at module
 * scope.
 */
if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react");

  /**
   * Install a minimal in-memory Storage, unconditionally.
   *
   * Node's `globalThis.localStorage` getter shadows jsdom's and is `undefined`
   * without `--localstorage-file`, but only exists from Node 22 — so the Node
   * major used to pick the implementation. It matters: jsdom keeps `setItem` on
   * the prototype behind a Proxy, where a `vi.spyOn` records zero writes while
   * the write succeeds.
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
    cleanup();
    document.documentElement.removeAttribute("style");
    for (const style of document.head.querySelectorAll("style[data-dev-toolbar-styles]")) {
      style.remove();
    }
    window.localStorage.clear();
  });
}
