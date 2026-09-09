/**
 * Pushes the bridge's coalesced, redacted snapshot to an off-page endpoint
 * (`plans/agent-readable-toolbar.md` § Phase 3). The page polls because the
 * server has no channel back; queued commands run on the next check-in.
 * `allowRun` still gates command execution, and no global is touched here.
 */
import { createThrottledStore, describeErrorUnmasked } from "../../runtime";
import { AGENT_MARKER, AGENT_PROTOCOL_VERSION } from "./types";
import type { AgentHandle, AgentRunResult, AgentSnapshot } from "./types";

/**
 * What the page sends the server on each check-in.
 *
 * `snapshot` is **absent** on a check-in where the coalesced state did not
 * change, which is the common case: an idle page sends a few hundred bytes to
 * ask whether anything was queued for it. The server keeps the last snapshot
 * it was given rather than expecting one every time.
 */
export interface AgentReportBody {
  /** `AGENT_PROTOCOL_VERSION`, so a receiver can refuse a shape it does not know. */
  protocolVersion: number;
  instanceId: string;
  /**
   * Identifies the *page*, not the toolbar. Two tabs of the same app report
   * the same `instanceId` and different `reporterId`s, which is the only way a
   * receiver holding one slot can say "two pages are writing into this" rather
   * than blending them silently.
   */
  reporterId: string;
  /** Whether this bridge can run a command at all. The receiver refuses `POST`s when false. */
  allowRun: boolean;
  /** Present only when the coalesced snapshot changed since the last check-in. */
  snapshot?: AgentSnapshot;
  /** Outcomes for commands a previous response handed out. Usually empty. */
  results: readonly AgentCommandResult[];
}

/** One command the server asks the page to run. */
export interface AgentPendingCommand {
  /** Opaque; echoed back in the result so the server can match it to a waiting request. */
  token: string;
  id: string;
  input?: unknown;
}

/**
 * `AgentRunResult` plus the one refusal the *reporter* can produce on its own:
 * a command handed to a handle that has no `runCommand`. A server that honours
 * `allowRun` never sees it; it exists so a server that does not gets an honest
 * answer instead of a fabricated `"unknown-command"`.
 */
export type AgentReportRunOutcome = AgentRunResult | { ok: false; reason: "run-not-allowed" };

export interface AgentCommandResult {
  token: string;
  outcome: AgentReportRunOutcome;
}

/** An empty `{}` is a valid reply; other response shapes are ignored. */
export interface AgentReportResponse {
  pending?: readonly AgentPendingCommand[];
}

export interface AgentReportOptions {
  /**
   * Where to POST. A same-origin dev-server path (`"/__dev-toolbar/state"`),
   * not a public URL: the snapshot is redacted but it is still your
   * application's state, and this is a development surface.
   */
  url: string;
  /**
   * Minimum milliseconds between *snapshot* POSTs — the coalescing interval
   * handed to `createThrottledStore`. Default `1000`.
   */
  intervalMs?: number;
  /**
   * How often the page checks in. Default `500`. This is the pickup latency
   * for a queued command, and the reason it is shorter than `intervalMs`:
   * an idle check-in carries no snapshot.
   */
  pollMs?: number;
  /** Injectable for tests and for a host that would rather not use `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch;
  /**
   * One-shot timer handed to the throttled store, returning its own cancel.
   * Injectable so a test can drive coalescing without global fake timers.
   */
  schedule?: (callback: () => void, delayMs: number) => () => void;
  /**
   * Repeating timer for the check-in loop, returning its own cancel. Separate
   * from `schedule` because the two have different semantics — one fires once,
   * one fires every `pollMs` — and sharing a knob between them would make an
   * injected fake wrong for one of the two.
   */
  pollSchedule?: (callback: () => void, everyMs: number) => () => void;
  /**
   * One clock for both the throttled store and the check-in loop's own
   * staleness check. Injectable so a test can drive coalescing without global
   * fake timers.
   *
   * The two halves have *different* defaults when this is omitted — the store
   * falls back to `performance.now()`, the loop to `Date.now()` — which is
   * safe only because neither ever compares a reading against the other's.
   * The loop's `sentAt` is set from this clock and compared against this
   * clock, and nothing else reads it. Keep it that way: a single subtraction
   * across the two bases would be off by however long the page has been open.
   */
  now?: () => number;
  /**
   * This page's id in every check-in. Defaults to a fresh random one per
   * reporter — set it only to make a test deterministic; two pages sharing an
   * id is exactly what it exists to reveal.
   */
  reporterId?: string;
}

/** The running reporter. `tick()` is exposed for deterministic driving in tests. */
export interface AgentReporter {
  /** One check-in: sample, coalesce, POST, run whatever came back. */
  tick(): Promise<void>;
  /** Idempotent. Destroys the store and stops posting. */
  stop(): void;
  /** Check-ins that reached the server. The coalescing assertion in the tests. */
  readonly posts: number;
  /** Snapshot POSTs — check-ins that actually carried one. */
  readonly snapshotPosts: number;
}

const warn = (message: string): void => {
  // eslint-disable-next-line no-console -- the only channel an extension has.
  console.warn(`${AGENT_MARKER} ${message}`);
};

const defaultPollSchedule = (callback: () => void, everyMs: number): (() => void) => {
  const handle = setInterval(callback, everyMs);
  return () => clearInterval(handle);
};

/** A per-page id, using `randomUUID` when available. */
function newReporterId(): string {
  const crypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The snapshot and its serialisation, used to detect changes. */
interface Sample {
  json: string;
  snapshot: AgentSnapshot;
}

/**
 * Builds a reporter over a handle. Does not start a timer — `startAgentReporter`
 * does that. Split so a test can drive `tick()` deterministically.
 */
export function createAgentReporter(
  handle: AgentHandle,
  options: AgentReportOptions,
): AgentReporter {
  const { url, intervalMs = 1000, now } = options;
  const reporterId = options.reporterId ?? newReporterId();
  const post = options.fetch ?? (typeof fetch === "function" ? fetch : undefined);

  let stopped = false;
  let posts = 0;
  let snapshotPosts = 0;
  let failures = 0;
  /** When a snapshot last left the page. Bounds how stale a `GET` can be. */
  let sentAt = Number.NEGATIVE_INFINITY;
  /** The coalesced snapshot waiting to be sent, or `null` when nothing changed. */
  let unsent: AgentSnapshot | null = null;
  /** Outcomes that did not make it back — a failed POST must not lose a caller's answer. */
  let outbox: AgentCommandResult[] = [];

  const store = createThrottledStore<Sample | null>(null, {
    intervalMs,
    ...(now === undefined ? {} : { now }),
    ...(options.schedule === undefined ? {} : { schedule: options.schedule }),
    // The comparison is the serialisation, so an unchanged snapshot — the
    // common case on an idle page — publishes nothing and posts nothing.
    equals: (a, b) => a?.json === b?.json,
  });
  store.subscribe(() => {
    unsent = store.getSnapshot()?.snapshot ?? null;
  });

  /** POSTs one body, returning `null` when the server cannot be reached. */
  const send = async (body: AgentReportBody): Promise<AgentReportResponse | null> => {
    if (post === undefined) return null;
    try {
      const response = await post(url, {
        method: "POST",
        // `application/json` is not CORS-simple, so a cross-origin page cannot
        // forge this check-in without a preflight the receiver does not answer.
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        // The check-in carries no credentials and must not be cached.
        credentials: "omit",
        cache: "no-store",
      });
      failures = 0;
      posts += 1;
      if (body.snapshot !== undefined) snapshotPosts += 1;
      if (!response.ok) return null;
      const parsed: unknown = await response.json();
      return parsed !== null && typeof parsed === "object" ? (parsed as AgentReportResponse) : null;
    } catch (error) {
      // Report a missing or restarting dev server once; the poll would repeat
      // the same failure every 500 ms. Unmasked on purpose: this is the
      // developer's own console, which logs the raw thrown value on a failure
      // path by design (`docs/architecture.md` §10). If the diagnostics console
      // tail captures this line it runs `redactProse()` over it, which finds a
      // URL inside the sentence but not a bare credential sitting mid-sentence
      // — so a `fetch` rejection whose message *is* a credential would reach
      // an exported tail as written. That is the raw-console policy's cost,
      // accepted here as everywhere else it applies.
      failures += 1;
      if (failures === 1) {
        warn(
          `could not reach the reporter endpoint "${url}" (${
            describeErrorUnmasked(error).message
          }). Is the dev-server middleware installed? Further failures are silent.`,
        );
      }
      return null;
    }
  };

  const run = async (command: AgentPendingCommand): Promise<AgentCommandResult> => {
    // The server receives `allowRun` on every check-in and should not queue this
    // when it is false, but keep the refusal honest if it does. The await below
    // needs no try/catch: the handle turns a throwing command into a value.
    if (handle.runCommand === undefined) {
      return { token: command.token, outcome: { ok: false, reason: "run-not-allowed" } };
    }
    return { token: command.token, outcome: await handle.runCommand(command.id, command.input) };
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;

    // Stop when the toolbar unmounts; its handle no longer has state to report.
    try {
      const snapshot = handle.read();
      store.set({ json: JSON.stringify(snapshot), snapshot });
    } catch {
      stop();
      return;
    }

    // The store timer and poll can drift. Flush only when no snapshot is queued
    // and the last send is at least one interval old, bounding staleness without
    // exceeding the throttle rate.
    const clock = options.now ?? Date.now;
    if (unsent === null && clock() - sentAt >= intervalMs) store.flush();

    const snapshot = unsent;
    unsent = null;
    const results = outbox;
    outbox = [];

    const body: AgentReportBody = {
      protocolVersion: AGENT_PROTOCOL_VERSION,
      instanceId: handle.instanceId,
      reporterId,
      allowRun: handle.allowRun,
      ...(snapshot === null ? {} : { snapshot }),
      results,
    };
    const response = await send(body);
    if (snapshot !== null && response !== null) sentAt = clock();
    if (response === null) {
      // Retry both the snapshot and outcomes. Preserve a newer `unsent` snapshot
      // if one arrived while the request was in flight.
      if (unsent === null && snapshot !== null) unsent = snapshot;
      outbox = [...results, ...outbox];
      return;
    }
    if (stopped) return;

    const pending = response.pending ?? [];
    if (pending.length === 0) return;

    const outcomes = await Promise.all(pending.map(run));
    if (stopped) return;

    // Send a fresh snapshot with the outcome. Otherwise an immediate
    // `GET /state` after `POST /commands/flags.set` would return pre-command
    // state. Write it to the store too, so the next check-in sees no change.
    let after: AgentSnapshot | undefined;
    try {
      const fresh = handle.read();
      store.set({ json: JSON.stringify(fresh), snapshot: fresh });
      unsent = null;
      after = fresh;
    } catch {
      // The toolbar unmounted between running and reporting; still return the outcome.
    }

    // Return outcomes immediately; the HTTP caller is waiting for them.
    const followUp = await send({
      protocolVersion: AGENT_PROTOCOL_VERSION,
      instanceId: handle.instanceId,
      reporterId,
      allowRun: handle.allowRun,
      ...(after === undefined ? {} : { snapshot: after }),
      results: outcomes,
    });
    if (after !== undefined && followUp !== null) sentAt = clock();
    if (followUp === null) outbox = [...outcomes, ...outbox];
  };

  function stop(): void {
    if (stopped) return;
    stopped = true;
    store.destroy();
  }

  return {
    tick,
    stop,
    get posts() {
      return posts;
    },
    get snapshotPosts() {
      return snapshotPosts;
    },
  };
}

/**
 * Starts a reporter and returns its teardown. A bridge without `report` opens
 * no connection.
 *
 * The first check-in is deferred by one macrotask, so it sees the committed
 * toolbar without waiting for `pollMs`. Later checks use `pollMs`; overlapping
 * ticks are dropped so a slow round trip cannot build a stale backlog.
 */
export function startAgentReporter(handle: AgentHandle, options: AgentReportOptions): () => void {
  const { pollMs = 500 } = options;
  const schedule = options.pollSchedule ?? defaultPollSchedule;
  const reporter = createAgentReporter(handle, options);

  let inFlight = false;
  const pump = (): void => {
    if (inFlight) return;
    inFlight = true;
    void reporter.tick().finally(() => {
      inFlight = false;
    });
  };

  // Deferred by a macrotask rather than run inline. `start(api)` is called
  // while core is still committing, so a synchronous first check-in reports
  // `shell.mounted: false` — a first answer that is wrong for about a second,
  // and wrong in the one field a reader uses to decide the toolbar is there.
  // `setTimeout(…, 0)` costs nothing perceptible and makes the first answer
  // the settled one.
  const first = setTimeout(pump, 0);
  const cancel = schedule(pump, pollMs);

  return () => {
    clearTimeout(first);
    cancel();
    reporter.stop();
  };
}
