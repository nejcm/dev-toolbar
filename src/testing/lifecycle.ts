/**
 * Mount bookkeeping, so a test file does not have to keep its own array of
 * `unmount` functions and an `afterEach` that drains it.
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
 * `renderWithToolbar` that remembers what it mounted. Identical otherwise,
 * except the returned `unmount` is idempotent and de-registers the mount, so a
 * test may call it itself without `cleanupToolbar()` unmounting it again.
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
 * fake layout still installed. Idempotent, safe with nothing mounted. Anyone
 * using `mountToolbar()` must call this — e.g. from an `afterEach` — since the
 * tracked list never hears about RTL's auto-cleanup. For plain
 * `renderWithToolbar()` it's only a safety net.
 *
 * A throwing unmount does not abort the teardown: every mount is still
 * unmounted and the layout restored, with the failure(s) re-thrown after
 * (`AggregateError` for more than one).
 */
export function cleanupToolbar(): void {
  const errors: unknown[] = [];
  try {
    for (const entry of mounted.splice(0).reverse()) {
      if (entry.done) continue;
      entry.done = true;
      try {
        entry.unmount();
      } catch (error) {
        errors.push(error);
      }
    }
  } finally {
    restoreToolbarLayouts();
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      `[dev-toolbar/testing] cleanupToolbar(): ${errors.length} mounts failed to unmount.`,
    );
  }
}
