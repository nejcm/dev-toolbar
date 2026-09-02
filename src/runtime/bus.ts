/**
 * A tiny typed event bus. [dev-toolbar/runtime]
 *
 * Deliberately not a singleton: create one per toolbar instance (or per
 * extension) and pass it around. A module-level bus would leak between SSR
 * requests, between two toolbars on one page, and between tests — the same
 * reasons core has no global extension registry.
 */

/**
 * Metadata the bus adds to every delivery.
 *
 * `K` carries the event name as a literal, so `emit("network-end", …)` hands
 * back a `BusEvent<…, "network-end">` rather than something whose `type` has
 * been widened to `string`. It defaults to `string`, so `BusEvent<Payload>`
 * still means what it always did.
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
 * `Events extends Record<string, unknown>` is what lets an *interface* serve as
 * an event map: an interface has no implicit index signature, so without that
 * base it fails the constraint — which is why `ToolbarEventMap` extends it. The
 * cost is that `keyof ToolbarEventMap & string` widens to `string`, and a
 * mapped type over `string` collapses to a single index signature, which would
 * leave `AnyBusEvent` un-narrowable. So strip the index signature back off.
 *
 * A map that really is nothing but `Record<string, unknown>` — the default type
 * argument for `createEventBus()` with no event map — declares no names at all,
 * and there `string` is the honest answer; hence the fallback.
 *
 * Only the bare `string` and `number` signatures are stripped. A
 * template-literal pattern signature — `` [k: `evt:${string}`]: Payload `` — is
 * deliberately kept: `string` does not extend the pattern, so the filter leaves
 * it alone. That is the intent, not an oversight — such a pattern is a name the
 * map means to declare, and it stays narrowable alongside the literal ones.
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
 * `type`. `onAny` is the one place a caller has to switch on the event name, so
 * it is the one place that needs `if (event.type === "network-end")` to narrow
 * `event.payload` along with it.
 *
 * The union covers the *declared* names. `emit` and `on` still take
 * `keyof Events & string`, which on a map extending `Record<string, unknown>`
 * is `string` — so `bus.emit("not-declared", …)` compiles, and an `onAny`
 * handler can be handed a `type` this union does not list. Widening `emit`
 * would be the breaking change, so the narrowing is optimistic on purpose:
 * switch on the names you care about, and do not `assertNever` on `event.type`
 * in a default branch.
 */
export type AnyBusEvent<Events extends Record<string, unknown>> = {
  [K in BusEventName<Events>]: BusEvent<Events[K], K>;
}[BusEventName<Events>];

/**
 * An `onAny` subscriber. `payload` is the union of every declared payload —
 * useful, but not correlated with the name, because nothing on a bare payload
 * says which event it came from. Narrow `event` instead: `event.payload` is the
 * same value, discriminated.
 */
export type AnyBusHandler<Events extends Record<string, unknown>> = (
  payload: Events[BusEventName<Events>],
  event: AnyBusEvent<Events>,
) => void;

export interface BusSubscribeOptions {
  /**
   * Unsubscribes when the signal aborts. `start(api)` hands you exactly such a
   * signal, so a collector rarely needs to keep the returned function.
   */
  signal?: AbortSignal;
}

/**
 * The two methods a consumer of a bus actually needs: publish, and subscribe.
 *
 * This exists so an option like `metrics`' `bus` can be typed *structurally*
 * rather than as the whole `EventBus`. `./testing` may not import `./runtime`
 * (see AGENTS.md), so `createMockBus()` reimplements the contract by hand;
 * asking a test double for `once`, `onAny`, `listenerCount` and `clear` — none
 * of which a collector calls — is what made the shipped double unusable as the
 * real thing and pushed tests onto `createEventBus()` instead.
 *
 * Take `BusLike<…>` in an option, not `EventBus<…>`, unless you really call the
 * rest. Anything assignable to it can drive the collector: the real bus, the
 * mock, or an adapter over an app's own emitter.
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
   * remaining subscribers, and must never propagate into the emitter — which is
   * usually a `fetch` wrapper or a `PerformanceObserver` callback.
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

  // Nobody listening: bail before allocating anything. One listener: the
  // load-bearing bit is that `handler` is read out of `set` before it is
  // called, not while a loop is still touching `set` — so whatever the call
  // does to `set` (unsubscribe itself, subscribe another) happens after we
  // already have our reference, and there is no snapshot to need. A live
  // `for...of set` here instead — even one that calls the sole handler and
  // then returns — would still be a bug: unlike our up-front read, a live
  // iterator that hasn't finished visits elements added while it runs, so it
  // would go on to yield a replacement the handler subscribed mid-call,
  // which the `Array.from` snapshot below never would. Two or more: a
  // handler may unsubscribe itself (or another) mid-dispatch, so we still
  // iterate a copy — `Array.from` — rather than the live set.
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
    // Unsubscribing twice must be a no-op: `once()` hands back the very function
    // it calls on delivery, so a React effect returning it runs it a second time
    // on cleanup, and so does a manual call after `signal` aborted. Without the
    // latch the second run would find the captured set already empty and evict
    // whatever set the map holds for `type` by then — someone else's subscribers.
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
      // Latched for the same reason as `on`. There is no map entry to evict
      // here, but a stale second call would still delete the handler out from
      // under a later `onAny(sameHandler)`.
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
