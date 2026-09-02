/**
 * A self-contained pub/sub bus with a hand-cranked clock.
 *
 * Deliberately *not* an import from `src/runtime/` — the real event bus lands
 * in P1 behind the `./runtime` subpath, and `./testing` must stay usable
 * without it. When `/runtime` ships, this stays: it is a test double, not a
 * re-export.
 *
 * Because it may not import the contract, it restates it. The shapes below are
 * therefore matched *by hand* to `BusLike<Events>` in `src/runtime/bus.ts`, so
 * that `createMockBus()` is structurally assignable to a `BusLike` option
 * without either module importing the other — structural typing needs no
 * import. `src/ext/metrics/__tests__/network.test.ts` asserts that
 * assignability, so drift fails a test rather than being discovered by a
 * consumer whose `bus:` option rejects the shipped double. In particular:
 * `MockBusEvent` carries the event name as a literal `K`, exactly as `BusEvent`
 * does, and `on`/`once`/`onAny` take an `options.signal`.
 *
 * The mock is deliberately *wider* than the contract — `type: string` rather
 * than a key of an event map, and a recorded history — which is the direction
 * assignability needs: wider parameters, equal-or-narrower returns.
 */

export interface MockClock {
  /** Current virtual time in milliseconds. Starts at `0` unless seeded. */
  now(): number;
  /** Moves time forward, firing every timer that comes due, in order. */
  advance(ms: number): void;
  /** Jumps to an absolute time. Fires due timers when moving forwards. */
  setTime(ms: number): void;
  /** Clock-driven `setTimeout`. Returns a cancel function. */
  setTimeout(callback: () => void, delay: number): () => void;
  /** Clock-driven `setInterval`. Returns a cancel function. */
  setInterval(callback: () => void, interval: number): () => void;
  /** Drops every pending timer without firing it. */
  clearTimers(): void;
  /** Number of timers still pending. */
  pending(): number;
}

export interface MockBusEvent<T = unknown, K extends string = string> {
  type: K;
  payload: T;
  /** `clock.now()` at emit time. */
  at: number;
}

export type MockBusHandler<T = unknown> = (payload: T, event: MockBusEvent<T>) => void;

/** Matched by hand to `BusSubscribeOptions` in `src/runtime/bus.ts`. */
export interface MockBusSubscribeOptions {
  /** Unsubscribes when the signal aborts, as the real bus does. */
  signal?: AbortSignal;
}

export interface MockBus {
  clock: MockClock;
  /** Publishes an event to `type` subscribers and to every `onAny` subscriber. */
  emit<T, K extends string = string>(type: K, payload?: T): MockBusEvent<T, K>;
  /** Subscribes to one type. Returns an unsubscribe function. */
  on<T>(type: string, handler: MockBusHandler<T>, options?: MockBusSubscribeOptions): () => void;
  /** Fires once, then unsubscribes. */
  once<T>(type: string, handler: MockBusHandler<T>, options?: MockBusSubscribeOptions): () => void;
  /** Subscribes to every type. */
  onAny(handler: MockBusHandler, options?: MockBusSubscribeOptions): () => void;
  /** Recorded events, newest last. Pass a `type` to filter. */
  events(type?: string): readonly MockBusEvent[];
  /** Payloads only — the common assertion shape. */
  payloads<T = unknown>(type: string): T[];
  /** Drops the recorded history. Subscribers and timers are untouched. */
  clearEvents(): void;
  /** Drops subscribers, history and timers. */
  reset(): void;
  /** Number of live subscribers, optionally for one type. */
  listenerCount(type?: string): number;
}

export interface CreateMockBusOptions {
  /** Starting value for `clock.now()`. Default `0`. */
  now?: number;
  /** Cap on recorded events. Oldest are dropped. Default `1000`. */
  historyLimit?: number;
}

interface Timer {
  id: number;
  at: number;
  interval: number | null;
  callback: () => void;
}

function createClock(start: number): MockClock {
  let time = start;
  let nextId = 0;
  let timers: Timer[] = [];

  const runDueUpTo = (target: number) => {
    // Re-read the queue each pass: a timer callback may schedule another one
    // that is itself due before `target`.
    for (let guard = 0; guard < 10_000; guard += 1) {
      const due = timers
        .filter((timer) => timer.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      time = due.at;
      if (due.interval === null) {
        timers = timers.filter((timer) => timer !== due);
      } else {
        due.at = due.at + due.interval;
      }
      due.callback();
    }
    time = target;
  };

  const schedule = (callback: () => void, delay: number, interval: number | null) => {
    const safeDelay = Number.isFinite(delay) && delay > 0 ? delay : 0;
    nextId += 1;
    const timer: Timer = {
      id: nextId,
      at: time + safeDelay,
      interval: interval === null ? null : Math.max(1, interval),
      callback,
    };
    timers.push(timer);
    return () => {
      timers = timers.filter((entry) => entry !== timer);
    };
  };

  return {
    now: () => time,
    advance(ms) {
      if (!Number.isFinite(ms) || ms < 0) {
        throw new Error("[dev-toolbar/testing] advance() needs a positive number of ms.");
      }
      runDueUpTo(time + ms);
    },
    setTime(ms) {
      if (ms < time) {
        time = ms;
        return;
      }
      runDueUpTo(ms);
    },
    setTimeout: (callback, delay) => schedule(callback, delay, null),
    setInterval: (callback, interval) => schedule(callback, interval, interval),
    clearTimers() {
      timers = [];
    },
    pending: () => timers.length,
  };
}

/** Creates an isolated bus. One per test — never share a module-level instance. */
export function createMockBus(options: CreateMockBusOptions = {}): MockBus {
  const { now = 0, historyLimit = 1000 } = options;
  const clock = createClock(now);
  const handlers = new Map<string, Set<MockBusHandler<never>>>();
  const anyHandlers = new Set<MockBusHandler>();
  let history: MockBusEvent[] = [];

  // `signal` support, latched so a second call is a no-op: `once()` hands back
  // the very function it calls on delivery, and an aborted signal has already
  // run it. Same reasoning as the real bus.
  const bind = (unsubscribe: () => void, signal?: AbortSignal) => {
    let live = true;
    const off = () => {
      if (!live) return;
      live = false;
      unsubscribe();
    };
    if (!signal) return off;
    if (signal.aborted) {
      off();
      return () => {};
    }
    signal.addEventListener("abort", off, { once: true });
    return () => {
      signal.removeEventListener("abort", off);
      off();
    };
  };

  const on = <T>(
    type: string,
    handler: MockBusHandler<T>,
    options?: MockBusSubscribeOptions,
  ): (() => void) => {
    const set = handlers.get(type) ?? new Set();
    handlers.set(type, set);
    set.add(handler as MockBusHandler<never>);
    return bind(() => {
      set.delete(handler as MockBusHandler<never>);
      if (set.size === 0 && handlers.get(type) === set) handlers.delete(type);
    }, options?.signal);
  };

  return {
    clock,
    emit<T, K extends string = string>(type: K, payload?: T) {
      const event: MockBusEvent<T, K> = {
        type,
        payload: payload as T,
        at: clock.now(),
      };
      history.push(event as MockBusEvent);
      if (history.length > historyLimit) {
        history = history.slice(history.length - historyLimit);
      }
      // Snapshot: a handler may unsubscribe itself mid-dispatch.
      for (const handler of Array.from(handlers.get(type) ?? [])) {
        (handler as MockBusHandler<T>)(event.payload, event);
      }
      for (const handler of Array.from(anyHandlers)) {
        handler(event.payload, event as MockBusEvent);
      }
      return event;
    },
    on,
    once<T>(type: string, handler: MockBusHandler<T>, options?: MockBusSubscribeOptions) {
      const off = on<T>(
        type,
        (payload, event) => {
          off();
          handler(payload, event);
        },
        options,
      );
      return off;
    },
    onAny(handler, options) {
      anyHandlers.add(handler);
      return bind(() => {
        anyHandlers.delete(handler);
      }, options?.signal);
    },
    events: (type) =>
      type === undefined ? history : history.filter((event) => event.type === type),
    payloads<T = unknown>(type: string) {
      return history.filter((event) => event.type === type).map((event) => event.payload as T);
    },
    clearEvents() {
      history = [];
    },
    reset() {
      handlers.clear();
      anyHandlers.clear();
      history = [];
      clock.clearTimers();
    },
    listenerCount: (type) =>
      type === undefined
        ? [...handlers.values()].reduce((sum, set) => sum + set.size, 0) + anyHandlers.size
        : (handlers.get(type)?.size ?? 0),
  };
}
