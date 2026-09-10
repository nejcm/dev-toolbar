/**
 * Live input: a value plus a change notification, so an extension built at
 * module scope can follow state that notifies instead of polling a getter.
 * `{ getState, subscribe }` is accepted as-is so a Zustand or Redux store — a
 * Zustand bound hook included — needs no adapter and is never called as a
 * getter. Framework-free; per-instance state only. Rationale in docs/kit.md.
 */

/** A value that can be read now and reports when it changes. */
export interface Readable<T> {
  read(): T;
  /** Notify on change. Returns unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/**
 * The shape a Zustand or Redux store already has. Accepted wherever a
 * `Readable` is, so a store is passed directly rather than wrapped.
 */
export interface ReadableStore<T> {
  getState(): T;
  subscribe(listener: () => void): () => void;
}

/** A `Readable` that can also be assigned, from a React effect or anywhere else. */
export interface Source<T> extends Readable<T> {
  set(next: T): void;
}

/**
 * What a consumer may hand an extension for a value that may change: the value
 * itself, a getter (re-read on a timer), or something subscribable (re-read on
 * notify). Only safe where `T` itself cannot carry a `subscribe` method next to
 * `read` or `getState`; a fixed-key options object or an array cannot.
 */
export type Input<T> = T | (() => T) | Readable<T> | ReadableStore<T>;

type Shape = Partial<Record<"read" | "getState" | "subscribe", unknown>>;

/** True for a `Readable` or a `{ getState, subscribe }` store, including a function carrying both. */
export function isReadable<T>(input: Input<T>): input is Readable<T> | ReadableStore<T> {
  if (input === null || (typeof input !== "object" && typeof input !== "function")) return false;
  const shape = input as Shape;
  return (
    typeof shape.subscribe === "function" &&
    (typeof shape.read === "function" || typeof shape.getState === "function")
  );
}

/** The current value: `value`, `getter()`, `readable.read()` or `store.getState()`. */
export function readInput<T>(input: Input<T>): T {
  if (isReadable(input)) {
    return "read" in input && typeof input.read === "function"
      ? input.read()
      : (input as ReadableStore<T>).getState();
  }
  return typeof input === "function" ? (input as () => T)() : input;
}

/**
 * A writable `Readable`. `set()` notifies only when the value changed by
 * `Object.is`, so assigning the same object from every render is free.
 */
export function createSource<T>(initial: T): Source<T> {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    read: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      if (Object.is(next, current)) return;
      current = next;
      // Snapshot first: a listener that unsubscribes mid-notify must not skip its neighbour.
      for (const listener of Array.from(listeners)) listener();
    },
  };
}

/**
 * One `Readable` over several. `compute` reads the inputs itself and runs on
 * every `read()` — the runtimes redact and diff what it returns, so it is not
 * memoised here; a change to any input notifies.
 */
export function derive<T>(
  inputs: readonly (Readable<unknown> | ReadableStore<unknown>)[],
  compute: () => T,
): Readable<T> {
  return {
    read: compute,
    subscribe(listener) {
      const stops = inputs.map((input) => input.subscribe(listener));
      return () => {
        for (const stop of stops) stop();
      };
    },
  };
}
