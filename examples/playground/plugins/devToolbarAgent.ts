/**
 * The playground's own Vite plugin: the toolbar's state, off the page.
 *
 * `plans/agent-readable-toolbar.md` § Phase 3. An agent editing `src/ext/flags`
 * never loads the app, so everything the bridge publishes on `window` is
 * invisible to it. This middleware holds the latest snapshot the page reported
 * and serves it over HTTP, so
 *
 *     curl -s localhost:5273/__dev-toolbar/state | jq '.extensions.flags.flags'
 *
 * answers "is the override applied" with no build, no browser, no screenshot.
 *
 * ```
 * GET  /__dev-toolbar/state         the latest snapshot, plus how old it is
 * GET  /__dev-toolbar/commands      the command registry, with descriptions and input schemas
 * POST /__dev-toolbar/commands/:id  queued for the page, result returned
 * POST /__dev-toolbar/state         the page checking in (not for you to call)
 * ```
 *
 * **This lives in the playground on purpose.** It is not part of
 * `@nejcm/dev-toolbar` and there is no `./vite` subpath: a bundler plugin in a
 * zero-dependency React library is a new coupling, and a consumer who wants
 * this copies one file. The three lines that turn it on — the bridge's
 * `report` option — are in the README; everything below is the receiving half,
 * and it is this long because refusing honestly costs more code than hanging.
 * It gets promoted when a consumer asks.
 *
 * ## Threat model
 *
 * This route runs **arbitrary registered toolbar commands** on the developer's
 * open page. Treat it as a debugger you left attached, because that is what it
 * is. Five controls, in the order they matter:
 *
 * 1. **Dev server only.** `apply: "serve"` and the only hook is
 *    `configureServer`, so nothing here can reach a production bundle. There is
 *    no build-time half to forget to strip.
 * 2. **Loopback only.** The plugin refuses to install its routes when the dev
 *    server is bound to anything but a loopback address — `--host`,
 *    `server.host: true`, an LAN IP — and says so on stderr. A toolbar command
 *    runner reachable from the network is not a thing this ships.
 * 3. **`allowRun` still decides.** The page tells the server on every check-in
 *    whether its bridge was built with `allowRun`. With it off, `POST
 *    /commands/:id` is refused with `403 run-not-allowed` and nothing is
 *    queued: a consumer who wanted reads gets reads.
 * 4. **No cross-origin driving.** A request carrying an `Origin` header that is
 *    not this dev server's own is refused with `403 cross-origin`, so a page
 *    the developer happens to be browsing cannot drive their toolbar through
 *    `fetch("http://localhost:5273/…")`. The page's own check-in posts
 *    `content-type: application/json`, which is not a CORS-simple type, so it
 *    cannot be forged without a preflight this middleware never answers.
 * 5. **A loopback `Host`, checked here.** Control 4 compares `Origin` against
 *    `Host`, which on its own would let an attacker-controlled name resolving
 *    to `127.0.0.1` satisfy both — classic DNS rebinding. Vite's own
 *    `hostValidationMiddleware` runs before plugin middlewares and would catch
 *    that today, but it is an implementation detail of a version, and it is
 *    skipped when `server.https` is set. So the `Host` header is checked
 *    against the loopback spellings here too, and a request that fails is
 *    `403 non-loopback-host`. A control this middleware depends on belongs in
 *    this middleware.
 *
 * What is deliberately *not* here: authentication, TLS, rate limiting, and any
 * notion of a user. Anything with a shell on the developer's machine can
 * already do worse. If that is not true of your machine, do not install this
 * plugin.
 *
 * ## One page at a time
 *
 * The middleware holds **one** slot: the last snapshot any page reported, and
 * a queue any page may drain. Two tabs of the same app therefore overwrite
 * each other every ~500 ms, and a queued command runs in whichever tab polls
 * first — which may not be the tab whose snapshot you just read.
 *
 * That is not hidden. Every check-in carries the reporter's own id, and
 * `connection` reports `reporters` (how many distinct ones checked in within
 * `staleMs`), `reporterId` (whose snapshot you are reading) and `ambiguous`
 * (true when that count is above one). A `POST /commands/:id` result says
 * which reporter ran it. **Read `connection.ambiguous` before trusting a
 * snapshot**; a silently blended answer would be worse than a documented
 * limit. Keying the slot per reporter is the fix if this stops being a
 * one-tab development tool.
 *
 * Two edges in that accounting, both of which a reader will meet:
 *
 * - **Id-less clients collapse into one `"anonymous"` bucket.** The bridge
 *   sends `reporterId` on every body, so this only ever describes something
 *   else speaking the protocol — a `curl` check-in, a hand-rolled reporter.
 *   Two of those look like one page, and `ambiguous` stays `false`.
 * - **`reporterId` lags `reporters` by up to a poll.** It is set only by a
 *   check-in that *carries a snapshot*, and most check-ins do not; `reporters`
 *   counts every check-in. So a second tab raises the count before it owns the
 *   slot, and `reporterId` can name a page that is no longer the last to
 *   speak. `ambiguous` is the field to branch on, not `reporterId`.
 *
 * ## Why polling, and why it is honest about it
 *
 * The server cannot call the page — a middleware has no channel back — so the
 * page checks in every ~500 ms and picks up whatever was queued. Consequences,
 * all of them stated in a response body rather than hidden behind a hang:
 *
 * - Nothing has ever reported: `503 no-page-connected`.
 * - The last check-in is older than `staleMs`: also `503 no-page-connected`,
 *   with `ageMs`, on the `POST` route. The `GET` routes still answer with the
 *   stale snapshot and `connection.stale: true` — the latest snapshot is still
 *   the latest snapshot, and saying how old it is beats refusing to say.
 * - Queued but never answered within `timeoutMs`: `504 timeout`, saying whether
 *   the page ever picked the command up.
 */
import type { Plugin, ViteDevServer } from "vite";

export interface DevToolbarAgentOptions {
  /** Route prefix. Default `"/__dev-toolbar"`. */
  base?: string;
  /**
   * How long `POST /commands/:id` waits for the page before answering `504`.
   * Default `10000`. There is no "wait forever" — a hang is a worse answer
   * than a body saying nobody picked it up.
   */
  timeoutMs?: number;
  /**
   * How long a check-in counts as a live connection. Default `3000`, six times
   * the bridge's 500 ms default poll, so one slow frame or an HMR remount does
   * not read as a disconnected page.
   */
  staleMs?: number;
}

/** Mirrors `AgentReportBody` from `@nejcm/dev-toolbar/ext/agent`, structurally. */
interface CheckInBody {
  protocolVersion?: number;
  instanceId?: string;
  /** Identifies the *page*, not the toolbar: a second tab reports a second id. */
  reporterId?: string;
  allowRun?: boolean;
  snapshot?: Record<string, unknown>;
  results?: readonly { token?: string; outcome?: RunOutcome }[];
}

/** One entry in `body.results`, after the shape check. */
interface CheckInResult {
  token?: unknown;
  outcome?: RunOutcome;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type RunOutcome =
  | { ok: true; result?: unknown }
  | { ok: false; reason: string; error?: string; errorName?: string };

interface Waiting {
  token: string;
  id: string;
  input: unknown;
  pickedUp: boolean;
  timer: ReturnType<typeof setTimeout>;
  settle(status: number, body: Record<string, unknown>): void;
}

/** The check-in body cap. A snapshot is tens of kilobytes; a megabyte is somebody else's idea. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0:0:0:0:0:0:0:1"]);

/**
 * `server.host` as Vite resolved it. `undefined` and `false` both mean Vite's
 * own default, which is loopback; `true` means every interface. A string is
 * taken at face value and only the three loopback spellings pass.
 */
/** `"[::1]:5273"` -> `"[::1]"`, `"localhost:5273"` -> `"localhost"`. */
function hostname(header: string): string {
  const value = header.trim();
  if (value.startsWith("[")) return value.slice(0, value.indexOf("]") + 1) || value;
  const colon = value.indexOf(":");
  return colon === -1 ? value : value.slice(0, colon);
}

function isLoopbackHost(host: string | boolean | undefined): boolean {
  if (host === undefined || host === false) return true;
  if (host === true) return false;
  return LOOPBACK.has(host.toLowerCase());
}

/**
 * The half of `IncomingMessage` this middleware uses. Written out rather than
 * imported from `node:http` because the playground's `tsconfig` deliberately
 * carries no Node globals — this file is fifteen lines of plumbing, not a
 * reason to widen the app's type environment.
 */
interface BodyStream {
  on(event: "data", cb: (chunk: Uint8Array) => void): unknown;
  on(event: "end", cb: () => void): unknown;
  on(event: "error", cb: (error: unknown) => void): unknown;
  /** Stops an over-cap upload at the socket instead of reading it to the end. */
  destroy?(error?: unknown): unknown;
}

/**
 * Collects a request body with a cap, decoding as it goes: a chunk boundary
 * can fall inside a multi-byte character, so `TextDecoder`'s streaming mode
 * does the joining rather than string concatenation.
 */
function readBody(req: BodyStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder();
    let text = "";
    let size = 0;
    let over = false;
    req.on("data", (chunk: Uint8Array) => {
      // Rejecting does not unsubscribe this handler, so without the flag and
      // the `destroy()` the buffer would keep growing for as long as the
      // client kept sending — the cap would be a message, not a limit.
      if (over) return;
      size += chunk.byteLength;
      if (size > MAX_BODY_BYTES) {
        over = true;
        req.destroy?.();
        reject(new Error(`body exceeds ${MAX_BODY_BYTES} bytes`));
        return;
      }
      text += decoder.decode(chunk, { stream: true });
    });
    req.on("end", () => {
      resolve(text + decoder.decode());
    });
    req.on("error", reject);
  });
}

export function devToolbarAgent(options: DevToolbarAgentOptions = {}): Plugin {
  const { base = "/__dev-toolbar", timeoutMs = 10_000, staleMs = 3_000 } = options;

  /** The last snapshot any page reported, and when. */
  let snapshot: Record<string, unknown> | null = null;
  let snapshotAt = 0;
  /** The last check-in of any kind — a snapshot-free one still proves a page is there. */
  let checkInAt = 0;
  let instanceId: string | null = null;
  let allowRun = false;
  /** Whose snapshot is in the slot. `null` for a client that sent no id. */
  let reporterId: string | null = null;
  /** Every reporter seen, so a second tab is *reported* rather than silently blended. */
  const reporters = new Map<string, number>();

  const waiting = new Map<string, Waiting>();
  let tokenSeq = 0;

  const ageMs = (at: number): number | null => (at === 0 ? null : Date.now() - at);
  const connected = (): boolean => checkInAt !== 0 && Date.now() - checkInAt <= staleMs;

  /** Distinct reporters that checked in within `staleMs`. Prunes as it counts. */
  function liveReporters(): number {
    const cutoff = Date.now() - staleMs;
    for (const [id, at] of reporters) if (at < cutoff) reporters.delete(id);
    return reporters.size;
  }

  const connection = () => {
    const live = liveReporters();
    return {
      instanceId,
      allowRun,
      connected: connected(),
      checkedInAt: checkInAt === 0 ? null : new Date(checkInAt).toISOString(),
      reportedAt: snapshotAt === 0 ? null : new Date(snapshotAt).toISOString(),
      ageMs: ageMs(snapshotAt),
      stale: !connected(),
      staleMs,
      /** Whose snapshot this is. Two tabs share one slot; see the header. */
      reporterId,
      reporters: live,
      /**
       * More than one page is reporting into a single slot, so this snapshot
       * is whichever tab checked in last and a queued command may run in the
       * other. Close a tab, or stop trusting the answer.
       */
      ambiguous: live > 1,
    };
  };

  /**
   * The one refusal every route shares, and the reason this middleware never
   * hangs: with no page there is nothing to ask, and saying so beats waiting.
   */
  const noPage = () => ({
    ok: false,
    reason: "no-page-connected" as const,
    message:
      checkInAt === 0
        ? `No page has reported to ${base} yet. Open the app with the agent bridge's ` +
          `\`report\` option pointed at "${base}/state" — this middleware cannot call the page.`
        : `The last check-in was ${String(ageMs(checkInAt))} ms ago, older than staleMs (${staleMs}). ` +
          `The tab is probably closed, reloading, or rebuilding.`,
    connection: connection(),
  });

  function install(server: ViteDevServer): void {
    server.middlewares.use((req, res, next) => {
      const url = req.url ?? "/";
      const pathname = url.split("?")[0] ?? "/";
      if (pathname !== base && !pathname.startsWith(`${base}/`)) {
        next();
        return;
      }

      const send = (status: number, body: unknown): void => {
        // A timed-out request has already answered, and the safety net below
        // may fire after a handler that answered and *then* threw. Writing
        // twice would crash the response, which is the failure this guards.
        if (res.writableEnded || res.headersSent) return;
        res.statusCode = status;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(`${JSON.stringify(body, null, 2)}\n`);
      };

      /**
       * Both async handlers are fire-and-forget from connect's point of view,
       * so an unhandled rejection here does not fail the request — under
       * Node's default `--unhandled-rejections=throw` it **kills the dev
       * server**, and the request hangs on the way out. Measured, before this
       * net existed: `POST /__dev-toolbar/state -d null` took the process
       * down with `TypeError: Cannot read properties of null`.
       *
       * The handlers validate their own input; this is the layer that makes
       * "they always will" not have to be true. Recipe code gets a net.
       */
      const guard = (work: Promise<void>): void => {
        void work.catch((error: unknown) => {
          send(500, {
            ok: false,
            reason: "middleware-error",
            message: `The dev-toolbar middleware threw while handling this request: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        });
      };

      // Control 5: `Host` is what control 4 compares against, so it has to be
      // trustworthy on its own — an attacker-controlled name resolving to
      // 127.0.0.1 would otherwise satisfy both halves of the Origin check.
      const hostHeader = req.headers.host ?? "";
      if (!isLoopbackHost(hostname(hostHeader))) {
        send(403, {
          ok: false,
          reason: "non-loopback-host",
          message:
            `Refused: Host "${hostHeader}" is not a loopback name. ${base} is reachable ` +
            `over localhost only — this is the DNS-rebinding guard, not a convenience.`,
        });
        return;
      }

      // Control 4: a browser page on another origin must not be able to drive
      // the toolbar. The page's own check-in is same-origin and passes.
      const origin = req.headers.origin;
      if (typeof origin === "string" && origin !== "") {
        const host = req.headers.host ?? "";
        const own = new Set([`http://${host}`, `https://${host}`]);
        if (!own.has(origin)) {
          send(403, {
            ok: false,
            reason: "cross-origin",
            message: `Refused: Origin "${origin}" is not this dev server. ${base} is a local debugging surface.`,
          });
          return;
        }
      }

      const method = req.method ?? "GET";

      if (pathname === `${base}/state` && method === "GET") {
        if (snapshot === null) {
          send(503, noPage());
          return;
        }
        // The snapshot's own keys first; `connection` and `extensions` are
        // this middleware's additions and are named so they cannot collide.
        send(200, { ...snapshot, connection: connection(), extensions: byExtension(snapshot) });
        return;
      }

      if (pathname === `${base}/commands` && method === "GET") {
        if (snapshot === null) {
          send(503, noPage());
          return;
        }
        send(200, {
          instanceId: snapshot["instanceId"] ?? null,
          allowRun,
          connection: connection(),
          commands: snapshot["commands"] ?? [],
        });
        return;
      }

      if (pathname === `${base}/state` && method === "POST") {
        guard(handleCheckIn(req, send));
        return;
      }

      if (pathname.startsWith(`${base}/commands/`) && method === "POST") {
        // `decodeURIComponent` throws `URIError` on a malformed percent
        // sequence, and this one is *synchronous* — outside `guard()`, which
        // only catches rejections. Connect would route it to Vite's error
        // middleware and answer HTML; a JSON route answers JSON.
        let id: string;
        try {
          id = decodeURIComponent(pathname.slice(`${base}/commands/`.length));
        } catch {
          send(400, {
            ok: false,
            reason: "bad-command-id",
            message: `The command id in the path is not valid percent-encoding: ${pathname.slice(
              `${base}/commands/`.length,
            )}`,
          });
          return;
        }
        guard(handleRun(id, req, send));
        return;
      }

      send(404, {
        ok: false,
        reason: "unknown-route",
        message: `No such route: ${method} ${pathname}`,
        routes: [
          `GET ${base}/state`,
          `GET ${base}/commands`,
          `POST ${base}/commands/:id`,
          `POST ${base}/state (the page checks in here)`,
        ],
      });
    });

    // A page that never comes back must not leave a caller waiting past
    // `timeoutMs`, and a server that is going away must not leave one waiting
    // at all. Both are answered, never dropped.
    server.httpServer?.on("close", () => {
      for (const entry of [...waiting.values()]) {
        clearTimeout(entry.timer);
        waiting.delete(entry.token);
        entry.settle(503, {
          ok: false,
          reason: "server-closing",
          message: "The dev server shut down before the page answered.",
        });
      }
    });
  }

  /** `extensions[id]` is the extension's own published state — `null` when it published none. */
  function byExtension(current: Record<string, unknown>): Record<string, unknown> {
    const roster = Array.isArray(current["diagnostics"]) ? current["diagnostics"] : [];
    const out: Record<string, unknown> = {};
    for (const entry of roster as { id?: string; status?: string; data?: unknown }[]) {
      if (typeof entry.id !== "string") continue;
      // `null` covers both "declared no diagnostics()" and "threw". Which of
      // the two it was is in the `diagnostics` roster, unabridged.
      out[entry.id] = entry.status === "ok" ? (entry.data ?? null) : null;
    }
    return out;
  }

  type Send = (status: number, body: unknown) => void;

  async function handleCheckIn(req: BodyStream, send: Send): Promise<void> {
    let parsed: unknown;
    try {
      const raw = await readBody(req);
      parsed = raw === "" ? {} : JSON.parse(raw);
    } catch (error) {
      send(400, {
        ok: false,
        reason: "bad-body",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    // Every field below is checked before it is dereferenced. `JSON.parse`
    // returns whatever was sent — `null`, an array, a number — and this
    // handler's promise is not awaited by connect, so a `TypeError` here does
    // not fail the request: it escapes as an unhandled rejection and, under
    // Node's default policy, ends the dev server. Measured: `-d null`,
    // `-d '{"results":{}}'` and `-d '{"results":[null]}'` each killed a fresh
    // server before these three checks existed.
    if (!isPlainObject(parsed)) {
      send(400, {
        ok: false,
        reason: "bad-body",
        message: "A check-in body must be a JSON object.",
      });
      return;
    }
    const body = parsed as CheckInBody;
    if (body.results !== undefined && !Array.isArray(body.results)) {
      send(400, {
        ok: false,
        reason: "bad-body",
        message: "`results` must be an array of { token, outcome } objects.",
      });
      return;
    }

    checkInAt = Date.now();
    if (typeof body.instanceId === "string") instanceId = body.instanceId;
    allowRun = body.allowRun === true;
    // A page with no id still works; it just cannot be told apart from another
    // one, which is what `reporters`/`ambiguous` then say.
    const from = typeof body.reporterId === "string" ? body.reporterId : "anonymous";
    reporters.set(from, checkInAt);
    if (isPlainObject(body.snapshot)) {
      snapshot = body.snapshot;
      snapshotAt = checkInAt;
      reporterId = typeof body.reporterId === "string" ? body.reporterId : null;
    }

    for (const result of (body.results ?? []) as readonly CheckInResult[]) {
      if (!isPlainObject(result)) continue;
      const token = result.token;
      const entry = typeof token === "string" ? waiting.get(token) : undefined;
      if (entry === undefined) continue;
      clearTimeout(entry.timer);
      waiting.delete(entry.token);
      entry.settle(statusFor(result.outcome), {
        ...(isPlainObject(result.outcome) ? result.outcome : { ok: false, reason: "no-outcome" }),
        command: entry.id,
        ranIn: from,
      });
    }

    // Hand out everything queued. A command handed out and never answered
    // still has its timeout running, so it cannot wait forever either.
    const pending: { token: string; id: string; input?: unknown }[] = [];
    for (const entry of waiting.values()) {
      if (entry.pickedUp) continue;
      entry.pickedUp = true;
      pending.push(
        entry.input === undefined
          ? { token: entry.token, id: entry.id }
          : { token: entry.token, id: entry.id, input: entry.input },
      );
    }
    send(200, { ok: true, pending });
  }

  /**
   * The bridge's `AgentRunResult` reasons, mapped onto status codes so `curl
   * -f` and a scripted caller agree with the body.
   */
  function statusFor(outcome: unknown): number {
    if (!isPlainObject(outcome)) return 502;
    if (outcome.ok === true) return 200;
    switch (outcome["reason"]) {
      case "unknown-command":
        return 404;
      case "run-not-allowed":
        return 403;
      case "torn-down":
        return 409;
      case "threw":
        return 422;
      default:
        return 502;
    }
  }

  async function handleRun(id: string, req: BodyStream, send: Send): Promise<void> {
    if (id === "") {
      send(404, { ok: false, reason: "unknown-route", message: "No command id in the path." });
      return;
    }

    let input: unknown;
    try {
      const raw = await readBody(req);
      // An empty body means "no input" — most commands take none — and is not
      // the same as `{}`, which a command with a schema would see as a bad
      // input object and refuse.
      input = raw.trim() === "" ? undefined : JSON.parse(raw);
    } catch (error) {
      send(400, {
        ok: false,
        reason: "bad-body",
        message: `The request body must be JSON (the command's input) or empty: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      return;
    }

    if (!connected()) {
      send(503, noPage());
      return;
    }
    // Control 3. The page's bridge would refuse this anyway; refusing here
    // means no queue entry, no wait, and an answer that names the option.
    if (!allowRun) {
      send(403, {
        ok: false,
        reason: "run-not-allowed",
        message:
          `The connected page's bridge was built with allowRun: false, so it carries no ` +
          `runCommand. Pass \`agentBridge({ allowRun: true })\` to enable this route.`,
        connection: connection(),
      });
      return;
    }

    tokenSeq += 1;
    const token = `c${String(tokenSeq)}-${String(Date.now())}`;
    const startedAt = Date.now();

    const entry: Waiting = {
      token,
      id,
      input,
      pickedUp: false,
      timer: setTimeout(() => {
        waiting.delete(token);
        send(504, {
          ok: false,
          reason: "timeout",
          message: entry.pickedUp
            ? `The page picked up "${id}" but did not report a result within ${timeoutMs} ms.`
            : `No page picked up "${id}" within ${timeoutMs} ms. The bridge polls this route; ` +
              `is the tab open and the reporter running?`,
          pickedUp: entry.pickedUp,
          waitedMs: Date.now() - startedAt,
          command: id,
          connection: connection(),
        });
      }, timeoutMs),
      settle: (status, body) => send(status, { ...body, waitedMs: Date.now() - startedAt }),
    };
    waiting.set(token, entry);
  }

  return {
    name: "dev-toolbar-agent",
    // Control 1: serve-time only. There is no build hook to strip.
    apply: "serve",
    configureServer(server) {
      // Control 2. Read from the *resolved* config, so `--host` on the command
      // line is caught as well as `server.host` in the file.
      const host = server.config.server.host;
      if (!isLoopbackHost(host)) {
        server.config.logger.error(
          `[dev-toolbar-agent] not installed: the dev server is bound to ${JSON.stringify(host)}, ` +
            `not loopback. These routes run arbitrary toolbar commands on the open page and are ` +
            `localhost-only by design.`,
        );
        return;
      }
      install(server);
      server.config.logger.info(
        `  ➜  dev-toolbar:  ${base}/state, ${base}/commands (localhost only)`,
      );
    },
  };
}
