/**
 * `formatCurl()` — the one function that turns a retained request into text a
 * developer will paste into a shell. Its whole job is to be boring: method and
 * URL, redacted, quoted.
 */
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { REDACTED } from "@nejcm/dev-toolbar/runtime";
import { formatCurl } from "../curl";

const entry = (url: string, method = "GET") => ({ method, url });

describe("formatCurl", () => {
  it("omits -X for a GET and quotes everything it emits", () => {
    expect(formatCurl(entry("https://api.test/v1/me"))).toBe(
      "curl --globoff 'https://api.test/v1/me'",
    );
    expect(formatCurl(entry("https://api.test/v1/me", "post"))).toBe(
      "curl --globoff -X 'POST' 'https://api.test/v1/me'",
    );
  });

  it("resolves a relative URL against the page, so the line actually runs", () => {
    expect(formatCurl(entry("/api/orders?page=2"))).toBe(
      "curl --globoff 'http://localhost:3000/api/orders?page=2'",
    );
    // …and leaves it exactly as the panel shows it when asked not to.
    expect(formatCurl(entry("/api/orders?page=2"), { absolute: false })).toBe(
      "curl --globoff '/api/orders?page=2'",
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
    expect(line).toBe(`curl --globoff 'https://api.test/v1?tenant=${REDACTED}'`);
  });

  it("escapes a single quote rather than ending the shell string on it", () => {
    // Unparseable, so no URL parser normalises it and the raw quote reaches the
    // quoting — the case the escaping exists for.
    const line = formatCurl(entry("htt p://api.test/'; rm -rf ~ #", "GET"), { absolute: false });
    expect(line).toBe(`curl --globoff 'htt%20p://api.test/'\\'';%20rm%20-rf%20~%20#'`);
    // Every `'` in the output either delimits the argument or is part of the
    // `'\\''` escape, so nothing after it is a shell word.
    expect(line.split(`'\\''`).join("").split("'")).toHaveLength(3);
  });

  it("normalises whitespace and control characters the way the browser does", () => {
    expect(formatCurl(entry("https://api.test/v1?q=a b"))).toBe(
      "curl --globoff 'https://api.test/v1?q=a%20b'",
    );
    // `URL` drops tab, CR and LF outright — that is what the browser sends —
    // and percent-encodes the other controls.
    expect(formatCurl(entry("https://api.test/v1?q=a\tb\nc\v\fd\x7f"))).toBe(
      "curl --globoff 'https://api.test/v1?q=abc%0B%0Cd%7F'",
    );
    // The branches no parser reaches are encoded instead, character by
    // character: an unparseable string, and a caller that opted out.
    expect(formatCurl(entry("not a url"), { absolute: false })).toBe(
      "curl --globoff 'not%20a%20url'",
    );
    expect(formatCurl(entry("https://api.test/v1?q=a\tb"), { absolute: false })).toBe(
      "curl --globoff 'https://api.test/v1?q=a%09b'",
    );
  });

  it("normalises the shapes a browser forgives and curl rejects", () => {
    // Each of these is accepted by `fetch()` and rejected by curl's URL
    // parser, and none can be fixed by escaping a character in place: what is
    // wrong is *where* the character sits.
    for (const recorded of [
      " http://127.0.0.1:1/v1", // leading space
      "http://127.0.0.1:\t1/v1", // tab in the port
      "http://127.0.0.1:1\\v1", // backslash for the path separator
      "http://127.0.0\t.1:1/v1", // tab in the host
      "htt\tp://127.0.0.1:1/v1", // tab in the scheme
    ]) {
      expect(formatCurl(entry(recorded))).toBe("curl --globoff 'http://127.0.0.1:1/v1'");
    }
  });

  it("encodes around the mask rather than through it", () => {
    // Encoding runs after redaction and only widens escapes, so a mask the
    // collector already wrote comes out readable and a secret stays hidden.
    const line = formatCurl(
      entry(`https://${REDACTED}:${REDACTED}@api.test/v1?q=a b&access_token=s3cret`),
    );
    expect(line).toContain(`https://${REDACTED}:${REDACTED}@api.test`);
    // `redactUrl` re-serialises a query it masks, which spells the space `+`.
    expect(line).toContain("q=a+b");
    expect(line).toContain(`access_token=${REDACTED}`);
    expect(line).not.toContain("s3cret");
  });

  it("quotes an app-supplied method too — `fetch` accepts far more than the verbs", () => {
    expect(formatCurl(entry("/x", "GET'; rm -rf ~"), { absolute: false })).toBe(
      `curl --globoff -X 'GET'\\''; RM -RF ~' '/x'`,
    );
  });

  it("leaves a URL alone when there is no page to resolve it against", () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, "location");
    Object.defineProperty(globalThis, "location", { value: undefined, configurable: true });
    try {
      expect(formatCurl(entry("/api/orders"))).toBe("curl --globoff '/api/orders'");
      // …and the string still gets encoded on the way out. Without a base
      // there is no parser to do it, so this branch is the only thing between
      // the raw space and `curl: (3) URL rejected`.
      expect(formatCurl(entry("/api/orders?q=a b"))).toBe("curl --globoff '/api/orders?q=a%20b'");
    } finally {
      if (saved) Object.defineProperty(globalThis, "location", saved);
    }
  });

  it("encodes a URL neither parser will take, rather than emitting it raw", () => {
    // An overflowing port throws in `new URL(url)` *and* in `new URL(url,
    // base)`, so both normalisation attempts fall through and the recorded
    // string reaches the encoder untouched by any parser — the third branch.
    expect(new URL("http://localhost:3000/").href).toBeTruthy(); // a base exists here
    expect(formatCurl(entry("http://ab:99999999/p q"))).toBe(
      "curl --globoff 'http://ab:99999999/p%20q'",
    );
  });

  it("writes the mask after the parser, so it survives normalisation literally", () => {
    // `new URL()` percent-encodes `[redacted]` in userinfo to
    // `%5Bredacted%5D`. Normalising *first* means the mask the line carries is
    // the one `redactUrl()` writes afterwards, over the parsed URL — and a
    // mask the collector had already written comes back re-masked, literal.
    const masked = `https://${REDACTED}:${REDACTED}@api.test/v1`;
    expect(formatCurl(entry(masked))).toBe(`curl --globoff '${masked}'`);
    expect(formatCurl(entry(masked))).not.toContain("%5B");
  });

  it("masks every category it masked before, on the normalised URL", () => {
    // `redactUrl()` now sees a parsed, re-serialised string rather than the
    // recorded one. One case per thing it masks, to prove none of them slipped.
    const userinfo = formatCurl(entry("https://alice:s3cret@api.test/v1"));
    expect(userinfo).toBe(`curl --globoff 'https://${REDACTED}:${REDACTED}@api.test/v1'`);

    const query = formatCurl(entry("https://api.test/v1?access_token=s3cret&page=2"));
    expect(query).toBe(`curl --globoff 'https://api.test/v1?access_token=${REDACTED}&page=2'`);

    const extra = formatCurl(entry("https://api.test/v1?tenant=acme"), {
      redact: { extraKeys: ["tenant"] },
    });
    expect(extra).toBe(`curl --globoff 'https://api.test/v1?tenant=${REDACTED}'`);

    const fragment = formatCurl(entry("https://api.test/v1#id_token=s3cret&view=1"));
    expect(fragment).toBe(`curl --globoff 'https://api.test/v1#id_token=${REDACTED}&view=1'`);

    // …and the same four through a shape only normalisation makes parseable,
    // so the masking is not quietly conditional on a tidy input.
    const awkward = formatCurl(entry(" https://alice:s3cret@api.test:443\\v1?api_key=k\t#otp=9"));
    expect(awkward).toContain(`https://${REDACTED}:${REDACTED}@api.test/v1`);
    expect(awkward).toContain(`api_key=${REDACTED}`);
    expect(awkward).toContain(`otp=${REDACTED}`);
    expect(awkward).not.toContain("s3cret");
    expect(awkward).not.toContain("alice");
  });
});

// A string comparison can't tell a runnable line from a broken one, so these
// hand the line to a shell against a port nothing listens on: exit 7 means
// curl accepted the URL, exit 3 means it rejected it before trying.
const curlAvailable = spawnSync("curl", ["--version"]).status === 0;

describe.skipIf(!curlAvailable)("the line, handed to curl itself", () => {
  const CONNECT_REFUSED = 7;
  const MALFORMED_URL = 3;

  const run = (line: string) =>
    spawnSync("sh", ["-c", `${line} --silent --show-error --max-time 5 --output /dev/null`], {
      encoding: "utf8",
    });

  it("parses a redacted URL, which is the line this feature exists to produce", () => {
    const line = formatCurl(entry("http://127.0.0.1:1/v1?access_token=s3cret"));
    expect(line).toContain(REDACTED);
    const { status, stderr } = run(line);
    expect(stderr).not.toContain("bad range");
    expect(status).toBe(CONNECT_REFUSED);
  });

  it("would fail without --globoff, so the check above is not vacuous", () => {
    const line = formatCurl(entry("http://127.0.0.1:1/v1?access_token=s3cret"));
    const { status, stderr } = run(line.replace("--globoff ", ""));
    expect(stderr).toContain("bad range");
    expect(status).toBe(MALFORMED_URL);
  });

  it("parses brackets and braces the app itself put in the URL", () => {
    const { status } = run(formatCurl(entry("http://127.0.0.1:1/items[1]?tags={a,b}")));
    expect(status).toBe(CONNECT_REFUSED);
  });

  it("parses a quoted method and a quote-carrying query without breaking the line apart", () => {
    const { status } = run(formatCurl(entry("http://127.0.0.1:1/v1?q=%27+whoami+%27", "POST")));
    expect(status).toBe(CONNECT_REFUSED);
  });

  it("parses a URL the app left a raw space in", () => {
    // `fetch("…?q=a b")` is legal and `new Request(url).url` encodes the space,
    // but the collector retains the string the app passed, spaces and all.
    const { status, stderr } = run(formatCurl(entry("http://127.0.0.1:1/v1?q=a b")));
    expect(stderr).not.toContain("URL rejected");
    expect(status).toBe(CONNECT_REFUSED);
  });

  it("parses a URL carrying a raw tab and newline", () => {
    const { status, stderr } = run(formatCurl(entry("http://127.0.0.1:1/v1?a=1\tb\n=2")));
    expect(stderr).not.toContain("URL rejected");
    expect(status).toBe(CONNECT_REFUSED);
  });

  it("would fail unencoded, so the two checks above are not vacuous", () => {
    for (const raw of ["http://127.0.0.1:1/v1?q=a b", "http://127.0.0.1:1/v1?a=1\tb\n=2"]) {
      const { status, stderr } = run(`curl --globoff '${raw}'`);
      expect(stderr).toContain("URL rejected");
      expect(status).toBe(MALFORMED_URL);
    }
  });

  /**
   * The shapes a browser normalises and curl refuses. Escaping in place cannot
   * reach any of them — the character is wrong for its *position*, not wrong
   * everywhere — which is why the URL is parsed before it is redacted.
   */
  const forgivenByTheBrowser = [
    ["a leading space", " http://127.0.0.1:1/v1", "curl --globoff '%20http://127.0.0.1:1/v1'"],
    ["a tab in the port", "http://127.0.0.1:\t1/v1", "curl --globoff 'http://127.0.0.1:%091/v1'"],
    [
      "a backslash path separator",
      "http://127.0.0.1:1\\v1",
      "curl --globoff 'http://127.0.0.1:1\\v1'",
    ],
    [
      "a tab in the hostname",
      "http://127.0.0\t.1:1/v1",
      "curl --globoff 'http://127.0.0%09.1:1/v1'",
    ],
  ] as const;

  it.each(forgivenByTheBrowser)("parses a URL with %s", (_name, recorded, _before) => {
    const line = formatCurl(entry(recorded));
    expect(line).toBe("curl --globoff 'http://127.0.0.1:1/v1'");
    const { status, stderr } = run(line);
    expect(stderr).not.toContain("URL rejected");
    expect(status).toBe(CONNECT_REFUSED);
  });

  it.each(forgivenByTheBrowser)(
    "would fail unnormalised (%s), so the above is not vacuous",
    (_name, recorded, before) => {
      // Exactly what the previous implementation emitted: redact first, then
      // encode in place, with the recorded string otherwise preserved. Pinned
      // byte for byte, so this stays a comparison against the old output
      // rather than against whatever `absolute: false` happens to produce.
      const line = formatCurl(entry(recorded), { absolute: false });
      expect(line).toBe(before);
      const { status, stderr } = run(line);
      expect(stderr).toContain("URL rejected");
      expect(status).toBe(MALFORMED_URL);
    },
  );

  it("parses every control character, in the path, the query and the fragment", () => {
    // 0x01–0x20 plus DEL, in the three positions the app controls. 0x00 is
    // excluded: an argument to `sh -c` cannot carry a NUL, so there is no line
    // to hand over.
    const codes = [...Array.from({ length: 0x20 }, (_, index) => index + 1), 0x7f];
    const rejected: string[] = [];
    for (const code of codes) {
      const raw = String.fromCharCode(code);
      for (const url of [
        `http://127.0.0.1:1/p${raw}q`,
        `http://127.0.0.1:1/v1?q=a${raw}b`,
        `http://127.0.0.1:1/v1#f${raw}g`,
      ]) {
        const line = formatCurl(entry(url));
        if (run(line).status !== CONNECT_REFUSED) rejected.push(line);
      }
    }
    expect(rejected).toEqual([]);
  });

  // Probed, not recalled: every printable ASCII character goes through the
  // platform parser and, if kept verbatim, through curl — pinning the exact
  // WHATWG-vs-curl gap (docs/ext/metrics.md) so either parser changing surfaces here.
  it("rejects exactly the hostname characters WHATWG keeps and curl will not", () => {
    const rejected: string[] = [];
    const reached: string[] = [];
    for (let code = 0x21; code <= 0x7e; code += 1) {
      const character = String.fromCharCode(code);
      const recorded = `http://a${character}b.test:49152/v1`;
      let hostname: string;
      try {
        hostname = new URL(recorded).hostname;
      } catch {
        continue; // The platform rejects it too; never reaches a line.
      }
      // Otherwise the character moved elsewhere in the URL (`#`, `/`, `?`,
      // `@`) and is not a hostname question at all.
      if (hostname !== `a${character}b.test`) continue;
      const { status, stderr } = run(formatCurl(entry(recorded)));
      if (status === MALFORMED_URL) {
        expect(stderr).toContain("Bad hostname");
        rejected.push(character);
      } else reached.push(character);
    }
    expect(rejected.join("")).toBe("!\"$&'()*+,;=`{}");
    // Non-vacuity: most of the swept characters really were handed to curl and
    // got past its URL parser, so the list above is a class and not a wall.
    expect(reached.length).toBeGreaterThan(rejected.length);
  });

  it("could not have encoded its way out of that class, which is why it does not try", () => {
    // curl percent-decodes a host *before* validating it, so escaping the
    // character changes nothing — while `%2E` for `.` does decode through to a
    // connection attempt, which proves the decode step is real and that the
    // rejection above is about the character, not about the escaping.
    expect(run(`curl --globoff 'http://a%21b.test:49152/v1'`).status).toBe(MALFORMED_URL);
    expect(run(`curl --globoff 'http://127%2E0%2E0%2E1:1/v1'`).status).toBe(CONNECT_REFUSED);
  });

  it("runs a line carrying masks, a glob bracket, whitespace and a secret", () => {
    const line = formatCurl(
      entry(`https://${REDACTED}:${REDACTED}@127.0.0.1:1/items[1]?q=a b&access_token=s3cret`),
    );
    expect(line).toContain(`https://${REDACTED}:${REDACTED}@127.0.0.1:1`);
    expect(line).toContain(`access_token=${REDACTED}`);
    expect(line).not.toContain("s3cret");
    expect(line).not.toContain("%5Bredacted%5D");
    const { status, stderr } = run(line);
    expect(stderr).not.toContain("bad range");
    expect(stderr).not.toContain("URL rejected");
    expect(status).toBe(CONNECT_REFUSED);
  });
});
