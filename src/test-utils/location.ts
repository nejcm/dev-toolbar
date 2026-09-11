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
