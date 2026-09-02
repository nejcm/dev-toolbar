/**
 * A store that coalesces writes. [dev-toolbar/runtime]
 *
 * A jank sampler writes on every animation frame; without this the bar would
 * re-render 60 times a second. The store accepts every write but
 * *publishes* at most once per interval, so `getSnapshot()` stays stable
 * between notifications, as `useSyncExternalStore` requires (a debounce
 * helper alone wouldn't give that).
 *
 * Leading edge first (the first write after idle shows up immediately),
 * trailing edge after (the last write of a burst is never lost).
 */

export type Unsubscribe = () => void;

export interface ThrottledStore<T> {
  /** Stable between notifications. Safe as a `useSyncExternalStore` snapshot. */
  getSnapshot(): T;
  /**
   * After `destroy()`, a no-op returning a no-op unsubscribe: the listener
   * is never added, so it's never retained or notified. Safe if a
   * `useSyncExternalStore` consumer's `subscribe` races a concurrent
   * `destroy()`.
   */
  subscribe(listener: () => void): Unsubscribe;
  /** The most recent write, published or not. For tests and diagnostics. */
  peek(): T;
  set(next: T): void;
  update(next: (previous: T) => T): void;
  /** Publishes any pending write immediately and cancels the trailing timer. */
  flush(): void;
  /**
   * Cancels the timer and drops every listener. Idempotent and permanent:
   * `set`/`update`/`flush` stop changing the store afterward, and
   * `subscribe` stops adding listeners.
   *
   * A pending trailing write is discarded by default (`getSnapshot()` keeps
   * the last published value); pass `{ flush: true }` to publish it first,
   * synchronously notifying subscribers, before tearing down. Off by
   * default since publishing during teardown can re-enter a caller that is
   * itself unwinding. Calling on an already-destroyed store is a no-op
   * regardless of the option.
   */
  destroy(destroyOptions?: { flush?: boolean }): void;
  /** Notifications emitted so far. The coalescing assertion in the tests. */
  readonly published: number;
}

export interface CreateThrottledStoreOptions<T> {
  /** Minimum milliseconds between notifications. Default `250` (4 Hz). */
  intervalMs?: number;
  /** Clock. Default `performance.now()`, falling back to `Date.now()`. */
  now?: () => number;
  /**
   * Timer. Returns its own cancel function. Injectable so tests can drive it
   * without global fake timers, and so a host can use `requestIdleCallback`.
   */
  schedule?: (callback: () => void, delayMs: number) => () => void;
  /** Skip the notification when the published value did not change. `Object.is` by default. */
  equals?: (a: T, b: T) => boolean;
  /**
   * Called when a listener throws. A throwing listener must never stop the
   * remaining listeners or propagate into the caller — usually a `set()` or
   * `flush()` call mid-render or mid-event-handler.
   */
  onError?: (error: unknown, value: T) => void;
}

// Byte-identical to bus.ts's defaultNow, deliberately not shared/imported —
// a three-line clock fallback isn't worth an inter-module dependency.
const defaultNow = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const defaultSchedule = (callback: () => void, delayMs: number) => {
  const handle = setTimeout(callback, delayMs);
  return () => clearTimeout(handle);
};

export function createThrottledStore<T>(
  initial: T,
  options: CreateThrottledStoreOptions<T> = {},
): ThrottledStore<T> {
  const {
    intervalMs = 250,
    now = defaultNow,
    schedule = defaultSchedule,
    equals = Object.is,
    onError = (error: unknown, _value: T) => {
      // eslint-disable-next-line no-console
      console.error("[dev-toolbar/runtime] a store listener threw.", error);
    },
  } = options;

  let published = initial;
  let pending = initial;
  let lastPublishedAt = Number.NEGATIVE_INFINITY;
  let cancelTimer: (() => void) | null = null;
  let destroyed = false;
  let publishCount = 0;

  const listeners = new Set<() => void>();

  const emit = () => {
    // Captured once: a re-entrant set()/flush() from a listener could advance
    // `published` before a later listener throws, so onError should get the
    // value this pass is notifying about, not whatever is newest by then.
    const value = published;
    // Copied: a listener may unsubscribe itself while being notified.
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch (error) {
        // Outside its own try/catch, so a throwing onError propagates to the
        // caller and stops remaining listeners this pass (same as bus.ts).
        onError(error, value);
      }
    }
  };

  const publish = () => {
    if (cancelTimer) {
      cancelTimer();
      cancelTimer = null;
    }
    lastPublishedAt = now();
    if (equals(published, pending)) return;
    published = pending;
    publishCount += 1;
    emit();
  };

  const write = (next: T) => {
    if (destroyed) return;
    pending = next;
    if (cancelTimer) return; // a trailing publish is already booked
    const elapsed = now() - lastPublishedAt;
    if (elapsed >= intervalMs) {
      publish();
      return;
    }
    cancelTimer = schedule(
      () => {
        cancelTimer = null;
        publish();
      },
      Math.max(0, intervalMs - elapsed),
    );
  };

  return {
    getSnapshot: () => published,
    peek: () => pending,
    subscribe(listener) {
      if (destroyed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: write,
    update(next) {
      write(next(pending));
    },
    flush() {
      if (destroyed) return;
      publish();
    },
    destroy(destroyOptions) {
      // Guard on !destroyed: a second destroy({ flush: true }) must not
      // publish and mutate getSnapshot() with no listener left to notify.
      if (!destroyed && destroyOptions?.flush === true) publish();
      destroyed = true;
      if (cancelTimer) {
        cancelTimer();
        cancelTimer = null;
      }
      listeners.clear();
    },
    get published() {
      return publishCount;
    },
  };
}
