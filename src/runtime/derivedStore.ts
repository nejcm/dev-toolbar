/**
 * Revision-owned snapshot publication. [dev-toolbar/runtime]
 *
 * Passing revision into the builder prevents export reads from advancing it.
 * See "advances revision only on publish, not on export reads" in
 * src/ext/environment/__tests__/runtime.test.ts.
 * `getSnapshot()` returns published state; `peek()` returns the latest write;
 * `read()` builds fresh state without writing or advancing revision.
 */
import { createThrottledStore } from "./throttledStore";
import type { CreateThrottledStoreOptions, ThrottledStore } from "./throttledStore";

export interface DerivedStore<T> extends ThrottledStore<T> {
  /** Builds at the current revision without advancing it or writing to the store. */
  read(): T;
  /** Synchronously advances revision and writes a fresh build, even when signatures match. */
  rebuild(): void;
}

export interface CreateDerivedStoreOptions<T> extends Omit<
  CreateThrottledStoreOptions<T>,
  "equals"
> {
  /** Compared at publication time; fields omitted here cannot trigger notifications. */
  signature: (snapshot: T) => string;
}

/** Builds initially at revision 0; rebuilds advance revision before building and use the throttle to publish. */
export function createDerivedStore<T>(
  build: (revision: number) => T,
  options: CreateDerivedStoreOptions<T>,
): DerivedStore<T> {
  let revision = 0;
  const { signature, ...throttleOptions } = options;
  const read = () => build(revision);
  const store = createThrottledStore(read(), {
    ...throttleOptions,
    equals: (a, b) => signature(a) === signature(b),
  });

  return Object.assign(store, {
    read,
    rebuild() {
      revision += 1;
      store.set(read());
    },
  });
}
