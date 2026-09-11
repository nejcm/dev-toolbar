// @vitest-environment node
// SSR / no-DOM safety for `src/runtime`, in an environment with genuinely no
// `document`/`window`/`localStorage` (jsdom always has `document`, so the
// no-DOM branches — including the `performance`-less fallback in `defaultNow` —
// are otherwise unreachable).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventBus } from "../bus";
import { createThrottledStore } from "../throttledStore";
import { ensureStyleSheet } from "../styles";
import * as runtime from "../index";

it("really is running without a DOM", () => {
  // Guards the guard — see the core SSR test for the same pattern.
  expect(typeof window).toBe("undefined");
  expect(typeof document).toBe("undefined");
});

describe("styles.ts: ensureStyleSheet with no document", () => {
  it("returns null instead of throwing when there is no document at all", () => {
    expect(() => ensureStyleSheet("ext-x", "body{color:red}")).not.toThrow();
    expect(ensureStyleSheet("ext-x", "body{color:red}")).toBeNull();
  });
});

describe("src/runtime/index.ts: re-exports", () => {
  it("re-exports STYLE_ATTRIBUTE and an ensureStyleSheet that returns null with no document", () => {
    // The static import above already fails the whole file if module
    // evaluation touches the DOM; this only asserts the shape it produced.
    expect(runtime.STYLE_ATTRIBUTE).toBe("data-dev-toolbar-styles");
    expect(runtime.ensureStyleSheet("x", "y")).toBeNull();
  });

  it("lets createEventBus and createThrottledStore construct with no DOM", () => {
    expect(() => runtime.createEventBus()).not.toThrow();
    expect(() => runtime.createThrottledStore(0)).not.toThrow();
  });
});

describe("defaultNow falls back to Date.now() with no performance global", () => {
  const originalPerformance = Object.getOwnPropertyDescriptor(globalThis, "performance");

  afterEach(() => {
    if (originalPerformance) {
      Object.defineProperty(globalThis, "performance", originalPerformance);
    } else {
      // @ts-expect-error -- restoring the no-descriptor case is itself a delete.
      delete globalThis.performance;
    }
  });

  it("bus.ts: still produces a finite event timestamp", () => {
    // @ts-expect-error -- deliberately simulating an environment with no
    // `performance` global at all, not just an empty one.
    delete globalThis.performance;
    expect(typeof globalThis.performance).toBe("undefined");
    const bus = createEventBus();
    const before = Date.now();
    const event = bus.emit("tick", { n: 1 });
    const after = Date.now();

    expect(Number.isFinite(event.at)).toBe(true);
    // Bounding by a Date.now() window (not performance.now()'s sub-ms one)
    // confirms the fallback branch produced this, not some other clock.
    expect(event.at).toBeGreaterThanOrEqual(before);
    expect(event.at).toBeLessThanOrEqual(after);
  });

  it("throttledStore.ts: still publishes the leading-edge write immediately", () => {
    // @ts-expect-error -- same simulated environment as the bus.ts case above.
    delete globalThis.performance;
    expect(typeof globalThis.performance).toBe("undefined");
    const listener = vi.fn();
    // The leading-edge publish only happens if `now() - lastPublishedAt`
    // evaluates without throwing, so this proves the Date.now() fallback
    // returns a usable number rather than blowing up on the missing global.
    const store = createThrottledStore(0);
    store.subscribe(listener);
    store.set(1);

    expect(store.getSnapshot()).toBe(1);
    expect(store.published).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    store.destroy();
  });
});
