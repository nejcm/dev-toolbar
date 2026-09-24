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
   * Flips visibility, keeping every invariant core does except timing: delivery is synchronous,
   * one call per change, and never coalesced. A runtime must not depend on either timing.
   */
  setVisible(visible: boolean): void;
  /**
   * Aborts the internal controller, which is what core does when the extension
   * is unregistered or the toolbar unmounts — the teardown path an extension's
   * cleanup is written against. A test that overrides `signal` keeps its own
   * signal on `api`; this aborts only the internal controller the listeners follow.
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
      if (controller.signal.aborted) return () => {};
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
      if (next === current) return;
      current = next;
      // A copy, so a subscriber added during delivery does not hear this one.
      for (const listener of Array.from(listeners)) {
        try {
          listener(next);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error("[dev-toolbar/testing] a subscribeVisibility() callback threw.", error);
        }
      }
    },
    abort() {
      controller.abort();
      listeners.clear();
    },
    controller,
  };
}
