/**
 * Keep the kit stateless: ESM extensions share this module, while the package
 * specifier prevents CJS from inlining a private copy into each extension.
 * Keep it free of extension markers because the bundle boundary test treats
 * those markers as proof that one extension contains another's code.
 */
import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import type { ThrottledStore } from "../runtime";
import type { Source } from "./source";

// `useLayoutEffect` warns during SSR in React 18; there is nothing to assign on a server anyway.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Read a live extension snapshot and optionally ensure its stylesheet.
 * `getSnapshot` is also the server snapshot because extension stores are
 * created eagerly from the same inputs; another shape or a throw would break SSR.
 */
export function useExtensionSurface<T>(
  store: Pick<ThrottledStore<T>, "subscribe" | "getSnapshot">,
  inject: boolean,
  ensureStyles: (doc?: Document, nonce?: string) => unknown,
  nonce?: string,
): T {
  useEffect(() => {
    if (inject) ensureStyles(undefined, nonce);
    // Keep `nonce` here so an asynchronously resolved value can reach the sheet's first insert.
    // Injectors deduplicate in the document, so a new function identity is harmless.
  }, [inject, ensureStyles, nonce]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/**
 * Assign a React-owned value into a module-scope `Source` from a layout effect:
 * subscribers see it in the same commit, and the extension store rebuilds
 * synchronously (publication still goes through that store's throttle).
 * Clears nothing on unmount — the source outlives any one component, and a
 * reset here read as "absent" between StrictMode's double mount.
 */
export function useSource<T>(source: Pick<Source<T>, "set">, value: T): void {
  useIsomorphicLayoutEffect(() => {
    source.set(value);
  }, [source, value]);
}
