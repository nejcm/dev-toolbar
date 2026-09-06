/**
 * One retained request, rendered as a `curl` line. [dev-toolbar/ext/metrics]
 *
 * **Method and URL only.** No raw header value, no body, no cookies — the
 * collector records a numeric byte count and nothing else of a response, and a
 * curl line that carried more would be a credential
 * buffer with a clipboard attached (`plans/ecosystem-extensions.md` § 1A,
 * explicitly out of scope). What comes out is therefore not a replay of the
 * original request; it is the request's identity, in a form you can paste into
 * a shell, an issue or a message to a colleague.
 *
 * Redaction is applied **again** here, on a URL the collector already masked on
 * the way in. That is deliberate belt-and-braces: this function is exported, so
 * it can be handed a URL that never went through the ring buffer, and the one
 * property it must hold — a curl line cannot show a secret the panel would have
 * hidden — should not depend on its caller. `redactUrl()` masks `user:pass@`
 * userinfo as well as sensitive query and hash parameters, and running it over
 * an already-masked URL is a no-op.
 *
 * Everything interpolated is single-quoted for `sh`, with the one escape a
 * single-quoted shell string allows (`'\\''`). Both the URL and the method are
 * app-controlled strings — `fetch(url, { method })` accepts far more than the
 * eight verbs — so neither is trusted into the line unquoted.
 *
 * Shell quoting is only half of it: curl runs its **own** glob syntax over the
 * URL after the shell is done, so `[`, `]`, `{` and `}` are ranges and sets to
 * it. The redaction mask is `[redacted]`, which makes an unglobbed line
 * `curl: (3) bad range` for exactly the URLs this feature exists to hand over,
 * so every line carries `--globoff`.
 *
 * And curl parses the URL itself, more strictly than a browser does: a raw
 * space or control character anywhere in it is `curl: (3) URL rejected`, while
 * `fetch()` accepts the same string and percent-encodes it. Those characters
 * are therefore encoded before the line is emitted.
 */
import { redactUrl } from "../../runtime";
import type { RedactOptions } from "../../runtime";
import type { NetworkEntryView } from "./types";

/**
 * Percent-encodes the characters curl's URL parser rejects outright: the space
 * and everything below it, plus DEL. A browser accepts them — `new Request(url)`
 * encodes a query space as `%20` — so the collector can retain a URL that curl
 * will not run, and the path that skips `absolute()` (an unparseable string, or
 * no `location` to resolve against) never gets a parser's encoding either.
 *
 * Runs last, on the already-redacted string. It can only widen an escape, never
 * undo one, so a mask survives it byte for byte: `[redacted]` contains none of
 * these characters.
 */
function encodeUrlControls(url: string): string {
  let encoded = "";
  for (const character of url) {
    const code = character.charCodeAt(0);
    encoded +=
      code <= 0x20 || code === 0x7f
        ? `%${code.toString(16).toUpperCase().padStart(2, "0")}`
        : character;
  }
  return encoded;
}

/** POSIX single-quoting: everything is literal inside `'…'` except `'` itself. */
function shellQuote(value: string): string {
  return `'${value.split("'").join(`'\\''`)}'`;
}

/**
 * Absolutises a recorded URL against the page, so a relative path recorded from
 * `fetch("/api/me")` produces a curl line that actually resolves.
 *
 * Failing softly is the point: no `location` (SSR, a worker), an opaque origin,
 * or a URL that will not parse leaves the string exactly as recorded rather
 * than throwing inside a command.
 */
function absolute(url: string): string {
  try {
    // Already absolute: returned untouched rather than re-serialised. A
    // round-trip through `URL` would percent-encode a mask the collector wrote
    // literally (`[redacted]` in userinfo becomes `%5Bredacted%5D`), so the
    // panel's string and the curl line would stop matching character for
    // character for no gain.
    new URL(url);
    return url;
  } catch {
    // Not absolute — or not a URL at all.
  }
  try {
    const base = (globalThis as { location?: { href?: string } }).location?.href;
    if (typeof base !== "string" || base === "") return url;
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

export interface CurlOptions {
  /** The collector's own `redact` options, so the mask matches the panel's. */
  redact?: RedactOptions;
  /**
   * Resolve a relative URL against `location.href`. Default `true`. Turn it off
   * to keep the string exactly as the panel shows it.
   */
  absolute?: boolean;
}

/**
 * `curl --globoff 'https://api.test/v1/me?token=[redacted]'`, or with `-X` for
 * anything that is not a GET.
 */
export function formatCurl(
  request: Pick<NetworkEntryView, "method" | "url">,
  options: CurlOptions = {},
): string {
  const { absolute: resolve = true } = options;
  const url = encodeUrlControls(
    redactUrl(resolve ? absolute(request.url) : request.url, options.redact),
  );
  const method = request.method.toUpperCase();
  const verb = method === "GET" || method === "" ? "" : `-X ${shellQuote(method)} `;
  return `curl --globoff ${verb}${shellQuote(url)}`;
}
