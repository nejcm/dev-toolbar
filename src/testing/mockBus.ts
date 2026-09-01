/**
 * A self-contained pub/sub bus with a hand-cranked clock.
 *
 * Deliberately *not* an import from `src/runtime/` — the real event bus lands
 * in P1 behind the `./runtime` subpath, and `./testing` must stay usable
 * without it. When `/runtime` ships, this stays: it is a test double, not a
 * re-export.
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

export interface MockBusEvent<T = unknown> {
  type: string;
  payload: T;
  /** `clock.now()` at emit time. */
  at: number;
}

export type MockBusHandler<T = unknown> = (
  payload: T,
  event: MockBusEvent<T>,
) => void;

export interface MockBus {
  clock: MockClock;
  /** Publishes an event to `type` subscribers and to every `onAny` subscriber. */
  emit<T>(type: string, payload?: T): MockBusEvent<T>;
  /** Subscribes to one type. Returns an unsubscribe function. */
  on<T>(type: string, handler: MockBusHandler<T>): () => void;
  /** Fires once, then unsubscribes. */
  once<T>(type: string, handler: MockBusHandler<T>): () => void;
  /** Subscribes to every type. */
  onAny(handler: MockBusHandler): () => void;
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

  const schedule = (
    callback: () => void,
    delay: number,
    interval: number | null,
  ) => {
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

  const on = <T,>(type: string, handler: MockBusHandler<T>) => {
    const set = handlers.get(type) ?? new Set();
    handlers.set(type, set);
    set.add(handler as MockBusHandler<never>);
    return () => {
      set.delete(handler as MockBusHandler<never>);
      if (set.size === 0) handlers.delete(type);
    };
  };

  return {
    clock,
    emit<T>(type: string, payload?: T) {
      const event: MockBusEvent<T> = {
        type,
        payload: payload as T,
        at: clock.now(),
      };
      history.push(event as MockBusEvent);
      if (history.length > historyLimit) {
        history = history.slice(history.length - historyLimit);
      }
      // Snapshot: a handler may unsubscribe itself mid-dispatch.
      for (const handler of [...(handlers.get(type) ?? [])]) {
        (handler as MockBusHandler<T>)(event.payload, event);
      }
      for (const handler of [...anyHandlers]) {
        handler(event.payload, event as MockBusEvent);
      }
      return event;
    },
    on,
    once<T>(type: string, handler: MockBusHandler<T>) {
      const off = on<T>(type, (payload, event) => {
        off();
        handler(payload, event);
      });
      return off;
    },
    onAny(handler) {
      anyHandlers.add(handler);
      return () => {
        anyHandlers.delete(handler);
      };
    },
    events: (type) =>
      type === undefined
        ? history
        : history.filter((event) => event.type === type),
    payloads<T = unknown>(type: string) {
      return history
        .filter((event) => event.type === type)
        .map((event) => event.payload as T);
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
        ? [...handlers.values()].reduce((sum, set) => sum + set.size, 0) +
          anyHandlers.size
        : (handlers.get(type)?.size ?? 0),
  };
}
