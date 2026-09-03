/**
 * The plugin's regression test, and the only automated gate it has: `examples/`
 * sits outside the repo's vitest, oxlint and knip runs by design, and this file
 * is a recipe consumers are told to copy.
 *
 * Run it with `bun run test` in this directory (`node --test`, using Node's own
 * type stripping — no build step, no test dependency).
 *
 * What it covers is the failure the review found: a malformed check-in body
 * dereferenced unchecked inside an `async` handler whose promise nothing
 * awaits. Under Node's default `--unhandled-rejections=throw` that does not
 * fail the request — it ends the dev server. Each body below took a real
 * server down before the validation and the `guard()` net existed.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { devToolbarAgent } from "../devToolbarAgent.ts";

type Handler = (req: unknown, res: unknown, next: () => void) => void;

/** Captures the middleware the plugin installs, with a fake dev server. */
function middleware(): Handler {
  let handler: Handler | undefined;
  const plugin = devToolbarAgent();
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
    httpServer: { on: () => {} },
  });
  assert.ok(handler, "the plugin installed no middleware");
  return handler;
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
    // Emitted after the handler subscribed, the way a real request arrives.
    setImmediate(() => {
      if (options.body !== undefined) req.emit("data", Buffer.from(options.body, "utf8"));
      req.emit("end");
    });
  });
}

const checkIn = (body: string) =>
  request(middleware(), { method: "POST", url: "/__dev-toolbar/state", body });

/**
 * The three on the left each killed a fresh dev server before the fix — `null`
 * dereferenced as an object, a non-iterable `results`, a `null` entry inside
 * it — as an unhandled rejection rather than a failed request. Two are now
 * refused; `{"results":[null]}` is a *well-formed* check-in whose one junk
 * entry is skipped, so it is accepted. What matters for all of them is that
 * the request is answered and the process is still standing.
 */
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
