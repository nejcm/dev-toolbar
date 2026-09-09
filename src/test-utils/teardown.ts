/**
 * This repository's per-test teardown, extracted from `vitest.setup.ts` so a
 * test can reach it.
 *
 * Vitest abandons the remaining `afterEach` hooks once one throws, and this one
 * runs last (the setup file registers first) while being the only place that
 * resets `documentElement`'s style, removes injected sheets and clears
 * `localStorage`. A skipped step is state every later test in that file
 * inherits. So every step runs, and nothing is swallowed: one failure re-thrown
 * as itself, several as an `AggregateError`, earliest first.
 *
 * The callables are injected so a test can make either throw.
 */
export function resetToolbarTestEnvironment(steps: {
  /** `cleanupToolbar()` from `@nejcm/dev-toolbar/testing`. */
  cleanupToolbar: () => void;
  /** `cleanup()` from `@testing-library/react`. */
  cleanup: () => void;
}): void {
  const errors: unknown[] = [];
  // Toolbar mounts first: RTL's `cleanup()` unmounts the trees whose `unmount`
  // functions the tracked list is still holding.
  for (const step of [
    steps.cleanupToolbar,
    steps.cleanup,
    () => document.documentElement.removeAttribute("style"),
    () => {
      for (const style of document.head.querySelectorAll("style[data-dev-toolbar-styles]")) {
        style.remove();
      }
    },
    () => window.localStorage.clear(),
  ]) {
    try {
      step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, `[dev-toolbar] test teardown: ${errors.length} steps failed.`);
  }
}
