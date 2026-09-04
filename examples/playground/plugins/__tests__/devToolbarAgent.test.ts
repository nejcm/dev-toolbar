/**
 * The playground-only regression gate. It covers malformed check-ins, the
 * command round trip, and every refusal path that must answer rather than hang.
 * Run with `bun run test` in this directory.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { devToolbarAgent } from "../devToolbarAgent.ts";

type Handler = (req: unknown, res: unknown, next: () => void) => void;

/** Captures the middleware the plugin installs, with a fake dev server. */
function middleware(options: Parameters<typeof devToolbarAgent>[0] = {}): Handler {
  return install(options).handler;
}

/**
 * `middleware()`, plus the `close` listener the plugin registers on
 * `httpServer` — the only way to exercise the shutdown path, which is not
 * reachable through a request.
 */
function install(options: Parameters<typeof devToolbarAgent>[0] = {}): {
  handler: Handler;
  close: () => void;
} {
  let handler: Handler | undefined;
  let onClose: (() => void) | undefined;
  const plugin = devToolbarAgent(options);
  const configure = plugin.configureServer as (server: unknown) => void;
  configure({
    middlewares: {
      use: (fn: Handler) => {
        handler = fn;
      },
    },
    config: {
      server: { host: undefined },
      logger: { info: () => {}, error: () => {} },
    },
    httpServer: {
      on: (event: string, listener: () => void) => {
        if (event === "close") onClose = listener;
      },
    },
  });
  assert.ok(handler, "the plugin installed no middleware");
  return {
    handler,
    close: () => {
      assert.ok(onClose, "the plugin registered no close listener");
      onClose();
    },
  };
}

interface Answer {
  status: number;
  body: Record<string, unknown>;
}

/** Drives one request through the middleware and resolves what it answered. */
function request(
  handler: Handler,
  options: { method: string; url: string; body?: string; headers?: Record<string, string> },
): Promise<Answer> {
  const req = new EventEmitter() as EventEmitter & Record<string, unknown>;
  req["method"] = options.method;
  req["url"] = options.url;
  req["headers"] = { host: "localhost:5273", ...options.headers };
  req["destroy"] = () => {};

  return new Promise<Answer>((resolve, reject) => {
    let chunk = "";
    const res = {
      statusCode: 200,
      headersSent: false,
      writableEnded: false,
      setHeader: () => {},
      end: (value: string) => {
        res.writableEnded = true;
        chunk = value;
        resolve({ status: res.statusCode, body: JSON.parse(chunk) as Record<string, unknown> });
      },
    };
    handler(req, res, () => {
      reject(new Error(`the middleware passed ${options.url} through to next()`));
    });
    setImmediate(() => {
      if (options.body !== undefined) req.emit("data", Buffer.from(options.body, "utf8"));
      req.emit("end");
    });
  });
}

const checkIn = (body: string) =>
  request(middleware(), { method: "POST", url: "/__dev-toolbar/state", body });

/** Malformed bodies that previously killed the dev server instead of getting a response. */
const MALFORMED: [body: string, status: number][] = [
  ["null", 400],
  ['{"results":{}}', 400],
  ['{"results":[null]}', 200],
  ["[]", 400],
  ["42", 400],
  ['"hi"', 400],
  ["{", 400],
];

for (const [body, status] of MALFORMED) {
  test(`a malformed check-in body is answered, not thrown: ${body}`, async () => {
    const answer = await checkIn(body);
    assert.equal(answer.status, status);
    if (status === 400) assert.equal(answer.body["reason"], "bad-body");
  });
}

test("a valid check-in is accepted and hands out an empty queue", async () => {
  const answer = await checkIn(
    JSON.stringify({ protocolVersion: 2, instanceId: "playground", allowRun: true, results: [] }),
  );
  assert.equal(answer.status, 200);
  assert.equal(answer.body["ok"], true);
  assert.deepEqual(answer.body["pending"], []);
});

test("a result entry that is not an object is skipped, not dereferenced", async () => {
  const answer = await checkIn('{"instanceId":"p","results":[null,7,{"token":"nope"}]}');
  assert.equal(answer.status, 200);
});

test("with no page connected, every route answers rather than hanging", async () => {
  const handler = middleware();
  for (const url of ["/__dev-toolbar/state", "/__dev-toolbar/commands"]) {
    const answer = await request(handler, { method: "GET", url });
    assert.equal(answer.status, 503);
    assert.equal(answer.body["reason"], "no-page-connected");
  }
  const posted = await request(handler, {
    method: "POST",
    url: "/__dev-toolbar/commands/flags.set",
    body: "{}",
  });
  assert.equal(posted.status, 503);
  assert.equal(posted.body["reason"], "no-page-connected");
});

test("a malformed command id is answered as JSON, not thrown at connect", async () => {
  // `decodeURIComponent` throws `URIError` synchronously, so `guard()` — which
  // only catches rejections — never sees it. Before the try/catch, Vite's
  // error middleware answered this with an HTML 500 page.
  const answer = await request(middleware(), {
    method: "POST",
    url: "/__dev-toolbar/commands/%E0%A4%A",
    body: "",
  });
  assert.equal(answer.status, 400);
  assert.equal(answer.body["reason"], "bad-command-id");
});

test("a non-loopback Host is refused (the DNS-rebinding guard)", async () => {
  const answer = await request(middleware(), {
    method: "GET",
    url: "/__dev-toolbar/state",
    headers: { host: "evil.example:5273" },
  });
  assert.equal(answer.status, 403);
  assert.equal(answer.body["reason"], "non-loopback-host");
});

test("a foreign Origin is refused", async () => {
  const answer = await request(middleware(), {
    method: "GET",
    url: "/__dev-toolbar/state",
    headers: { origin: "https://evil.example" },
  });
  assert.equal(answer.status, 403);
  assert.equal(answer.body["reason"], "cross-origin");
});

test("two reporters in one slot are reported, not blended", async () => {
  const handler = middleware();
  const check = (reporterId: string) =>
    request(handler, {
      method: "POST",
      url: "/__dev-toolbar/state",
      body: JSON.stringify({
        instanceId: "playground",
        reporterId,
        allowRun: true,
        snapshot: { instanceId: "playground", diagnostics: [] },
        results: [],
      }),
    });

  await check("tab-a");
  await check("tab-b");
  const state = await request(handler, { method: "GET", url: "/__dev-toolbar/state" });
  const connection = state.body["connection"] as Record<string, unknown>;
  assert.equal(connection["reporters"], 2);
  assert.equal(connection["ambiguous"], true);
  assert.equal(connection["reporterId"], "tab-b");
});

test("the plugin refuses to install on a non-loopback bind", () => {
  const errors: string[] = [];
  let installed = false;
  const plugin = devToolbarAgent();
  (plugin.configureServer as (server: unknown) => void)({
    middlewares: {
      use: () => {
        installed = true;
      },
    },
    config: { server: { host: true }, logger: { info: () => {}, error: (m: string) => errors.push(m) } },
    httpServer: { on: () => {} },
  });
  assert.equal(installed, false);
  assert.match(errors[0] ?? "", /not installed/);
});

/** A check-in body, with the fields the round trip below actually depends on. */
const page = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    protocolVersion: 2,
    instanceId: "playground",
    reporterId: "tab-a",
    allowRun: true,
    snapshot: { instanceId: "playground", diagnostics: [], commands: [] },
    results: [],
    ...extra,
  });

/** The end-to-end route: queue on POST, pick up on the next check-in, return the result. */
test("a command round-trips: POST, picked up on the next check-in, answered", async () => {
  const handler = middleware();
  await request(handler, { method: "POST", url: "/__dev-toolbar/state", body: page() });

  // Deliberately not awaited: this request stays open until a check-in
  // carries its result back, which is the whole shape being tested.
  const posted = request(handler, {
    method: "POST",
    url: "/__dev-toolbar/commands/flags.set",
    body: JSON.stringify({ key: "beta", value: true }),
  });

  const polled = await request(handler, {
    method: "POST",
    url: "/__dev-toolbar/state",
    body: page(),
  });
  const pending = polled.body["pending"] as { token: string; id: string; input?: unknown }[];
  assert.equal(pending.length, 1, "the queued command was not handed to the page");
  assert.equal(pending[0]?.id, "flags.set");
  // Contract v2 carries command input through the queue unchanged.
  assert.deepEqual(pending[0]?.input, { key: "beta", value: true });
  const token = pending[0]?.token as string;

  const answered = await request(handler, {
    method: "POST",
    url: "/__dev-toolbar/state",
    body: page({ results: [{ token, outcome: { ok: true, result: "was false" } }] }),
  });
  assert.equal(answered.status, 200);

  const result = await posted;
  assert.equal(result.status, 200);
  assert.equal(result.body["ok"], true);
  assert.equal(result.body["result"], "was false");
  // The middleware identifies both the command and the reporter that ran it.
  assert.equal(result.body["command"], "flags.set");
  assert.equal(result.body["ranIn"], "tab-a");
  assert.equal(typeof result.body["waitedMs"], "number");
});

// `timeoutMs` is short because this test deliberately never answers the token:
// the default 10s timer would keep the process alive for the whole suite.
test("a second check-in is not handed a command that was already picked up", async () => {
  const handler = middleware({ timeoutMs: 20 });
  await request(handler, { method: "POST", url: "/__dev-toolbar/state", body: page() });
  void request(handler, { method: "POST", url: "/__dev-toolbar/commands/noop", body: "" });

  const first = await request(handler, { method: "POST", url: "/__dev-toolbar/state", body: page() });
  assert.equal((first.body["pending"] as unknown[]).length, 1);
  const second = await request(handler, { method: "POST", url: "/__dev-toolbar/state", body: page() });
  assert.deepEqual(second.body["pending"], [], "the same command was handed out twice");
});

test("a page reporting allowRun: false gets 403, and nothing is queued", async () => {
  const handler = middleware();
  await request(handler, {
    method: "POST",
    url: "/__dev-toolbar/state",
    body: page({ allowRun: false }),
  });

  const posted = await request(handler, {
    method: "POST",
    url: "/__dev-toolbar/commands/flags.set",
    body: "{}",
  });
  assert.equal(posted.status, 403);
  assert.equal(posted.body["reason"], "run-not-allowed");

  // A refusal must not leave a command queued for the next poll.
  const polled = await request(handler, { method: "POST", url: "/__dev-toolbar/state", body: page() });
  assert.deepEqual(polled.body["pending"], []);
});

test("a command nobody answers times out at 504 rather than hanging", async () => {
  const handler = middleware({ timeoutMs: 20 });
  await request(handler, { method: "POST", url: "/__dev-toolbar/state", body: page() });

  const posted = await request(handler, {
    method: "POST",
    url: "/__dev-toolbar/commands/slow.command",
    body: "",
  });
  assert.equal(posted.status, 504);
  assert.equal(posted.body["reason"], "timeout");
  // Distinguish "no page picked it up" from "the page did not answer".
  assert.equal(posted.body["pickedUp"], false);
  assert.equal(posted.body["command"], "slow.command");
  assert.match(String(posted.body["message"]), /No page picked up/);
});

test("the timeout body says when the page did pick the command up", async () => {
  const handler = middleware({ timeoutMs: 40 });
  await request(handler, { method: "POST", url: "/__dev-toolbar/state", body: page() });
  const posted = request(handler, {
    method: "POST",
    url: "/__dev-toolbar/commands/slow.command",
    body: "",
  });
  // Picked up, then never answered — the other half of the same 504.
  await request(handler, { method: "POST", url: "/__dev-toolbar/state", body: page() });
  const answer = await posted;
  assert.equal(answer.status, 504);
  assert.equal(answer.body["pickedUp"], true);
  assert.match(String(answer.body["message"]), /did not report a result/);
});

test("a dev server shutting down answers every waiting caller, not none", async () => {
  const server = install({ timeoutMs: 60_000 });
  await request(server.handler, { method: "POST", url: "/__dev-toolbar/state", body: page() });
  const first = request(server.handler, {
    method: "POST",
    url: "/__dev-toolbar/commands/a",
    body: "",
  });
  const second = request(server.handler, {
    method: "POST",
    url: "/__dev-toolbar/commands/b",
    body: "",
  });
  // With a 60 s timeout, only the shutdown path can answer these requests.
  await new Promise((resolve) => setImmediate(resolve));

  server.close();

  for (const answer of await Promise.all([first, second])) {
    assert.equal(answer.status, 503);
    assert.equal(answer.body["reason"], "server-closing");
  }
});

test("a check-in body over the cap is refused, not buffered", async () => {
  // Reject one byte over 4 MiB while reading, so the request cannot buffer without bound.
  const handler = middleware();
  const req = new EventEmitter() as EventEmitter & Record<string, unknown>;
  req["method"] = "POST";
  req["url"] = "/__dev-toolbar/state";
  req["headers"] = { host: "localhost:5273" };
  let destroyed = false;
  req["destroy"] = () => {
    destroyed = true;
  };

  const answer = await new Promise<Answer>((resolve, reject) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      writableEnded: false,
      setHeader: () => {},
      end: (value: string) => {
        res.writableEnded = true;
        resolve({ status: res.statusCode, body: JSON.parse(value) as Record<string, unknown> });
      },
    };
    handler(req, res, () => reject(new Error("passed through to next()")));
    setImmediate(() => {
      const chunk = Buffer.alloc(1024 * 1024, 0x61);
      for (let i = 0; i < 5; i += 1) req.emit("data", chunk);
      req.emit("end");
    });
  });

  assert.equal(answer.status, 400);
  assert.equal(answer.body["reason"], "bad-body");
  assert.match(String(answer.body["message"]), /exceeds/);
  assert.equal(destroyed, true, "the request stream was not destroyed");
});

/** Pins the protocol-mismatch refusal instead of allowing a skewed body through. */
test("a check-in declaring an unknown protocol version is refused", async () => {
  for (const version of [1, 3, 99]) {
    const answer = await checkIn(page({ protocolVersion: version }));
    assert.equal(answer.status, 400, `protocolVersion ${version} was accepted`);
    assert.equal(answer.body["reason"], "protocol-mismatch");
    assert.equal(answer.body["expected"], 2);
    assert.equal(answer.body["received"], version);
    assert.match(String(answer.body["message"]), /devToolbarAgent\.ts/);
  }
});

test("a refused check-in does not become the connected page", async () => {
  const handler = middleware();
  await request(handler, {
    method: "POST",
    url: "/__dev-toolbar/state",
    body: page({ protocolVersion: 1 }),
  });
  const state = await request(handler, { method: "GET", url: "/__dev-toolbar/state" });
  assert.equal(state.status, 503);
  assert.equal(state.body["reason"], "no-page-connected");
});

test("a check-in with no protocolVersion at all is still accepted", async () => {
  const answer = await checkIn('{"instanceId":"playground","allowRun":true,"results":[]}');
  assert.equal(answer.status, 200);
});
