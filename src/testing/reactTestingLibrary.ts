import type { RenderOptions, RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

/**
 * The slice of `@testing-library/react` that `renderWithToolbar` uses.
 *
 * RTL is an *optional* peer dependency, so it must not appear as a static
 * import anywhere in this subpath's module graph: a static import is hoisted
 * into `dist/testing.js`, and importing `@nejcm/dev-toolbar/testing` for
 * `createMockBus()` alone would then fail with `ERR_MODULE_NOT_FOUND` on a
 * project that never installed RTL.
 *
 * So it is loaded through a dynamic import instead, started eagerly at module
 * scope and cached. Two properties matter:
 *
 * - The import goes through the *host's own module graph*, so the `act` and
 *   `render` used here are the same instances the consumer's setup file uses.
 *   Reaching for `createRequire()` would load a second, unrelated copy, whose
 *   `cleanup()` would not clean up what this `render()` mounted.
 * - The rejection is swallowed. A missing RTL therefore costs nothing until
 *   somebody actually calls `renderWithToolbar()`, which then throws a message
 *   that says what to install.
 *
 * Jest is the exception that needs the second path below. Inside its vm
 * sandbox `import()` never settles, so the eager import above resolves nothing
 * and awaiting `testingLibraryReady` does not help. There, the module-scoped
 * `require` *is* the runner's own resolver: it returns the copy already in
 * Jest's registry, not a second instance, so the hazard that rules out
 * `createRequire()` in an ESM host does not apply. The guard is deliberately
 * narrow — `require` simply does not exist in the ESM build, so the branch is
 * dead exactly where the original reasoning holds.
 */
export interface ReactTestingLibrary {
  act: (callback: () => void) => void;
  render: (ui: ReactElement, options?: RenderOptions) => RenderResult;
}

let cached: ReactTestingLibrary | null = null;
let loadError: unknown = null;

/**
 * Resolves once the optional `@testing-library/react` import has settled, one
 * way or the other.
 *
 * Test runners evaluate the whole module graph before running a single test, so
 * by the time an `it()` body calls `renderWithToolbar()` this has already
 * settled. Await it only if you need to render during module evaluation.
 */
export const testingLibraryReady: Promise<void> = import("@testing-library/react")
  .then((module) => {
    cached ??= module as unknown as ReactTestingLibrary;
  })
  .catch((error: unknown) => {
    loadError = error;
  });

/**
 * Supplies the Testing Library module explicitly.
 *
 * For hosts where the dynamic import cannot resolve — a custom runner, a
 * vendored build, a fork — or where a wrapped `render` should be used instead.
 */
export function setTestingLibrary(module: ReactTestingLibrary): void {
  cached = module;
  loadError = null;
}

/**
 * CommonJS-only fallback, for hosts whose `import()` never settles — Jest.
 *
 * Reached through `module.require` rather than the bare `require` identifier:
 * both are the runner's own resolver under Jest, but a bare `require` makes
 * esbuild inject its `__require` shim into the shared chunk — a shim that is
 * *truthy* in the ESM build, which would widen exactly the guard this is meant
 * to keep narrow. `module` is undefined in ESM, so this is genuinely dead there.
 */
function requireFromHost(): ReactTestingLibrary | null {
  const host: unknown = typeof module === "undefined" ? undefined : (module as unknown);
  if (host === undefined || host === null) return null;
  const load = (host as { require?: (id: string) => unknown }).require;
  if (typeof load !== "function") return null;
  try {
    return load.call(host, "@testing-library/react") as ReactTestingLibrary;
  } catch {
    return null;
  }
}

/** Internal. Throws a message that names every remedy, per module system. */
export function requireTestingLibrary(): ReactTestingLibrary {
  if (cached) return cached;

  const fromHost = requireFromHost();
  if (fromHost) {
    cached = fromHost;
    return cached;
  }

  throw new Error(
    "[dev-toolbar/testing] renderWithToolbar() needs @testing-library/react, " +
      "which is an optional peer dependency of @nejcm/dev-toolbar.\n" +
      "  Install it:  npm install --save-dev @testing-library/react\n" +
      "  Or supply it yourself, using the form your runner supports:\n" +
      "    CommonJS / Jest:  setTestingLibrary(require('@testing-library/react'))\n" +
      "    ESM:              setTestingLibrary(await import('@testing-library/react'))\n" +
      "  Under Jest, put that call in your setupFilesAfterEnv file.\n" +
      "Every other export of @nejcm/dev-toolbar/testing works without it." +
      (loadError instanceof Error ? `\nUnderlying error: ${loadError.message}` : ""),
  );
}
