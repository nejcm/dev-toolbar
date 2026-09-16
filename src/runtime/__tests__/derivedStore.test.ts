import { describe, expect, it, vi } from "vitest";
import { createDerivedStore } from "../derivedStore";

describe("createDerivedStore", () => {
  it("builds exactly once at revision zero on construction", () => {
    const build = vi.fn((revision: number) => ({ revision }));
    const store = createDerivedStore(build, {
      signature: (snapshot) => String(snapshot.revision),
    });

    expect(build.mock.calls).toEqual([[0]]);
    expect(store.getSnapshot()).toEqual({ revision: 0 });
    expect(store.peek()).toBe(store.getSnapshot());
    expect(store.published).toBe(0);
    store.destroy();
  });

  it("advances pending revision on equal signatures without publishing", () => {
    const store = createDerivedStore((revision) => ({ revision, value: "same" }), {
      signature: (snapshot) => snapshot.value,
      intervalMs: 0,
    });
    const listener = vi.fn();
    store.subscribe(listener);
    const initial = store.getSnapshot();

    store.rebuild();
    expect(store.peek()).toEqual({ revision: 1, value: "same" });
    store.rebuild();
    expect(store.peek()).toEqual({ revision: 2, value: "same" });
    expect(store.getSnapshot()).toBe(initial);
    expect(listener).not.toHaveBeenCalled();
    expect(store.published).toBe(0);
    store.destroy();
  });

  it("reads fresh state at the current revision without writing or advancing it", () => {
    let value = "initial";
    const build = vi.fn((revision: number) => ({ revision, value }));
    const store = createDerivedStore(build, {
      signature: (snapshot) => snapshot.value,
      intervalMs: 0,
    });
    const listener = vi.fn();
    store.subscribe(listener);
    store.rebuild();
    const pending = store.peek();
    const published = store.getSnapshot();

    value = "fresh";
    const first = store.read();
    const second = store.read();
    expect(first).toEqual({ revision: 1, value: "fresh" });
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(build.mock.calls).toEqual([[0], [1], [1], [1]]);
    expect(store.peek()).toBe(pending);
    expect(store.getSnapshot()).toBe(published);
    expect(listener).not.toHaveBeenCalled();
    expect(store.published).toBe(0);

    store.rebuild();
    expect(store.peek()).toEqual({ revision: 2, value: "fresh" });
    store.destroy();
  });

  it("uses the injected clock and scheduler and keeps published live", () => {
    let time = 1000;
    let value = "initial";
    const now = vi.fn(() => time);
    const cancel = vi.fn();
    const schedule = vi.fn((_callback: () => void, _delayMs: number) => cancel);
    const store = createDerivedStore((revision) => ({ revision, value }), {
      signature: (snapshot) => snapshot.value,
      intervalMs: 100,
      now,
      schedule,
    });
    const listener = vi.fn();
    store.subscribe(listener);
    const initial = store.getSnapshot();
    store.rebuild();
    expect(now).toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();

    time = 1025;
    value = "changed";
    store.rebuild();
    expect(store.peek()).toEqual({ revision: 2, value: "changed" });
    expect(store.getSnapshot()).toBe(initial);
    expect(listener).not.toHaveBeenCalled();
    expect(store.published).toBe(0);
    expect(schedule).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 75);

    time = 1100;
    schedule.mock.calls[0]?.[0]();
    expect(store.getSnapshot()).toBe(store.peek());
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.published).toBe(1);
    store.destroy();
  });

  it.each(["set", "update"] as const)("direct %s leaves the revision counter alone", (method) => {
    const build = vi.fn((revision: number) => ({ revision }));
    const store = createDerivedStore(build, {
      signature: (snapshot) => String(snapshot.revision),
      intervalMs: 0,
    });

    if (method === "set") store.set({ revision: 100 });
    else store.update((previous) => ({ revision: previous.revision + 100 }));
    expect(store.peek()).toEqual({ revision: 100 });
    expect(store.read()).toEqual({ revision: 0 });
    store.rebuild();
    expect(store.getSnapshot()).toEqual({ revision: 1 });
    expect(build.mock.calls).toEqual([[0], [0], [1]]);
    expect(store.published).toBe(2);
    store.destroy();
  });

  it("passes listener failures to the supplied onError handler", () => {
    const onError = vi.fn();
    const store = createDerivedStore((revision) => ({ revision }), {
      signature: (snapshot) => String(snapshot.revision),
      onError,
    });
    const error = new Error("listener failed");
    store.subscribe(() => {
      throw error;
    });
    const listener = vi.fn();
    store.subscribe(listener);

    expect(() => store.rebuild()).not.toThrow();
    expect(onError).toHaveBeenCalledExactlyOnceWith(error, store.getSnapshot());
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.published).toBe(1);
    store.destroy();
  });

  it("compares the whole snapshot when no signature is given", () => {
    let label = "a";
    const store = createDerivedStore((revision) => ({ revision, view: { label } }), {
      intervalMs: 0,
      ignorePaths: [["revision"]],
    });
    const listener = vi.fn();
    store.subscribe(listener);
    const initial = store.getSnapshot();

    store.rebuild();
    expect(store.getSnapshot()).toBe(initial);
    expect(listener).not.toHaveBeenCalled();

    label = "b";
    store.rebuild();
    expect(store.getSnapshot()).toEqual({ revision: 2, view: { label: "b" } });
    expect(listener).toHaveBeenCalledTimes(1);
    store.destroy();
  });

  it("builds with no options at all", () => {
    const store = createDerivedStore((revision) => ({ revision }));
    expect(store.getSnapshot()).toEqual({ revision: 0 });
    store.destroy();
  });

  it("lets a supplied signature win over the structural comparison", () => {
    let label = "a";
    const store = createDerivedStore((revision) => ({ revision, view: { label } }), {
      intervalMs: 0,
      signature: (snapshot) => String(snapshot.revision),
      ignorePaths: [["revision"]],
    });
    const listener = vi.fn();
    store.subscribe(listener);

    // The signature sees only `revision`, which `ignorePaths` would have hidden.
    label = "b";
    store.rebuild();
    expect(store.getSnapshot()).toEqual({ revision: 1, view: { label: "b" } });
    expect(listener).toHaveBeenCalledTimes(1);
    store.destroy();
  });

  it("applies an ignored path at a nested location without hiding its namesake", () => {
    let promotedLabel = "Pinned";
    let error = "storage refused";
    const store = createDerivedStore(
      (revision) => ({
        revision,
        flags: [{ key: "a", promotedLabel }],
        adapterErrors: { promotedLabel: error },
      }),
      { intervalMs: 0, ignorePaths: [["revision"], ["flags", "promotedLabel"]] },
    );
    const listener = vi.fn();
    store.subscribe(listener);
    const initial = store.getSnapshot();

    promotedLabel = "Renamed";
    store.rebuild();
    expect(store.getSnapshot()).toBe(initial);
    expect(listener).not.toHaveBeenCalled();

    error = "storage still refused";
    store.rebuild();
    expect(listener).toHaveBeenCalledTimes(1);
    store.destroy();
  });

  it("does not write or notify when rebuilt after destruction", () => {
    const build = vi.fn((revision: number) => ({ revision }));
    const store = createDerivedStore(build, {
      signature: (snapshot) => String(snapshot.revision),
    });
    const listener = vi.fn();
    store.subscribe(listener);
    const initial = store.getSnapshot();
    store.destroy();

    store.rebuild();
    store.flush();
    expect(build.mock.calls).toEqual([[0], [1]]);
    expect(store.peek()).toBe(initial);
    expect(store.getSnapshot()).toBe(initial);
    expect(listener).not.toHaveBeenCalled();
    expect(store.published).toBe(0);
  });
});
