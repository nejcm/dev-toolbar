/**
 * `fakeExtensionApi()` is a published export: a suite that overrides nothing
 * must still get an `api` core would recognise, and its handles
 * (`setVisible`, `abort`, `controller`) must drive what `start()` subscribes
 * to. The first test is load-bearing — the returned object must stay
 * *complete*, or a widened `ExtensionRuntimeApi` becomes a type error at
 * every call site instead of one edit here.
 */
import { describe, expect, it, vi } from "vitest";
import { fakeExtensionApi } from "../fakeExtensionApi";
import type { ExtensionRuntimeApi } from "../../core/contract";

describe("fakeExtensionApi", () => {
  it("returns every member of the contract, so no call site has to add one", () => {
    const { api } = fakeExtensionApi();
    expect(Object.keys(api).sort()).toEqual([
      "getCommands",
      "getDiagnostics",
      "invokeCommand",
      "isVisible",
      "runCommand",
      "signal",
      "storage",
      "subscribeVisibility",
    ]);
  });

  it("defaults to visible, empty and permissionless", async () => {
    const { api } = fakeExtensionApi();
    expect(api.isVisible()).toBe(true);
    expect(api.getCommands()).toEqual([]);
    expect(api.getDiagnostics()).toEqual([]);
    expect(api.signal.aborted).toBe(false);
    expect(await api.runCommand("anything")).toBe(false);
    expect(await api.invokeCommand("anything")).toEqual({
      ok: false,
      reason: "unknown-command",
    });
  });

  it("gives each call its own storage, so tests cannot leak into each other", () => {
    const first = fakeExtensionApi();
    first.api.storage.setItem("k", "1");
    expect(fakeExtensionApi().api.storage.getItem("k")).toBeNull();
  });

  it("drives visibility through both halves at once", () => {
    const { api, setVisible } = fakeExtensionApi();
    const seen = vi.fn();
    const release = api.subscribeVisibility(seen);

    setVisible(false);
    expect(api.isVisible()).toBe(false);
    expect(seen).toHaveBeenCalledWith(false);

    // Released listeners stop hearing about it; `isVisible` still moves.
    release();
    setVisible(true);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(api.isVisible()).toBe(true);
  });

  it("starts hidden when asked", () => {
    expect(fakeExtensionApi({ visible: false }).api.isVisible()).toBe(false);
  });

  it("aborts the signal and stops notifying, the way an unmount does", () => {
    const { api, setVisible, abort } = fakeExtensionApi();
    const seen = vi.fn();
    api.subscribeVisibility(seen);

    abort();
    expect(api.signal.aborted).toBe(true);

    // A teardown that left the fake still publishing would let a test pass
    // against an extension that never unsubscribed.
    setVisible(false);
    expect(seen).not.toHaveBeenCalled();
    // The toolbar outlives an unregistered extension, so visibility keeps moving.
    expect(api.isVisible()).toBe(false);
  });

  it("logs a throwing callback under the testing marker", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { api, setVisible } = fakeExtensionApi();
      const error = new Error("boom");
      api.subscribeVisibility(() => {
        throw error;
      });

      setVisible(false);
      expect(spy).toHaveBeenCalledWith(
        "[dev-toolbar/testing] a subscribeVisibility() callback threw.",
        error,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("takes an override for every member, `visible` aside", async () => {
    const command = { id: "a", label: "A", run: () => {} };
    const controller = new AbortController();
    const { api } = fakeExtensionApi({
      signal: controller.signal,
      getCommands: () => [command],
      runCommand: async () => true,
      // The cast is the generic's fault, not the helper's: `invokeCommand<Out>`
      // promises the caller's `Out`, and a fake that always resolves a number
      // cannot honour that for an arbitrary `Out`. Real implementations reach
      // the same place — core casts once, deliberately (`src/core/commands.ts`).
      invokeCommand: (async () => ({
        ok: true,
        result: 7,
      })) as ExtensionRuntimeApi["invokeCommand"],
      getDiagnostics: () => [{ id: "x", label: "X", status: "absent" as const }],
    });

    expect(api.getCommands()).toEqual([command]);
    expect(await api.runCommand("a")).toBe(true);
    expect(await api.invokeCommand("a")).toEqual({ ok: true, result: 7 });
    expect(api.getDiagnostics()).toHaveLength(1);
    controller.abort();
    expect(api.signal.aborted).toBe(true);
  });
});
