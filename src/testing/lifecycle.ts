/**
 * Mount bookkeeping, so a test file does not have to keep its own.
 *
 * Every suite that renders more than one toolbar had grown the same six lines:
 * an array of `unmount` functions, a `mount()` that pushes onto it, and an
 * `afterEach` that drains it. That array is the thing this module owns —
 * AGENTS.md, *Conventions*: setup boilerplate belongs in `src/testing/`.
 */
import { renderWithToolbar } from "./renderWithToolbar";
import type { RenderWithToolbarOptions, RenderWithToolbarResult } from "./renderWithToolbar";
import { restoreToolbarLayouts } from "./layout";

interface Entry {
  unmount: () => void;
  done: boolean;
}

/** Live mounts, oldest first. Torn down last-in-first-out. */
const mounted: Entry[] = [];

/**
 * `renderWithToolbar` that remembers what it mounted.
 *
 * Identical to `renderWithToolbar` in every other respect, except that the
 * returned `unmount` is idempotent and de-registers the mount. So a test may
 * call `unmount()` itself to assert teardown behaviour, and the later
 * `cleanupToolbar()` will not unmount it a second time.
 */
export function mountToolbar(
  ui?: Parameters<typeof renderWithToolbar>[0],
  options: RenderWithToolbarOptions = {},
): RenderWithToolbarResult {
  const result = renderWithToolbar(ui, options);
  const entry: Entry = { unmount: result.unmount, done: false };
  mounted.push(entry);

  return {
    ...result,
    unmount: () => {
      if (entry.done) return;
      entry.done = true;
      const at = mounted.indexOf(entry);
      if (at !== -1) mounted.splice(at, 1);
      result.unmount();
    },
  };
}

/**
 * Unmounts everything `mountToolbar()` mounted, newest first, and restores any
 * fake layout still installed.
 *
 * Idempotent, and safe to call when nothing is mounted. Anyone using
 * `mountToolbar()` must call it — from an `afterEach`, as this repo does in
 * `vitest.setup.ts`. The tracked list is this module's own and never hears
 * about RTL's auto-cleanup, so nothing else drains it.
 *
 * For plain `renderWithToolbar()` it is only a net: that path already ties both
 * the unmount and the layout teardown to Testing Library's own `cleanup()`, so
 * the one thing left for this to catch is a bare `installToolbarLayout()` whose
 * `restore()` was missed.
 */
export function cleanupToolbar(): void {
  for (const entry of mounted.splice(0).reverse()) {
    if (entry.done) continue;
    entry.done = true;
    entry.unmount();
  }
  restoreToolbarLayouts();
}
