/**
 * This repository's per-test teardown, extracted from `vitest.setup.ts` so a
 * test can reach it.
 *
 * Vitest abandons the remaining `afterEach` hooks once one throws, and a
 * skipped reset step here becomes state the next test in the file inherits.
 * So every step always runs: one failure is re-thrown as itself, several as
 * an `AggregateError`, earliest first.
 */
export function resetToolbarTestEnvironment(steps: {
  /** `cleanupToolbar()` from `@nejcm/dev-toolbar/testing`. */
  cleanupToolbar: () => void;
  /** `cleanup()` from `@testing-library/react`. */
  cleanup: () => void;
  /**
   * `resetMountedInstances()` from `src/core/useHeightVariables`. A mount whose
   * unmount threw can leave its registration behind, and the next test's lone
   * toolbar would then count as one of two.
   */
  resetMountedInstances: () => void;
}): void {
  const errors: unknown[] = [];
  // Toolbar mounts first, so RTL's cleanup() unmounts the trees still tracked.
  for (const step of [
    steps.cleanupToolbar,
    steps.cleanup,
    steps.resetMountedInstances,
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
