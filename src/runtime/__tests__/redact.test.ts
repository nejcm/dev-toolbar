import { describe, expect, expectTypeOf, it } from "vitest";
import {
  DEFAULT_SENSITIVE_KEYS,
  REDACTED,
  type RedactOptions,
  isSensitiveKey,
  redact,
  redactHeaders,
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

  // The old unanchored SCHEME regex matched a credential-shaped prefix inside
  // ordinary prose and replaced the whole string — `token expired…` became
  // `token [redacted]`, and `Bearer abc def` lost its trailing word.
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
    // `redact()` matches key names, and `?access_token=` hides in the *value* —
    // so the OAuth-callback shape leaks unless URLs are parsed too.
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
    // `URL.toString()` rewrites more than it looks: it adds the missing path,
    // lowercases scheme and host, and punycodes an IDN. A redactor that had
    // nothing to redact must not touch the value, or two diagnostic dumps that
    // are identical will not diff as identical.
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
    // `seen` (the cycle guard) is scoped to one path: it is added before
    // recursing into a value and removed after, so a value reachable through
    // several paths is walked once per path, not once overall. A structure
    // where every one of 8 keys at each of 7 levels aliases the *same* child
    // costs 8^7 walks of the innermost object with no bound on the count —
    // only on width (`maxArrayLength`) and depth (`maxDepth`), neither of
    // which this shape exceeds. A `Proxy`'s `ownKeys` trap (which `walk` hits
    // once per object it walks, via `Object.keys`) counts how many times the
    // shared leaf is actually visited.
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

    // The budget is spent well before every path to the leaf is walked: far
    // fewer than the 8^7 = 2_097_152 an unbounded walk would produce.
    expect(leafWalks).toBeLessThan(200);
    expect(JSON.stringify(output)).toContain("[truncated]");

    // The budget is shared by the whole call, not per-branch: once it is
    // spent, a sibling key that has not even been reached yet is truncated
    // too, not just the branch that used up the count.
    const record = output as Record<string, unknown>;
    expect(record["k7"]).toBe("[truncated]");
  });

  it("falls back to the default maxArrayLength instead of throwing when it is NaN", () => {
    // `Math.min(length, NaN)` is `NaN`, and `new Array(NaN)` throws a
    // `RangeError` — straight out of `redact()`, defeating its one
    // guarantee: it does not throw. Before the fix this call threw; after,
    // a malformed bound falls back to the default rather than being read as
    // "unbounded".
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
    // `Array.isArray` throws a `TypeError` on a revoked Proxy — the one read
    // in `walk()` that used to sit above every guard, before the object and
    // array branches even get to decide which one they are.
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
    // Type-level, and it fails on the single `<T>(value: T) => unknown`
    // signature this replaced: `T` appeared only in the parameter, so every
    // caller paid for a return of `unknown` with a cast or a `String()` wrap.
    // The runtime assertions are the same values, so a signature that drifts
    // from the behaviour fails twice.
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
    // An explicit type argument still lands on the catch-all overload, the way
    // it did under the single `<T>(value: T) => unknown` signature. Without a
    // type parameter there, TS matches only the primitive-constrained overload
    // and fails with TS2344 — a break for a caller who spelled the type out.
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
  // Every default entry, spelled the way a real payload spells it, plus the
  // separator and case variants the normaliser is supposed to fold together.
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
    // Plural tolerance: the one inflection the segment rule folds, so
    // `credential` still covers the `credentials` bag every SDK ships.
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
    // A PIN *is* the credential: `pin` matching the `pin` segment of `pinCode`
    // is the rule working, not the over-match `spinner` was.
    "pin",
    "pinCode",
    // Run-together compounds have no boundary to segment on, so they are only
    // matched because the list carries the concatenation itself.
    "accesstoken",
    "authtoken",
    "secretkey",
    // Standard session cookie names, all-caps and unsegmentable, listed for
    // the same reason.
    "JSESSIONID",
    "PHPSESSID",
    // `auth` no longer reaches inside a word, so the spellings it used to cover
    // by substring are entries of their own.
    "Authentication",
    "authorisation",
    "bearer",
    // Named credential fields the substring rule caught inside a longer word
    // and the segment rule releases unless the word itself is listed: Django's
    // CSRF form field, the abbreviated session ids, the TOTP/HOTP spellings of
    // a one-time code, and `xauth` written without its separator.
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

  // Substring matching over the normalised key redacted every one of these:
  // `auth` hit `author`, `pin` hit `shipping` and `spinner`, `sid` hit
  // `inside`, `residual` and `consider`. In a diagnostics dump a masked
  // `author` is a lie by omission, so the matcher reads word segments instead.
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

  // A key name is whatever the consumer called it. `[^a-z\\d]+` as the segment
  // separator treated every non-ASCII letter as punctuation, so `contraseña`
  // segmented to `contrase`/`a` and `пароль` to nothing at all — and an
  // `extraKeys` entry that HEAD matched by substring stopped matching.
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

  // An entry is canonicalised through the same segmenter as the key, so it
  // cannot carry a character no run of segments can hold. Stripping only
  // `-_.` and whitespace left `x/y` unmatchable.
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
  // *whole* canonical key. An entry that would sensitise a key as a substring
  // does not, by itself, exempt a longer key built from it.
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

  // `isSensitiveKey` memoises the resolved form of an options object by its
  // identity (see `resolveCached` in redact.ts), so a caller that hoists its
  // options and reuses the same object gets it resolved once. That means the
  // resolution is a snapshot taken the first time the object is seen: mutating
  // a field on an already-used options object is not picked up by later calls
  // sharing that same object. A fresh object literal per call is unaffected —
  // there is nothing to reuse, so each one resolves independently, correctly.
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

  // The old fragment pass parsed the whole hash as query params, so
  // `/settings?token` was read as one param key and the path was mangled.
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

  // One table, every reference form the callers actually hand over: absolute,
  // the three relative forms, and the strings that are not URLs at all but
  // reach here anyway because a fetch argument is whatever the app passed.
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
    // The parser strips leading C0 controls and spaces and removes every tab,
    // newline and carriage return before it looks at the slashes, so the form
    // has to be counted on the same normalised string the parser saw. A raw
    // count read "  //host.test/p" as document-relative and returned the query
    // alone, origin and all.
    ["  //host.test/p?token=1", `//host.test/p?token=${REDACTED}`],
    ["  /rooted?token=1", `/rooted?token=${REDACTED}`],
    ["\t/tab?token=1", `/tab?token=${REDACTED}`],
    ["\n//h.test/x?token=1", `//h.test/x?token=${REDACTED}`],
  ];

  it.each(MASKED)("keeps the shape of %j while masking it", (input, expected) => {
    expect(redactUrl(input)).toBe(expected);
  });

  // The mask goes into a URL *literally*, in all three positions, so a dump
  // reads `[redacted]` rather than `%5Bredacted%5D` and a consumer can compare
  // against the exported `REDACTED` without re-encoding it first.
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

  // A mask carrying a URL delimiter cannot go in literally without changing
  // what the URL means, so it keeps the percent-encoded treatment.
  it("percent-encodes a mask that would break the URL", () => {
    expect(redactUrl("https://a.test/p?token=abc&x=1", { mask: "a&b=c" })).toBe(
      `https://a.test/p?token=${encodeURIComponent("a&b=c")}&x=1`,
    );
    expect(redactUrl("https://a.test/p?token=abc", { mask: "100% gone" })).toBe(
      "https://a.test/p?token=100%25+gone",
    );
  });

  // The placeholder the mask is carried in must not collide with the input:
  // the substitution is only allowed to rewrite the slots this pass wrote.
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

  // The placeholder has to be cleared against the *normalised* serialisation,
  // not the argument: the parser lowercases the host and strips tabs, newlines
  // and carriage returns before the output is built from it. Cleared against
  // the argument alone, the swap rewrote the host — leaving an unparseable
  // URL — and rewrote ordinary path and query text as if it had matched.
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
    // The host rewrite is what made this unparseable, so parsing is the assertion.
    expect(() => new URL(output)).not.toThrow();
    expect(new URL(output).host).toBe(new URL(input).host);
  });

  // Clearing the placeholder used to append one `*` and re-scan, which is
  // quadratic in the input's own run of `*` — 300 000 of them took 11.5 s,
  // synchronously inside a patched `fetch`. The timeout is the regression
  // guard; the expectations are that the shortcut is still correct.
  it("clears the placeholder in one pass over a long run of stars", () => {
    const stars = "*".repeat(300_000);
    const output = redactUrl(`https://a.test/p?n=dtb*mask${stars}&token=1`);
    expect(output).toBe(`https://a.test/p?n=dtb*mask${stars}&token=${REDACTED}`);
  }, 2000);
});

describe("ACRONYM segmentation cost", () => {
  // The old `(\p{Lu}+)(\p{Lu}\p{Ll})` pattern is pathological on a long
  // uppercase run with no lowercase terminator: greedy `\p{Lu}+` grabs the
  // run, fails, backtracks from every start position (~5.6 s at 100k `A`s
  // against the 2 s timeout; the lookahead form takes under 1 ms).
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

    // The old array branch overwrote duplicate keys, so the last value won
    // (`"b"`) instead of joining like the `Headers` branch (`"a, b"`).
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
  // A network collector's dump shape: `{ url, headers, body }`, where `url` is
  // a real `URL` and `headers` a real `Headers` — not top-level arguments to
  // `redactHeaders`/`redactUrl`, but values `walk()` meets while recursing an
  // object. Both must be masked the same way the top-level helpers mask them,
  // and honour the same options.
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
    // A plain value, not a `Bearer …`/JWT-shaped one — `redactString` masks a
    // credential-*shaped value* regardless of `allowKeys`, which names keys.
    // The point here is the key check alone, so the value must not trip that
    // separate rule.
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
    // the array branch; reading `.length` is the part that can throw on
    // hostile input (a Proxy `get` trap), same family as the index-getter and
    // ownKeys cases above.
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
    // `Object.getPrototypeOf(value)` call further down `walk()`, so a trap
    // that always throws is caught by the earlier instanceof cascade's own
    // try/catch, never reaching the later one. Returning `null` for the
    // handful of calls the cascade makes (satisfying every `instanceof`
    // check as false) before throwing on the next call isolates the later,
    // standalone `Object.getPrototypeOf` site instead. The six calls are the
    // six instanceof checks in that cascade, in order: Date, Error, URL,
    // Headers, Map, Set — the `expect(calls).toBe(7)` below pins that count
    // so a reorder or an added/removed check fails loudly here instead of
    // silently exercising the wrong catch block.
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
    // A real (non-getter) `constructor` property is what puts `value` past the
    // `proto !== Object.prototype` guard in the first place — an object whose
    // own prototype chain ends at `Object.prototype` never reaches the
    // `ctorName` read at all. `class Weird {}` gives it exactly that kind of
    // prototype; overriding the instance's own `constructor` with a throwing
    // getter (class syntax itself rejects `get constructor()`) is what makes
    // reading it throw.
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
  // Found through /ext/flags: a flag literally keyed `__proto__` rendered as
  // "[object Object]" for every value, with a spurious "masked" badge. The
  // rebuild assigned into a plain object, and `Object.prototype`'s `__proto__`
  // setter swallows the write. Nothing was polluted; the value was replaced by
  // a lie, which is worse in a redactor than in most places.
  it("survives the rebuild as data", () => {
    // `as object`, not `as never`: `never` is assignable to `string`, so it
    // picks the string overload and the cast below stops making sense.
    const output = redact({ __proto__: undefined, a: 1 } as object) as Record<string, unknown>;
    // Build the input by definition too — an object *literal* `__proto__:` sets
    // the prototype rather than creating a key.
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
    // Still an ordinary object: the fix must not leak a null prototype across
    // the public API.
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
