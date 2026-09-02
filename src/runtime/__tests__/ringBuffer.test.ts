import { describe, expect, it, vi } from "vitest";
import { createNumericRing, createRingBuffer, createTimeSeries } from "../ringBuffer";

describe("createRingBuffer", () => {
  it("keeps the newest `capacity` items and drops the rest", () => {
    const ring = createRingBuffer<number>(3);
    expect(ring.size).toBe(0);
    expect(ring.last()).toBeUndefined();

    for (const value of [1, 2, 3, 4, 5]) ring.push(value);

    expect(ring.capacity).toBe(3);
    expect(ring.size).toBe(3);
    expect(ring.written).toBe(5);
    expect(ring.toArray()).toEqual([3, 4, 5]);
    expect(ring.last()).toBe(5);
    expect(ring.at(0)).toBe(3);
    expect(ring.at(2)).toBe(5);
    expect(ring.at(3)).toBeUndefined();
    expect(ring.at(-1)).toBeUndefined();
  });

  it("stays ordered across many wraparounds", () => {
    const ring = createRingBuffer<number>(4);
    for (let value = 0; value < 1003; value += 1) ring.push(value);
    expect(ring.toArray()).toEqual([999, 1000, 1001, 1002]);

    const seen: number[] = [];
    ring.forEach((value) => seen.push(value));
    expect(seen).toEqual([999, 1000, 1001, 1002]);
  });

  it("allocates its backing store exactly once, however many pushes", () => {
    const ArrayConstructor = globalThis.Array;
    const spy = vi
      .spyOn(globalThis, "Array")
      // Not an arrow: the spy is invoked with `new`, and arrows aren't
      // constructible.
      .mockImplementation(function (...args: unknown[]) {
        return new ArrayConstructor(...(args as [number])) as unknown as never;
      });
    try {
      const ring = createRingBuffer<number>(8);
      expect(spy).toHaveBeenCalledTimes(1);
      for (let index = 0; index < 10_000; index += 1) ring.push(index);
      // Not one allocation in 10 000 pushes.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(ring.size).toBe(8);
    } finally {
      spy.mockRestore();
    }
  });

  it("fills a caller-owned array instead of allocating on read", () => {
    const ring = createRingBuffer<number>(4);
    for (const value of [1, 2, 3, 4, 5]) ring.push(value);

    const scratch: number[] = [];
    expect(ring.toArray(scratch)).toBe(scratch);
    expect(scratch).toEqual([2, 3, 4, 5]);
    expect(ring.latest(2, scratch)).toBe(scratch);
    expect(scratch).toEqual([4, 5]);
    expect(ring.latest(99)).toEqual([2, 3, 4, 5]);
    expect(ring.latest(0)).toEqual([]);
  });

  it("clears without releasing the backing store", () => {
    const ring = createRingBuffer<{ id: number }>(2);
    ring.push({ id: 1 });
    ring.clear();
    expect(ring.size).toBe(0);
    expect(ring.written).toBe(0);
    expect(ring.toArray()).toEqual([]);
    expect(ring.capacity).toBe(2);
    ring.push({ id: 9 });
    expect(ring.last()).toEqual({ id: 9 });
  });

  it("clamps a nonsense capacity to one slot", () => {
    for (const capacity of [0, -5, Number.NaN]) {
      const ring = createRingBuffer<number>(capacity);
      expect(ring.capacity).toBe(1);
      ring.push(1);
      ring.push(2);
      expect(ring.toArray()).toEqual([2]);
    }
  });

  it("clamps +Infinity to the max capacity instead of throwing", () => {
    const ring = createRingBuffer<number>(Number.POSITIVE_INFINITY);
    expect(ring.capacity).toBe(1 << 24);
    ring.push(1);
    expect(ring.last()).toBe(1);
  });

  it("clamps -Infinity to one slot, same as other nonsense capacities", () => {
    const ring = createRingBuffer<number>(Number.NEGATIVE_INFINITY);
    expect(ring.capacity).toBe(1);
    ring.push(1);
    ring.push(2);
    expect(ring.toArray()).toEqual([2]);
  });
});

describe("createNumericRing", () => {
  it("allocates one Float64Array and never another", () => {
    const Float64 = globalThis.Float64Array;
    const spy = vi.spyOn(globalThis, "Float64Array").mockImplementation(function (
      ...args: unknown[]
    ) {
      return new Float64(...(args as [number])) as unknown as never;
    });
    try {
      const ring = createNumericRing(16);
      expect(spy).toHaveBeenCalledTimes(1);
      for (let index = 0; index < 50_000; index += 1) ring.push(index);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(ring.size).toBe(16);
      expect(ring.last()).toBe(49_999);
    } finally {
      spy.mockRestore();
    }
  });

  it("summarises into a caller-owned object", () => {
    const ring = createNumericRing(4);
    for (const value of [10, 2, 8, 4, 6]) ring.push(value);

    const target = { min: 0, max: 0, mean: 0, last: 0, count: 0 };
    expect(ring.stats(target)).toBe(target);
    expect(target).toEqual({ min: 2, max: 8, mean: 5, last: 6, count: 4 });
  });

  it("reports NaN rather than zero when empty", () => {
    const ring = createNumericRing(4);
    const stats = ring.stats();
    expect(stats.count).toBe(0);
    expect(Number.isNaN(stats.mean)).toBe(true);
    expect(Number.isNaN(ring.last())).toBe(true);
    expect(Number.isNaN(ring.at(0))).toBe(true);
  });

  it("copies oldest-to-newest into a short destination", () => {
    const ring = createNumericRing(5);
    for (const value of [1, 2, 3, 4, 5, 6]) ring.push(value);
    const into = new Float64Array(3);
    expect(ring.copyInto(into)).toBe(3);
    expect([...into]).toEqual([4, 5, 6]);
  });

  it("visits oldest-to-newest without materialising an array", () => {
    const ring = createNumericRing(3);
    for (const value of [1, 2, 3, 4]) ring.push(value);
    const seen: Array<[number, number]> = [];
    ring.forEach((value, index) => seen.push([value, index]));
    expect(seen).toEqual([
      [2, 0],
      [3, 1],
      [4, 2],
    ]);
  });

  it("clamps +Infinity to the max capacity instead of throwing", () => {
    const ring = createNumericRing(Number.POSITIVE_INFINITY);
    expect(ring.capacity).toBe(1 << 24);
    ring.push(1);
    expect(ring.last()).toBe(1);
  });

  it("clamps -Infinity and NaN to one slot, same as other nonsense capacities", () => {
    for (const capacity of [Number.NEGATIVE_INFINITY, Number.NaN]) {
      const ring = createNumericRing(capacity);
      expect(ring.capacity).toBe(1);
      ring.push(1);
      ring.push(2);
      expect(ring.copyInto(new Float64Array(1))).toBe(1);
    }
  });
});

describe("createTimeSeries", () => {
  it("windows by timestamp", () => {
    const series = createTimeSeries(8);
    for (let index = 0; index < 6; index += 1) {
      series.push(index * 1000, index * 10);
    }
    expect(series.size).toBe(6);
    expect(series.last()).toBe(50);
    expect(series.lastAt()).toBe(5000);
    expect(series.countSince(3000)).toBe(3);
    expect(series.valueAt(2500)).toBe(30);
    expect(Number.isNaN(series.valueAt(999_999))).toBe(true);

    series.clear();
    expect(series.size).toBe(0);
    expect(series.countSince(0)).toBe(0);
  });

  it("clamps an unbounded capacity instead of throwing", () => {
    const series = createTimeSeries(Number.POSITIVE_INFINITY);
    expect(series.capacity).toBe(1 << 24);
    series.push(1, 10);
    expect(series.last()).toBe(10);
  });
});
