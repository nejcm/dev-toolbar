/**
 * A self-contained pub/sub bus with a hand-cranked clock.
 *
 * Deliberately *not* an import from `src/runtime/bus.ts`: `src/testing/` may
 * not import `src/runtime/` at all (per AGENTS.md's layering table), and this
 * stays a test double, not a re-export, permanently.
 *
 * Since it can't import the contract, it restates it: the shapes here are
 * matched *by hand* to `BusLike<Events>` in `src/runtime/bus.ts` so that
 * `createMockBus()` stays structurally assignable to a `BusLike` option
 * without either module importing the other. `src/ext/metrics/__tests__/network.test.ts`
 * asserts that assignability, so drift fails a test rather than surprising a
 * consumer. The mock is deliberately *wider* than the contract (`type: string`
 * rather than a key of an event map, plus a recorded history) — the direction
 * assignability needs.
 *
 * Known divergences from `createEventBus()`:
 * - `MockBus` is not generic over an `Events` map — `emit`/`on`/`once` take
 *   `type: string` everywhere. A caller wanting payload type safety narrows at
 *   the call site.
 * - `MockBus.reset()` also wipes recorded history and pending timers, unlike
 *   `EventBus.clear()` which drops only subscribers — deliberately not aliased
 *   under one name since the scopes differ.
 */

export interface MockClock {
  /** Current virtual time in milliseconds. Starts at `0` unless seeded. */
  now(): number;
  /**
   * Moves time forward by `ms` (must be `>= 0`), firing every timer that comes
   * due, in order. Throws if a single call would need more than 100,000 timer
   * firings — almost always a timer rescheduling faster than time advances.
   */
  advance(ms: number): void;
  /**
   * Jumps to an absolute time, firing due timers when moving forwards (and
   * throwing the same runaway-timer error `advance()` can). `ms` must be finite.
   */
  setTime(ms: number): void;
  /** Clock-driven `setTimeout`. Returns a cancel function. A non-finite delay fires immediately. */
  setTimeout(callback: () => void, delay: number): () => void;
  /**
   * Clock-driven `setInterval`. Returns a cancel function. A delay below 1ms,
   * or `NaN`, is clamped to 1ms; an infinite delay never fires.
   */
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

/** See the "Known divergences" list in this file's header comment. */
export interface MockBus {
  clock: MockClock;
  /**
   * Publishes an event to `type` subscribers and every `onAny` subscriber.
   * Matches the real bus: a throwing handler doesn't stop the rest or
   * propagate to the caller — it's routed to `onError` instead.
   */
  emit<T, K extends string = string>(type: K, payload?: T): MockBusEvent<T, K>;
  /** Subscribes to one type. Returns an unsubscribe function. */
  on<T>(type: string, handler: MockBusHandler<T>, options?: MockBusSubscribeOptions): () => void;
  /** Fires once, then unsubscribes. */
  once<T>(type: string, handler: MockBusHandler<T>, options?: MockBusSubscribeOptions): () => void;
  /** Subscribes to every type. */
  onAny(handler: MockBusHandler, options?: MockBusSubscribeOptions): () => void;
  /**
   * Recorded events, newest last. Pass a `type` to filter. Returns a snapshot
   * copy, so a later `clearEvents()` or `emit()` never mutates an array you
   * already hold.
   */
  events(type?: string): readonly MockBusEvent[];
  /** Payloads only — the common assertion shape. */
  payloads<T = unknown>(type: string): T[];
  /** Drops the recorded history. Subscribers and timers are untouched. */
  clearEvents(): void;
  /**
   * Drops subscribers, history and timers — wider than the real bus's
   * `EventBus.clear()`. Not aliased as `clear()` on purpose (see header).
   */
  reset(): void;
  /** Number of live subscribers, optionally for one type. */
  listenerCount(type?: string): number;
}

export interface CreateMockBusOptions {
  /** Starting value for `clock.now()`. Default `0`. */
  now?: number;
  /** Cap on recorded events. Oldest are dropped. Default `1000`. */
  historyLimit?: number;
  /**
   * Called when a handler throws during `emit()`, mirroring the real bus's
   * `CreateEventBusOptions.onError`. Defaults to `console.error`.
   */
  onError?: (error: unknown, event: MockBusEvent) => void;
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

  // Generous cap for legitimate heavy use (e.g. `setInterval(cb, 1);
  // advance(20_000)`); when hit, `advance`/`setTime` throw naming the runaway
  // timer rather than silently truncating.
  const MAX_TIMER_FIRINGS = 100_000;

  const runDueUpTo = (target: number) => {
    // Re-read the queue each pass: a callback may schedule another timer due
    // before `target`.
    for (let guard = 0; guard < MAX_TIMER_FIRINGS; guard += 1) {
      const due = timers
        .filter((timer) => timer.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) {
        time = target;
        return;
      }
      time = due.at;
      if (due.interval === null) {
        timers = timers.filter((timer) => timer !== due);
      } else {
        due.at = due.at + due.interval;
      }
      due.callback();
    }
    // Recompute to check whether a timer is still genuinely due — otherwise
    // `advance(100_000)` for a plain 1ms interval would throw a false positive.
    const due = timers
      .filter((timer) => timer.at <= target)
      .sort((a, b) => a.at - b.at || a.id - b.id)[0];
    if (!due) {
      time = target;
      return;
    }
    throw new Error(
      `[dev-toolbar/testing] clock.advance()/setTime() aborted: exceeded ${MAX_TIMER_FIRINGS} timer firings ` +
        `while advancing to ${target}ms (currently at ${time}ms). ` +
        `Runaway timer #${due.id} (interval=${due.interval ?? "one-shot"}) is still due at ${due.at}ms — ` +
        `check for a timer that reschedules itself faster than time advances, or more distinct timers than ` +
        `the guard allows in a single call.`,
    );
  };

  const schedule = (callback: () => void, delay: number, interval: number | null) => {
    // `null` = one-shot (setTimeout): delay may legitimately be 0. A recurring
    // timer (setInterval) is floored to 1ms for both its first and every later
    // firing, so `setInterval(cb, 0)` has a consistent cadence rather than
    // firing immediately once. `NaN` falls back to that same floor; `Infinity`
    // is left alone as a legitimate "never fires" interval.
    const safeInterval =
      interval === null ? null : Number.isNaN(interval) ? 1 : Math.max(1, interval);
    const safeDelay =
      safeInterval !== null ? safeInterval : Number.isFinite(delay) && delay > 0 ? delay : 0;
    nextId += 1;
    const timer: Timer = {
      id: nextId,
      at: time + safeDelay,
      interval: safeInterval,
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
        throw new Error("[dev-toolbar/testing] advance() needs a non-negative number of ms.");
      }
      runDueUpTo(time + ms);
    },
    setTime(ms) {
      if (!Number.isFinite(ms)) {
        throw new Error("[dev-toolbar/testing] setTime() needs a finite number of ms.");
      }
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
  const onError =
    options.onError ??
    ((error: unknown, event: MockBusEvent) => {
      // eslint-disable-next-line no-console
      console.error(`[dev-toolbar/testing] a "${event.type}" handler threw.`, error);
    });
  const clock = createClock(now);
  const handlers = new Map<string, Set<MockBusHandler<never>>>();
  const anyHandlers = new Set<MockBusHandler>();
  let history: MockBusEvent[] = [];

  // `signal` support, latched so a second call is a no-op — `once()` hands
  // back the same function it calls on delivery. Same reasoning as the real bus.
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
      // Snapshot: a handler may unsubscribe itself mid-dispatch. Matches the
      // real bus's `dispatch()` contract.
      for (const handler of Array.from(handlers.get(type) ?? [])) {
        try {
          (handler as MockBusHandler<T>)(event.payload, event);
        } catch (error) {
          onError(error, event as MockBusEvent);
        }
      }
      for (const handler of Array.from(anyHandlers)) {
        try {
          handler(event.payload, event as MockBusEvent);
        } catch (error) {
          onError(error, event as MockBusEvent);
        }
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
      type === undefined ? history.slice() : history.filter((event) => event.type === type),
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
