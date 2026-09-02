/**
 * A tiny typed event bus. [dev-toolbar/runtime]
 *
 * Deliberately not a singleton: create one per toolbar instance (or per
 * extension) and pass it around, to avoid leaking between SSR requests,
 * toolbars on one page, or tests.
 */

/**
 * Metadata the bus adds to every delivery.
 *
 * `K` carries the event name as a literal, so `emit("network-end", …)` hands
 * back a `BusEvent<…, "network-end">` rather than one widened to `string`.
 * Defaults to `string`, so `BusEvent<Payload>` still means what it did.
 */
export interface BusEvent<T = unknown, K extends string = string> {
  type: K;
  payload: T;
  /** `options.now()` at emit time. Defaults to `performance.now()`. */
  at: number;
}

export type BusHandler<T = unknown> = (payload: T, event: BusEvent<T>) => void;

/**
 * The names an event map actually declares.
 *
 * `Events extends Record<string, unknown>` lets an *interface* serve as an
 * event map (interfaces have no implicit index signature otherwise — why
 * `ToolbarEventMap` extends it), but that widens `keyof Events & string` to
 * `string`, collapsing a mapped type over it to a single index signature and
 * leaving `AnyBusEvent` un-narrowable. So strip the index signature back off.
 * A map that really is bare `Record<string, unknown>` (the default with no
 * event map) declares no names, so `string` is the honest fallback there.
 *
 * Only bare `string`/`number` signatures are stripped — a template-literal
 * pattern (`` [k: \`evt:${string}\`]: Payload ``) is kept, since `string`
 * doesn't extend it and it's a name the map means to declare.
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
 * The union covers only *declared* names — `emit`/`on` still accept
 * `keyof Events & string`, which widens to `string` on a
 * `Record<string, unknown>`-extending map, so `bus.emit("not-declared", …)`
 * compiles and an `onAny` handler can see a `type` this union doesn't list.
 * The narrowing is optimistic on purpose: switch on names you care about,
 * don't `assertNever` on `event.type` in a default branch.
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
 * Lets an option like `metrics`' `bus` be typed *structurally* rather than
 * as the whole `EventBus`. `./testing` may not import `./runtime`, so
 * `createMockBus()` reimplements this contract by hand — take `BusLike<…>`
 * in an option, not `EventBus<…>`, unless you really need the rest, so the
 * real bus, the mock, or an app's own emitter adapter can all drive it.
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
  /** Drops every subscriber. */
  clear(): void;
}

export interface CreateEventBusOptions {
  /** Clock for `event.at`. Default `performance.now()`, falling back to `Date.now()`. */
  now?: () => number;
  /**
   * Called when a handler throws. A throwing subscriber must never stop the
   * remaining subscribers or propagate into the emitter (usually a `fetch`
   * wrapper or `PerformanceObserver` callback).
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

  // No listeners: bail early. One listener: read `handler` out of `set`
  // before calling it (not via a live `for...of`, which would also visit a
  // handler subscribed mid-call). Two or more: a handler may unsubscribe
  // itself or another mid-dispatch, so iterate a copy (`Array.from`), not
  // the live set.
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
    // Unsubscribing twice must be a no-op: `once()` hands back the function
    // it calls on delivery, and a React effect cleanup or a post-abort manual
    // call can run it again. Without the latch, the second run could evict
    // someone else's subscribers from a since-reused set.
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
      // Latched for the same reason as `on`: a stale second call could
      // delete the handler out from under a later `onAny(sameHandler)`.
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
      handlers.clear();
      anyHandlers.clear();
    },
  };
}

/**
 * Shared event vocabulary so extensions don't invent separate names for
 * the same thing (e.g. "a request finished"). Not required —
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
