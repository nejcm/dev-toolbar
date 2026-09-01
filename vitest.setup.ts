import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * Install a minimal in-memory Storage, **unconditionally**.
 *
 * Node exposes a `globalThis.localStorage` getter that resolves to `undefined`
 * unless the process was started with `--localstorage-file`, and it shadows the
 * jsdom implementation. That getter only exists from Node 22, so which Storage
 * a test sees used to depend on the Node major: this shim on 22+, jsdom's real
 * `Storage` below it.
 *
 * That divergence is not cosmetic. jsdom's `Storage` keeps `setItem` on the
 * prototype behind a Proxy, so `vi.spyOn(localStorage, "setItem")` installs an
 * own property that is never called and silently records zero writes — while
 * the write itself succeeds. The panel-resize test asserts a write *count*, so
 * it passed locally and failed on CI's older Node against correct library code.
 *
 * One implementation everywhere is worth more than fidelity to jsdom's here:
 * these tests are about what this package writes, not about `Storage` itself.
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
