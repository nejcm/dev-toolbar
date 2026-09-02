/**
 * A store that coalesces writes. [dev-toolbar/runtime]
 *
 * A jank sampler writes on every animation frame. Without this, the bar would
 * re-render 60 times a second to move a two-character number. The store accepts
 * every write but *publishes* at most once per interval, so `getSnapshot()`
 * stays stable between notifications — which is what `useSyncExternalStore`
 * requires, and why this is a store rather than a debounce helper.
 *
 * Leading edge first (the first write after an idle period shows up
 * immediately), trailing edge after (the last write of a burst is never lost).
 */

export type Unsubscribe = () => void;

export interface ThrottledStore<T> {
  /** Stable between notifications. Safe as a `useSyncExternalStore` snapshot. */
  getSnapshot(): T;
  /**
   * After `destroy()`, this is a no-op that returns a no-op unsubscribe: the
   * listener is never added, so it is never retained or notified. Safe when a
   * `useSyncExternalStore` consumer's `subscribe` races a concurrent
   * `destroy()`, since React only ever invokes the returned unsubscribe — it
   * never inspects it.
   */
  subscribe(listener: () => void): Unsubscribe;
  /** The most recent write, published or not. For tests and diagnostics. */
  peek(): T;
  set(next: T): void;
  update(next: (previous: T) => T): void;
  /** Publishes any pending write immediately and cancels the trailing timer. */
  flush(): void;
  /**
   * Cancels the timer and drops every listener. Idempotent, and permanent:
   * `set`, `update` and `flush` stop changing the store afterward (`update`
   * still evaluates its callback, then discards the result), and `subscribe`
   * stops adding listeners rather than accepting ones that would never fire.
   */
  destroy(): void;
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
}

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
  } = options;

  let published = initial;
  let pending = initial;
  let lastPublishedAt = Number.NEGATIVE_INFINITY;
  let cancelTimer: (() => void) | null = null;
  let destroyed = false;
  let publishCount = 0;

  const listeners = new Set<() => void>();

  const emit = () => {
    // Copied: a listener may unsubscribe itself while being notified.
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[dev-toolbar/runtime] a store listener threw.", error);
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
    destroy() {
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
