import type { RenderOptions, RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

/**
 * The slice of `@testing-library/react` that `renderWithToolbar` uses.
 *
 * RTL is an *optional* peer dependency, so it must never appear as a static
 * import here — that would break importing `@nejcm/dev-toolbar/testing` for
 * `createMockBus()` alone on a project that never installed RTL. It's loaded
 * via a dynamic import, started eagerly at module scope and cached: the
 * import goes through the host's own module graph, so `act`/`render` are the
 * same instances the consumer's setup file uses (unlike `createRequire()`,
 * which would load an unrelated second copy whose `cleanup()` wouldn't clean
 * up what this `render()` mounted); the rejection is swallowed, so a missing
 * RTL costs nothing until `renderWithToolbar()` is actually called.
 *
 * Jest needs the fallback path below: inside its vm sandbox `import()` never
 * settles, but the module-scoped `require` is the runner's own resolver
 * there, returning the same copy already in Jest's registry.
 */
export interface ReactTestingLibrary {
  /** Sync form wraps the state mutators; async form wraps `runCommand()`, which may await. */
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
  render: (ui: ReactElement, options?: RenderOptions) => RenderResult;
}

let cached: ReactTestingLibrary | null = null;
let loadError: unknown = null;

/**
 * Resolves once the optional `@testing-library/react` import has settled,
 * either way. Test runners evaluate the whole module graph before running any
 * test, so this has already settled by the time an `it()` body calls
 * `renderWithToolbar()` — await it only if rendering during module evaluation.
 */
export const testingLibraryReady: Promise<void> = import("@testing-library/react")
  .then((module) => {
    cached ??= module as unknown as ReactTestingLibrary;
  })
  .catch((error: unknown) => {
    loadError = error;
  });

/**
 * Supplies the Testing Library module explicitly, for hosts where the dynamic
 * import can't resolve (custom runner, vendored build, fork) or where a
 * wrapped `render` should be used instead.
 */
export function setTestingLibrary(module: ReactTestingLibrary): void {
  cached = module;
  loadError = null;
}

/**
 * CommonJS-only fallback for hosts whose `import()` never settles — Jest.
 *
 * Reached through `module.require` rather than the bare `require` identifier:
 * a bare `require` makes esbuild inject its `__require` shim into the shared
 * chunk, truthy even in the ESM build, which would widen this guard. `module`
 * is undefined in ESM, so this stays genuinely dead there.
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
