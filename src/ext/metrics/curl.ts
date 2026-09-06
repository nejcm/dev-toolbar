/**
 * One retained request, rendered as a `curl` line. [dev-toolbar/ext/metrics]
 *
 * **Method and URL only.** No headers, no body, no cookies — the collector
 * never reads them, and a curl line that carried them would be a credential
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
 */
import { redactUrl } from "../../runtime";
import type { RedactOptions } from "../../runtime";
import type { NetworkEntryView } from "./types";

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
 * `curl 'https://api.test/v1/me?token=[redacted]'`, or with `-X` for anything
 * that is not a GET.
 */
export function formatCurl(
  request: Pick<NetworkEntryView, "method" | "url">,
  options: CurlOptions = {},
): string {
  const { absolute: resolve = true } = options;
  const url = redactUrl(resolve ? absolute(request.url) : request.url, options.redact);
  const method = request.method.toUpperCase();
  const verb = method === "GET" || method === "" ? "" : `-X ${shellQuote(method)} `;
  return `curl ${verb}${shellQuote(url)}`;
}
