import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createSource, derive, isReadable, readInput } from "../index";
import type { Input, Readable, ReadableStore } from "../index";

/** The shape a Zustand bound hook has: callable, with the store API attached. */
function zustandLike<T>(initial: T): (() => T) & ReadableStore<T> & { set(next: T): void } {
  const source = createSource(initial);
  const hook = (): T => {
    throw new Error("called the hook outside a component");
  };
  return Object.assign(hook, {
    getState: source.read,
    subscribe: source.subscribe,
    set: source.set,
  });
}

describe("Input", () => {
  it("is the value, a getter, a Readable or a store", () => {
    expectTypeOf<Input<number>>().toEqualTypeOf<
      number | (() => number) | Readable<number> | ReadableStore<number>
    >();
  });
});

describe("createSource", () => {
  it("reads the initial value and what was set", () => {
    const source = createSource<string | undefined>(undefined);
    expect(source.read()).toBeUndefined();
    source.set("nejc");
    expect(source.read()).toBe("nejc");
  });

  it("notifies on change and not on an identical value", () => {
    const source = createSource({ id: 1 });
    const listener = vi.fn();
    source.subscribe(listener);

    const same = source.read();
    source.set(same);
    expect(listener).not.toHaveBeenCalled();

    source.set({ id: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("treats NaN as equal to itself, like Object.is", () => {
    const source = createSource(Number.NaN);
    const listener = vi.fn();
    source.subscribe(listener);
    source.set(Number.NaN);
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops notifying after unsubscribe, and tolerates a double unsubscribe", () => {
    const source = createSource(0);
    const listener = vi.fn();
    const stop = source.subscribe(listener);
    stop();
    stop();
    source.set(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it("still reaches the next listener when one unsubscribes mid-notify", () => {
    const source = createSource(0);
    const second = vi.fn();
    const stopFirst = source.subscribe(() => stopFirst());
    source.subscribe(second);
    source.set(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("defers a listener added mid-notify to the next notification", () => {
    // A `Set` iterated directly would visit the newcomer in the same pass.
    const source = createSource(0);
    const late = vi.fn();
    source.subscribe(() => {
      if (source.read() === 1) source.subscribe(late);
    });
    source.set(1);
    expect(late).not.toHaveBeenCalled();
    source.set(2);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("is itself readable", () => {
    expect(isReadable(createSource(0))).toBe(true);
  });
});

describe("isReadable", () => {
  it("accepts read/subscribe and getState/subscribe shapes", () => {
    expect(isReadable<number>({ read: () => 1, subscribe: () => () => {} })).toBe(true);
    expect(isReadable<number>({ getState: () => 1, subscribe: () => () => {} })).toBe(true);
  });

  it("accepts a function carrying the store shape, the way a Zustand hook does", () => {
    expect(isReadable(zustandLike(1))).toBe(true);
  });

  it("rejects values, plain getters, arrays and half shapes", () => {
    expect(isReadable<unknown>(undefined)).toBe(false);
    expect(isReadable<unknown>(null)).toBe(false);
    expect(isReadable<unknown>(3)).toBe(false);
    expect(isReadable<unknown>("text")).toBe(false);
    expect(isReadable<unknown>(() => 1)).toBe(false);
    expect(isReadable<unknown>([1, 2])).toBe(false);
    expect(isReadable<unknown>({ environment: "staging" })).toBe(false);
    expect(isReadable<unknown>({ read: () => 1 })).toBe(false);
    expect(isReadable<unknown>({ subscribe: () => () => {} })).toBe(false);
    expect(isReadable<unknown>({ getState: 1, subscribe: () => () => {} })).toBe(false);
  });
});

describe("readInput", () => {
  it("returns a value as-is, including undefined, null and arrays", () => {
    expect(readInput(undefined)).toBeUndefined();
    expect(readInput(null)).toBeNull();
    const list = [1, 2];
    expect(readInput<readonly number[]>(list)).toBe(list);
  });

  it("calls a getter", () => {
    expect(readInput(() => 7)).toBe(7);
  });

  it("reads a Readable and a store", () => {
    expect(readInput(createSource("a"))).toBe("a");
    expect(readInput<string>({ getState: () => "b", subscribe: () => () => {} })).toBe("b");
  });

  it("reads a Zustand-shaped hook through getState, never by calling it", () => {
    expect(readInput(zustandLike("state"))).toBe("state");
  });
});

describe("derive", () => {
  it("computes on every read and notifies when any input changes", () => {
    const user = createSource<string | undefined>(undefined);
    const store = zustandLike({ region: "eu" });
    const compute = vi.fn(() => ({ userId: user.read(), region: store.getState().region }));
    const session = derive([user, store], compute);
    const listener = vi.fn();
    const stop = session.subscribe(listener);

    expect(session.read()).toEqual({ userId: undefined, region: "eu" });
    user.set("u1");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(session.read()).toEqual({ userId: "u1", region: "eu" });
    expect(compute).toHaveBeenCalledTimes(2);

    // The store side of the fan-out, not only the first input.
    store.set({ region: "us" });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(session.read()).toEqual({ userId: "u1", region: "us" });

    stop();
    user.set("u2");
    store.set({ region: "ap" });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("is itself readable, so a derived value can feed an extension", () => {
    expect(isReadable(derive([createSource(1)], () => 1))).toBe(true);
  });
});
