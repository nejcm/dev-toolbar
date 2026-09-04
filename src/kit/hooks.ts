/**
 * Keep the kit stateless: ESM extensions share this module, while the package
 * specifier prevents CJS from inlining a private copy into each extension.
 * Keep it free of extension markers because the bundle boundary test treats
 * those markers as proof that one extension contains another's code.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { ThrottledStore } from "../runtime";

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
