/**
 * The reporter: the bridge's snapshot, pushed off the page.
 * [dev-toolbar/ext/agent]
 *
 * Phases 0–2 serve an agent that *loads the app* — Playwright, CDP,
 * computer-use. An agent editing `src/ext/flags` in an editor never loads it,
 * so everything on `window` is invisible to it and a screenshot is a token
 * bill (`plans/agent-readable-toolbar.md` § "Two kinds of agent"). This module
 * is the transport that closes that gap: the page checks in with a local
 * endpoint, the endpoint holds the latest snapshot, and `curl` answers "is the
 * override applied" with no build, no browser and no screenshot.
 *
 * Three properties are the design:
 *
 * - **The snapshot is coalesced, not streamed.** `read()` is cheap but not
 *   free, and the interesting state changes in bursts (a flag flipped, a panel
 *   opened). Writes go through `createThrottledStore` from `/runtime` — the
 *   same primitive the metrics sampler uses — so a burst produces one POST and
 *   an unchanged snapshot produces none at all.
 * - **The check-in is the only channel.** The page polls; the server never
 *   calls the page. That is what makes the whole thing work through an
 *   ordinary dev-server middleware with no socket, no SSE and no second port,
 *   and it is why a command posted to the server arrives at the page on the
 *   next check-in rather than instantly.
 * - **Running is still gated by `allowRun`.** The reporter reports the
 *   handle's `allowRun` in every check-in, and a handle with it off carries no
 *   `runCommand` to call. A consumer with `allowRun: false` gets a reporter,
 *   read routes, and no way to run anything.
 *
 * Nothing here runs at module evaluation, and nothing touches `window`.
 */
import { createThrottledStore } from "../../runtime";
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

/** One command the server is asking the page to run. */
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

/** What the page expects back. Anything else is ignored — an empty `{}` is a valid reply. */
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
  /** Clock handed to the throttled store. Default `performance.now()`. */
  now?: () => number;
  /**
   * This page's id in every check-in. Defaults to a fresh random one per
   * reporter — set it only to make a test deterministic; two pages sharing an
   * id is exactly what it exists to reveal.
   */
  reporterId?: string;
}

/** The running reporter. `tick()` is exposed so a test can drive one check-in. */
export interface AgentReporter {
  /** One check-in: sample, coalesce, POST, run whatever came back. */
  tick(): Promise<void>;
  /** Idempotent. Cancels the timer, destroys the store and stops posting. */
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

/** A per-page id. `randomUUID` where there is one; the fallback only has to not collide on one machine. */
function newReporterId(): string {
  const crypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** What the store holds: the snapshot plus the serialisation that decides whether it changed. */
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

  /** POSTs one body. Returns the parsed response, or `null` when the server could not be reached. */
  const send = async (body: AgentReportBody): Promise<AgentReportResponse | null> => {
    if (post === undefined) return null;
    try {
      const response = await post(url, {
        method: "POST",
        // `application/json` on purpose: it is not a CORS-simple content type,
        // so a cross-origin page cannot forge this check-in without a
        // preflight the receiver does not answer.
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        // The check-in carries no credentials and wants no cache.
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
      // A dev server that is not running, or was just restarted, is the normal
      // reason to land here. Say so once and keep quiet after that: a 500 ms
      // poll would otherwise fill the console with the same line.
      failures += 1;
      if (failures === 1) {
        warn(
          `could not reach the reporter endpoint "${url}" (${
            error instanceof Error ? error.message : String(error)
          }). Is the dev-server middleware installed? Further failures are silent.`,
        );
      }
      return null;
    }
  };

  const run = async (command: AgentPendingCommand): Promise<AgentCommandResult> => {
    // Absent, not refusing (Phase 0, decision 2). The server is told
    // `allowRun` on every check-in and should never have queued this.
    if (handle.runCommand === undefined) {
      return { token: command.token, outcome: { ok: false, reason: "run-not-allowed" } };
    }
    // The handle already turns a throw into a value, so this cannot reject.
    return { token: command.token, outcome: await handle.runCommand(command.id, command.input) };
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;

    // `read()` throws once the toolbar has unmounted. That is the handle doing
    // its job; the reporter's job is to stop rather than to keep posting the
    // state of something that is gone.
    try {
      const snapshot = handle.read();
      store.set({ json: JSON.stringify(snapshot), snapshot });
    } catch {
      stop();
      return;
    }

    // The store's trailing publish lands on its own timer, which does not line
    // up with the poll — left alone, a snapshot can sit written-but-unpublished
    // across a tick and the served state drifts to several times `intervalMs`
    // old. Flushing when nothing is queued *and* the last send is already a
    // full interval behind publishes it on the tick boundary instead, which
    // bounds staleness at roughly one interval plus one poll without
    // publishing any more often than the throttle allows.
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
      // Nothing reached the server: put both halves back so the next check-in
      // carries them. `unsent` may have been overwritten by a newer snapshot
      // in the meantime, which is the right one to send.
      if (unsent === null && snapshot !== null) unsent = snapshot;
      outbox = [...results, ...outbox];
      return;
    }
    if (stopped) return;

    const pending = response.pending ?? [];
    if (pending.length === 0) return;

    const outcomes = await Promise.all(pending.map(run));
    if (stopped) return;

    // A command is the most likely thing in the world to have changed the
    // state, and the caller who ran it is about to read it. So the follow-up
    // carries a *fresh* snapshot rather than waiting for the coalescing
    // interval — otherwise `POST /commands/flags.set` followed immediately by
    // `GET /state` answers with the state from before the write, which is the
    // single most misleading thing this transport could do. The store is
    // written too, so the next ordinary check-in still sees no change.
    let after: AgentSnapshot | undefined;
    try {
      const fresh = handle.read();
      store.set({ json: JSON.stringify(fresh), snapshot: fresh });
      unsent = null;
      after = fresh;
    } catch {
      // Unmounted between running and reporting. The outcome still goes back.
    }

    // Post the outcomes straight back rather than waiting for the next
    // check-in: the caller on the other end of the HTTP request is blocked on
    // them, and one poll interval of latency per command is one too many.
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
 * Starts a reporter on a timer and returns its teardown. Called from
 * `installAgentBridge` when the consumer passed `report`, and never otherwise:
 * a bridge with no `report` option opens no connection to anything.
 *
 * The first check-in is immediate — an agent that starts the dev server and
 * curls it should not wait a poll interval for the first answer — and every
 * later one is on `pollMs`. Overlapping ticks are dropped rather than queued:
 * a slow round trip must not build a backlog of state that is already stale.
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
