/**
 * `redact()` — the one survivor of the dropped §6 access-control model.
 * [dev-toolbar/runtime]
 *
 * Core has no identity, no session and no server, so an authorization check
 * inside it would be theatre. What *is* real is that a diagnostics panel puts
 * URLs, headers and payloads on a screen somebody may screenshot, and a
 * "copy diagnostic data" button puts them on the clipboard. This masks the
 * values that must not travel.
 *
 * It is a hygiene helper, not a security boundary: it matches on key names, so
 * a secret stored under `data` stays visible. Do not send anything anywhere on
 * the strength of having called it.
 */

export const REDACTED = "[redacted]";

/**
 * Matched case-insensitively, ignoring `-`, `_`, `.` and spaces — so `token`
 * covers `Token`, `access_token`, `X-Access-Token` and `accessToken` alike,
 * because matching is by substring on the normalised key.
 */
export const DEFAULT_SENSITIVE_KEYS: readonly string[] = [
  "authorization",
  "auth",
  "bearer",
  "cookie",
  "setcookie",
  "token",
  "apikey",
  "secret",
  "password",
  "passwd",
  "pwd",
  "credential",
  "session",
  "sessionid",
  "sid",
  "csrf",
  "xsrf",
  "signature",
  "privatekey",
  "accesskey",
  "clientsecret",
  "refreshtoken",
  "idtoken",
  "otp",
  "pin",
  "ssn",
  "creditcard",
  "cardnumber",
  "cvv",
];

export interface RedactOptions {
  /** Replaces the default list outright. */
  keys?: readonly string[];
  /** Added to whichever list is in force. The common case. */
  extraKeys?: readonly string[];
  /** Keys that survive even when they match. Wins over the lists above. */
  allowKeys?: readonly string[];
  /** Replacement value. Default `"[redacted]"`. */
  mask?: string;
  /** Objects deeper than this become `"[truncated]"`. Default `8`. */
  maxDepth?: number;
  /** Arrays longer than this are cut short. Default `200`. */
  maxArrayLength?: number;
  /**
   * Also mask string *values* that look like credentials regardless of their
   * key: `Bearer …` / `Basic …` scheme headers, bare JWTs, and absolute
   * `http(s)` URLs carrying a sensitive query or fragment parameter — the
   * OAuth-callback shape, where the secret hides in the value and no amount of
   * key matching will find it. Default `true`.
   *
   * A URL value that has nothing to mask is returned byte-for-byte unchanged;
   * only one that was actually masked comes back rewritten.
   */
  values?: boolean;
}

const normalise = (key: string): string => key.toLowerCase().replace(/[-_.\s]/g, "");

interface ResolvedOptions {
  keys: string[];
  allow: string[];
  mask: string;
  maxDepth: number;
  maxArrayLength: number;
  values: boolean;
}

function resolve(options: RedactOptions | undefined): ResolvedOptions {
  const base = options?.keys ?? DEFAULT_SENSITIVE_KEYS;
  return {
    keys: [...base, ...(options?.extraKeys ?? [])].map(normalise),
    allow: (options?.allowKeys ?? []).map(normalise),
    mask: options?.mask ?? REDACTED,
    maxDepth: options?.maxDepth ?? 8,
    maxArrayLength: options?.maxArrayLength ?? 200,
    values: options?.values ?? true,
  };
}

/** True when a key name should have its value masked. Exported for reuse. */
export function isSensitiveKey(key: string, options?: RedactOptions): boolean {
  const resolved = resolve(options);
  return matches(key, resolved);
}

function matches(key: string, resolved: ResolvedOptions): boolean {
  const normalised = normalise(key);
  if (resolved.allow.some((entry) => normalised === entry)) return false;
  return resolved.keys.some((entry) => normalised.includes(entry));
}

// `xxxxx.yyyyy.zzzzz` with base64url segments.
const JWT = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;
const SCHEME = /^(bearer|basic|digest|token)\s+\S+/i;

// Cheap prefix gate before paying for a URL parse.
const ABSOLUTE_URL = /^https?:\/\/\S+$/i;

function redactString(value: string, resolved: ResolvedOptions): string {
  if (!resolved.values) return value;
  if (SCHEME.test(value)) {
    const scheme = value.split(/\s+/, 1)[0] as string;
    return `${scheme} ${resolved.mask}`;
  }
  if (JWT.test(value)) return resolved.mask;
  // A URL is the one string shape that carries credentials in a place key-name
  // matching cannot see: `?access_token=…` sits inside the *value*. Without
  // this, `redact()` is only as safe as every call site remembering to run
  // `redactUrl()` first — and the OAuth-callback shape is exactly what leaks.
  //
  // Only a URL that was actually masked comes back rewritten. `URL.toString()`
  // normalises — it adds a missing path, lowercases the scheme and host, and
  // punycodes an IDN — so returning it unconditionally would quietly rewrite
  // every innocent URL in a diagnostic dump, and anyone diffing two dumps would
  // read those as changes. This is a redactor, not a canonicaliser.
  if (ABSOLUTE_URL.test(value)) {
    const pass = maskUrl(value, resolved);
    return pass.masked ? pass.output : value;
  }
  return value;
}

/**
 * Writes one own data property, by definition rather than by assignment.
 *
 * `output[key] = value` invokes a setter, and `Object.prototype` has one for
 * `__proto__`: assigning there silently *drops* the entry and rebuilds nothing.
 * A key literally called `__proto__` then read back through the prototype and
 * rendered as `"[object Object]"` — with a "masked" badge, because the before
 * and after forms differed. No pollution (the value is a string and the setter
 * ignores it), but a value replaced by a lie is exactly what this module exists
 * to prevent. `/ext/flags` made it observable; `/ext/environment` had it too.
 */
function define(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * Returns a masked deep copy. The input is never mutated. Cycles become
 * `"[circular]"`; class instances, `Map`, `Set`, functions and symbols become
 * a short tag rather than being walked, because a diagnostics dump is not the
 * place to discover a serializer bug.
 */
export function redact<T>(value: T, options?: RedactOptions): unknown {
  return walk(value, resolve(options), 0, new WeakSet<object>());
}

function walk(
  value: unknown,
  resolved: ResolvedOptions,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null || value === undefined) return value;

  const type = typeof value;
  if (type === "string") return redactString(value as string, resolved);
  if (type === "number" || type === "boolean" || type === "bigint") {
    return value;
  }
  if (type === "function") return "[function]";
  if (type === "symbol") return "[symbol]";

  if (depth >= resolved.maxDepth) return "[truncated]";

  const object = value as object;
  if (seen.has(object)) return "[circular]";

  if (Array.isArray(value)) {
    seen.add(object);
    const limit = Math.min(value.length, resolved.maxArrayLength);
    // oxlint-disable-next-line unicorn/no-new-array -- preallocated to `limit`, filled below
    const output: unknown[] = new Array(limit);
    for (let index = 0; index < limit; index += 1) {
      output[index] = walk(value[index], resolved, depth + 1, seen);
    }
    seen.delete(object);
    if (value.length > limit) {
      output.push(`[+${value.length - limit} more]`);
    }
    return output;
  }

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message, resolved) };
  }
  if (value instanceof URL) return redactUrl(value.href, options(resolved));
  if (typeof Headers !== "undefined" && value instanceof Headers) {
    return redactHeaders(value, options(resolved));
  }
  if (value instanceof Map) return "[Map]";
  if (value instanceof Set) return "[Set]";

  const proto = Object.getPrototypeOf(value) as object | null;
  if (proto !== null && proto !== Object.prototype) {
    return `[${(value as { constructor?: { name?: string } }).constructor?.name ?? "object"}]`;
  }

  seen.add(object);
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    define(
      output,
      key,
      matches(key, resolved) ? resolved.mask : walk(entry, resolved, depth + 1, seen),
    );
  }
  seen.delete(object);
  return output;
}

/** Rebuilds a `RedactOptions` from resolved state, for the nested calls above. */
function options(resolved: ResolvedOptions): RedactOptions {
  return {
    keys: resolved.keys,
    allowKeys: resolved.allow,
    mask: resolved.mask,
    maxDepth: resolved.maxDepth,
    maxArrayLength: resolved.maxArrayLength,
    values: resolved.values,
  };
}

interface UrlPass {
  output: string;
  /** False when nothing in the URL matched, i.e. the output is cosmetic only. */
  masked: boolean;
}

/** The origin every relative reference is resolved against, and un-resolved from. */
const BASE = "http://dtb.invalid";

// Leading `/` or `\` — WHATWG treats a backslash as a slash for special schemes,
// so `\\host\x` is a protocol-relative reference too.
const SLASHES = /^[/\\]{1,2}/;

/**
 * How many characters of a resolved serialisation `BASE` contributed in front
 * of a relative reference, so slicing them off restores the form it arrived in.
 *
 * A flat `slice(BASE.length)` is wrong for two of the three relative forms:
 *
 * - A protocol-relative reference resolves to a URL on *another* host, so only
 *   the scheme came from the base. Cutting `BASE.length` characters ate into
 *   the real authority — `//cdn.example.com/lib.js` came back as `.com/lib.js`,
 *   and `/ext/metrics`, which routes every observed request URL through here,
 *   rendered third-party CDN requests as same-origin paths.
 * - A reference with no leading slash at all (`cb?token=1`, `?x=1`, `#top`)
 *   gains the `/` that `BASE`'s empty path normalises to, so the base
 *   contributed one character more than its own length. Slicing only
 *   `BASE.length` rooted a document-relative reference, changing what it means.
 */
function baseContribution(url: string): number {
  const slashes = SLASHES.exec(url)?.[0].length ?? 0;
  if (slashes === 2) return BASE.indexOf("//");
  return slashes === 1 ? BASE.length : BASE.length + 1;
}

/**
 * The actual work behind `redactUrl`, plus the one bit callers inside this
 * module need and callers outside do not: whether anything was masked.
 */
function maskUrl(url: string, resolved: ResolvedOptions): UrlPass {
  let parsed: URL;
  // How many leading characters of the serialisation came from `BASE` rather
  // than from `url`, i.e. how much to slice back off to un-resolve.
  let contributed = 0;
  try {
    parsed = new URL(url);
  } catch {
    try {
      parsed = new URL(url, BASE);
      contributed = baseContribution(url);
    } catch {
      return maskQueryString(url, resolved);
    }
  }

  let masked = false;

  if (parsed.username || parsed.password) {
    if (parsed.username) parsed.username = resolved.mask;
    if (parsed.password) parsed.password = resolved.mask;
    masked = true;
  }

  // Copied: `set` below mutates the params being iterated.
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (matches(key, resolved)) {
      parsed.searchParams.set(key, resolved.mask);
      masked = true;
    }
  }

  if (parsed.hash.includes("=")) {
    const raw = parsed.hash.slice(1);
    const separator = raw.startsWith("?") ? "?" : "";
    const params = new URLSearchParams(separator ? raw.slice(1) : raw);
    let touched = false;
    // Copied: `set` below mutates the params being iterated.
    for (const key of Array.from(params.keys())) {
      if (matches(key, resolved)) {
        params.set(key, resolved.mask);
        touched = true;
      }
    }
    if (touched) {
      parsed.hash = `#${separator}${params.toString()}`;
      masked = true;
    }
  }

  return { output: parsed.toString().slice(contributed), masked };
}

/**
 * Masks credentials in a URL: `user:pass@` userinfo, sensitive query
 * parameters, and sensitive parameters in a `#`-fragment query.
 *
 * Every reference form keeps its shape: an absolute URL stays absolute, a
 * protocol-relative one keeps its `//host`, a root-relative one keeps its
 * single leading `/`, and a document-relative one gains neither.
 *
 * A string with nothing to mask comes back byte-for-byte, the same rule
 * `redact()` applies to a URL-shaped value (see `redactString`) and for the
 * same reason: `URL.toString()` normalises — it adds a missing path, lowercases
 * scheme and host, punycodes an IDN and percent-encodes a path — so returning
 * it unconditionally would rewrite every innocent URL in a diagnostic dump and
 * anyone diffing two dumps would read those as changes. It also matters that
 * "this is a URL" is a claim about the argument, not a fact: a `fetch()` URL is
 * whatever the app passed, so plain text reaches here, and `just some text`
 * came back as `/just%20some%20text`. This is a redactor, not a canonicaliser.
 *
 * Only a masked value is rewritten, and then normalisation is the point. An
 * unparseable string falls back to a query rewrite rather than being skipped.
 */
export function redactUrl(url: string, redactOptions?: RedactOptions): string {
  const pass = maskUrl(url, resolve(redactOptions));
  return pass.masked ? pass.output : url;
}

function maskQueryString(url: string, resolved: ResolvedOptions): UrlPass {
  const index = url.indexOf("?");
  if (index === -1) return { output: url, masked: false };
  const head = url.slice(0, index);
  const query = url.slice(index + 1);
  let masked = false;
  const rewritten = query
    .split("&")
    .map((pair) => {
      const equals = pair.indexOf("=");
      if (equals === -1) return pair;
      const key = pair.slice(0, equals);
      // `decodeURIComponent` throws URIError on a malformed escape ("%zz").
      // This runs synchronously inside a patched `fetch`, so a weird URL must
      // never become an exception in the host app's network layer. Match the
      // raw key instead — worse at unescaping, never worse than throwing.
      let decoded: string;
      try {
        decoded = decodeURIComponent(key);
      } catch {
        decoded = key;
      }
      if (!matches(decoded, resolved)) return pair;
      masked = true;
      return `${key}=${encodeURIComponent(resolved.mask)}`;
    })
    .join("&");
  return { output: `${head}?${rewritten}`, masked };
}

export type HeaderLike =
  | Headers
  | Record<string, string | string[] | undefined>
  | readonly (readonly [string, string])[];

/** Masks a header bag of any of the three shapes `fetch` accepts. */
export function redactHeaders(
  headers: HeaderLike,
  redactOptions?: RedactOptions,
): Record<string, string> {
  const resolved = resolve(redactOptions);
  const output: Record<string, string> = {};

  const put = (key: string, value: string) => {
    // Same reason as `walk`: a header named `__proto__` must survive as data.
    define(output, key, matches(key, resolved) ? resolved.mask : redactString(value, resolved));
  };

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    headers.forEach((value, key) => put(key, value));
    return output;
  }
  if (Array.isArray(headers)) {
    for (const pair of headers as readonly (readonly [string, string])[]) {
      put(pair[0], pair[1]);
    }
    return output;
  }
  for (const [key, value] of Object.entries(
    headers as Record<string, string | string[] | undefined>,
  )) {
    if (value === undefined) continue;
    put(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return output;
}
