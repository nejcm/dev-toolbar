/**
 * Stands a stubbed `window.location` in for one call, then puts the real one
 * back.
 *
 * jsdom's `location` is not assignable, so a test that drives a URL-reading
 * path has to `Object.defineProperty` over it — and remember to restore it in a
 * `finally`, or the stub leaks into every later test in the file. Three suites
 * wrote the same eight lines to do that; this is those eight lines, once.
 *
 * The patch is spread over the current `location`, so a stub names only what it
 * changes. Two suites stub a shape this cannot express — a `pathname` getter
 * that throws (`src/ext/environment`) and an absent `location`
 * (`src/ext/flags`) — and keep doing it by hand.
 *
 * Keep this outside `src/testing/`: it is a repository fixture, not part of the
 * published `/testing` entrypoint (AGENTS.md).
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
