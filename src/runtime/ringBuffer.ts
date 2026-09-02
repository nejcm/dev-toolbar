/**
 * Bounded, allocation-stable ring buffers. [dev-toolbar/runtime]
 *
 * These back the sparkline histories, so the invariant that matters is not
 * "holds N items" but "allocates its storage once". A collector sampling at
 * 60 Hz for an hour must not create 216 000 objects for the garbage collector
 * to walk: `push()` writes into a slot that already exists, and every read that
 * could allocate accepts a caller-owned destination instead.
 */

/**
 * Upper bound on ring capacity: 1 << 24 (16 777 216 slots). A `Float64Array`
 * that size is 128 MB, which is already far past anything a sparkline history
 * needs; it also sits comfortably under every engine's typed-array length
 * limit, so `new Float64Array(slots)` / `new Array(slots)` never throw here
 * even though both constructors would throw a `RangeError` for `Infinity` or
 * for a length past the platform's limit.
 */
const MAX_CAPACITY = 1 << 24;

/**
 * Clamps a requested capacity to a sane, allocatable slot count: at least 1
 * (a zero-length ring silently swallowing every sample is never what the
 * caller meant) and at most `MAX_CAPACITY`. Non-finite input (`Infinity`,
 * `-Infinity`, `NaN`) and fractions are folded in the same pass, since an
 * unclamped `Infinity` reaches `new Array()` / `new Float64Array()` and
 * throws a `RangeError` there instead of failing predictably here.
 */
function clampCapacity(capacity: number): number {
  // `NaN > 0` and `-Infinity > 0` are both false, so both take the `: 1`
  // branch here; only `+Infinity` needs the ceiling.
  if (!Number.isFinite(capacity)) return capacity > 0 ? MAX_CAPACITY : 1;
  return Math.max(1, Math.min(MAX_CAPACITY, Math.floor(capacity) || 1));
}

export interface RingBuffer<T> {
  /** Fixed slot count. Never changes after construction. */
  readonly capacity: number;
  /** Slots currently filled, `<= capacity`. */
  readonly size: number;
  /** Total pushes ever, including the ones that were overwritten. */
  readonly written: number;
  /** Overwrites the oldest slot once full. Allocates nothing. */
  push(value: T): void;
  /** `0` is the oldest retained item. */
  at(index: number): T | undefined;
  /** Newest item, or `undefined` when empty. */
  last(): T | undefined;
  /** Oldest to newest. Pass `into` to reuse an array instead of allocating. */
  toArray(into?: T[]): T[];
  /** The newest `count` items, oldest to newest. */
  latest(count: number, into?: T[]): T[];
  /** Oldest to newest, without materialising an array at all. */
  forEach(visit: (value: T, index: number) => void): void;
  clear(): void;
}

/**
 * `capacity` is clamped by {@link clampCapacity}: at least 1 (a zero-length
 * ring silently swallowing every sample is never what the caller meant) and
 * at most `MAX_CAPACITY`, so a non-finite or absurd request never reaches
 * `new Array()` and throws a `RangeError`.
 */
export function createRingBuffer<T>(capacity: number): RingBuffer<T> {
  const slots = clampCapacity(capacity);
  // Allocated once, here. Nothing below this line grows it.
  // oxlint-disable-next-line unicorn/no-new-array -- fixed-capacity preallocation, not an element
  const store = new Array<T | undefined>(slots);
  let head = 0;
  let size = 0;
  let written = 0;

  const indexOf = (index: number) => (head - size + index + slots * 2) % slots;

  return {
    capacity: slots,
    get size() {
      return size;
    },
    get written() {
      return written;
    },
    push(value) {
      store[head] = value;
      head = (head + 1) % slots;
      if (size < slots) size += 1;
      written += 1;
    },
    at(index) {
      if (index < 0 || index >= size) return undefined;
      return store[indexOf(index)];
    },
    last() {
      if (size === 0) return undefined;
      return store[(head - 1 + slots) % slots];
    },
    toArray(into) {
      const target = into ?? [];
      target.length = size;
      for (let index = 0; index < size; index += 1) {
        target[index] = store[indexOf(index)] as T;
      }
      return target;
    },
    latest(count, into) {
      const take = Math.max(0, Math.min(size, Math.floor(count) || 0));
      const target = into ?? [];
      target.length = take;
      const offset = size - take;
      for (let index = 0; index < take; index += 1) {
        target[index] = store[indexOf(offset + index)] as T;
      }
      return target;
    },
    forEach(visit) {
      for (let index = 0; index < size; index += 1) {
        visit(store[indexOf(index)] as T, index);
      }
    },
    clear() {
      // Drop references so a ring of objects does not pin them, but keep the
      // backing array itself.
      for (let index = 0; index < slots; index += 1) store[index] = undefined;
      head = 0;
      size = 0;
      written = 0;
    },
  };
}

export interface NumericRingStats {
  min: number;
  max: number;
  mean: number;
  last: number;
  count: number;
}

/**
 * Read-only view of a {@link NumericRing}: every inspection method, minus
 * `push`/`clear`. `TimeSeries` exposes its two backing rings through this
 * type so a consumer can read `times`/`values` (`copyInto`, `at`, `written`,
 * …) without a route to push or clear one ring out of step with the other —
 * `times.push()` with no matching `values.push()` desyncs the pair, and
 * `last()`/`lastAt()` then describe two different samples. This is what the
 * sparklines read.
 */
export interface NumericRingView {
  readonly capacity: number;
  readonly size: number;
  readonly written: number;
  at(index: number): number;
  last(): number;
  /** Fills `into` oldest-to-newest and returns how many values were written. */
  copyInto(into: Float64Array | number[]): number;
  /** Fills and returns `into` when given; allocates a fresh object otherwise. */
  stats(into?: NumericRingStats): NumericRingStats;
  forEach(visit: (value: number, index: number) => void): void;
}

/**
 * A ring of numbers backed by a `Float64Array`.
 *
 * Structurally allocation-free: a typed array cannot grow, `push` writes a
 * double into a slot, and `stats()` fills a caller-owned object.
 */
export interface NumericRing extends NumericRingView {
  push(value: number): void;
  clear(): void;
}

/**
 * `capacity` is clamped by {@link clampCapacity}: at least 1 (a zero-length
 * ring silently swallowing every sample is never what the caller meant) and
 * at most `MAX_CAPACITY`, so a non-finite or absurd request never reaches
 * `new Float64Array()` and throws a `RangeError`.
 */
export function createNumericRing(capacity: number): NumericRing {
  const slots = clampCapacity(capacity);
  const store = new Float64Array(slots);
  let head = 0;
  let size = 0;
  let written = 0;

  const indexOf = (index: number) => (head - size + index + slots * 2) % slots;

  return {
    capacity: slots,
    get size() {
      return size;
    },
    get written() {
      return written;
    },
    push(value) {
      store[head] = value;
      head = (head + 1) % slots;
      if (size < slots) size += 1;
      written += 1;
    },
    at(index) {
      if (index < 0 || index >= size) return Number.NaN;
      return store[indexOf(index)] as number;
    },
    last() {
      if (size === 0) return Number.NaN;
      return store[(head - 1 + slots) % slots] as number;
    },
    copyInto(into) {
      const take = Math.min(size, into.length);
      const offset = size - take;
      for (let index = 0; index < take; index += 1) {
        into[index] = store[indexOf(offset + index)] as number;
      }
      return take;
    },
    stats(into) {
      const target = into ?? { min: 0, max: 0, mean: 0, last: 0, count: 0 };
      if (size === 0) {
        target.min = Number.NaN;
        target.max = Number.NaN;
        target.mean = Number.NaN;
        target.last = Number.NaN;
        target.count = 0;
        return target;
      }
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      let sum = 0;
      for (let index = 0; index < size; index += 1) {
        const value = store[indexOf(index)] as number;
        if (value < min) min = value;
        if (value > max) max = value;
        sum += value;
      }
      target.min = min;
      target.max = max;
      target.mean = sum / size;
      target.last = store[(head - 1 + slots) % slots] as number;
      target.count = size;
      return target;
    },
    forEach(visit) {
      for (let index = 0; index < size; index += 1) {
        visit(store[indexOf(index)] as number, index);
      }
    },
    clear() {
      store.fill(0);
      head = 0;
      size = 0;
      written = 0;
    },
  };
}

/**
 * Two parallel numeric rings — timestamps and values — which is the shape every
 * time series in a collector actually wants. Kept as two `Float64Array`s rather
 * than a ring of `{ at, value }` objects precisely to avoid the per-sample
 * allocation.
 */
export interface TimeSeries {
  readonly capacity: number;
  readonly size: number;
  /** Read-only: push through {@link TimeSeries.push} so it stays paired with `values`. */
  readonly times: NumericRingView;
  /** Read-only: push through {@link TimeSeries.push} so it stays paired with `times`. */
  readonly values: NumericRingView;
  push(at: number, value: number): void;
  /** Newest value, or `NaN`. */
  last(): number;
  /** Newest timestamp, or `NaN`. */
  lastAt(): number;
  /** Oldest retained sample at or after `since`, or `NaN` when there is none. */
  valueAt(since: number): number;
  /** Number of samples with `at >= since`. */
  countSince(since: number): number;
  clear(): void;
}

export function createTimeSeries(capacity: number): TimeSeries {
  const times = createNumericRing(capacity);
  const values = createNumericRing(capacity);
  return {
    capacity: times.capacity,
    get size() {
      return times.size;
    },
    times,
    values,
    push(at, value) {
      times.push(at);
      values.push(value);
    },
    last: () => values.last(),
    lastAt: () => times.last(),
    valueAt(since) {
      for (let index = 0; index < times.size; index += 1) {
        if (times.at(index) >= since) return values.at(index);
      }
      return Number.NaN;
    },
    countSince(since) {
      let count = 0;
      for (let index = times.size - 1; index >= 0; index -= 1) {
        if (times.at(index) < since) break;
        count += 1;
      }
      return count;
    },
    clear() {
      times.clear();
      values.clear();
    },
  };
}
