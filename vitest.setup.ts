import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * Node exposes a `globalThis.localStorage` getter that resolves to `undefined`
 * unless the process was started with `--localstorage-file`, and it shadows the
 * jsdom implementation. Install a minimal in-memory Storage when that happens.
 */
if (typeof globalThis.localStorage === "undefined") {
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
  for (const style of document.head.querySelectorAll(
    "style[data-dev-toolbar-styles]",
  )) {
    style.remove();
  }
  window.localStorage.clear();
});
