import { describe, expect, expectTypeOf, it } from "vitest";
import {
  DEFAULT_SENSITIVE_KEYS,
  REDACTED,
  type RedactOptions,
  UNREADABLE,
  isSensitiveKey,
  redact,
  redactHeaders,
  redactProse,
  redactText,
  redactUrl,
} from "../redact";

describe("redact", () => {
  it("masks by key name, case- and separator-insensitively", () => {
    expect(
      redact({
        Authorization: "Bearer abc",
        access_token: "xyz",
        "X-Api-Key": "k",
        refreshToken: "r",
        userId: 7,
        nested: { clientSecret: "s", label: "fine" },
      }),
    ).toEqual({
      Authorization: REDACTED,
      access_token: REDACTED,
      "X-Api-Key": REDACTED,
      refreshToken: REDACTED,
      userId: 7,
      nested: { clientSecret: REDACTED, label: "fine" },
    });
  });

  it("never mutates the input", () => {
    const input = { token: "secret", keep: [1, 2] };
    const output = redact(input) as { token: string };
    expect(input.token).toBe("secret");
    expect(output.token).toBe(REDACTED);
  });

  it("masks credential-shaped string values regardless of key", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVPmB92K";
    expect(redact({ note: `Bearer ${jwt}`, blob: jwt, plain: "hello world" })).toEqual({
      note: `Bearer ${REDACTED}`,
      blob: REDACTED,
      plain: "hello world",
    });

    expect(redact({ blob: jwt }, { values: false })).toEqual({ blob: jwt });
  });

  it("masks Digest auth headers with comma-separated parameters", () => {
    expect(redact({ header: "Digest username=x, realm=y" })).toEqual({
      header: `Digest ${REDACTED}`,
    });
    expect(redact({ header: "digest username=x" })).toEqual({
      header: `digest ${REDACTED}`,
    });
  });

  // `redact()` is an anchored whole-value match — it must not fire on prose
  // that merely starts with a scheme-like prefix (see `redactText` for the
  // substring-scan counterpart that handles prose).
  it("leaves prose that merely starts like a scheme header byte-for-byte", () => {
    expect(redact({ h: "token expired, please log in" })).toEqual({
      h: "token expired, please log in",
    });
    expect(redact({ h: "Bearer abc def" })).toEqual({ h: "Bearer abc def" });
  });

  it("masks non-http absolute URLs and leaves prose timestamps alone", () => {
    expect(
      redact({
        db: "postgres://user:secret@db.test/app",
        cache: "redis://:hunter2@cache.test/0",
        socket: "wss://stream.test/live?token=abc&room=1",
        build: "build:2024-01-01T00:00:00Z",
      }),
    ).toEqual({
      db: `postgres://${REDACTED}:${REDACTED}@db.test/app`,
      cache: `redis://:${REDACTED}@cache.test/0`,
      socket: `wss://stream.test/live?token=${REDACTED}&room=1`,
      build: "build:2024-01-01T00:00:00Z",
    });
  });

  it("walks a non-string Error.message and tags reference cycles", () => {
    const error = new Error("fine") as Error & { extra?: unknown };
    error.message = error as unknown as string;
    expect(redact({ error })).toEqual({
      error: { name: "Error", message: "[circular]" },
    });

    const nested = new Error("fine") as Error & { detail: unknown };
    nested.message = { code: "E_FAIL", token: "s3" } as unknown as string;
    expect(redact({ nested })).toEqual({
      nested: { name: "Error", message: { code: "E_FAIL", token: REDACTED } },
    });

    const named = new Error("fine") as Error & { extra?: unknown };
    named.name = named as unknown as string;
    expect(redact({ named })).toEqual({
      named: { name: "[circular]", message: "fine" },
    });

    const titled = new Error("fine") as Error & { extra?: unknown };
    titled.name = { token: "s3" } as unknown as string;
    expect(redact({ titled })).toEqual({
      titled: { name: { token: REDACTED }, message: "fine" },
    });
  });

  it("honours extraKeys, allowKeys and a custom mask", () => {
    expect(
      redact({ tenant: "acme", session: "s1" }, { extraKeys: ["tenant"], mask: "***" }),
    ).toEqual({ tenant: "***", session: "***" });

    // allowKeys wins over the default list.
    expect(redact({ sessionName: "checkout" }, { allowKeys: ["sessionName"] })).toEqual({
      sessionName: "checkout",
    });
  });

  it("masks credentials inside URL-shaped values, wherever the key is innocent", () => {
    expect(
      redact({
        page: "https://app.test/cb?access_token=hunter2&state=1",
        note: "see https://api.test/v1?api_key=abc123",
      }),
    ).toEqual({
      page: `https://app.test/cb?access_token=${REDACTED}&state=1`,
      // Not a bare URL, so it is left alone: this is defence in depth, not a
      // replacement for calling redactUrl() on something you know is a URL.
      note: "see https://api.test/v1?api_key=abc123",
    });

    expect(redact({ page: "https://app.test/about" })).toEqual({
      page: "https://app.test/about",
    });
    expect(redact({ page: "https://app.test/cb?access_token=hunter2" }, { values: false })).toEqual(
      { page: "https://app.test/cb?access_token=hunter2" },
    );
  });

  it("returns an innocent URL byte-for-byte, normalisation included", () => {
    // `URL.toString()` normalizes (adds path, lowercases host, punycodes IDN);
    // a redactor with nothing to redact must not touch the value at all, or
    // two identical diagnostic dumps would stop diffing as identical.
    const untouched = [
      "https://app.test?x=1", // gains "/" through URL.toString()
      "HTTPS://App.Test/path", // lowercased
      "https://münchen.de/x", // punycoded to xn--mnchen-3ya.de
      "https://app.test/a//b/../c", // path left exactly as written
    ];
    for (const page of untouched) {
      expect(redact({ page })).toEqual({ page });
    }

    // …and the moment there *is* something to mask, rewriting is the point.
    expect(redact({ page: "https://App.Test?token=t" })).toEqual({
      page: `https://app.test/?token=${REDACTED}`,
    });
  });

  it("handles cycles, depth and long arrays without throwing", () => {
    const cyclic: Record<string, unknown> = { name: "root" };
    cyclic["self"] = cyclic;
    expect(redact(cyclic)).toEqual({ name: "root", self: "[circular]" });

    const deep = { a: { b: { c: { d: 1 } } } };
    expect(redact(deep, { maxDepth: 2 })).toEqual({ a: { b: "[truncated]" } });

    const long = Array.from({ length: 5 }, (_, index) => index);
    expect(redact(long, { maxArrayLength: 3 })).toEqual([0, 1, 2, "[+2 more]"]);
  });

  it("bounds a shared (DAG) reference walked once per path with maxNodes", () => {
    // The cycle guard is scoped to one path, so a value reachable through many
    // paths is walked once per path — a DAG of 8 keys x 7 levels aliasing one
    // child costs 8^7 walks with no bound but `maxNodes`. A `Proxy` `ownKeys`
    // trap counts how many times the shared leaf is actually visited.
    let leafWalks = 0;
    function buildLevel(depth: number): unknown {
      if (depth === 0) {
        return new Proxy(
          { value: "leaf" },
          {
            ownKeys(target) {
              leafWalks += 1;
              return Reflect.ownKeys(target);
            },
          },
        );
      }
      const child = buildLevel(depth - 1);
      const level: Record<string, unknown> = {};
      for (let index = 0; index < 8; index += 1) level[`k${index}`] = child;
      return level;
    }
    const sharedGraph = buildLevel(7);

    const output = redact(sharedGraph, { maxNodes: 50 });

    // Far fewer than the 8^7 = 2_097_152 walks an unbounded traversal would produce.
    expect(leafWalks).toBeLessThan(200);
    expect(JSON.stringify(output)).toContain("[truncated]");

    // The budget is shared by the whole call: a sibling not yet reached is
    // truncated too, not just the branch that spent the count.
    const record = output as Record<string, unknown>;
    expect(record["k7"]).toBe("[truncated]");
  });

  it("falls back to the default maxArrayLength instead of throwing when it is NaN", () => {
    // `new Array(NaN)` throws a RangeError, defeating redact()'s one guarantee
    // that it never throws — a malformed bound must fall back to the default.
    const array = Array.from({ length: 250 }, (_, index) => index);
    expect(() => redact(array, { maxArrayLength: Number.NaN })).not.toThrow();
    expect(redact(array, { maxArrayLength: Number.NaN })).toEqual(
      redact(array, { maxArrayLength: 200 }),
    );
  });

  it("falls back to the default maxDepth when it is NaN", () => {
    function buildDeep(depth: number): unknown {
      return depth === 0 ? { value: 1 } : { next: buildDeep(depth - 1) };
    }
    const value = buildDeep(9);
    expect(redact(value, { maxDepth: Number.NaN })).toEqual(redact(value, { maxDepth: 8 }));
  });

  it("falls back to the default maxNodes when it is NaN", () => {
    const value = { a: 1, b: { c: 2 } };
    expect(redact(value, { maxNodes: Number.NaN })).toEqual(redact(value, { maxNodes: 50_000 }));
  });

  it("tags values a diagnostics dump should not walk", () => {
    class Widget {
      token = "nope";
    }
    expect(
      redact({
        fn: () => {},
        map: new Map(),
        set: new Set(),
        instance: new Widget(),
        when: new Date("2020-01-02T03:04:05.000Z"),
        error: new Error("Bearer abc"),
        nothing: null,
      }),
    ).toEqual({
      fn: "[function]",
      map: "[Map]",
      set: "[Set]",
      instance: "[Widget]",
      when: "2020-01-02T03:04:05.000Z",
      error: { name: "Error", message: `Bearer ${REDACTED}` },
      nothing: null,
    });
  });

  it("tags a throwing getter instead of propagating it — top-level, nested, and in an array", () => {
    const hostile = {
      get boom(): string {
        throw new Error("getter blew up");
      },
      fine: "ok",
    };
    expect(redact(hostile)).toEqual({ boom: "[getter threw]", fine: "ok" });

    expect(redact({ nested: hostile })).toEqual({
      nested: { boom: "[getter threw]", fine: "ok" },
    });

    expect(redact([hostile, "plain"])).toEqual([{ boom: "[getter threw]", fine: "ok" }, "plain"]);
  });

  it("tags an object whose own keys cannot even be enumerated", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("ownKeys blew up");
        },
      },
    );
    expect(redact({ nested: hostile })).toEqual({ nested: "[unwalkable]" });
  });

  it("tags an invalid Date instead of letting toISOString() throw", () => {
    expect(redact({ when: new Date(NaN) })).toEqual({ when: "[invalid date]" });
    expect(redact({ when: new Date("not a date") })).toEqual({ when: "[invalid date]" });
  });

  it("tags a throwing array-index accessor instead of losing the whole array", () => {
    const hostile: unknown[] = [1, 2, 3];
    Object.defineProperty(hostile, 1, {
      enumerable: true,
      configurable: true,
      get(): number {
        throw new Error("index blew up");
      },
    });
    expect(redact(hostile)).toEqual([1, "[getter threw]", 3]);
  });

  it("tags an Error whose name or message getter throws", () => {
    const hostileMessage = new Error("fine");
    Object.defineProperty(hostileMessage, "message", {
      get(): string {
        throw new Error("message blew up");
      },
    });
    expect(redact(hostileMessage)).toEqual({ name: "Error", message: "[getter threw]" });

    const hostileName = new Error("fine");
    Object.defineProperty(hostileName, "name", {
      get(): string {
        throw new Error("name blew up");
      },
    });
    expect(redact(hostileName)).toEqual({ name: "[getter threw]", message: "fine" });
  });

  it("tags a Proxy whose getPrototypeOf trap throws", () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("getPrototypeOf blew up");
        },
      },
    );
    expect(redact({ nested: hostile })).toEqual({ nested: "[unwalkable]" });
  });

  it("tags a revoked Proxy instead of letting Array.isArray throw", () => {
    // `Array.isArray` throws a TypeError on a revoked Proxy, before `walk()`
    // even gets to decide which branch to take.
    const revokedObject = Proxy.revocable({}, {});
    revokedObject.revoke();
    expect(redact({ nested: revokedObject.proxy })).toEqual({ nested: "[unwalkable]" });

    const revokedArray = Proxy.revocable([], {});
    revokedArray.revoke();
    expect(redact({ nested: revokedArray.proxy })).toEqual({ nested: "[unwalkable]" });
  });

  it("never invokes a sensitive-named getter — masked before it is read", () => {
    let invoked = false;
    const hostile = {
      get token(): string {
        invoked = true;
        return "secret";
      },
    };
    expect(redact(hostile)).toEqual({ token: REDACTED });
    expect(invoked).toBe(false);
  });

  it("passes primitives straight through", () => {
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(undefined)).toBeUndefined();
    expect(redact("plain")).toBe("plain");
  });

  it("keeps the type it was handed, where `walk` actually guarantees one", () => {
    const text: string = "https://app.test/about";
    expectTypeOf(redact(text)).toEqualTypeOf<string>();
    expectTypeOf(redact(text, { mask: "***" })).toEqualTypeOf<string>();
    expect(redact(text)).toBe(text);

    expectTypeOf(redact(1 as number)).toEqualTypeOf<number>();
    expectTypeOf(redact(true as boolean)).toEqualTypeOf<boolean>();
    expectTypeOf(redact(1n as bigint)).toEqualTypeOf<bigint>();
    expectTypeOf(redact(null)).toEqualTypeOf<null>();
    expectTypeOf(redact(undefined)).toEqualTypeOf<undefined>();

    // Everything else stays `unknown`, because a plain object comes back as a
    // record *or* as a tag string (a cycle, `maxDepth: 0`, a hostile Proxy).
    expectTypeOf(redact({ a: 1 })).toBeUnknown();
    expectTypeOf(redact([1, 2])).toBeUnknown();
    // An explicit type argument must still land on the catch-all overload,
    // not fail with TS2344.
    expectTypeOf(redact<{ a: 1 }>({ a: 1 })).toBeUnknown();
    expectTypeOf(redact<string>("x")).toBeUnknown();
    expect(redact({ deep: { a: 1 } }, { maxDepth: 0 })).toBe("[truncated]");
  });

  it("exposes its default key list and a predicate", () => {
    expect(DEFAULT_SENSITIVE_KEYS).toContain("authorization");
    expect(isSensitiveKey("X-CSRF-Token")).toBe(true);
    expect(isSensitiveKey("userId")).toBe(false);
  });
});

describe("isSensitiveKey", () => {
  // Default entries as a real payload spells them, plus separator/case variants.
  const SENSITIVE = [
    ...DEFAULT_SENSITIVE_KEYS,
    "Authorization",
    "auth",
    "authToken",
    "X-Auth-Token",
    "x-auth-token",
    "apiKey",
    "api_key",
    "X-Api-Key",
    "APIKey",
    "accessToken",
    "access_token",
    "refreshToken",
    "refresh_token",
    "idToken",
    "sessionId",
    "session-id",
    "session",
    "sid",
    "X-CSRF-Token",
    "csrfToken",
    "xsrfToken",
    "password",
    "userPassword",
    "passwd",
    "pwd",
    "secret",
    "clientSecret",
    "client_secret",
    "privateKey",
    "private_key",
    "accessKey",
    "cookie",
    "set-cookie",
    "Set-Cookie",
    "signature",
    // Plural tolerance: `credential` still covers the `credentials` bag every SDK ships.
    "credential",
    "credentials",
    "tokens",
    "cookies",
    "ssn",
    "creditCard",
    "credit_card",
    "cardNumber",
    "cvv",
    "cvc",
    "jwt",
    "passphrase",
    "passcode",
    "otp",
    "otpCode",
    // A PIN *is* the credential: matching the `pin` segment of `pinCode` is the
    // rule working, not the over-match `spinner` was.
    "pin",
    "pinCode",
    // Run-together compounds have no boundary to segment on, so they're only
    // matched because the list carries the concatenation itself.
    "accesstoken",
    "authtoken",
    "secretkey",
    "JSESSIONID",
    "PHPSESSID",
    // `auth` no longer reaches inside a word, so spellings it used to cover by
    // substring are entries of their own — same for the other named fields below.
    "Authentication",
    "authorisation",
    "bearer",
    "csrfmiddlewaretoken",
    "sessid",
    "SESSID",
    "sess_id",
    "sess",
    "totp",
    "hotp",
    "xauth",
    "x_auth",
  ];

  it.each(SENSITIVE)("treats %j as sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  // Substring matching used to redact every one of these (`auth` hit `author`,
  // `pin` hit `spinner`, `sid` hit `inside`), so the matcher reads word segments instead.
  const INNOCENT = [
    "author",
    "authorName",
    "oauthClientName",
    "inside",
    "shipping",
    "residual",
    "consider",
    "spinner",
    "--spinner-size",
    "--sidebar-bg",
    "considered",
    "userId",
    "id",
    "tokenizer",
    "secretary",
    "cwd",
    "keystone",
    "pinnacle",
    // A public key is the half of the pair that is meant to be published.
    "publicKey",
    // Not a credential: the response header naming the challenge scheme.
    "www-authenticate",
  ];

  it.each(INNOCENT)("leaves %j alone", (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });

  // The segmenter used to treat every non-ASCII letter as punctuation, so
  // `contraseña` split to `contrase`/`a` and `пароль` to nothing at all.
  it("segments a non-ASCII key, so extraKeys can name one", () => {
    expect(isSensitiveKey("contraseña", { extraKeys: ["contraseña"] })).toBe(true);
    expect(isSensitiveKey("Contraseña", { extraKeys: ["contraseña"] })).toBe(true);
    expect(isSensitiveKey("пароль", { extraKeys: ["пароль"] })).toBe(true);
    expect(isSensitiveKey("密码", { extraKeys: ["密码"] })).toBe(true);
    expect(isSensitiveKey("mot_de_passe", { extraKeys: ["motdepasse"] })).toBe(true);
    // NFC: a decomposed combining mark must still match the composed extraKey.
    expect(isSensitiveKey("Passw\u006f\u0308rter", { extraKeys: ["passwörter"] })).toBe(true);
    // And the non-ASCII letter is a letter, not a boundary: an entry cannot
    // reach half a word.
    expect(isSensitiveKey("contraseña", { extraKeys: ["contrase"] })).toBe(false);
    expect(isSensitiveKey("Passwörter", { extraKeys: ["contraseña"] })).toBe(false);
  });

  // An entry is canonicalised through the same segmenter as the key; stripping
  // only `-_.` and whitespace used to leave `x/y` unmatchable.
  it("accepts an extraKey spelled with any separator", () => {
    expect(isSensitiveKey("x/y", { extraKeys: ["x/y"] })).toBe(true);
    expect(isSensitiveKey("x-y", { extraKeys: ["x/y"] })).toBe(true);
    expect(isSensitiveKey("xY", { extraKeys: ["x y"] })).toBe(true);
    expect(isSensitiveKey("a.b:c", { extraKeys: ["a-b-c"] })).toBe(true);
    // An entry of pure punctuation segments to nothing and matches nothing,
    // rather than matching every key the way `includes("")` did.
    expect(isSensitiveKey("anything", { keys: ["---"] })).toBe(false);
  });

  it("still lets allowKeys win over a match", () => {
    expect(isSensitiveKey("sessionName")).toBe(true);
    expect(isSensitiveKey("sessionName", { allowKeys: ["sessionName"] })).toBe(false);
    expect(isSensitiveKey("session-name", { allowKeys: ["sessionName"] })).toBe(false);
    expect(isSensitiveKey("session_name", { allowKeys: ["session name"] })).toBe(false);
    // And extraKeys still land on the same segment rule.
    expect(isSensitiveKey("tenantCode", { extraKeys: ["tenantcode"] })).toBe(true);
    expect(isSensitiveKey("tenant_code", { extraKeys: ["tenant-code"] })).toBe(true);
  });

  // `keys`/`extraKeys` match a *run* of segments; `allowKeys` matches the
  // *whole* canonical key.
  it("does not let allowKeys exempt by partial match", () => {
    // "session" alone still sensitises "sessionName" — allowKeys has to name
    // the whole key, not just the segment that triggered the match.
    expect(isSensitiveKey("sessionName", { allowKeys: ["session"] })).toBe(true);
    // allowKeys still tolerates the same separator/case variance keys do...
    expect(isSensitiveKey("session-name", { allowKeys: ["sessionName"] })).toBe(false);
    expect(isSensitiveKey("SESSION_NAME", { allowKeys: ["sessionName"] })).toBe(false);
    // ...but it is still equality against the *entire* key, not a run inside
    // it: an extra trailing segment is enough to miss.
    expect(isSensitiveKey("sessionNameV2", { allowKeys: ["sessionName"] })).toBe(true);
  });

  // `isSensitiveKey` memoises the resolved form of an options object by identity
  // (`resolveCached` in redact.ts): a snapshot taken the first time the object
  // is seen, so mutating it later is not picked up by calls sharing that object.
  it("resolves an options object once: later mutation of that same object is not observed", () => {
    const shared: RedactOptions = { extraKeys: ["tenantcode"] };
    expect(isSensitiveKey("tenantCode", shared)).toBe(true);
    expect(isSensitiveKey("shipCode", shared)).toBe(false);

    // Mutating the same object after it has already been resolved once.
    (shared.extraKeys as string[]).push("shipcode");
    expect(isSensitiveKey("shipCode", shared)).toBe(false);

    // A fresh object with the same new content matches immediately: nothing
    // is cached against content, only against the object's own identity.
    expect(isSensitiveKey("shipCode", { extraKeys: ["shipcode"] })).toBe(true);
  });

  it("matches header names and URL parameters through the same rule", () => {
    expect(redactHeaders({ "x-auth-token": "t", "x-author": "nejcm" })).toEqual({
      "x-auth-token": REDACTED,
      "x-author": "nejcm",
    });
    expect(redactUrl("/p?author=nejcm&auth=t")).toBe(`/p?author=nejcm&auth=${REDACTED}`);
  });
});

describe("redactUrl", () => {
  it("masks sensitive query parameters and keeps the rest", () => {
    expect(redactUrl("https://api.example.com/v1/users?page=2&access_token=abc123")).toBe(
      `https://api.example.com/v1/users?page=2&access_token=${REDACTED}`,
    );
  });

  it("masks userinfo credentials", () => {
    const output = redactUrl("https://alice:hunter2@example.com/x");
    expect(output).toContain(REDACTED);
    expect(output).not.toContain("hunter2");
    expect(output).not.toContain("alice");
  });

  it("keeps a relative URL relative", () => {
    expect(redactUrl("/api/orders?token=t&limit=10")).toBe(
      `/api/orders?token=${REDACTED}&limit=10`,
    );
  });

  it("masks fragment parameters, the OAuth implicit-flow shape", () => {
    const output = redactUrl("https://app.test/cb#access_token=abc&state=1");
    expect(output).not.toContain("abc");
    expect(output).toContain("state=1");
  });

  // The old fragment pass parsed the whole hash as query params, mangling a
  // hash-router path like `/settings?token`.
  it("masks only the query in a hash-router fragment and keeps the path", () => {
    expect(redactUrl("https://app.test/#/settings?token=abc&tab=general")).toBe(
      `https://app.test/#/settings?token=${REDACTED}&tab=general`,
    );
  });

  it("falls back to a query rewrite for an unparseable URL", () => {
    const output = redactUrl("::::?api_key=abc&ok=1");
    expect(output).not.toContain("abc");
    expect(output).toContain("ok=1");
  });

  it("never throws on a malformed percent-escape", () => {
    // Reachable synchronously inside the patched fetch, so a URIError here
    // would be an exception in the host app's network layer.
    expect(() => redactUrl("http://bad host/?%zz=1&api_key=abc")).not.toThrow();
    expect(redactUrl("http://bad host/?%zz=1&api_key=abc")).not.toContain("abc");
    expect(() => redactUrl("::::?%e0%a4%a=1")).not.toThrow();
  });

  it("leaves a URL with nothing sensitive untouched", () => {
    expect(redactUrl("/api/orders")).toBe("/api/orders");
  });

  it("keeps the origin of a protocol-relative URL", () => {
    expect(redactUrl("//cdn.example.com/lib.js")).toBe("//cdn.example.com/lib.js");
    expect(redactUrl("//example.com/a?access_token=1")).toBe(
      `//example.com/a?access_token=${REDACTED}`,
    );
  });

  it("does not turn a bare string into a rooted, encoded path", () => {
    expect(redactUrl("just some text")).toBe("just some text");
    expect(redactUrl("#top")).toBe("#top");
    expect(redactUrl("cb?x=1")).toBe("cb?x=1");
    expect(redactUrl("cb?token=1")).toBe(`cb?token=${REDACTED}`);
  });

  // Every reference form callers hand over: absolute, the three relative
  // forms, and non-URL strings that reach here anyway via a fetch argument.
  const UNMASKED = [
    "https://api.test/v1/users?page=2",
    "HTTPS://App.Test/path",
    "https://api.test?x=1",
    "/api/orders?limit=10",
    "//cdn.example.com/lib.js",
    "#section-2",
    "?page=2&sort=asc",
    "cb?x=1",
    "http://bad host/?%zz=1",
    "just some text",
    "::::",
  ];

  it.each(UNMASKED)("returns %j byte-for-byte when nothing matched", (input) => {
    expect(redactUrl(input)).toBe(input);
  });

  const MASKED: readonly (readonly [string, string])[] = [
    [
      "https://api.test/v1?page=2&access_token=a",
      `https://api.test/v1?page=2&access_token=${REDACTED}`,
    ],
    ["/api/orders?token=t&limit=10", `/api/orders?token=${REDACTED}&limit=10`],
    ["//example.com/a?api_key=k", `//example.com/a?api_key=${REDACTED}`],
    ["cb?token=t", `cb?token=${REDACTED}`],
    ["?token=t", `?token=${REDACTED}`],
    ["#access_token=a&state=1", `#access_token=${REDACTED}&state=1`],
    ["https://alice:hunter2@example.com/x", `https://${REDACTED}:${REDACTED}@example.com/x`],
    ["http://bad host/?%zz=1&api_key=a", `http://bad host/?%zz=1&api_key=${REDACTED}`],
    // The parser strips leading whitespace and every tab/newline/CR before
    // looking at the slashes, so the form must be judged from that normalised
    // string, not the raw input.
    ["  //host.test/p?token=1", `//host.test/p?token=${REDACTED}`],
    ["  /rooted?token=1", `/rooted?token=${REDACTED}`],
    ["\t/tab?token=1", `/tab?token=${REDACTED}`],
    ["\n//h.test/x?token=1", `//h.test/x?token=${REDACTED}`],
  ];

  it.each(MASKED)("keeps the shape of %j while masking it", (input, expected) => {
    expect(redactUrl(input)).toBe(expected);
  });

  // The mask goes into a URL literally so a dump reads `[redacted]` rather
  // than percent-encoded, and can be compared against the exported `REDACTED`.
  it("writes the mask literally in userinfo, query and fragment", () => {
    expect(redactUrl("https://user:pw@a.test/p")).toBe(`https://${REDACTED}:${REDACTED}@a.test/p`);
    expect(redactUrl("https://a.test/p?token=abc&x=1")).toBe(
      `https://a.test/p?token=${REDACTED}&x=1`,
    );
    expect(redactUrl("https://a.test/cb#access_token=abc&state=1")).toBe(
      `https://a.test/cb#access_token=${REDACTED}&state=1`,
    );
    expect(redactUrl("https://a.test/cb#?access_token=abc")).toBe(
      `https://a.test/cb#?access_token=${REDACTED}`,
    );
  });

  it.each([
    "https://user:pw@a.test/p",
    "https://a.test/p?token=abc&x=1",
    "https://a.test/cb#access_token=abc&state=1",
    "https://u:p@a.test/p?token=abc#access_token=b",
  ])("leaves %j parseable after masking", (input) => {
    const output = redactUrl(input);
    expect(() => new URL(output)).not.toThrow();
  });

  it("reparses the masked query and fragment back to the mask", () => {
    const output = new URL(redactUrl("https://a.test/p?token=abc&x=1"));
    expect(output.searchParams.get("token")).toBe(REDACTED);
    expect(output.searchParams.get("x")).toBe("1");
    const fragment = new URL(redactUrl("https://a.test/cb#access_token=abc&state=1"));
    expect(new URLSearchParams(fragment.hash.slice(1)).get("access_token")).toBe(REDACTED);
  });

  it("writes a URL-safe custom mask literally too", () => {
    const mask = "__hidden__";
    expect(redactUrl("https://user:pw@a.test/p?token=abc", { mask })).toBe(
      `https://${mask}:${mask}@a.test/p?token=${mask}`,
    );
    expect(redactUrl("#access_token=a", { mask })).toBe(`#access_token=${mask}`);
    // The unparseable-URL fallback agrees with the parsed path.
    expect(redactUrl("::::?api_key=abc&ok=1", { mask })).toBe(`::::?api_key=${mask}&ok=1`);
  });

  // A mask carrying a URL delimiter must stay percent-encoded, or it would
  // change what the URL means.
  it("percent-encodes a mask that would break the URL", () => {
    expect(redactUrl("https://a.test/p?token=abc&x=1", { mask: "a&b=c" })).toBe(
      `https://a.test/p?token=${encodeURIComponent("a&b=c")}&x=1`,
    );
    expect(redactUrl("https://a.test/p?token=abc", { mask: "100% gone" })).toBe(
      "https://a.test/p?token=100%25+gone",
    );
  });

  // The internal placeholder must not collide with input that happens to look like it.
  it("does not rewrite input that looks like the internal placeholder", () => {
    const input = "https://a.test/p?note=dtb*mask*&more=dtb%2Amask%2A&token=abc";
    const output = redactUrl(input);
    expect(output).toContain("note=dtb*mask*");
    expect(output).toContain("more=dtb*mask*");
    expect(output).toContain(`token=${REDACTED}`);
    expect(new URL(output).searchParams.getAll("note")).toEqual(["dtb*mask*"]);
  });

  it("still returns an unmasked URL byte-for-byte", () => {
    expect(redactUrl("https://a.test/p?note=dtb*mask*")).toBe("https://a.test/p?note=dtb*mask*");
  });

  // The placeholder must be cleared against the normalised serialisation (the
  // parser lowercases the host and strips tabs/newlines/CRs), not the raw
  // argument, or the swap corrupts the host and rewrites unrelated text.
  it.each([
    [
      "a host the parser lowercases into the placeholder",
      "http://DTB*MASK*.test/x?token=s3cr3t",
      "http://dtb*mask*.test/x?token=[redacted]",
    ],
    [
      "a path segment the parser strips a tab out of",
      "https://a.test/dtb*ma\tsk*/x?token=s3cr3t",
      "https://a.test/dtb*mask*/x?token=[redacted]",
    ],
    [
      "an innocent query value the parser strips a newline out of",
      "https://a.test/p?note=dtb*ma\nsk*&token=s3cr3t",
      "https://a.test/p?note=dtb*mask*&token=[redacted]",
    ],
  ])("masks only the sensitive parameter given %s", (_label, input, expected) => {
    const output = redactUrl(input);
    expect(output).toBe(expected);
    expect(output).not.toContain("s3cr3t");
    expect(() => new URL(output)).not.toThrow();
    expect(new URL(output).host).toBe(new URL(input).host);
  });

  // Clearing the placeholder used to append one `*` and re-scan — quadratic
  // in a run of `*`s, 11.5s at 300k of them, synchronously inside `fetch`.
  it("clears the placeholder in one pass over a long run of stars", () => {
    const stars = "*".repeat(300_000);
    const output = redactUrl(`https://a.test/p?n=dtb*mask${stars}&token=1`);
    expect(output).toBe(`https://a.test/p?n=dtb*mask${stars}&token=${REDACTED}`);
  }, 2000);
});

describe("ACRONYM segmentation cost", () => {
  // The old greedy pattern backtracked from every start position on a long
  // uppercase run with no lowercase terminator — 5.6s at 100k `A`s against a
  // 2s timeout; the lookahead form takes under 1ms.
  it("segments a long uppercase run with no lowercase terminator in one pass", () => {
    const key = "A".repeat(100_000);
    expect(isSensitiveKey(key)).toBe(false);
  }, 2000);
});

describe("redactHeaders", () => {
  it("accepts all three fetch header shapes", () => {
    const expected = { authorization: REDACTED, accept: "application/json" };

    expect(
      redactHeaders(new Headers({ Authorization: "Bearer x", Accept: "application/json" })),
    ).toEqual(expected);

    expect(
      redactHeaders([
        ["authorization", "Bearer x"],
        ["accept", "application/json"],
      ]),
    ).toEqual(expected);

    expect(
      redactHeaders([
        ["set-cookie", "a=1"],
        ["set-cookie", "b=2"],
        ["accept", "application/json"],
      ]),
    ).toEqual({ "set-cookie": REDACTED, accept: "application/json" });

    // The array branch must join duplicate keys like the Headers branch does,
    // not overwrite (last value winning).
    expect(
      redactHeaders([
        ["x-trace", "a"],
        ["x-trace", "b"],
      ]),
    ).toEqual({ "x-trace": "a, b" });

    expect(
      redactHeaders({
        authorization: "Bearer x",
        accept: "application/json",
        "set-cookie": ["a=1", "b=2"],
        skipped: undefined,
      }),
    ).toEqual({ ...expected, "set-cookie": REDACTED });
  });
});

describe("a Headers or URL instance nested inside a plain object", () => {
  // A network collector's dump shape: `{ url, headers, body }` where `url`/`headers`
  // are real instances `walk()` meets while recursing, not top-level arguments —
  // they must be masked the same way the top-level helpers mask them.
  it("redacts a nested Headers instance", () => {
    const headers = new Headers({ Authorization: "Bearer x", Accept: "application/json" });
    expect(redact({ headers })).toEqual({
      headers: { authorization: REDACTED, accept: "application/json" },
    });
  });

  it("redacts a nested URL instance", () => {
    const url = new URL("https://a.test/p?token=abc&x=1");
    const result = redact({ url }) as { url: string };
    expect(result.url).not.toContain("abc");
    expect(new URL(result.url).searchParams.get("x")).toBe("1");
  });

  it("honours extraKeys on a nested Headers instance", () => {
    const headers = new Headers({ "x-tenant": "acme", Accept: "application/json" });
    expect(redact({ headers }, { extraKeys: ["tenant"] })).toEqual({
      headers: { "x-tenant": REDACTED, accept: "application/json" },
    });
  });

  it("honours allowKeys on a nested Headers instance", () => {
    // A plain value, not credential-shaped — `redactString` masks a
    // credential-shaped value regardless of `allowKeys`, which names keys, so
    // the value here must not trip that separate rule.
    const headers = new Headers({ "Session-Name": "checkout" });
    expect(redact({ headers }, { allowKeys: ["sessionName"] })).toEqual({
      headers: { "session-name": "checkout" },
    });
  });

  it("honours a custom mask on a nested Headers instance", () => {
    const headers = new Headers({ Authorization: "Bearer x" });
    expect(redact({ headers }, { mask: "***" })).toEqual({
      headers: { authorization: "***" },
    });
  });

  it("honours extraKeys on a nested URL instance's query string", () => {
    const url = new URL("https://a.test/p?tenant=acme&x=1");
    const result = redact({ url }, { extraKeys: ["tenant"] }) as { url: string };
    expect(new URL(result.url).searchParams.get("tenant")).toBe(REDACTED);
    expect(new URL(result.url).searchParams.get("x")).toBe("1");
  });

  it("honours a custom mask on a nested URL instance's query string", () => {
    const url = new URL("https://a.test/p?token=abc");
    const result = redact({ url }, { mask: "hidden" }) as { url: string };
    expect(new URL(result.url).searchParams.get("token")).toBe("hidden");
  });
});

describe("hostile inputs walk() has not yet been asked to survive in this file", () => {
  it("tags a Proxy array whose length getter throws", () => {
    // `Array.isArray` sees through a Proxy to its target, so this still takes
    // the array branch; reading `.length` is what can throw here.
    const hostile = new Proxy([1, 2, 3], {
      get(target, prop, receiver) {
        if (prop === "length") throw new Error("length blew up");
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(redact(hostile)).toBe("[unwalkable]");
  });

  it("tags an object whose own getPrototypeOf call throws, distinct from the instanceof cascade", () => {
    // `instanceof` invokes the same `getPrototypeOf` trap as the explicit
    // `Object.getPrototypeOf(value)` call later in `walk()`, so a trap that
    // always throws would be caught by the instanceof cascade's own try/catch
    // first. Returning null for its six checks (Date, Error, URL, Headers,
    // Map, Set) before throwing isolates the later, standalone call instead;
    // `expect(calls).toBe(7)` pins that count so a changed cascade fails loudly here.
    let calls = 0;
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          calls += 1;
          if (calls <= 6) return null;
          throw new Error("getPrototypeOf blew up, eventually");
        },
      },
    );
    expect(redact({ nested: hostile })).toEqual({ nested: "[unwalkable]" });
    expect(calls).toBe(7);
  });

  it("tags an object whose constructor getter throws instead of propagating it", () => {
    // Reading `.constructor` only happens past the `proto !== Object.prototype`
    // guard, so `class Weird {}` gives it a non-default prototype; the
    // instance's own `constructor` is then overridden with a throwing getter
    // (class syntax itself rejects `get constructor()` on the class).
    class Weird {}
    const hostile = new Weird();
    Object.defineProperty(hostile, "constructor", {
      get() {
        throw new Error("constructor blew up");
      },
    });
    expect(redact({ nested: hostile })).toEqual({ nested: "[object]" });
  });
});

describe("a key called __proto__", () => {
  // A flag literally keyed `__proto__` used to render as "[object Object]" with
  // a spurious "masked" badge: assigning into a plain object during rebuild hit
  // `Object.prototype`'s `__proto__` setter, which silently swallowed the write.
  it("survives the rebuild as data", () => {
    const output = redact({ __proto__: undefined, a: 1 } as object) as Record<string, unknown>;
    // Defined via defineProperty: an object *literal* `__proto__:` sets the
    // prototype rather than creating a key.
    const input: Record<string, unknown> = {};
    Object.defineProperty(input, "__proto__", {
      value: "keep-me",
      writable: true,
      enumerable: true,
      configurable: true,
    });
    input["token"] = "abc";
    const redacted = redact(input) as Record<string, unknown>;

    expect(Object.keys(redacted).sort()).toEqual(["__proto__", "token"]);
    expect(Object.getOwnPropertyDescriptor(redacted, "__proto__")?.value).toBe("keep-me");
    expect(redacted["token"]).toBe(REDACTED);
    // Must not leak a null prototype across the public API.
    expect(Object.getPrototypeOf(redacted)).toBe(Object.prototype);
    expect(output).toBeTypeOf("object");
  });

  it("is masked like any other key when it matches", () => {
    const input: Record<string, unknown> = {};
    Object.defineProperty(input, "__proto__", {
      value: "x",
      writable: true,
      enumerable: true,
      configurable: true,
    });
    const redacted = redact(input, { extraKeys: ["proto"] }) as Record<string, unknown>;
    expect(Object.getOwnPropertyDescriptor(redacted, "__proto__")?.value).toBe(REDACTED);
  });

  it("pollutes nothing on the way through", () => {
    redact(JSON.parse('{"__proto__":{"polluted":true},"a":1}'));
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("survives redactHeaders too", () => {
    const headers: Record<string, string> = {};
    Object.defineProperty(headers, "__proto__", {
      value: "keep-me",
      writable: true,
      enumerable: true,
      configurable: true,
    });
    const redacted = redactHeaders(headers);
    expect(Object.getOwnPropertyDescriptor(redacted, "__proto__")?.value).toBe("keep-me");
    expect(Object.getPrototypeOf(redacted)).toBe(Object.prototype);
  });
});

describe("redactText", () => {
  it.each([
    ["prefix Bearer SECRET suffix", "prefix Bearer [redacted] suffix"],
    ["prefix bAsIc SECRET suffix", "prefix bAsIc [redacted] suffix"],
    ["prefix token SECRET suffix", "prefix token [redacted] suffix"],
    ["prefix Bearer\nSECRET suffix", "prefix Bearer\n[redacted] suffix"],
    ["prefix Bearer\r\nSECRET suffix", "prefix Bearer\r\n[redacted] suffix"],
    ["prefix token Bearer SECRET suffix", "prefix token [redacted] [redacted] suffix"],
    [
      'Bearer A: Digest realm="Bearer A",nonce="SECRET"\nframe',
      "Bearer [redacted] Digest [redacted]",
    ],
    ["Bearer A: Bearer A_LONG_SECRET suffix", "Bearer [redacted] Bearer [redacted] suffix"],
    ["prefix abcdefgh.ijklmnop.qrstuvwx suffix", "prefix [redacted] suffix"],
    ["prefix Bearer abcdefgh.ijklmnop.qrstuvwx suffix", "prefix Bearer [redacted] suffix"],
    [
      "ordinary stack\n    at withBearer_secret (app.js:1:2)",
      "ordinary stack\n    at withBearer_secret (app.js:1:2)",
    ],
    ["digest of a file", "digest of a file"],
    ["", ""],
  ])("masks original-input spans in %j", (input, expected) => {
    expect(redactText(input)).toBe(expected);
  });

  it("does not rescan a credential-shaped replacement", () => {
    expect(redactText("Error: Bearer SECRET", { mask: "Bearer A" })).toBe("Error: Bearer Bearer A");
    expect(redactText("Error: Bearer SECRET", { mask: "$&" })).toBe("Error: Bearer $&");
    expect(redactText("Error: Bearer SECRET", { mask: "" })).toBe("Error: Bearer ");
  });

  it.each(["\\n", "%0A", "\n", "\r\n", "\r", "\u2028", "\u2029"])(
    "keeps Digest continuation parameters masked after %j",
    (separator) => {
      const input = `Digest realm="ordinary${separator}nonce=SECRET"\n    at foo (a.js:1:1)`;
      expect(redactText(input)).toBe("Digest [redacted]");
    },
  );

  it("masks later Digest credentials conservatively with the first suffix", () => {
    expect(redactText('Digest realm="FIRST"\n    at foo\nDigest nonce="SECOND"\n    at bar')).toBe(
      "Digest [redacted]",
    );
  });

  it("pins the cross-line scheme marker displacement while retaining split credential masking", () => {
    expect(redactText("Error: Bearer\n    at LEAK (a.js:1:1)")).toBe(
      "Error: Bearer\n    [redacted] LEAK (a.js:1:1)",
    );
    expect(redactText("Error: Bearer\nLEAK_SECRET_123")).toBe("Error: Bearer\n[redacted]");
  });

  it("honours the value opt-out without changing redact's whole-value semantics", () => {
    const input = "prefix Bearer SECRET";
    expect(redactText(input, { values: false })).toBe(input);
    expect(redact(input)).toBe(input);
    expect(redact({ note: input })).toEqual({ note: input });
    expect(redactText("the token expired")).toBe("the token [redacted]");
    expect(redact("the token expired")).toBe("the token expired");
  });

  // Without a leading lookbehind, `TEXT_URL` was quadratic on a long
  // alphanumeric run (same defect `network.test.ts` pins for `URL_IN_TEXT`).
  it("scans a long alphanumeric run in one pass", () => {
    const blob = "a".repeat(200_000);
    expect(redactText(`${blob} https://api.test/v1?access_token=super-secret`)).toBe(
      `${blob} https://api.test/v1?access_token=${REDACTED}`,
    );
  }, 2000);

  it("stops a URL at trailing punctuation instead of masking the sentence's full stop", () => {
    expect(redactText("see https://api.test/v1?access_token=abc.")).toBe(
      `see https://api.test/v1?access_token=${REDACTED}.`,
    );
    // `]` must not end the match: the credential after it is still masked and
    // the wrapping `)` survives (the URL parser percent-encodes the brackets).
    const wrapped = redactText("(https://api.test/v1?ids[]=1&access_token=abc)");
    expect(wrapped).not.toContain("abc");
    expect(wrapped).toBe(`(https://api.test/v1?ids%5B%5D=1&access_token=${REDACTED})`);
  });
});

it.each([
  "https://SECRET:password@customer.services.internal/path",
  "https://example.com/?token=x&Bearer SECRET",
])("redactText combines URL and credential masks against %s", (url) => {
  expect(redactText(`prefix ${url}`)).not.toContain("SECRET");
});

it("redactText combines a whole relative URL with credential spans", () => {
  expect(redactText("/path?token=x&Bearer SECRET", { url: true })).toBe(REDACTED);
  expect(redactText("/path?token=SECRET&page=2", { url: true })).toBe(
    "/path?token=[redacted]&page=2",
  );
  expect(redactText("https://a.test/?token=SECRET", { values: false })).toBe(
    "https://a.test/?token=[redacted]",
  );
  expect(redactText("https://a.test/?token=SECRET", { mask: "Bearer A" })).toBe(
    "https://a.test/?token=Bearer+A",
  );
});

it.each([
  "https://a.test/?x=1 https://b.test/?token=SECRET",
  "/a b?x=https://b.test/?token=SECRET",
  // A `#` ends the query, so the fragment is not swallowed by the outer parse, and
  // `maskUrl` reads neither userinfo nor the path — a second URL's credentials go
  // unseen even when the whole-value pass did mask something.
  "https://a.test/?token=x #https://SECRET:pw@b.test/",
  "https://a.test/?token=x #https://SECRET:pw@b.test/?x=1",
  "https://a.test/p https://SECRET:pw@b.test/ ?token=x",
  "/a?token=x #https://SECRET:pw@b.test/",
])("redactText scans embedded URLs alongside the whole value: %s", (value) => {
  // Regression: `url: true` used to replace the embedded-URL scan rather than run
  // alongside it, so a value with whitespace parsed as one URL that hid the rest of
  // itself from inspection.
  expect(redactText(value, { url: true })).not.toContain("SECRET");
});

it("redactText keeps the precise rewrite when the whole value is one URL", () => {
  expect(redactText("https://a.test/?token=SECRET", { url: true })).toBe(
    "https://a.test/?token=[redacted]",
  );
  // The outer query swallows the second URL, so masking that value covers both.
  expect(
    redactText("https://a.test/?token=FIRST https://b.test/?token=SECRET", { url: true }),
  ).not.toContain("SECRET");
});

describe("redactProse", () => {
  const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVPmB92K";

  it.each([
    ["failed for https://x/?token=abc", "failed for https://x/?token=[redacted]"],
    ["https://x/?token=abc", "https://x/?token=[redacted]"],
    [
      "callback https://app.test/cb?access_token=hunter2&state=1 rejected",
      "callback https://app.test/cb?access_token=[redacted]&state=1 rejected",
    ],
    // The body runs to whitespace, so a quoted value is masked with its quotes.
    ['failed for https://x/?token="abc" (401)', "failed for https://x/?token=[redacted] (401)"],
    ["Bearer abc", "Bearer [redacted]"],
    [JWT, "[redacted]"],
    [
      "postgres://user:secret@db.test/app failed",
      "postgres://[redacted]:[redacted]@db.test/app failed",
    ],
    [
      "wss://s.test/live?token=abc\nnext line https://y/?sid=1",
      "wss://s.test/live?token=[redacted]\nnext line https://y/?sid=[redacted]",
    ],
    // A run of digits glued to the scheme is prose, not scheme: digits left in place.
    ["code 500https://x/?token=abc", "code 500https://x/?token=[redacted]"],
    ["", ""],
    ["nothing to see", "nothing to see"],
    // Known limits, pinned at today's behaviour so a change is visible.
    [`${JWT}.`, `${JWT}.`],
    ["auth failed: Bearer secret rejected", "auth failed: Bearer secret rejected"],
    ["Authorization: hunter2", "Authorization: hunter2"],
    ["X-Api-Key: sk-test-abc123", "X-Api-Key: sk-test-abc123"],
    ["password: hunter2", "password: hunter2"],
    ['error: {"token":"abc"}', 'error: {"token":"abc"}'],
    [
      'failed "https://x/?ok=1","https://y/?token=abc"',
      'failed "https://x/?ok=1","https://y/?token=abc"',
    ],
    ["see https://x/?token=abchttps://y/?ok=1", "see https://x/?token=[redacted]"],
    // A wrapping bracket glued to the value goes with it; a later one survives, percent-encoded.
    ["see [https://x/?token=abc]", "see [https://x/?token=[redacted]"],
    ["see [https://x/?token=abc&ok=1]", "see [https://x/?token=[redacted]&ok=1%5D"],
  ])("masks %j as %j", (input, expected) => {
    expect(redactProse(input)).toBe(expected);
  });

  it("returns UNREADABLE for a non-string where the type says string", () => {
    expect(UNREADABLE).toBe("[unreadable]");
    for (const value of [undefined, null, 7, { message: "x" }, ["x"], Symbol("s")]) {
      expect(redactProse(value as unknown as string)).toBe(UNREADABLE);
    }
  });

  it("returns UNREADABLE when the options throw while being read", () => {
    const hostile = new Proxy({} as RedactOptions, {
      get() {
        throw new Error("no");
      },
    });
    expect(redactProse("failed for https://x/?token=abc", hostile)).toBe(UNREADABLE);
    expect(() => redactProse("plain", hostile)).not.toThrow();
  });

  it("honours extraKeys, allowKeys, values and a custom mask", () => {
    expect(redactProse("see https://x/?zap=abc", { extraKeys: ["zap"], mask: "***" })).toBe(
      "see https://x/?zap=***",
    );
    expect(redactProse("see https://x/?token=abc", { allowKeys: ["token"] })).toBe(
      "see https://x/?token=abc",
    );
    // `values: false` turns off the anchored shape pass; the URL sweep is key
    // matching and still runs.
    expect(redactProse("Bearer abc", { values: false })).toBe("Bearer abc");
    expect(redactProse("see https://x/?token=abc", { values: false })).toBe(
      "see https://x/?token=[redacted]",
    );
    // A URL-unsafe mask is percent-encoded inside the URL, as `redactUrl` does.
    expect(redactProse("see https://x/?token=abc", { mask: "a b" })).toBe(
      "see https://x/?token=a+b",
    );
  });

  // A lone surrogate as the mask makes `redactUrl()`'s fallback rewrite throw
  // mid-sweep; `redactProse` catches that per match and keeps it as written,
  // same as the shipped `maskUrls` did.
  describe("hands a URL back as written when its own rewrite throws", () => {
    const surrogate = { mask: "\uD800" };

    it.each([
      ["failed http://[?token=secret", "failed http://[?token=secret"],
      ["failed +.-500http://[?token=secret", "failed +.-500http://[?token=secret"],
      // A well-formed URL earlier in the text is still masked — the parser
      // substitutes U+FFFD for the surrogate — so the output is partial.
      [
        "see https://x/?token=abc then 500http://[?token=secret",
        "see https://x/?token=%EF%BF%BD then 500http://[?token=secret",
      ],
    ])("masks %j as %j", (input, expected) => {
      expect(redactProse(input, surrogate)).toBe(expected);
    });

    it("is UNREADABLE when the whole text is that URL, because the anchored pass throws first", () => {
      expect(redactProse("http://[?token=secret", surrogate)).toBe(UNREADABLE);
    });

    it("is only the mask: the same URLs are rewritten with an encodable one", () => {
      expect(redactProse("failed +.-500http://[?token=secret")).toBe(
        `failed +.-500http://[?token=${REDACTED}`,
      );
      expect(redactProse("failed http://[?token=secret", { mask: "***" })).toBe(
        "failed http://[?token=***",
      );
    });
  });

  // The shipped `URL_LIKE` had no lookbehind, so a long run with no `://` was
  // quadratic (10-22s at 200k vs. `PROSE_URL`'s 1-3ms); the quotes and
  // angle-wrapper rows aren't quadratic but pin the sweep's behavior on the
  // two non-letter shapes the fixture would otherwise miss.
  it.each([
    ["letters", "a".repeat(200_000)],
    ["hex", "3f9a2b7c1d".repeat(20_000)],
    ["digit-letter", "1a".repeat(100_000)],
    ["dotted", "a.".repeat(100_000)],
    ["quotes", '"'.repeat(200_000)],
    ["angle wrappers", `see ${"Bearer <a ".repeat(20_000)}>`],
  ])(
    "scans a long %s run in one pass",
    (_, run) => {
      expect(redactProse(`${run} https://api.test/v1?access_token=super-secret`)).toBe(
        `${run} https://api.test/v1?access_token=${REDACTED}`,
      );
    },
    2000,
  );
});
