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

/**
 * The default replacement value, and the one every consumer compares against.
 *
 * It reads the same everywhere, including *inside* a URL: `redactUrl` writes the
 * mask into userinfo, a query parameter and a fragment parameter literally, so a
 * masked URL contains `[redacted]`, not the `%5Bredacted%5D` a percent-encoding
 * serialiser would have produced. See `maskUrl` for how, and
 * `RedactOptions.mask` for the custom masks that cannot be written that way.
 */
export const REDACTED = "[redacted]";

/**
 * Matched case-insensitively against the key's **word segments** — split on
 * separators, case boundaries and letter/digit boundaries (see `isSensitiveKey`
 * for the rule) — so `token` covers `Token`, `access_token`,
 * `X-Access-Token` and `accessToken` alike, and `apikey` covers `apiKey`,
 * `api_key` and `X-Api-Key`, without `auth` also covering `author`.
 *
 * The entries fall into four kinds, and knowing which is which is how to
 * extend the list:
 *
 * - **Whole words** — `authorization`, `bearer`, `cookie`, `token`, `secret`,
 *   `password`, `passwd`, `pwd`, `credential`, `session`, `sid`, `csrf`,
 *   `xsrf`, `signature`, `otp`, `totp`, `hotp`, `pin`, `ssn`, `cvv`, and the
 *   abbreviated `sess`. Each matches that segment of a key, wherever it sits:
 *   `auth` hits `authToken` and `X-Auth-Token`, `pin` hits `pinCode`, `secret`
 *   hits `clientSecret`, `sess` hits `sess_id`.
 * - **Concatenations** — `setcookie`, `apikey`, `sessionid`, `privatekey`,
 *   `accesskey`, `clientsecret`, `refreshtoken`, `idtoken`, `accesstoken`,
 *   `authtoken`, `apitoken`, `apisecret`, `secretkey`, `creditcard`,
 *   `cardnumber`, `sessid`, `xauth`, `csrfmiddlewaretoken` (Django's form
 *   field), plus the two standard all-caps session cookies `jsessionid` and
 *   `phpsessid`. These match a *run* of adjacent segments, which is what
 *   makes `setcookie` cover `set-cookie` and `apikey` cover `x-api-key`. They
 *   also carry the only case segments cannot reach: a run-together key with no
 *   separator and no case boundary (`accesstoken`, `secretkey`, `JSESSIONID`)
 *   has exactly one segment, so it is matched only because the concatenation is
 *   listed here. A compound spelled without separators and *not* listed
 *   (`bearertoken`) is the known gap; add it with `extraKeys`.
 * - **Spelling variants** — `authorisation` and `authentication` sit next to
 *   `authorization` because `auth` no longer reaches inside a word to cover
 *   them, and both name a header that carries a credential.
 * - **Redundant on purpose** — `clientsecret` and `refreshtoken` are already
 *   covered by `secret` and `token`. They stay because they document the shapes
 *   the list is aimed at, and because removing them would silently drop the
 *   run-together spellings above.
 */
export const DEFAULT_SENSITIVE_KEYS: readonly string[] = [
  "authorization",
  "authorisation",
  "authentication",
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
  "jsessionid",
  "phpsessid",
  "sess",
  "sessid",
  "sid",
  "csrf",
  "csrfmiddlewaretoken",
  "xsrf",
  "xauth",
  "signature",
  "privatekey",
  "accesskey",
  "clientsecret",
  "refreshtoken",
  "idtoken",
  "accesstoken",
  "authtoken",
  "apitoken",
  "apisecret",
  "secretkey",
  "otp",
  "totp",
  "hotp",
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
  /**
   * Replacement value. Default `"[redacted]"`.
   *
   * Inside a URL the mask is written literally as long as it is URL-safe —
   * ASCII alphanumerics and the punctuation that cannot change how the result
   * parses (see `URL_SAFE_MASK`), which the default `[redacted]` is. Anything
   * else is percent-encoded in a URL instead: a mask carrying a delimiter
   * (`&`, `=`, `#`, `%`, a space) because writing it literally would rewrite
   * the URL's structure rather than one of its values, and a mask carrying a
   * non-ASCII character (`██`) because `new URL` re-encodes it the moment the
   * result is reparsed, so the literal form would not survive a round trip.
   */
  mask?: string;
  /**
   * Objects deeper than this become `"[truncated]"`. Default `8`. A value
   * that is not a finite non-negative integer (`NaN`, `Infinity`, negative,
   * or fractional) falls back to the default rather than being treated as
   * unbounded — see `sanitizeCount`.
   */
  maxDepth?: number;
  /**
   * Arrays longer than this are cut short. Default `200`. Sanitised the same
   * way as `maxDepth`: a non-finite or negative value falls back to the
   * default.
   */
  maxArrayLength?: number;
  /**
   * Caps the total number of objects, arrays and class-like instances walked
   * across one top-level `redact()` call. Default `50_000`. Sanitised the
   * same way as `maxDepth`: a non-finite or negative value falls back to the
   * default.
   *
   * `maxDepth` and `maxArrayLength` bound how *wide* and how *deep* a single
   * path can be, but neither bounds how many times a **shared** reference is
   * walked: `seen` (the cycle guard) is scoped to the current path, added
   * before recursing and removed after, so a DAG where several keys point at
   * the same child is walked once per path to it, not once per object. A
   * value with `k` keys at every one of `d` levels, all aliasing a single
   * child per level, costs `k^d` walks of that child — at `k=8`, `d=7` this
   * measured 1268 ms and 2,097,152 walks of the shared leaf, entirely within
   * `maxDepth: 8`'s default. `redact({ a: shared, b: shared })` still produces
   * two independent, correctly-redacted copies; this only stops paying for
   * that correctness exponentially many times over on a hostile or just
   * unlucky shape.
   *
   * The remaining budget is shared by the whole call, not per-branch, so once
   * it is spent every node still to be visited — sibling keys included —
   * becomes `"[truncated]"` too: the same tag `maxDepth` and a revoked Proxy
   * already use for "this shape exceeded a bound, and which bound is not the
   * useful part of the answer." A distinct tag would let a caller tell "too
   * deep" apart from "too much," but no caller does that today, and every
   * other bound in this module already collapses into one tag.
   */
  maxNodes?: number;
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

// The boundaries a key name carries besides its separators, each turned into an
// explicit space before the split below. `ACRONYM` runs first so `APIKey`
// breaks as `API`/`Key` rather than `APIKe`/`y`, and the digit pair keeps
// `sha256` and `token2` from welding a number onto a word.
//
// Every class is a Unicode property, not `[A-Za-z]`: a key name is whatever the
// consumer called it, and `contraseña`, `пароль` and `密码` are key names. The
// case classes matter for the scripts that *have* case (`ПарольToken` breaks in
// two), and `NOT_WORD` matters for every script at once — as `[^a-z\d]+` it
// treated `ñ` as a separator and split `contraseña` into `contrase`/`a`.
const ACRONYM = /(\p{Lu}+)(\p{Lu}\p{Ll})/gu;
const CAMEL = /([\p{Ll}\p{N}])(\p{Lu})/gu;
const LETTER_DIGIT = /(\p{L})(\p{N})/gu;
const DIGIT_LETTER = /(\p{N})(\p{L})/gu;
const NOT_WORD = /[^\p{L}\p{N}]+/u;

/**
 * The key's lowercase word segments: `X-Api-Key` and `apiKey` both become
 * `["api", "key"]`, `--sidebar-bg` becomes `["sidebar", "bg"]`, `authorization`
 * and `contraseña` each stay one segment.
 *
 * Empty pieces are dropped, so a leading `--` (a CSS custom property) or a
 * trailing `[0]` contributes nothing, and a key of pure punctuation segments to
 * nothing at all.
 */
function segments(key: string): string[] {
  return key
    .replace(ACRONYM, "$1 $2")
    .replace(CAMEL, "$1 $2")
    .replace(LETTER_DIGIT, "$1 $2")
    .replace(DIGIT_LETTER, "$1 $2")
    .toLowerCase()
    .split(NOT_WORD)
    .filter((segment) => segment.length > 0);
}

/**
 * One canonical form, used for both a *list entry* and an `allowKeys` entry: the
 * key's segments with the boundaries closed up. `X-Custom-Secret`, `x_custom
 * secret` and `xCustomSecret` all canonicalise to `xcustomsecret`.
 *
 * Entries go through the same segmenter as the keys they are matched against,
 * which is the only way an entry can be *reachable*: `matchesAny` compares the
 * entries against a run of segments, and a run can only ever contain characters a
 * segment contains. An entry canonicalised any other way could carry a
 * character no run can hold and so match nothing — which is exactly what
 * `extraKeys: ["x/y"]` did when entries were merely stripped of `-_.` and
 * whitespace.
 */
const canonical = (key: string): string => segments(key).join("");

/**
 * True when any entry names one or more *adjacent whole* segments of the key.
 *
 * The runs are built from every start position, growing one segment at a time,
 * and looked up in the entry set — rather than the set being looped over per
 * run — so the cost is the key's length times the longest entry, and does not
 * grow with the size of the list. A run is abandoned as soon as it is longer
 * than the longest entry can be, which is what keeps a hostile key cheap: at
 * `"a-".repeat(50000)` (50 000 one-character segments) the per-entry loop this
 * replaced took 160 ms, in a module whose whole job is to survive whatever a
 * diagnostics dump hands it.
 *
 * A trailing `s` on the run is tolerated, which is the one inflection the rule
 * folds: `credential` has to cover the `credentials` bag every SDK ships, and
 * `token`/`cookie`/`secret` their plurals. It cannot resurrect the substring
 * over-matches — `auths` is not `author` — because the tolerance is still an
 * equality, not a prefix.
 */
function matchesAny(
  parts: readonly string[],
  entries: ReadonlySet<string>,
  longest: number,
): boolean {
  if (entries.size === 0) return false;
  for (let start = 0; start < parts.length; start += 1) {
    let run = "";
    for (let end = start; end < parts.length; end += 1) {
      run += parts[end] as string;
      if (run.length > longest + 1) break;
      if (entries.has(run)) return true;
      if (run.length > 1 && run.endsWith("s") && entries.has(run.slice(0, -1))) return true;
    }
  }
  return false;
}

interface ResolvedOptions {
  /** Canonicalised, deduplicated; the empty entry a punctuation-only one folds to is dropped. */
  keys: Set<string>;
  /** The longest entry, i.e. how far a run of segments is worth growing. */
  longestKey: number;
  allow: string[];
  mask: string;
  /** Whether `mask` can be written into a URL literally; see `URL_SAFE_MASK`. */
  urlSafeMask: boolean;
  maxDepth: number;
  maxArrayLength: number;
  maxNodes: number;
  values: boolean;
}

/**
 * Coerces a numeric option to a safe non-negative integer, falling back to
 * `fallback` for anything that isn't one: `undefined` (not supplied), `NaN`,
 * `Infinity`, or negative.
 *
 * Without this, `maxArrayLength: NaN` reaches `Math.min(length, NaN)` — which
 * is `NaN` — and then `new Array(NaN)`, which throws a `RangeError` straight
 * out of `redact()`, defeating the one guarantee this module makes: it does
 * not throw. Falling back to the *default* rather than treating a malformed
 * bound as "unbounded" is the safer reading of garbage input — an unbounded
 * node budget is exactly the exponential-walk vulnerability `maxNodes` exists
 * to close, so a bad value must not silently disable it.
 */
function sanitizeCount(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value as number)) : fallback;
}

function resolve(options: RedactOptions | undefined): ResolvedOptions {
  const mask = options?.mask ?? REDACTED;
  const base = options?.keys ?? DEFAULT_SENSITIVE_KEYS;
  const keys = new Set(
    [...base, ...(options?.extraKeys ?? [])].map(canonical).filter((entry) => entry.length > 0),
  );
  let longestKey = 0;
  for (const entry of keys) {
    if (entry.length > longestKey) longestKey = entry.length;
  }
  return {
    keys,
    longestKey,
    allow: (options?.allowKeys ?? []).map(canonical),
    mask,
    urlSafeMask: URL_SAFE_MASK.test(mask),
    maxDepth: sanitizeCount(options?.maxDepth, 8),
    maxArrayLength: sanitizeCount(options?.maxArrayLength, 200),
    maxNodes: sanitizeCount(options?.maxNodes, 50_000),
    values: options?.values ?? true,
  };
}

/** Options-object identity to its resolved form; see `resolveCached`. */
const resolvedCache = new WeakMap<RedactOptions, ResolvedOptions>();
/** The no-options resolution, built lazily on first use; see `resolveCached`. */
let defaultResolved: ResolvedOptions | undefined;

/**
 * Memoised `resolve`. Canonicalising ~44 default entries through the
 * segmenter and building a `Set` is cheap once but not free enough to pay on
 * every `isSensitiveKey` call in a per-header or per-key loop — that call is
 * a public export with no top-level `resolve` above it the way `redact()`
 * and `redactHeaders` have.
 *
 * Two tiers:
 *
 * - **No options** (the common case for a hot loop) resolves once, lazily,
 *   into a module-level constant. That first resolution snapshots
 *   `DEFAULT_SENSITIVE_KEYS` — a JS consumer (nothing in TS can) that reaches
 *   past the `readonly` type and mutates the exported array afterwards is not
 *   observed by later no-options calls; the array is typed `readonly` for
 *   exactly this reason, but it is not frozen, so this is the one guarantee
 *   that actually holds the line.
 * - **An options object** is cached in a `WeakMap` keyed on that object's
 *   identity, not its contents. A caller that builds its options once and
 *   reuses the same object across calls — the pattern this cache is for —
 *   gets it resolved once. A caller that passes a fresh object literal each
 *   call (`isSensitiveKey(k, { extraKeys: [...] })` inline) gets no reuse and
 *   pays full price every time, same as before this cache existed; the
 *   `WeakMap` key is never reachable a second time so nothing leaks either.
 *
 * Reading is snapshot-once, not live: `resolve` is called the first time an
 * options object is seen, so mutating `extraKeys` (or any other field) on an
 * object already cached does not change what later calls with that same
 * object see. `ResolvedOptions` itself is never mutated after `resolve`
 * builds it — every consumer only ever reads its fields — so it's safe to
 * hand the identical cached object back to every caller sharing the same
 * options identity.
 */
function resolveCached(options: RedactOptions | undefined): ResolvedOptions {
  if (options === undefined) {
    defaultResolved ??= resolve(undefined);
    return defaultResolved;
  }
  const cached = resolvedCache.get(options);
  if (cached !== undefined) return cached;
  const resolved = resolve(options);
  resolvedCache.set(options, resolved);
  return resolved;
}

/**
 * True when a key name should have its value masked. Exported for reuse.
 *
 * The rule, in one sentence: **an entry matches when it equals one or more
 * adjacent whole word segments of the key, give or take a trailing `s`.**
 *
 * The key is split into segments on its separators (`-`, `_`, `.`, whitespace
 * and anything else non-alphanumeric) and on its case and letter/digit
 * boundaries, so `X-Auth-Token`, `authToken` and `auth_token` all segment to
 * `["auth", "token"]` and match `auth` and `token`; `x-api-key` segments to
 * `["x", "api", "key"]` and matches the concatenation `apikey` through the
 * adjacent run `api`+`key`. `allowKeys` still wins, and is still an exact match
 * rather than a segment one — against the key's segments closed up, so
 * `allowKeys: ["sessionName"]` exempts `session-name` and `session_name` too.
 *
 * This used to be `normalise(key).includes(entry)`, which over-redacted eight
 * ordinary words for every dump that contained one: `auth` matched `author` and
 * `authorName`, `pin` matched `shipping` and `spinner`, `sid` matched `inside`,
 * `residual` and `consider`. Over-redaction is the safe direction but it is
 * still a lie — a diagnostics dump that renders `{ author: "nejcm" }` as
 * `[redacted]` is hiding data that was never sensitive, and `/ext/theme-editor`
 * had to route its token names *around* this pass to keep `--sidebar-bg` and
 * `--spinner-size` readable at all.
 *
 * The cost is that a compound spelled with no separator and no case boundary
 * has one segment and matches nothing inside it: `accesstoken` is caught only
 * because `DEFAULT_SENSITIVE_KEYS` lists that concatenation. That is a list
 * problem with a list fix (`extraKeys`), not a matcher that guesses.
 */
export function isSensitiveKey(key: string, options?: RedactOptions): boolean {
  const resolved = resolveCached(options);
  return matches(key, resolved);
}

function matches(key: string, resolved: ResolvedOptions): boolean {
  const parts = segments(key);
  if (resolved.allow.length > 0) {
    const joined = parts.join("");
    if (resolved.allow.some((entry) => joined === entry)) return false;
  }
  return matchesAny(parts, resolved.keys, resolved.longestKey);
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
 *
 * The overloads say only what `walk` actually guarantees, which is why there
 * are exactly three of them:
 *
 * - **A string in, a string out.** Masked or not, `redactString` returns a
 *   string on every path. This is the overload that earns its keep: masking a
 *   value before it is joined into a sentence is the module's most common use
 *   (`/ext/diagnostics`, `/ext/metrics`, `/ext/theme-editor` all do it), and
 *   every one of those call sites used to pay for the missing overload with a
 *   `String(…)` wrap or an `as string`.
 * - **A number, boolean, bigint, `null` or `undefined` in, itself out.** These
 *   are returned by identity, so the parameter's own type is the honest return.
 * - **Anything else, `unknown` out.** Not because the type is unknowable but
 *   because it is a union nobody can use: a plain object normally comes back as
 *   `Record<string, unknown>`, yet a cycle, `maxDepth: 0`, a revoked Proxy or a
 *   hostile trap makes it a tag *string*, an array comes back as an array (or a
 *   tag string), and a `Date`, `URL`, `Map`, `Set`, function or class instance
 *   comes back as a string or a different shape entirely. Declaring
 *   `string | Record<string, unknown>` would be true for a statically-plain
 *   object and useless: every caller that indexes the result would have to add
 *   a narrowing branch for a case it deliberately does not handle, and would
 *   write the cast back to silence it. `unknown` says the same thing without
 *   pretending the union buys safety it does not.
 *
 * The catch-all keeps a type parameter it does not use in its return, which is
 * the very thing this signature was fixed for — but as the *last* overload it
 * is the only landing place for an explicit type argument. `redact<Payload>(x)`
 * and `redact<string>(x)` compiled before, and TS only considers overloads
 * whose type-parameter count matches, so without it both fall on the primitive
 * constraint above and fail with TS2344. It costs nothing (the return is
 * already `unknown`) and it keeps a published signature from breaking a caller
 * who spelled the argument type out.
 */
export function redact(value: string, options?: RedactOptions): string;
export function redact<T extends number | boolean | bigint | null | undefined>(
  value: T,
  options?: RedactOptions,
): T;
export function redact<T>(value: T, options?: RedactOptions): unknown;
export function redact(value: unknown, options?: RedactOptions): unknown {
  return walk(value, resolveCached(options), 0, new WeakSet<object>(), { count: 0 });
}

/** Mutable node budget shared across one top-level `redact()` call. */
interface Budget {
  count: number;
}

function walk(
  value: unknown,
  resolved: ResolvedOptions,
  depth: number,
  seen: WeakSet<object>,
  budget: Budget,
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
  // `Array.isArray` throws a `TypeError` on a revoked Proxy — bundled here
  // with the (never-throwing) `seen.has` check next to it so both reads that
  // precede every other guard in this function share one guard of their own.
  let alreadySeen: boolean;
  let isArray: boolean;
  try {
    alreadySeen = seen.has(object);
    isArray = Array.isArray(value);
  } catch {
    return "[unwalkable]";
  }
  if (alreadySeen) return "[circular]";

  // Counted here — after the cycle check (a cycle doesn't recurse, so it
  // doesn't spend budget) and before the array/object split (so both share
  // one pool) — this is what stops a DAG of shared references from being
  // walked once per path to it. See `RedactOptions.maxNodes`.
  if (budget.count >= resolved.maxNodes) return "[truncated]";
  budget.count += 1;

  if (isArray) {
    // `isArray` came from `Array.isArray`, but through a local boolean
    // rather than an inline `if (Array.isArray(value))`, so it no longer
    // narrows `value`'s type here — recover that with one cast.
    const array = value as unknown[];
    seen.add(object);
    // `.length` is an ordinary data property on a real array, but `array` can
    // be a Proxy wrapping one with a throwing `get` trap on "length" — same
    // family of hostile input as everything else this function guards
    // against, so it gets the same treatment rather than an assumption.
    let length: number;
    try {
      length = array.length;
    } catch {
      seen.delete(object);
      return "[unwalkable]";
    }
    const limit = Math.min(length, resolved.maxArrayLength);
    // oxlint-disable-next-line unicorn/no-new-array -- preallocated to `limit`, filled below
    const output: unknown[] = new Array(limit);
    for (let index = 0; index < limit; index += 1) {
      // An index accessor throwing (a getter on a sparse array, or a Proxy
      // `get` trap) must tag just that slot, not lose every element already
      // collected.
      let entry: unknown;
      let threw = false;
      try {
        entry = array[index];
      } catch {
        threw = true;
      }
      output[index] = threw ? "[getter threw]" : walk(entry, resolved, depth + 1, seen, budget);
    }
    seen.delete(object);
    if (length > limit) {
      output.push(`[+${length - limit} more]`);
    }
    return output;
  }

  // `instanceof` is not the plain check it looks like: `OrdinaryHasInstance`
  // walks `value`'s prototype chain via its `[[GetPrototypeOf]]` internal
  // method, so every check below is itself trap-observable on a Proxy with a
  // throwing `getPrototypeOf` trap — the throw happens on the first
  // `instanceof`, long before the explicit `Object.getPrototypeOf` call
  // further down gets a chance to guard anything. One try around the whole
  // cascade, before `seen.add`, so there is nothing to unwind on the early
  // return.
  try {
    if (value instanceof Date) {
      // `toISOString()` throws `RangeError` on an invalid Date (`new
      // Date(NaN)`, `new Date("not a date")`) rather than returning a
      // string — the one case here that can throw on ordinary,
      // non-hostile input rather than a hostile trap.
      return Number.isNaN(value.getTime()) ? "[invalid date]" : value.toISOString();
    }
    if (value instanceof Error) {
      // `name` and `message` are ordinary string properties on a real
      // `Error`, but nothing stops a subclass or a manually constructed
      // object from shadowing either with a throwing getter — this module
      // does not control what reaches it, only that reading it must not
      // propagate.
      let name: string;
      try {
        name = value.name;
      } catch {
        name = "[getter threw]";
      }
      let message: string;
      try {
        message = redactString(value.message, resolved);
      } catch {
        message = "[getter threw]";
      }
      return { name, message };
    }
    if (value instanceof URL) return redactUrlResolved(value.href, resolved);
    if (typeof Headers !== "undefined" && value instanceof Headers) {
      return redactHeadersResolved(value, resolved);
    }
    if (value instanceof Map) return "[Map]";
    if (value instanceof Set) return "[Set]";
  } catch {
    return "[unwalkable]";
  }

  let proto: object | null;
  try {
    proto = Object.getPrototypeOf(value) as object | null;
  } catch {
    return "[unwalkable]";
  }
  if (proto !== null && proto !== Object.prototype) {
    let ctorName: string | undefined;
    try {
      ctorName = (value as { constructor?: { name?: string } }).constructor?.name;
    } catch {
      ctorName = undefined;
    }
    return `[${ctorName ?? "object"}]`;
  }

  seen.add(object);
  const output: Record<string, unknown> = {};
  // Enumerating and reading are two separate steps, deliberately: either can
  // throw on data this module does not control, and a diagnostics dump is not
  // the place to discover a serializer bug (see the module doc comment).
  //
  // `Object.keys` fails the same way `Object.entries` does — both call the
  // object's `[[OwnPropertyKeys]]` internal method, so a Proxy with a
  // throwing `ownKeys` trap throws here regardless of which one is used. That
  // makes the guard free: nothing here walks a nested object without one.
  let keys: string[];
  try {
    keys = Object.keys(value as Record<string, unknown>);
  } catch {
    seen.delete(object);
    return "[unwalkable]";
  }
  for (const key of keys) {
    // Checked before the property is ever read: a masked key is replaced by
    // the mask outright, so a sensitive-named getter is never invoked at
    // all — not read-then-discarded, never called.
    if (matches(key, resolved)) {
      define(output, key, resolved.mask);
      continue;
    }
    // A getter throws when *read*, not when merely named by `Object.keys` —
    // reading has to be its own try/catch so one hostile accessor tags just
    // its own key instead of losing every property gathered so far.
    let entry: unknown;
    let threw = false;
    try {
      entry = (value as Record<string, unknown>)[key];
    } catch {
      threw = true;
    }
    define(output, key, threw ? "[getter threw]" : walk(entry, resolved, depth + 1, seen, budget));
  }
  seen.delete(object);
  return output;
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

// What the parser discards before it reaches the slashes: leading C0 controls
// and spaces, then every tab, newline and carriage return anywhere in the input.
// The control characters are the point here: this is the exact range the URL
// parser strips, so the class has to name it.
// oxlint-disable-next-line eslint/no-control-regex -- see above
const LEADING_JUNK = /^[\u0000-\u0020]+/;
const STRIPPED = /[\t\n\r]/g;

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
 *
 * The count runs over the input normalised the way the parser normalises it:
 * leading C0 controls and spaces are stripped and tabs and newlines removed
 * before the slashes are read, so `"  //host.test/p"` is protocol-relative and
 * a raw count mistook it for document-relative, returning the query alone.
 *
 * Dot segments are the one form not restored: `../x?token=1` resolves to
 * `x?token=…`, because `new URL` collapses `..` and there is nothing left in
 * the serialisation to recover it from. Only a masked value is rewritten at
 * all, so an untouched reference keeps its `../` either way.
 */
function baseContribution(url: string): number {
  const normalised = url.replace(LEADING_JUNK, "").replace(STRIPPED, "");
  const slashes = SLASHES.exec(normalised)?.[0].length ?? 0;
  if (slashes === 2) return BASE.indexOf("//");
  return slashes === 1 ? BASE.length : BASE.length + 1;
}

/**
 * Which masks can be written into a URL literally.
 *
 * ASCII alphanumerics plus the punctuation that is legal unescaped in userinfo,
 * a query and a fragment *at once* and cannot change how the result parses.
 * Deliberately absent: `%` (it would read as the start of an escape), `#`, `?`,
 * `&`, `=`, `/`, `\`, `:`, `@`, `+` (a delimiter, or a space once
 * form-decoded), space and every control character, and everything non-ASCII
 * (which `new URL` re-encodes the moment the result is reparsed, so the literal
 * form would not survive a round trip anyway). Brackets and braces are the
 * point of the exercise: the default `[redacted]` passes.
 *
 * A mask that fails keeps the percent-encoded treatment — for a mask carrying a
 * delimiter that is not a cosmetic difference, it is the difference between
 * masking a value and rewriting the URL's structure.
 */
const URL_SAFE_MASK = /^[A-Za-z0-9\-._~!()*[\]{}]+$/;

/**
 * The placeholder a URL-safe mask travels in, and why one is needed at all.
 *
 * Nothing in this module ever asked for percent-encoding; two different
 * serialisers apply it on their own:
 *
 * - **The query and the fragment** go through `URLSearchParams`, whose
 *   serialiser is `application/x-www-form-urlencoded` — it encodes everything
 *   except ASCII alphanumerics and `*-._`, and writes a space as `+`. That is
 *   *not* the URL query percent-encode set, which does not contain `[` or `]`
 *   at all: `url.search = "?token=[redacted]"` keeps the brackets, and only
 *   `searchParams.set` turns them into `%5B`/`%5D`.
 * - **Userinfo** goes through the `username`/`password` setters, which use the
 *   userinfo percent-encode set — and that one really does contain `[` and `]`,
 *   so no amount of assigning around `URLSearchParams` avoids it there.
 *
 * So the mask is written as a placeholder both serialisers pass through
 * untouched (ASCII letters and `*`), and the placeholder is swapped for the
 * literal mask once, on the finished serialisation. `URLSearchParams` keeps
 * doing the encoding for every *other* part of the query, which is the part
 * that has to stay correct.
 *
 * The swap is only allowed to rewrite the slots this pass wrote, so the
 * placeholder ends in a run of `*` longer than any run in the serialisation it
 * is about to be written into — which is what makes an occurrence of it there
 * impossible rather than merely unlikely. Two runs are measured, and both are
 * needed: the one in the serialisation itself, and the one in its escapes
 * decoded a single level, because `%2A` is a `*` that `URLSearchParams` decodes
 * and re-encodes back to a literal one. Nothing else in the output can hold a
 * character the placeholder is made of: re-serialising only ever *adds* `%XX`
 * escapes and a `+` for a space, and neither is a letter or a `*`.
 *
 * The run is measured against `parsed.href`, **not** the argument. The output
 * is built from `parsed.toString()`, and the parser normalises on the way in:
 * it lowercases the host and strips every tab, newline and carriage return
 * anywhere in the input. So a host of `DTB*MASK*.test`, or a path segment
 * spelled `dtb*ma\tsk*`, is not in the argument in the form it reaches the
 * output in — and a placeholder cleared against the argument alone then
 * matched the *host*, whose rewrite left the output unparseable, and matched
 * ordinary path and query text, which reported as masked something that never
 * matched. `href` is read inside `slot`, which is memoised and first called
 * before this function mutates anything, so what it measures is the fully
 * normalised, still-untouched serialisation.
 */
const PLACEHOLDER_PREFIX = "dtb*mask";

// A single percent-escape, for the one-level decode `looseDecode` performs.
const PERCENT_ESCAPE = /%[0-9a-f]{2}/gi;

/**
 * The input with its percent-escapes decoded one level, character by character
 * and without `decodeURIComponent` — this runs on arbitrary input inside a
 * patched `fetch`, and `decodeURIComponent` throws on a malformed escape and
 * on a valid escape that is not valid UTF-8. Byte-wise is also the right
 * reading here: the question is only which substrings the output could contain.
 */
function looseDecode(url: string): string {
  return url.replace(PERCENT_ESCAPE, (escape) =>
    String.fromCharCode(Number.parseInt(escape.slice(1), 16)),
  );
}

/** The longest run of `*` in `source`; one pass, no allocation. */
function longestStarRun(source: string): number {
  let longest = 0;
  let run = 0;
  for (let index = 0; index < source.length; index += 1) {
    // 42 is `*`.
    if (source.charCodeAt(index) === 42) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  return longest;
}

/**
 * A placeholder that cannot occur in `href`; see `PLACEHOLDER_PREFIX`.
 *
 * One pass for the longest `*` run, then one longer than it — rather than
 * appending a `*` and re-scanning until the string no longer occurs, which was
 * quadratic in that run and is reachable from a URL: `?n=dtb*mask` followed by
 * 100 000 `*` took 1.2 s, 300 000 took 11.5 s, synchronously inside a patched
 * `fetch`. The bound this reads is the only thing the loop was ever
 * establishing.
 */
function placeholderFor(href: string): string {
  const longest = Math.max(longestStarRun(href), longestStarRun(looseDecode(href)));
  return PLACEHOLDER_PREFIX + "*".repeat(longest + 1);
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
  // What the mask is written as while the URL is being serialised, computed on
  // the first match so an untouched URL — every URL, in a hot per-request
  // loop — pays nothing for it.
  let placeholder: string | undefined;
  // `parsed.href`, not `url`: the placeholder has to be cleared against the
  // serialisation the output is built from, which the parser has already
  // normalised. See `PLACEHOLDER_PREFIX`.
  const slot = (): string =>
    (placeholder ??= resolved.urlSafeMask ? placeholderFor(parsed.href) : resolved.mask);

  if (parsed.username || parsed.password) {
    if (parsed.username) parsed.username = slot();
    if (parsed.password) parsed.password = slot();
    masked = true;
  }

  // Copied: `set` below mutates the params being iterated.
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (matches(key, resolved)) {
      parsed.searchParams.set(key, slot());
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
        params.set(key, slot());
        touched = true;
      }
    }
    if (touched) {
      parsed.hash = `#${separator}${params.toString()}`;
      masked = true;
    }
  }

  const serialised = parsed.toString().slice(contributed);
  const output =
    placeholder === undefined || placeholder === resolved.mask
      ? serialised
      : serialised.split(placeholder).join(resolved.mask);
  return { output, masked };
}

/**
 * Masks credentials in a URL: `user:pass@` userinfo, sensitive query
 * parameters, and sensitive parameters in a `#`-fragment query.
 *
 * The mask goes in **literally** — `https://[redacted]:[redacted]@a.test/p`,
 * `?token=[redacted]` — so a dump is readable and greppable and a masked URL
 * contains the exported `REDACTED` rather than a percent-encoded spelling of
 * it. The result still parses as a URL. See `PLACEHOLDER` for what forces the
 * encoding and how it is undone, and `URL_SAFE_MASK` for the custom masks that
 * keep the encoded form because they could not go in literally without
 * changing what the URL means.
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
  return redactUrlResolved(url, resolveCached(redactOptions));
}

/** The resolved-options-taking half of `redactUrl`, for callers already holding one. */
function redactUrlResolved(url: string, resolved: ResolvedOptions): string {
  const pass = maskUrl(url, resolved);
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
      // Literal when the mask is URL-safe, matching what the parsed path
      // produces; encoded otherwise, for the same reason it is there.
      return `${key}=${resolved.urlSafeMask ? resolved.mask : encodeURIComponent(resolved.mask)}`;
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
  return redactHeadersResolved(headers, resolveCached(redactOptions));
}

/** The resolved-options-taking half of `redactHeaders`, for callers already holding one. */
function redactHeadersResolved(
  headers: HeaderLike,
  resolved: ResolvedOptions,
): Record<string, string> {
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
