/**
 * A tiny typed event bus. [dev-toolbar/runtime]
 *
 * Deliberately not a singleton: create one per toolbar instance (or per
 * extension) and pass it around. A module-level bus would leak between SSR
 * requests, between two toolbars on one page, and between tests — the same
 * reasons core has no global extension registry.
 */

/** Metadata the bus adds to every delivery. */
export interface BusEvent<T = unknown> {
  type: string;
  payload: T;
  /** `options.now()` at emit time. Defaults to `performance.now()`. */
  at: number;
}

export type BusHandler<T = unknown> = (payload: T, event: BusEvent<T>) => void;

export interface BusSubscribeOptions {
  /**
   * Unsubscribes when the signal aborts. `start(api)` hands you exactly such a
   * signal, so a collector rarely needs to keep the returned function.
   */
  signal?: AbortSignal;
}

export interface EventBus<Events extends Record<string, unknown>> {
  emit<K extends keyof Events & string>(
    type: K,
    payload: Events[K],
  ): BusEvent<Events[K]>;
  on<K extends keyof Events & string>(
    type: K,
    handler: BusHandler<Events[K]>,
    options?: BusSubscribeOptions,
  ): () => void;
  once<K extends keyof Events & string>(
    type: K,
    handler: BusHandler<Events[K]>,
    options?: BusSubscribeOptions,
  ): () => void;
  onAny(
    handler: BusHandler<Events[keyof Events & string]>,
    options?: BusSubscribeOptions,
  ): () => void;
  /** Live subscribers, optionally for one type. `onAny` counts toward the total. */
  listenerCount(type?: keyof Events & string): number;
  /** Drops every subscriber. */
  clear(): void;
}

export interface CreateEventBusOptions {
  /** Clock for `event.at`. Default `performance.now()`, falling back to `Date.now()`. */
  now?: () => number;
  /**
   * Called when a handler throws. A throwing subscriber must never stop the
   * remaining subscribers, and must never propagate into the emitter — which is
   * usually a `fetch` wrapper or a `PerformanceObserver` callback.
   */
  onError?: (error: unknown, event: BusEvent) => void;
}

const defaultNow = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

export function createEventBus<
  Events extends Record<string, unknown> = Record<string, unknown>,
>(options: CreateEventBusOptions = {}): EventBus<Events> {
  const { now = defaultNow } = options;
  const onError =
    options.onError ??
    ((error: unknown, event: BusEvent) => {
      // eslint-disable-next-line no-console
      console.error(
        `[dev-toolbar/runtime] a "${event.type}" handler threw.`,
        error,
      );
    });

  const handlers = new Map<string, Set<BusHandler<never>>>();
  const anyHandlers = new Set<BusHandler<never>>();

  const bind = (unsubscribe: () => void, signal?: AbortSignal) => {
    if (!signal) return unsubscribe;
    if (signal.aborted) {
      unsubscribe();
      return () => {};
    }
    signal.addEventListener("abort", unsubscribe, { once: true });
    return () => {
      signal.removeEventListener("abort", unsubscribe);
      unsubscribe();
    };
  };

  const on = <K extends keyof Events & string>(
    type: K,
    handler: BusHandler<Events[K]>,
    subscribeOptions?: BusSubscribeOptions,
  ) => {
    const set = handlers.get(type) ?? new Set<BusHandler<never>>();
    handlers.set(type, set);
    set.add(handler as unknown as BusHandler<never>);
    return bind(() => {
      set.delete(handler as unknown as BusHandler<never>);
      if (set.size === 0) handlers.delete(type);
    }, subscribeOptions?.signal);
  };

  return {
    emit<K extends keyof Events & string>(type: K, payload: Events[K]) {
      const event: BusEvent<Events[K]> = { type, payload, at: now() };
      // Snapshot both sets: a handler may unsubscribe itself mid-dispatch.
      for (const handler of [...(handlers.get(type) ?? [])]) {
        try {
          (handler as unknown as BusHandler<Events[K]>)(payload, event);
        } catch (error) {
          onError(error, event as BusEvent);
        }
      }
      for (const handler of [...anyHandlers]) {
        try {
          (handler as unknown as BusHandler<Events[K]>)(payload, event);
        } catch (error) {
          onError(error, event as BusEvent);
        }
      }
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
      return bind(() => {
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
      handlers.clear();
      anyHandlers.clear();
    },
  };
}

/**
 * The shared vocabulary from `plans/dev-bar.md` §5, so three extensions do not
 * invent three names for "a request finished". Nothing forces you to use it —
 * `createEventBus<YourEvents>()` is the general case — but `/ext/metrics` reads
 * `network-start` / `network-end` off a bus shaped like this, which is how an
 * app instruments its own HTTP client instead of being monkey-patched.
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
   * One hydrated root or Suspense boundary finished. Named now, before the
   * collector that consumes it exists (§3D Hydration is not in P1), because a
   * shared vocabulary that grows a name per release is not shared — and adding
   * one later would be a `ToolbarEventMap` change nobody can adopt gradually.
   *
   * Emit one per boundary rather than one per page: under streaming SSR there
   * is no single moment hydration is "done", and claiming otherwise is what
   * makes a hydration number wrong.
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
