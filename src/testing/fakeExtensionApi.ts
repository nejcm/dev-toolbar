/**
 * `fakeExtensionApi()` — the `ExtensionRuntimeApi` object core hands to
 * `start()`, built by hand for a test that drives an extension's `runtime.ts`
 * without mounting a toolbar.
 *
 * It exists because `ExtensionRuntimeApi` is the one half of the contract that
 * a consumer *constructs* rather than consumes, so every widening of it is a
 * compile error in every test suite that fakes one. Contract v2's required
 * `invokeCommand` broke every one of them inside this repo alone
 * (`docs/adr/ADR-003-contract-version-policy.md`, *Context*); this helper is
 * the one place the next widening has to be absorbed.
 *
 * Defaults are the empty, permissionless shape: visible, nothing aggregated,
 * `runCommand` resolving `false`, `invokeCommand` resolving
 * `unknown-command`, and a fresh in-memory storage adapter. Override the parts
 * a test actually cares about and leave the rest alone — the point is that a
 * suite asserting on visibility never has to have an opinion about commands.
 *
 * Every override is merged over the defaults, `storage` included, so
 * `fakeExtensionApi({ storage: createMemoryStorage({ seed: "1" }) })` is the
 * seeding path and `fakeExtensionApi()` never shares state between tests.
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
    // Last, so an explicit override always wins. Overriding `isVisible` or
    // `subscribeVisibility` opts that half out of `setVisible`: it still flips
    // the internal flag and still notifies subscribers it registered, but a
    // hand-supplied `isVisible` is the one core would call. Override both or
    // neither.
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
