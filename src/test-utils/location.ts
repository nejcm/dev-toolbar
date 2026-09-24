/**
 * Stands a stubbed `window.location` in for one call, then restores the real
 * one. jsdom's `location` isn't assignable, so this needs
 * `Object.defineProperty` and a `finally`-guarded restore to avoid leaking the
 * stub into later tests.
 *
 * The patch spreads over the current `location`, so a stub names only what it
 * changes; suites needing a shape this can't express (a throwing `pathname`
 * getter, an absent `location`) still stub by hand.
 */
export function withLocation<T>(patch: Partial<Location>, fn: () => T): T {
  const original = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...original, ...patch },
  });
  try {
    return fn();
  } finally {
    Object.defineProperty(window, "location", { configurable: true, value: original });
  }
}

/** A mutable `location` plus `history.replaceState`, restored afterwards. */
export interface HistoryUrlStub {
  location: { href: string; search: string; pathname: string; hash: string };
  /** The `history.state` the stub was installed with. */
  state: { marker: "keep" };
  /** Arguments of each `replaceState` call. */
  calls: unknown[][];
}

/**
 * Stands in `location` and `history` for one call. The default `replaceState`
 * applies the next URL onto the stub, which is what a browser does, so a
 * second `start()` sees the stripped param. Pass `replaceState` to throw or
 * no-op instead. `history: null` installs no history, for the missing-global case.
 */
export function withHistoryUrl<T>(
  href: string,
  fn: (stub: HistoryUrlStub) => T,
  options?: {
    history?: null;
    replaceState?: (...args: unknown[]) => void;
  },
): T {
  const url = new URL(href);
  const location = {
    href: url.href,
    search: url.search,
    pathname: url.pathname,
    hash: url.hash,
  };
  const state = { marker: "keep" as const };
  const calls: unknown[][] = [];
  const history =
    options?.history === null
      ? undefined
      : {
          state,
          replaceState: (...args: unknown[]) => {
            calls.push(args);
            if (options?.replaceState) {
              options.replaceState(...args);
              return;
            }
            const updated = new URL(String(args[2]), url.origin);
            location.href = updated.href;
            location.search = updated.search;
            location.pathname = updated.pathname;
            location.hash = updated.hash;
          },
        };
  const originalLocation = window.location;
  const originalHistory = window.history;
  Object.defineProperty(window, "location", { configurable: true, value: location });
  Object.defineProperty(window, "history", { configurable: true, value: history });
  try {
    return fn({ location, state, calls });
  } finally {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    Object.defineProperty(window, "history", { configurable: true, value: originalHistory });
  }
}
