/**
 * React glue the first-party extensions share.
 *
 * Internal: `src/ext/shared` is **not** a published subpath, so it is absent
 * from `package.json`'s `exports` and from `tsup.config.ts`. The CJS build does
 * not code-split, so everything here is inlined into every `dist/ext/*.cjs` —
 * keep it tiny, keep it stateless (no module-level mutable state, or seven
 * bundles would each own a different copy of it), and give it no
 * `[dev-toolbar/ext/…]` marker: the marker is how
 * `src/core/__tests__/boundary.test.ts` proves one extension's bundle does not
 * contain another's, and a marker in shared code would appear in all seven.
 *
 * Types only from core, values only from `src/runtime` — the same rule every
 * `src/ext/<name>/` follows.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { ThrottledStore } from "../../runtime";

/**
 * Everything a mounted extension surface needs: the current snapshot of the
 * extension's store, plus the extension's stylesheet in the document.
 *
 * One hook rather than two because all fifteen call sites use both, adjacently,
 * in this order — so "a mounted extension surface" is the unit, and this is the
 * single place to later thread a `doc` or a `nonce` through.
 *
 * `store` is narrowed to the `useSyncExternalStore` pair so a caller can pass
 * anything with that shape; `ensureStyles` is `() => unknown` so every
 * `ensureXStyles(doc?)` signature fits without each one being restated here.
 * Passing `getSnapshot` as the server snapshot is deliberate: the stores are
 * built eagerly by the extension factory, the value they hold is derived from
 * the same inputs on both sides, and the alternative — throwing, or a second
 * "server" shape — would make an SSR render fail rather than render the bar.
 */
export function useExtensionSurface<T>(
  store: Pick<ThrottledStore<T>, "subscribe" | "getSnapshot">,
  inject: boolean,
  ensureStyles: () => unknown,
): T {
  // The effect runs before the store is read, preserving the order the call
  // sites had when each extension owned its own pair of hooks.
  useEffect(() => {
    if (inject) ensureStyles();
    // `ensureStyleSheet` deduplicates on the DOM — it looks for an existing
    // `style[data-dev-toolbar-styles=…]` with the same entry and returns it —
    // so a re-run caused by an inline-arrow `ensureStyles` identity change is a
    // no-op, not a second stylesheet.
  }, [inject, ensureStyles]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
