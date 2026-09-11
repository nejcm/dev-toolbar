/**
 * A tiny typed event bus. [dev-toolbar/runtime]
 *
 * Deliberately not a singleton: create one per toolbar instance (or per
 * extension) to avoid leaking state between SSR requests, toolbars on one
 * page, or tests.
 */

/**
 * Metadata the bus adds to every delivery.
 *
 * `K` carries the event name as a literal, so `emit("network-end", …)` hands
 * back a `BusEvent<…, "network-end">` rather than one widened to `string`.
 */
export interface BusEvent<T = unknown, K extends string = string> {
  type: K;
  payload: T;
  /** `options.now()` at emit time. Defaults to `performance.now()`. */
  at: number;
}

export type BusHandler<T = unknown> = (payload: T, event: BusEvent<T>) => void;

/**
 * The names an event map actually declares, with the index signature that
 * `Events extends Record<string, unknown>` requires (so an interface can
 * serve as an event map) stripped back off — otherwise `keyof Events &
 * string` widens to `string` and `AnyBusEvent` can't narrow. A bare
 * `Record<string, unknown>` (no event map given) declares no names, so
 * `string` is the fallback. A template-literal signature (`` [k:
 * \`evt:${string}\`]: Payload ``) is kept, since `string` doesn't extend it.
 */
type DeclaredEventName<Events> = keyof {
  [K in keyof Events as string extends K ? never : number extends K ? never : K]: 0;
} &
  string;

/** The event names of `Events`, with the constraint's index signature removed. */
export type BusEventName<Events> = [DeclaredEventName<Events>] extends [never]
  ? keyof Events & string
  : DeclaredEventName<Events>;

/**
 * Every delivery a bus over `Events` can make, as a union discriminated on
 * `type`. `onAny` handlers can narrow `event.payload` via
 * `if (event.type === "network-end")`.
 *
 * Covers only *declared* names, so `emit("not-declared", …)` still compiles
 * and an `onAny` handler can see a `type` outside this union. Don't
 * `assertNever` on `event.type` in a default branch.
 */
export type AnyBusEvent<Events extends Record<string, unknown>> = {
  [K in BusEventName<Events>]: BusEvent<Events[K], K>;
}[BusEventName<Events>];

/**
 * An `onAny` subscriber. `payload` is the union of every declared payload,
 * but not correlated with the name — narrow `event` instead, since
 * `event.payload` is the same value, discriminated.
 */
export type AnyBusHandler<Events extends Record<string, unknown>> = (
  payload: Events[BusEventName<Events>],
  event: AnyBusEvent<Events>,
) => void;

export interface BusSubscribeOptions {
  /** Unsubscribes when the signal aborts, so a collector rarely needs to keep the returned function. */
  signal?: AbortSignal;
}

/**
 * The two methods a consumer of a bus actually needs: publish and subscribe.
 *
 * Lets an option like `metrics`' `bus` be typed *structurally* rather than as
 * the whole `EventBus`, so the real bus, `./testing`'s `createMockBus()`, or
 * an app's own emitter adapter can all drive it. Take `BusLike<…>` in an
 * option unless you really need the rest of `EventBus`.
 */
export interface BusLike<Events extends Record<string, unknown>> {
  emit<K extends keyof Events & string>(type: K, payload: Events[K]): BusEvent<Events[K], K>;
  on<K extends keyof Events & string>(
    type: K,
    handler: BusHandler<Events[K]>,
    options?: BusSubscribeOptions,
  ): () => void;
}

export interface EventBus<Events extends Record<string, unknown>> extends BusLike<Events> {
  once<K extends keyof Events & string>(
    type: K,
    handler: BusHandler<Events[K]>,
    options?: BusSubscribeOptions,
  ): () => void;
  onAny(handler: AnyBusHandler<Events>, options?: BusSubscribeOptions): () => void;
  /** Live subscribers, optionally for one type. `onAny` counts toward the total. */
  listenerCount(type?: keyof Events & string): number;
  /**
   * Drops every subscriber, including signal-bound subscriptions' `abort`
   * listeners — so a pre-`clear()` signal aborting later touches nothing
   * subscribed since.
   */
  clear(): void;
}

export interface CreateEventBusOptions {
  /** Clock for `event.at`. Default `performance.now()`, falling back to `Date.now()`. */
  now?: () => number;
  /**
   * Called when a handler throws. A throwing subscriber must never stop the
   * remaining subscribers or propagate into the emitter (usually a `fetch`
   * wrapper or `PerformanceObserver` callback).
   *
   * Called **outside** the try/catch, so a throwing `onError` propagates out
   * of `emit()` and skips the remaining handlers for that event — same as
   * `throttledStore`'s `onError`: swallowing an error reporter's own failure
   * would hide the one thing left that could report it. Keep it total.
   */
  onError?: (error: unknown, event: BusEvent) => void;
}

const defaultNow = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

export function createEventBus<Events extends Record<string, unknown> = Record<string, unknown>>(
  options: CreateEventBusOptions = {},
): EventBus<Events> {
  const { now = defaultNow } = options;
  const onError =
    options.onError ??
    ((error: unknown, event: BusEvent) => {
      // eslint-disable-next-line no-console
      console.error(`[dev-toolbar/runtime] a "${event.type}" handler threw.`, error);
    });

  const handlers = new Map<string, Set<BusHandler<never>>>();
  const anyHandlers = new Set<BusHandler<never>>();

  // A handler may unsubscribe itself or another mid-dispatch, so multi-handler
  // sets are iterated over a copy (`Array.from`), not the live set.
  const dispatch = <T>(set: Set<BusHandler<never>> | undefined, payload: T, event: BusEvent<T>) => {
    if (!set || set.size === 0) return;
    if (set.size === 1) {
      const [handler] = set;
      try {
        (handler as unknown as BusHandler<T>)(payload, event);
      } catch (error) {
        onError(error, event as BusEvent);
      }
      return;
    }
    for (const handler of Array.from(set)) {
      try {
        (handler as unknown as BusHandler<T>)(payload, event);
      } catch (error) {
        onError(error, event as BusEvent);
      }
    }
  };

  /**
   * Every live subscription's teardown, so `clear()` can run them instead of
   * just emptying the handler sets — which would leave signal-bound
   * subscriptions' `abort` listeners attached (an old signal aborting after
   * `clear()` could otherwise delete an `onAny` handler registered after it,
   * since `anyHandlers` is one `Set` for the life of the bus).
   */
  const teardowns = new Set<() => void>();

  const bind = (unsubscribe: () => void, signal?: AbortSignal) => {
    if (signal?.aborted) {
      unsubscribe();
      return () => {};
    }
    // One wrapper for all three exits — manual unsubscribe, abort, `clear()` —
    // so each removes the other two's hold. Idempotent.
    const off = () => {
      teardowns.delete(off);
      signal?.removeEventListener("abort", off);
      unsubscribe();
    };
    teardowns.add(off);
    signal?.addEventListener("abort", off, { once: true });
    return off;
  };

  const on = <K extends keyof Events & string>(
    type: K,
    handler: BusHandler<Events[K]>,
    subscribeOptions?: BusSubscribeOptions,
  ) => {
    const set = handlers.get(type) ?? new Set<BusHandler<never>>();
    handlers.set(type, set);
    set.add(handler as unknown as BusHandler<never>);
    // Unsubscribing twice must be a no-op (e.g. `once()`'s handler plus a
    // React cleanup) — without the latch, a second run could evict someone
    // else's subscribers from a since-reused set.
    let live = true;
    return bind(() => {
      if (!live) return;
      live = false;
      set.delete(handler as unknown as BusHandler<never>);
      if (set.size === 0 && handlers.get(type) === set) handlers.delete(type);
    }, subscribeOptions?.signal);
  };

  return {
    emit<K extends keyof Events & string>(type: K, payload: Events[K]) {
      const event: BusEvent<Events[K], K> = { type, payload, at: now() };
      dispatch(handlers.get(type), payload, event);
      dispatch(anyHandlers, payload, event);
      return event;
    },
    on,
    once(type, handler, subscribeOptions) {
      const off = on(
        type,
        (payload, event) => {
          off();
          handler(payload, event);
        },
        subscribeOptions,
      );
      return off;
    },
    onAny(handler, subscribeOptions) {
      anyHandlers.add(handler as unknown as BusHandler<never>);
      // Latched for the same reason as `on`.
      let live = true;
      return bind(() => {
        if (!live) return;
        live = false;
        anyHandlers.delete(handler as unknown as BusHandler<never>);
      }, subscribeOptions?.signal);
    },
    listenerCount(type) {
      if (type === undefined) {
        let total = anyHandlers.size;
        for (const set of handlers.values()) total += set.size;
        return total;
      }
      return handlers.get(type)?.size ?? 0;
    },
    clear() {
      // Copied: each teardown removes itself from the set.
      for (const off of Array.from(teardowns)) off();
      teardowns.clear();
      handlers.clear();
      anyHandlers.clear();
    },
  };
}

/**
 * Shared event vocabulary so extensions don't invent separate names for the
 * same thing (e.g. "a request finished"). Not required —
 * `createEventBus<YourEvents>()` is the general case — but `/ext/metrics`
 * reads `network-start`/`network-end` off a bus shaped like this, letting an
 * app instrument its own HTTP client instead of being monkey-patched.
 */
export interface ToolbarEventMap extends Record<string, unknown> {
  navigation: { route: string };
  interaction: { name: string; duration: number };
  "long-task": { duration: number };
  "network-start": {
    requestId: string;
    method: string;
    url: string;
    category?: "api" | "sync" | "asset" | "analytics";
  };
  "network-end": {
    requestId: string;
    status?: number;
    ok: boolean;
    /** Milliseconds. */
    duration: number;
    bytes?: number;
    cached?: boolean;
    error?: string;
    aborted?: boolean;
  };
  "react-commit": { duration: number };
  "flag-changed": { key: string };
  /**
   * One hydrated root or Suspense boundary finished. Emit one per boundary
   * rather than one per page: under streaming SSR there is no single moment
   * hydration is "done".
   */
  hydration: {
    /** Milliseconds, e.g. from a `performance.measure`. */
    duration: number;
    /** Which root or boundary. Omit for a single-root app. */
    boundary?: string;
  };
  /** `onRecoverableError` from `hydrateRoot`. */
  "hydration-error": { message: string; boundary?: string };
}

/** Convenience alias for a bus carrying the shared vocabulary. */
export type ToolbarBus = EventBus<ToolbarEventMap>;
