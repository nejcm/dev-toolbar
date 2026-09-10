import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode, useEffect, useLayoutEffect } from "react";
import { createThrottledStore } from "../../runtime";
import { useExtensionSurface, useSource } from "../hooks";
import { createSource } from "../source";

afterEach(() => {
  cleanup();
});

const store = (initial: string) => createThrottledStore<string>(initial, { intervalMs: 0 });

describe("useExtensionSurface", () => {
  it("returns the store's current snapshot", () => {
    const throttled = store("first");
    const { result } = renderHook(() => useExtensionSurface(throttled, false, () => {}));
    expect(result.current).toBe("first");
  });

  it("re-renders when the store publishes", () => {
    const throttled = store("first");
    const { result } = renderHook(() => useExtensionSurface(throttled, false, () => {}));

    act(() => {
      throttled.set("second");
      throttled.flush();
    });

    expect(result.current).toBe("second");
  });

  it("injects the stylesheet once when inject is true", () => {
    const ensureStyles = vi.fn();
    const throttled = store("first");
    const { rerender } = renderHook(() => useExtensionSurface(throttled, true, ensureStyles));
    rerender();

    act(() => {
      throttled.set("second");
      throttled.flush();
    });

    expect(ensureStyles).toHaveBeenCalledTimes(1);
  });

  it("never injects when inject is false", () => {
    const ensureStyles = vi.fn();
    const throttled = store("first");
    const { rerender } = renderHook(() => useExtensionSurface(throttled, false, ensureStyles));
    rerender();
    expect(ensureStyles).not.toHaveBeenCalled();
  });

  it("does not inject when inject is false, even with a nonce", () => {
    const ensureStyles = vi.fn();
    const throttled = store("first");
    renderHook(() => useExtensionSurface(throttled, false, ensureStyles, "n0nce"));
    expect(ensureStyles).not.toHaveBeenCalled();
  });

  it("injects when inject flips from false to true", () => {
    const ensureStyles = vi.fn();
    const throttled = store("first");
    const { rerender } = renderHook(
      ({ inject }: { inject: boolean }) => useExtensionSurface(throttled, inject, ensureStyles),
      { initialProps: { inject: false } },
    );
    expect(ensureStyles).not.toHaveBeenCalled();

    rerender({ inject: true });
    expect(ensureStyles).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes from the store on unmount", () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const { unmount } = renderHook(() =>
      useExtensionSurface({ subscribe, getSnapshot: () => "first" }, false, () => {}),
    );

    expect(subscribe).toHaveBeenCalled();
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("passes the nonce to ensureStyles and re-runs when it changes", () => {
    const ensureStyles = vi.fn();
    const throttled = store("first");
    const { rerender } = renderHook(
      ({ nonce }: { nonce?: string }) => useExtensionSurface(throttled, true, ensureStyles, nonce),
      { initialProps: { nonce: "a" } },
    );
    expect(ensureStyles).toHaveBeenCalledTimes(1);
    expect(ensureStyles).toHaveBeenCalledWith(undefined, "a");

    rerender({ nonce: "b" });
    expect(ensureStyles).toHaveBeenCalledTimes(2);
    expect(ensureStyles).toHaveBeenLastCalledWith(undefined, "b");
  });
});

describe("useSource", () => {
  it("assigns from a layout effect, so a later layout effect already reads it", () => {
    const source = createSource<string | undefined>(undefined);
    const seenInLayout: (string | undefined)[] = [];
    const seenInEffect: (string | undefined)[] = [];
    const { rerender } = renderHook(
      ({ value }: { value: string | undefined }) => {
        useSource(source, value);
        // Layout effects run in declaration order, before any passive effect. If
        // `useSource` fell back to `useEffect` this would still see the previous value.
        useLayoutEffect(() => {
          seenInLayout.push(source.read());
        });
        useEffect(() => {
          seenInEffect.push(source.read());
        });
      },
      { initialProps: { value: "first" } },
    );
    expect(seenInLayout).toEqual(["first"]);
    expect(seenInEffect).toEqual(["first"]);

    rerender({ value: "second" });
    expect(seenInLayout).toEqual(["first", "second"]);
    expect(source.read()).toBe("second");
  });

  it("notifies subscribers exactly once per changed value", () => {
    const source = createSource(0);
    const listener = vi.fn();
    source.subscribe(listener);
    const { rerender } = renderHook(({ value }: { value: number }) => useSource(source, value), {
      initialProps: { value: 1 },
    });
    rerender({ value: 1 });
    rerender({ value: 2 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("clears nothing on unmount", () => {
    const source = createSource<string | undefined>(undefined);
    const { unmount } = renderHook(() => useSource(source, "signed-in"));
    unmount();
    expect(source.read()).toBe("signed-in");
  });

  it("never reads as absent across a StrictMode double mount", () => {
    // The module-scope-mutable pattern reset its holder in a cleanup; StrictMode's
    // mount → cleanup → mount then reported "nobody signed in" in between.
    const source = createSource<string | undefined>("stale");
    const seen: (string | undefined)[] = [];
    source.subscribe(() => seen.push(source.read()));
    renderHook(() => useSource(source, "signed-in"), { wrapper: StrictMode });
    expect(source.read()).toBe("signed-in");
    expect(seen).toEqual(["signed-in"]);
  });
});
