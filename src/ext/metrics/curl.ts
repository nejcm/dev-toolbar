/**
 * One retained request, rendered as a `curl` line. [dev-toolbar/ext/metrics]
 * Method and URL only, deliberately — no header, body or cookie. The URL is
 * normalised through `URL` before redaction so the line matches what the
 * browser would send; every value is single-quoted for `sh`, and the line
 * carries `--globoff` since the `[redacted]` mask contains glob characters.
 * The WHATWG-vs-curl hostname gap this cannot close is in docs/ext/metrics.md.
 */
import { redactUrl } from "../../runtime";
import type { RedactOptions } from "../../runtime";
import type { NetworkEntryView } from "./types";

// Percent-encodes the space-and-below/DEL characters curl's URL parser
// rejects outright. A no-op for a normalised HTTP(S) URL (`URL` already strips
// them); needed for a non-special scheme, `absolute: false`, or an
// unparseable URL. Runs last, on the redacted string, and can only widen an
// escape, so `[redacted]` survives it byte for byte.
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

// The recorded URL as the browser would have sent it: absolutised against the
// page and run through the same WHATWG parser `fetch()` uses. Fails soft — no
// `location`, an opaque origin, or an unparseable URL leaves the string as
// recorded rather than throwing; `encodeUrlControls()` catches those.
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
   * against `location.href`. Default `true`; `false` keeps the recorded
   * string, at the cost of a line curl may refuse.
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
