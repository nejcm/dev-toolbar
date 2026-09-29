import { vi } from "vitest";

export interface FakeFrames {
  tick(deltaMs: number): void;
  /** `requestAnimationFrame` calls so far. */
  readonly requested: number;
  readonly cancelled: number[];
  readonly pending: boolean;
  restore(): void;
}

/** A hand-cranked rAF whose clock also drives `performance.now()`, as a browser's shares an origin. */
export function installAnimationFrames(): FakeFrames {
  const originals = ["requestAnimationFrame", "cancelAnimationFrame"].map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  let callback: FrameRequestCallback | null = null;
  let requested = 0;
  let timestamp = 0;
  const cancelled: number[] = [];
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: (fn: FrameRequestCallback) => {
      callback = fn;
      requested += 1;
      return requested;
    },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    writable: true,
    value: (id: number) => {
      cancelled.push(id);
      callback = null;
    },
  });
  const now = vi.spyOn(performance, "now").mockImplementation(() => timestamp + 0.001);
  return {
    tick(deltaMs) {
      const next = callback;
      callback = null;
      timestamp += deltaMs;
      next?.(timestamp);
    },
    get requested() {
      return requested;
    },
    cancelled,
    get pending() {
      return callback !== null;
    },
    restore() {
      now.mockRestore();
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as Record<string, unknown>)[name];
      }
    },
  };
}
