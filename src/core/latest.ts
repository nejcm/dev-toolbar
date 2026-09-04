import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * `useLayoutEffect` in a browser, `useEffect` where there is no window, so the
 * commit-time ref writes do not trip React's
 * "useLayoutEffect does nothing on the server" warning during SSR. The choice
 * is resolved once, at module load, so it cannot change between renders.
 */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Written at commit, never during render. A render React abandons — a
 * suspended transition over a controlled `visible`, say — would otherwise
 * leave this ref describing a state nothing committed: the window shortcut
 * listener would read a visibility no handler agrees with and toggle to the
 * value that is already live, doing nothing at all.
 *
 * Everything that reads it runs later than this: listeners are installed in
 * passive effects, `api.isVisible()` is called by extension code that
 * `start()` reaches from a passive effect, and passive effects run after every
 * layout effect in the same commit. No dependency array — "latest value after
 * every commit" is the whole contract.
 * Seeded with the first render's value so a reader on the first commit sees
 * something true rather than a placeholder.
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useIsomorphicLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
