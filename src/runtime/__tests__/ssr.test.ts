// @vitest-environment node
/**
 * SSR / no-DOM safety for `src/runtime`, in an environment that genuinely has
 * no `document`, `window`, or `localStorage` — mirroring
 * `src/core/__tests__/ssr.test.tsx`. `styles.ts`'s doc comment promises
 * `ensureStyleSheet()` degrades to `null` with no document rather than
 * throwing; nothing exercised that outside jsdom, where `document` always
 * exists and the guard's true branch is unreachable.
 *
 * This file also covers the `performance`-less fallback in `bus.ts`'s and
 * `throttledStore.ts`'s `defaultNow`: jsdom always defines `performance`, so
 * the `Date.now()` half of `typeof performance !== "undefined" ? ... :
 * Date.now()` is otherwise never taken.
 */
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
    // The import above is static, so a throw during this module's own
    // evaluation (e.g. a top-level DOM access in one of the barrel's
    // dependencies) would fail this whole file before any test ran — a
    // louder, earlier failure than a runtime assertion here could produce,
    // and the intended one. What is left to assert at test time is the
    // shape of what evaluation produced.
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
    // Date.now() resolution, not performance.now()'s sub-millisecond one —
    // bounding it against a Date.now() window either side is how we know
    // the fallback branch, not some other clock, produced it.
    expect(event.at).toBeGreaterThanOrEqual(before);
    expect(event.at).toBeLessThanOrEqual(after);
  });

  it("throttledStore.ts: still publishes the leading-edge write immediately", () => {
    // @ts-expect-error -- same simulated environment as the bus.ts case above.
    delete globalThis.performance;
    expect(typeof globalThis.performance).toBe("undefined");
    const listener = vi.fn();
    // The argument is `initial` (the store's starting value), not
    // `intervalMs` — `intervalMs` defaults to 250 here, which is why the
    // very first write still counts as "after idle" and publishes
    // synchronously (leading edge) regardless of what `now()` returns. That
    // publish only happens at all if `now() - lastPublishedAt` evaluated
    // without throwing, so this proves the Date.now() fallback ran and
    // returned a usable number rather than blowing up on the missing global —
    // not that it returned any particular value.
    const store = createThrottledStore(0);
    store.subscribe(listener);
    store.set(1);

    expect(store.getSnapshot()).toBe(1);
    expect(store.published).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    store.destroy();
  });
});
