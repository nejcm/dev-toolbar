import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createThrottledStore } from "../../runtime";
import { useExtensionSurface } from "../hooks";

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
