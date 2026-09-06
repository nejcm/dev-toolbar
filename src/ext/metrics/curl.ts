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
 * The line shows the **normalised, redacted** request, not the recorded string
 * byte for byte. `fetch()` accepts a great deal a URL parser tidies up on the
 * way to the wire — a leading space, a tab inside the host or the scheme, a
 * backslash where a `/` belongs — and the collector retains what the app
 * passed, not what the browser sent. curl's URL parser is stricter than a
 * browser's and rejects those outright (`curl: (3) URL rejected`), so the URL
 * is put through `URL` first and the line shows what the browser would
 * actually have requested. Where that differs from the panel's string, the
 * curl line is the one that runs.
 *
 * Normalising **before** redacting is what makes that safe. The mask is
 * written after parsing, so it never round-trips through `URL` and cannot come
 * out as `%5Bredacted%5D`; a mask the collector already wrote is re-masked
 * back to its literal form by the same pass. Redaction is applied here at all
 * — on a URL the collector already masked on the way in — because this
 * function is exported, so the one property it must hold (a curl line cannot
 * show a secret the panel would have hidden) should not depend on its caller.
 * `redactUrl()` masks `user:pass@` userinfo as well as sensitive query and
 * hash parameters.
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
 */
import { redactUrl } from "../../runtime";
import type { RedactOptions } from "../../runtime";
import type { NetworkEntryView } from "./types";

/**
 * Percent-encodes the characters curl's URL parser rejects outright: the space
 * and everything below it, plus DEL.
 *
 * A normalised URL has none of them left — `URL` strips tab, CR and LF, trims
 * leading and trailing C0-or-space, and percent-encodes the rest — so this is
 * for the strings normalisation could not touch: a caller passing
 * `absolute: false`, and a relative or unparseable URL with no `location` to
 * resolve it against. On those, it is the only thing standing between a raw
 * space and `curl: (3) URL rejected`.
 *
 * Runs last, on the already-redacted string. It can only widen an escape,
 * never undo one, so a mask survives it byte for byte: `[redacted]` contains
 * none of these characters.
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
 * The recorded URL as the browser would have sent it: absolutised against the
 * page, and normalised by the same parser `fetch()` puts it through.
 *
 * `new URL()` is the whole primitive. It is the WHATWG parser the platform
 * already applies to a request URL, so it fixes exactly the shapes a browser
 * forgives and curl does not — it removes every tab, CR and LF wherever they
 * sit (including inside the scheme or the host, which no positional-blind
 * escaping could reach), trims leading and trailing C0-or-space, turns a
 * backslash into `/` under a special scheme, and percent-encodes what is left.
 * `new Request(url).url` would give the same string by running the same
 * parser, at the cost of constructing a request object and needing a `fetch`
 * environment; resolving against `location.href` unconditionally would rewrite
 * an absolute URL against the wrong base.
 *
 * Failing softly is the point: no `location` (SSR, a worker), an opaque
 * origin, or a URL that will not parse leaves the string exactly as recorded
 * rather than throwing inside a command. `encodeUrlControls()` catches those.
 */
function normalise(url: string): string {
  try {
    return new URL(url).href;
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
   * Normalise the URL the way the browser does and resolve a relative one
   * against `location.href`. Default `true`. Turn it off to keep the string
   * exactly as the panel shows it — at the cost of a line curl may refuse.
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
  // Normalise, *then* redact: the mask is written by the pass after the
  // parser, so it reaches the line literally rather than percent-encoded.
  const url = encodeUrlControls(
    redactUrl(resolve ? normalise(request.url) : request.url, options.redact),
  );
  const method = request.method.toUpperCase();
  const verb = method === "GET" || method === "" ? "" : `-X ${shellQuote(method)} `;
  return `curl --globoff ${verb}${shellQuote(url)}`;
}
