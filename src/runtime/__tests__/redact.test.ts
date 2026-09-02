import { describe, expect, it } from "vitest";
import {
  DEFAULT_SENSITIVE_KEYS,
  REDACTED,
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
      page: `https://app.test/cb?access_token=${encodeURIComponent(REDACTED)}&state=1`,
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
      page: `https://app.test/?token=${encodeURIComponent(REDACTED)}`,
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

  it("passes primitives straight through", () => {
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(undefined)).toBeUndefined();
    expect(redact("plain")).toBe("plain");
  });

  it("exposes its default key list and a predicate", () => {
    expect(DEFAULT_SENSITIVE_KEYS).toContain("authorization");
    expect(isSensitiveKey("X-CSRF-Token")).toBe(true);
    expect(isSensitiveKey("userId")).toBe(false);
  });
});

describe("redactUrl", () => {
  it("masks sensitive query parameters and keeps the rest", () => {
    expect(redactUrl("https://api.example.com/v1/users?page=2&access_token=abc123")).toBe(
      `https://api.example.com/v1/users?page=2&access_token=${encodeURIComponent(REDACTED)}`,
    );
  });

  it("masks userinfo credentials", () => {
    const output = redactUrl("https://alice:hunter2@example.com/x");
    expect(output).toContain(encodeURIComponent(REDACTED));
    expect(output).not.toContain("hunter2");
    expect(output).not.toContain("alice");
  });

  it("keeps a relative URL relative", () => {
    expect(redactUrl("/api/orders?token=t&limit=10")).toBe(
      `/api/orders?token=${encodeURIComponent(REDACTED)}&limit=10`,
    );
  });

  it("masks fragment parameters, the OAuth implicit-flow shape", () => {
    const output = redactUrl("https://app.test/cb#access_token=abc&state=1");
    expect(output).not.toContain("abc");
    expect(output).toContain("state=1");
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
      `//example.com/a?access_token=${encodeURIComponent(REDACTED)}`,
    );
  });

  it("does not turn a bare string into a rooted, encoded path", () => {
    expect(redactUrl("just some text")).toBe("just some text");
    expect(redactUrl("#top")).toBe("#top");
    expect(redactUrl("cb?x=1")).toBe("cb?x=1");
    expect(redactUrl("cb?token=1")).toBe(`cb?token=${encodeURIComponent(REDACTED)}`);
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
      `https://api.test/v1?page=2&access_token=${encodeURIComponent(REDACTED)}`,
    ],
    ["/api/orders?token=t&limit=10", `/api/orders?token=${encodeURIComponent(REDACTED)}&limit=10`],
    ["//example.com/a?api_key=k", `//example.com/a?api_key=${encodeURIComponent(REDACTED)}`],
    ["cb?token=t", `cb?token=${encodeURIComponent(REDACTED)}`],
    ["?token=t", `?token=${encodeURIComponent(REDACTED)}`],
    ["#access_token=a&state=1", `#access_token=${encodeURIComponent(REDACTED)}&state=1`],
    [
      "https://alice:hunter2@example.com/x",
      `https://${encodeURIComponent(REDACTED)}:${encodeURIComponent(REDACTED)}@example.com/x`,
    ],
    [
      "http://bad host/?%zz=1&api_key=a",
      `http://bad host/?%zz=1&api_key=${encodeURIComponent(REDACTED)}`,
    ],
    // The parser strips leading C0 controls and spaces and removes every tab,
    // newline and carriage return before it looks at the slashes, so the form
    // has to be counted on the same normalised string the parser saw. A raw
    // count read "  //host.test/p" as document-relative and returned the query
    // alone, origin and all.
    ["  //host.test/p?token=1", `//host.test/p?token=${encodeURIComponent(REDACTED)}`],
    ["  /rooted?token=1", `/rooted?token=${encodeURIComponent(REDACTED)}`],
    ["\t/tab?token=1", `/tab?token=${encodeURIComponent(REDACTED)}`],
    ["\n//h.test/x?token=1", `//h.test/x?token=${encodeURIComponent(REDACTED)}`],
  ];

  it.each(MASKED)("keeps the shape of %j while masking it", (input, expected) => {
    expect(redactUrl(input)).toBe(expected);
  });
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
      redactHeaders({
        authorization: "Bearer x",
        accept: "application/json",
        "set-cookie": ["a=1", "b=2"],
        skipped: undefined,
      }),
    ).toEqual({ ...expected, "set-cookie": REDACTED });
  });
});

describe("a key called __proto__", () => {
  // Found through /ext/flags: a flag literally keyed `__proto__` rendered as
  // "[object Object]" for every value, with a spurious "masked" badge. The
  // rebuild assigned into a plain object, and `Object.prototype`'s `__proto__`
  // setter swallows the write. Nothing was polluted; the value was replaced by
  // a lie, which is worse in a redactor than in most places.
  it("survives the rebuild as data", () => {
    const output = redact({ __proto__: undefined, a: 1 } as never) as Record<string, unknown>;
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
