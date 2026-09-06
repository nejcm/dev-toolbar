/**
 * `formatCurl()` — the one function that turns a retained request into text a
 * developer will paste into a shell. Its whole job is to be boring: method and
 * URL, redacted, quoted.
 */
import { describe, expect, it } from "vitest";
import { REDACTED } from "@nejcm/dev-toolbar/runtime";
import { formatCurl } from "../curl";

const entry = (url: string, method = "GET") => ({ method, url });

describe("formatCurl", () => {
  it("omits -X for a GET and quotes everything it emits", () => {
    expect(formatCurl(entry("https://api.test/v1/me"))).toBe("curl 'https://api.test/v1/me'");
    expect(formatCurl(entry("https://api.test/v1/me", "post"))).toBe(
      "curl -X 'POST' 'https://api.test/v1/me'",
    );
  });

  it("resolves a relative URL against the page, so the line actually runs", () => {
    expect(formatCurl(entry("/api/orders?page=2"))).toBe(
      "curl 'http://localhost:3000/api/orders?page=2'",
    );
    // …and leaves it exactly as the panel shows it when asked not to.
    expect(formatCurl(entry("/api/orders?page=2"), { absolute: false })).toBe(
      "curl '/api/orders?page=2'",
    );
  });

  it("masks userinfo and credential-shaped parameters even on a URL that never met the collector", () => {
    /**
     * The redaction is applied here, not merely inherited: this function is
     * exported, so the property "a curl line cannot show what the panel would
     * hide" must not depend on the caller having redacted first.
     */
    const line = formatCurl(entry("https://alice:s3cret@api.test/v1?access_token=abc&page=2"));
    expect(line).not.toContain("s3cret");
    expect(line).not.toContain("abc");
    expect(line).toContain("page=2");
    expect(line).toContain(REDACTED);
  });

  it("honours the collector's own extra redaction keys", () => {
    const line = formatCurl(entry("https://api.test/v1?tenant=acme"), {
      redact: { extraKeys: ["tenant"] },
    });
    expect(line).toBe(`curl 'https://api.test/v1?tenant=${REDACTED}'`);
  });

  it("escapes a single quote rather than ending the shell string on it", () => {
    // No URL parser will normalise this one, so the raw quote survives as far
    // as the quoting — which is exactly the case the escaping exists for.
    const line = formatCurl(entry("htt p://api.test/'; rm -rf ~ #", "GET"), { absolute: false });
    expect(line).toBe(`curl 'htt p://api.test/'\\''; rm -rf ~ #'`);
    // Every `'` in the output either delimits the argument or is part of the
    // `'\\''` escape, so nothing after it is a shell word.
    expect(line.split(`'\\''`).join("").split("'")).toHaveLength(3);
  });

  it("quotes an app-supplied method too — `fetch` accepts far more than the verbs", () => {
    expect(formatCurl(entry("/x", "GET'; rm -rf ~"), { absolute: false })).toBe(
      `curl -X 'GET'\\''; RM -RF ~' '/x'`,
    );
  });

  it("leaves a URL alone when there is no page to resolve it against", () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, "location");
    Object.defineProperty(globalThis, "location", { value: undefined, configurable: true });
    try {
      expect(formatCurl(entry("/api/orders"))).toBe("curl '/api/orders'");
    } finally {
      if (saved) Object.defineProperty(globalThis, "location", saved);
    }
  });

  it("keeps an already-absolute URL byte-for-byte, mask included", () => {
    // A re-serialisation would percent-encode the literal `[redacted]` the
    // collector wrote into userinfo, and the panel's string and the curl line
    // would stop matching.
    const masked = `https://${REDACTED}:${REDACTED}@api.test/v1`;
    expect(formatCurl(entry(masked))).toBe(`curl '${masked}'`);
  });
});
