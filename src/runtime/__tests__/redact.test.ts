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
    expect(
      redact({ note: `Bearer ${jwt}`, blob: jwt, plain: "hello world" }),
    ).toEqual({ note: `Bearer ${REDACTED}`, blob: REDACTED, plain: "hello world" });

    expect(redact({ blob: jwt }, { values: false })).toEqual({ blob: jwt });
  });

  it("honours extraKeys, allowKeys and a custom mask", () => {
    expect(
      redact(
        { tenant: "acme", session: "s1" },
        { extraKeys: ["tenant"], mask: "***" },
      ),
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
    expect(
      redact(
        { page: "https://app.test/cb?access_token=hunter2" },
        { values: false },
      ),
    ).toEqual({ page: "https://app.test/cb?access_token=hunter2" });
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
    expect(
      redactUrl("https://api.example.com/v1/users?page=2&access_token=abc123"),
    ).toBe(
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
