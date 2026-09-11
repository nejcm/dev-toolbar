/**
 * `fakeExtensionApi()` builds the `ExtensionRuntimeApi` object core hands to
 * `start()`, for driving an extension's `runtime.ts` without mounting a
 * toolbar. Defaults are the empty, permissionless shape — visible, nothing
 * aggregated, `runCommand` resolving `false`, `invokeCommand` resolving
 * `unknown-command`, fresh in-memory storage — so a test overrides only what
 * it cares about; every override merges over the defaults, `storage` included.
 */
import { createMemoryStorage } from "@nejcm/dev-toolbar";
import type { ExtensionRuntimeApi } from "../core/contract";

export interface FakeExtensionApiOptions extends Partial<ExtensionRuntimeApi> {
  /**
   * Initial visibility, for the common case where a test wants a hidden bar
   * but no control over it afterwards. Ignored when `isVisible` is supplied.
   * Default `true`.
   */
  visible?: boolean;
}

/** What `fakeExtensionApi()` returns: the `api`, plus the handles to drive it. */
export interface FakeExtensionApi {
  /** Pass this to `start()`. */
  api: ExtensionRuntimeApi;
  /**
   * Flips visibility and notifies every subscriber, the way core's own
   * `subscribeVisibility` does. A no-op once `abort()` has run.
   */
  setVisible(visible: boolean): void;
  /**
   * Aborts the internal controller, which is what core does when the extension
   * is unregistered or the toolbar unmounts — the teardown path an extension's
   * cleanup is written against. A test that overrides `signal` keeps its own
   * signal on `api` and this aborts only the controller behind `setVisible`.
   */
  abort(): void;
  /** The controller behind `api.signal`, for a test that needs `reason`. */
  controller: AbortController;
}

export function fakeExtensionApi(options: FakeExtensionApiOptions = {}): FakeExtensionApi {
  const { visible = true, ...overrides } = options;

  const controller = new AbortController();
  const listeners = new Set<(next: boolean) => void>();
  let current = visible;

  const api: ExtensionRuntimeApi = {
    signal: controller.signal,
    isVisible: () => current,
    subscribeVisibility(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    storage: createMemoryStorage(),
    getCommands: () => [],
    getDiagnostics: () => [],
    runCommand: async () => false,
    invokeCommand: async () => ({ ok: false, reason: "unknown-command" }) as const,
    // Last, so an explicit override wins. Overriding just `isVisible` (not
    // `subscribeVisibility`) still lets `setVisible` flip the internal flag
    // and notify, but core would call the overridden `isVisible` — override
    // both or neither.
    ...overrides,
  };

  return {
    api,
    setVisible(next) {
      if (controller.signal.aborted) return;
      current = next;
      // A `Set` tolerates deletion during iteration, so an unsubscribing
      // listener is safe without copying.
      for (const listener of listeners) listener(next);
    },
    abort() {
      controller.abort();
      listeners.clear();
    },
    controller,
  };
}
