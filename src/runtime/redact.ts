/**
 * `redact()` masks values that must not be screenshotted or copied from a
 * diagnostics panel. Core has no identity, session or server, so it is a
 * hygiene helper, not a security boundary: it matches on key names, so a
 * secret stored under `data` stays visible.
 */

/**
 * The default replacement value. Written literally even inside a URL (a
 * masked URL contains `[redacted]`, not `%5Bredacted%5D`) — see `maskUrl` and
 * `RedactOptions.mask` for the custom masks that can't be written that way.
 */
export const REDACTED = "[redacted]";

/**
 * What `redactProse()` returns when it could not run at all — the input was
 * not a string, or the anchored `redact()` pass over the whole text threw (a
 * caller's `RedactOptions` whose fields throw when read, or a mask that cannot
 * be encoded when the whole text is one URL). This replaces the *whole* text,
 * so nothing that could not be inspected is shown. It is not the only
 * non-input value `redactProse()` returns, and its output is not
 * all-or-nothing: the URL sweep that follows is per-match, and a URL whose own
 * rewrite throws is handed back as written — see `redactProse`.
 */
export const UNREADABLE = "[unreadable]";

/**
 * Matched case-insensitively against the key's **word segments** (split on
 * separators, case and letter/digit boundaries — see `isSensitiveKey`), so
 * `token` covers `Token`, `access_token`, `X-Access-Token`, `accessToken`,
 * and `apikey` covers `apiKey`/`api_key`/`X-Api-Key`, without `auth` also
 * matching `author`.
 *
 * Entries are one of four kinds:
 * - **Whole words** (`authorization`, `bearer`, `cookie`, `token`, `secret`,
 *   `password`, `session`, `sid`, `csrf`, `signature`, `otp`, `pin`, `ssn`,
 *   `cvv`, `sess`, etc.) match that segment wherever it sits, e.g. `auth`
 *   hits `authToken`, `sess` hits `sess_id`.
 * - **Concatenations** (`apikey`, `sessionid`, `accesstoken`,
 *   `csrfmiddlewaretoken`, `jsessionid`, etc.) match a *run* of adjacent
 *   segments — needed for run-together keys with no separator or case
 *   boundary (`accesstoken`, `JSESSIONID`), which have exactly one segment
 *   and match only because the concatenation is listed. A compound not
 *   listed (`bearertoken`) is a gap to fill via `extraKeys`.
 * - **Spelling variants** (`authorisation`, `authentication`) sit next to
 *   `authorization` since `auth` no longer reaches inside a word.
 * - **Redundant on purpose** (`clientsecret`, `refreshtoken` — already
 *   covered by `secret`/`token`) document the shapes the list targets and
 *   preserve the run-together spellings above.
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
  "cvc",
  "jwt",
  "passphrase",
  "passcode",
];

export interface RedactOptions {
  /**
   * Replaces the default list outright. An entry matches one or more
   * *adjacent* whole segments of the key (a run, not the whole key), so
   * `"token"` matches `refreshToken` and `x-auth-token` alike. See
   * `isSensitiveKey` for segmenting; `allowKeys` matches differently.
   */
  keys?: readonly string[];
  /** Added to whichever list is in force. Matched the same way as `keys`. */
  extraKeys?: readonly string[];
  /**
   * Keys that survive even when they match. Wins over the lists above.
   *
   * Metric payloads sometimes carry innocent keys whose segments overlap a
   * sensitive entry (`promptTokens` → `token` via the trailing-`s` fold).
   * Name the exact key here rather than trimming the default list.
   *
   * Unlike `keys`/`extraKeys`, an entry here must match the key's **entire**
   * canonicalised form, not just a run inside it: `allowKeys: ["sessionName"]`
   * exempts `session-name`/`SESSION_NAME` but not `sessionNameV2`, and naming
   * just the triggering segment (`allowKeys: ["session"]`) does not exempt
   * `sessionName` either. The trailing-`s` tolerance `keys`/`extraKeys` get
   * is not extended here: it does not exempt `sessionNames`. Name the exact
   * key shape you mean to exempt.
   */
  allowKeys?: readonly string[];
  /**
   * Replacement value. Default `"[redacted]"`.
   *
   * Written literally into a URL when URL-safe (ASCII alphanumerics plus
   * punctuation that can't change parsing — see `URL_SAFE_MASK`), which the
   * default is. Otherwise percent-encoded: a mask with a delimiter (`&`,
   * `=`, `#`, `%`, space) would rewrite the URL's structure, and a non-ASCII
   * mask (`██`) wouldn't survive `new URL`'s re-encoding on reparse.
   */
  mask?: string;
  /**
   * Objects deeper than this become `"[truncated]"`. Default `8`. A
   * non-finite, negative, or fractional value falls back to the default —
   * see `sanitizeCount`.
   */
  maxDepth?: number;
  /**
   * Arrays longer than this are cut short. Default `200`. Sanitised the
   * same way as `maxDepth`.
   */
  maxArrayLength?: number;
  /**
   * Caps the total number of objects, arrays and class-like instances walked
   * across one top-level `redact()` call. Default `50_000`. Sanitised the
   * same way as `maxDepth`.
   *
   * `maxDepth`/`maxArrayLength` bound width and depth of a single path, but
   * not how many times a **shared** reference is walked: the cycle guard
   * (`seen`) is scoped per-path, so a DAG where several keys alias the same
   * child is walked once per path to it. A value with `k` keys at each of
   * `d` levels all aliasing one child costs `k^d` walks — at `k=8, d=7` that
   * measured 1268 ms and ~2.1M walks, well within `maxDepth: 8`'s default.
   * `maxNodes` caps the shared total instead, without changing correctness
   * (`redact({ a: shared, b: shared })` still produces two independent
   * copies).
   *
   * The budget is shared by the whole call: once spent, every remaining
   * node — sibling keys included — becomes `"[truncated]"` too, the same tag
   * used for exceeding `maxDepth`, since no caller distinguishes the bounds.
   */
  maxNodes?: number;
  /**
   * Also mask string *values* that look like credentials regardless of key:
   * `Bearer …`/`Basic …`/`Digest …` (parameterised `key=` form) scheme headers,
   * bare JWTs, and absolute
   * URLs (`scheme://…` for any registered scheme — `postgres://`,
   * `redis://`, `wss://`, etc.) with a sensitive query/fragment parameter
   * (the OAuth-callback shape, where key matching can't find the secret).
   * Relative references and header values that are not bare absolute URLs
   * are out of scope here — call `redactUrl()` on those. Default `true`.
   *
   * A URL with nothing to mask is returned byte-for-byte unchanged.
   */
  values?: boolean;
}

// Boundaries besides separators, turned into explicit spaces before the split
// below. `ACRONYM` runs first so `APIKey` breaks as `API`/`Key`, not
// `APIKe`/`y`; the digit pairs keep `sha256`/`token2` from welding a number
// onto a word. Unicode properties (not `[A-Za-z]`) so `contraseña`, `пароль`,
// `密码` segment correctly too — `NOT_WORD` as `[^a-z\d]+` used to treat `ñ`
// as a separator and split `contraseña` into `contrase`/`a`.
const ACRONYM = /(\p{Lu})(?=\p{Lu}\p{Ll})/gu;
const CAMEL = /([\p{Ll}\p{N}])(\p{Lu})/gu;
const LETTER_DIGIT = /(\p{L})(\p{N})/gu;
const DIGIT_LETTER = /(\p{N})(\p{L})/gu;
const NOT_WORD = /[^\p{L}\p{N}]+/u;

/**
 * The key's lowercase word segments: `X-Api-Key`/`apiKey` both become
 * `["api", "key"]`, `--sidebar-bg` becomes `["sidebar", "bg"]`. Empty pieces
 * are dropped, so a leading `--` or trailing `[0]` contributes nothing.
 */
function segments(key: string): string[] {
  return key
    .normalize("NFC")
    .replace(ACRONYM, "$1 ")
    .replace(CAMEL, "$1 $2")
    .replace(LETTER_DIGIT, "$1 $2")
    .replace(DIGIT_LETTER, "$1 $2")
    .toLowerCase()
    .split(NOT_WORD)
    .filter((segment) => segment.length > 0);
}

/**
 * One canonical form for a *list entry* and an `allowKeys` entry: the key's
 * segments closed up. `X-Custom-Secret`/`x_custom secret`/`xCustomSecret` all
 * canonicalise to `xcustomsecret`.
 *
 * Entries go through the same segmenter as the keys matched against them —
 * required for reachability, since `matchesAny` compares entries against a
 * run of segments and a run can only contain segment characters. Any other
 * canonicalisation could produce an entry no run can match (as `extraKeys:
 * ["x/y"]` once did when entries were merely stripped of `-_.` and whitespace).
 */
const canonical = (key: string): string => segments(key).join("");

/**
 * True when any entry names one or more *adjacent whole* segments of the key.
 *
 * Runs are built from every start position, growing one segment at a time,
 * and looked up in the entry set rather than looping the set per run, so cost
 * scales with the key's length times the longest entry, not the list size. A
 * run is abandoned once longer than the longest entry, keeping a hostile key
 * cheap (`"a-".repeat(50000)` took 160ms with the old per-entry loop).
 *
 * A trailing `s` is tolerated (`credential`/`token`/`cookie`/`secret` also
 * catch their plurals) but only as an equality, not a prefix — `auths` still
 * isn't `author`.
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
  /** Canonicalised, deduplicated; empty entries (punctuation-only) dropped. */
  keys: Set<string>;
  /** Longest entry length, i.e. how far a run of segments is worth growing. */
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
 * `fallback` for anything that isn't one (`undefined`, `NaN`, `Infinity`,
 * negative). Without this, `maxArrayLength: NaN` reaches `new Array(NaN)`,
 * which throws — defeating the guarantee that `redact()` never throws.
 * Falling back to the default rather than "unbounded" also matters because
 * an unbounded node budget is exactly the exploit `maxNodes` exists to close.
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
 * Memoised `resolve`, since `isSensitiveKey` is a public export that may be
 * called per-header or per-key in a hot loop, unlike `redact()`/`redactHeaders`.
 *
 * Two tiers:
 * - **No options** resolves once lazily into a module-level constant.
 * - **An options object** is cached in a `WeakMap` keyed on identity, not
 *   contents — a caller reusing the same options object gets it resolved
 *   once; a fresh literal each call gets no reuse (same as no cache).
 *
 * Resolution is snapshot-once: mutating fields on an already-cached options
 * object doesn't change what later calls with that object see.
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
 * The rule: **an entry matches when it equals one or more adjacent whole
 * word segments of the key, give or take a trailing `s`.** The key is split
 * on separators and case/letter-digit boundaries, so `X-Auth-Token`,
 * `authToken`, `auth_token` all segment to `["auth", "token"]`; `x-api-key`
 * segments to `["x", "api", "key"]` and matches `apikey` via the adjacent
 * run. `allowKeys` wins and is an exact match against the closed-up segments
 * (not a segment match): see `RedactOptions.allowKeys` for the asymmetry.
 *
 * This used to be `normalise(key).includes(entry)`, which over-redacted
 * ordinary words containing a sensitive substring (`auth` matched `author`,
 * `pin` matched `spinner`, `sid` matched `inside`) — a lie in the other
 * direction, since it hid data that was never sensitive and forced
 * `/ext/theme-editor` to route `--sidebar-bg`/`--spinner-size` around it.
 *
 * Cost: a compound with no separator or case boundary (`accesstoken`) is one
 * segment and matches only because `DEFAULT_SENSITIVE_KEYS` lists that exact
 * concatenation — a list problem with a list fix (`extraKeys`), not a guess.
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
const SCHEME_CREDENTIAL = /^(bearer|basic|token)\s+\S+$/i;
const SCHEME_DIGEST = /^digest\s+[a-z-]+=/i;

const TEXT_SCHEME = /\b(?=(bearer|basic|token)(\s+)(\S+))/gi;
const TEXT_DIGEST = /\bdigest\s+(?=[a-z-]+=)/gi;
const TEXT_JWT =
  /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])/g;
// An absolute-URL substring inside free text (unanchored, unlike `ABSOLUTE_URL`).
// The lookbehind keeps it linear on a long alphanumeric run (a URL glued to a
// preceding letter/digit/`.`/`-`/`+` is the accepted cost); closing delimiters
// `)`/`]` and `.,;:!?` end the match only as its last character, so a wrapped
// URL stops cleanly without truncating `?ids[]=1&token=…` at the first `]`.
// `PROSE_URL` below runs to whitespace instead, for the reason given there.
// Byte-identical to `URL_IN_TEXT` in `ext/metrics/collectors/network.ts`, the
// one URL scanner kept outside `/runtime` (its punctuation tail is tested there,
// the exception Phase 1 allowed for); keep the two in step.
const TEXT_URL = /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'`<>]*[^\s"'`<>)\].,;:!?]/g;

export interface RedactTextOptions extends RedactOptions {
  /** Also treat the entire input as a URL, including relative references. */
  url?: boolean;
}

interface TextMaskSpan {
  start: number;
  end: number;
  replacement: string;
}

/** Masks credential shapes and URLs inside text, merging overlaps before replacing anything. */
export function redactText(text: string, options?: RedactTextOptions): string {
  const resolved = resolveCached(options);
  const spans: TextMaskSpan[] = [];
  if (resolved.values) {
    const schemes = new RegExp(TEXT_SCHEME);
    let match: RegExpExecArray | null;
    while ((match = schemes.exec(text)) !== null) {
      const start = match.index + match[1]!.length + match[2]!.length;
      spans.push({ start, end: start + match[3]!.length, replacement: resolved.mask });
      // A zero-width match leaves overlapping schemes available for the next scan.
      schemes.lastIndex = match.index + 1;
    }
    const digest = new RegExp(TEXT_DIGEST).exec(text);
    // Digest has no reliable end delimiter in prose; discard its entire suffix.
    if (digest !== null) {
      spans.push({
        start: digest.index + digest[0].length,
        end: text.length,
        replacement: resolved.mask,
      });
    }
    for (const jwt of text.matchAll(TEXT_JWT)) {
      spans.push({ start: jwt.index, end: jwt.index + jwt[0].length, replacement: resolved.mask });
    }
  }
  // With `url`, the whole input is tried as one URL — that keeps the precise rewrite
  // (`?token=[redacted]`) where the value really is one URL. The embedded-URL scan
  // runs *as well*, never instead: a value with whitespace parses as one URL that
  // hides the rest of itself from inspection — after a `#` the query has ended, and
  // `maskUrl` reads neither userinfo nor the path, so a second URL's credentials go
  // unseen. Where both find something the merge below collapses them to a plain
  // mask, which is the safe direction; an identical whole-range match is skipped so
  // the single-URL case keeps its rewrite rather than being masked whole.
  let whole = false;
  if (options?.url === true) {
    const pass = maskUrl(text, resolved);
    if (pass.masked) {
      spans.push({ start: 0, end: text.length, replacement: pass.output });
      whole = true;
    }
  }
  for (const url of text.matchAll(TEXT_URL)) {
    const start = url.index;
    const end = start + url[0].length;
    if (whole && start === 0 && end === text.length) continue;
    const pass = maskUrl(url[0], resolved);
    if (pass.masked) spans.push({ start, end, replacement: pass.output });
  }
  if (spans.length === 0) return text;
  spans.sort((a, b) => a.start - b.start);
  const merged: TextMaskSpan[] = [];
  for (const span of spans) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && span.start < previous.end) {
      previous.end = Math.max(previous.end, span.end);
      // Overlapping URL rewrites and token masks cannot safely retain either partial rewrite.
      previous.replacement = resolved.mask;
    } else {
      merged.push(span);
    }
  }
  let out = "";
  let cursor = 0;
  for (const span of merged) {
    out += text.slice(cursor, span.start) + span.replacement;
    cursor = span.end;
  }
  return out + text.slice(cursor);
}

// Cheap prefix gate before paying for a URL parse.
const ABSOLUTE_URL = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+$/;

function redactString(value: string, resolved: ResolvedOptions): string {
  if (!resolved.values) return value;
  if (SCHEME_CREDENTIAL.test(value) || SCHEME_DIGEST.test(value)) {
    const scheme = value.split(/\s+/, 1)[0] as string;
    return `${scheme} ${resolved.mask}`;
  }
  if (JWT.test(value)) return resolved.mask;
  // A URL can carry credentials in the value itself (`?access_token=…`),
  // which key matching alone can't see. Only rewritten if actually masked —
  // `URL.toString()` normalises (missing path, lowercased host, IDN
  // punycoding), and this is a redactor, not a canonicaliser.
  if (ABSOLUTE_URL.test(value)) {
    const pass = maskUrl(value, resolved);
    return pass.masked ? pass.output : value;
  }
  return value;
}

/**
 * Writes one own data property, by definition rather than assignment.
 * `output[key] = value` invokes `Object.prototype`'s `__proto__` setter,
 * which silently drops a key literally named `__proto__` instead of storing
 * it — no pollution, but a value replaced by a lie is what this module exists
 * to prevent (`/ext/flags`, `/ext/environment` made it observable).
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
 * a short tag rather than being walked.
 *
 * Three overloads, matching what `walk` actually guarantees:
 * - **string in, string out** — the common case (`/ext/diagnostics`,
 *   `/ext/metrics`, `/ext/theme-editor` mask a value before using it inline).
 * - **number/boolean/bigint/null/undefined in, itself out** — returned by
 *   identity.
 * - **anything else, `unknown` out** — a plain object is usually
 *   `Record<string, unknown>`, but a cycle/`maxDepth: 0`/hostile Proxy makes
 *   it a tag string instead, and other types come back in varying shapes;
 *   `unknown` avoids claiming a union safety it doesn't have.
 *
 * The unused type parameter on the catch-all overload exists only so
 * `redact<Payload>(x)` still compiles — without a last overload matching an
 * explicit type argument, TS falls through to the primitive-constrained
 * overload and errors (TS2344).
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
  // `Array.isArray` throws on a revoked Proxy; bundled with `seen.has` so
  // both pre-guard reads share one try.
  let alreadySeen: boolean;
  let isArray: boolean;
  try {
    alreadySeen = seen.has(object);
    isArray = Array.isArray(value);
  } catch {
    return "[unwalkable]";
  }
  if (alreadySeen) return "[circular]";

  // Counted after the cycle check (a cycle spends no budget) and before the
  // array/object split (so both share one pool); see `RedactOptions.maxNodes`.
  if (budget.count >= resolved.maxNodes) return "[truncated]";
  budget.count += 1;

  if (isArray) {
    // Local boolean doesn't narrow `value`'s type, so recover it with a cast.
    const array = value as unknown[];
    seen.add(object);
    // `array` can be a Proxy with a throwing `get` trap on "length".
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
      // A throwing index accessor tags just that slot, not the whole array.
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

  // `instanceof` walks the prototype chain via `[[GetPrototypeOf]]`, so it's
  // trap-observable on a Proxy with a throwing `getPrototypeOf` trap — one
  // try around the whole cascade, before `seen.add`.
  try {
    if (value instanceof Date) {
      // `toISOString()` throws `RangeError` on an invalid Date — the one
      // case here that can throw on ordinary input, not just a hostile trap.
      return Number.isNaN(value.getTime()) ? "[invalid date]" : value.toISOString();
    }
    if (value instanceof Error) {
      // A subclass or manually constructed Error can shadow `name`/`message`
      // with a throwing getter. The instance stays in `seen` while those
      // properties are read and walked so `error.message = error` becomes
      // `[circular]`, not a depth blow-up.
      seen.add(object);
      let name: unknown;
      try {
        name = value.name;
      } catch {
        name = "[getter threw]";
      }
      let message: unknown;
      try {
        message = value.message;
      } catch {
        message = "[getter threw]";
      }
      const output = {
        name: typeof name === "string" ? name : walk(name, resolved, depth + 1, seen, budget),
        message:
          typeof message === "string"
            ? redactString(message, resolved)
            : walk(message, resolved, depth + 1, seen, budget),
      };
      seen.delete(object);
      return output;
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
  // Enumerating and reading are separate steps: either can throw on data
  // this module doesn't control. `Object.keys` can throw the same way as a
  // Proxy's `ownKeys` trap.
  let keys: string[];
  try {
    keys = Object.keys(value as Record<string, unknown>);
  } catch {
    seen.delete(object);
    return "[unwalkable]";
  }
  for (const key of keys) {
    // Checked before the property is read: a sensitive-named getter is
    // never invoked at all.
    if (matches(key, resolved)) {
      define(output, key, resolved.mask);
      continue;
    }
    // Its own try/catch so one hostile accessor tags just its own key.
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

// Leading `/` or `\` — WHATWG treats a backslash as a slash for special
// schemes, so `\\host\x` is protocol-relative too.
const SLASHES = /^[/\\]{1,2}/;

// The exact range the URL parser strips before reaching the slashes: leading
// C0 controls/spaces, then every tab/newline/CR anywhere in the input.
// oxlint-disable-next-line eslint/no-control-regex -- see above
const LEADING_JUNK = /^[\u0000-\u0020]+/;
const STRIPPED = /[\t\n\r]/g;

/**
 * How many characters of a resolved serialisation `BASE` contributed in
 * front of a relative reference, so slicing them off restores the original
 * form. A flat `slice(BASE.length)` is wrong for two of the three relative
 * forms:
 * - Protocol-relative resolves onto *another* host, so only the scheme came
 *   from the base — slicing `BASE.length` used to eat into the real
 *   authority (`//cdn.example.com/lib.js` came back as `.com/lib.js`).
 * - A reference with no leading slash (`cb?token=1`, `#top`) gains the `/`
 *   that `BASE`'s empty path normalises to, one character more than
 *   `BASE.length` — slicing only that much rooted a document-relative
 *   reference, changing its meaning.
 *
 * The count runs over input normalised the way the parser normalises it
 * (leading junk stripped, tabs/newlines removed), so e.g. `"  //host.test/p"`
 * is correctly read as protocol-relative.
 *
 * Dot segments aren't restored: `../x?token=1` resolves to `x?token=…`
 * because `new URL` collapses `..` with nothing left to recover it from —
 * harmless since only a masked value is rewritten at all.
 */
function baseContribution(url: string): number {
  const normalised = url.replace(LEADING_JUNK, "").replace(STRIPPED, "");
  const slashes = SLASHES.exec(normalised)?.[0].length ?? 0;
  if (slashes === 2) return BASE.indexOf("//");
  return slashes === 1 ? BASE.length : BASE.length + 1;
}

/**
 * Which masks can be written into a URL literally: ASCII alphanumerics plus
 * punctuation legal unescaped in userinfo, a query and a fragment *at once*,
 * that can't change how the result parses. Deliberately absent: `%`, `#`,
 * `?`, `&`, `=`, `/`, `\`, `:`, `@`, `+` (delimiters, or a space once
 * form-decoded), space, every control character, and non-ASCII (`new URL`
 * re-encodes it on reparse, so it wouldn't survive a round trip). Brackets
 * and braces are the point: the default `[redacted]` passes.
 *
 * A mask that fails keeps percent-encoding — for a mask with a delimiter,
 * that's the difference between masking a value and rewriting the URL.
 */
const URL_SAFE_MASK = /^[A-Za-z0-9\-._~!()*[\]{}]+$/;

/**
 * The placeholder a URL-safe mask travels in. Nothing here ever asks for
 * percent-encoding; two serialisers apply it on their own:
 *
 * - **Query/fragment** go through `URLSearchParams`
 *   (`application/x-www-form-urlencoded`), which encodes everything except
 *   ASCII alphanumerics and `*-._` and writes a space as `+` — not the URL
 *   query percent-encode set, which doesn't contain `[`/`]` at all, so
 *   `url.search = "?token=[redacted]"` keeps the brackets while
 *   `searchParams.set` would turn them into `%5B`/`%5D`.
 * - **Userinfo** goes through the `username`/`password` setters, whose
 *   percent-encode set does contain `[`/`]`, unavoidably.
 *
 * So the mask is written as a placeholder both serialisers pass through
 * untouched (ASCII letters and `*`), then swapped for the literal mask once
 * the serialisation is finished.
 *
 * The placeholder ends in a run of `*` longer than any run already present,
 * so the swap can't touch anything but the slots this pass wrote. Two runs
 * are measured — the serialisation itself, and its escapes decoded one
 * level (since `%2A` round-trips to a literal `*` through `URLSearchParams`)
 * — because re-serialising can only *add* `%XX` escapes or `+`, never a
 * letter or `*`.
 *
 * The run is measured against `parsed.href`, not the argument, since the
 * parser normalises on the way in (lowercases host, strips tabs/newlines) —
 * measuring the raw argument could under-count and let the placeholder
 * collide with normalised output.
 */
const PLACEHOLDER_PREFIX = "dtb*mask";

// A single percent-escape, for the one-level decode `looseDecode` performs.
const PERCENT_ESCAPE = /%[0-9a-f]{2}/gi;

/**
 * The input with its percent-escapes decoded one level, byte-wise rather
 * than via `decodeURIComponent` — which throws on a malformed escape or
 * invalid UTF-8, and this runs on arbitrary input inside a patched `fetch`.
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
 * One pass for the longest `*` run, then use one longer than it — appending
 * `*` and re-scanning until unique was quadratic and reachable from a URL
 * (`?n=dtb*mask` + 300,000 `*` took 11.5s synchronously inside a patched
 * `fetch`).
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
    const question = raw.indexOf("?");
    const prefix = question === -1 ? "" : raw.slice(0, question + 1);
    const query = question === -1 ? raw : raw.slice(question + 1);
    const params = new URLSearchParams(query);
    let touched = false;
    // Copied: `set` below mutates the params being iterated.
    for (const key of Array.from(params.keys())) {
      if (matches(key, resolved)) {
        params.set(key, slot());
        touched = true;
      }
    }
    if (touched) {
      parsed.hash = `#${prefix}${params.toString()}`;
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
 * The mask goes in **literally** (`https://[redacted]:[redacted]@a.test/p`,
 * `?token=[redacted]`) so a dump stays greppable, and the result still
 * parses as a URL. See `URL_SAFE_MASK` for custom masks that must stay
 * percent-encoded instead.
 *
 * Every reference form keeps its shape: absolute stays absolute,
 * protocol-relative keeps `//host`, root-relative keeps its leading `/`.
 *
 * A string with nothing to mask comes back byte-for-byte — same rule as
 * `redact()` for URL-shaped values, since `URL.toString()` normalises
 * (adds a missing path, lowercases scheme/host, punycodes, percent-encodes
 * the path), and returning that unconditionally would silently rewrite
 * every innocent URL in a dump. This is a redactor, not a canonicaliser, and
 * plain text can reach here too (a `fetch()` argument is whatever the app
 * passed) — an unparseable string falls back to a raw query rewrite.
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
    const joined = new Map<string, string[]>();
    for (const pair of headers as readonly (readonly [string, string])[]) {
      const values = joined.get(pair[0]);
      if (values === undefined) joined.set(pair[0], [pair[1]]);
      else values.push(pair[1]);
    }
    for (const [key, values] of joined) {
      put(key, values.join(", "));
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

/*
 * An absolute URL inside free text, for `redactProse`. Semantically the
 * `/[a-z][a-z0-9+.-]*:\/\/\S+/gi` a11y and the console collector shipped, in
 * a form that runs in linear time:
 *
 * - The lookbehind means only the *start* of a run of scheme characters is
 *   tried. Without it, every letter in a 40k-character blob with no `://`
 *   started a scan that ran to the end of the run before failing (quadratic:
 *   224 ms at 40k letters, 5.3 s at 200k). This is the fix `TEXT_URL` already
 *   carries.
 * - Group 1 is the run's leading non-letters, kept *outside* the URL. The
 *   original had no lookbehind, so in `500https://x/?token=abc` it started at
 *   the first letter and masked the URL, leaving `500` alone. A lookbehind on
 *   the whole class would refuse to start there at all and leak the token, so
 *   the prefix is matched and handed back untouched instead. `TEXT_URL` does
 *   not do this and is not a drop-in: its body also stops at a quote, and
 *   `?token="abc"` leaks through it where `\S+` keeps the quote inside the URL.
 *
 * Equivalence: the original's leftmost match at `p` needs a letter at `p` and
 * scheme characters through the `:`; if the character before `p` were a letter
 * the match would have started there instead, so every original match begins
 * at the first letter of a run — which is where group 2 begins, with the
 * identical greedy body following. Both then resume at the same whitespace.
 * The timing regression guard is in `redact.test.ts`.
 */
const PROSE_URL = /(?<![a-z0-9+.-])([0-9+.-]*)([a-z][a-z0-9+.-]*:\/\/\S+)/gi;

/**
 * Masks credentials in free text that is about to leave the page: an error
 * message on its way into a snapshot, a `title` attribute, a status line, or an
 * agent's report. This is the composition `/ext/a11y` and `/ext/diagnostics`'s
 * console collector each built privately, lifted here unchanged:
 *
 * 1. `redact()` on the whole string — the anchored pass, so text that *is* a
 *    credential (`Bearer abc`, a bare JWT, a URL with `?access_token=`) is
 *    masked as a value.
 * 2. Every `scheme://…` run inside the text, taken to the next whitespace, goes
 *    through `redactUrl()` — so `failed for https://x/?token=abc` comes back as
 *    `failed for https://x/?token=[redacted]`, and `?token="abc"` is masked with
 *    its quote still attached.
 *
 * Never throws, and never returns anything but a string. Two failure paths, in
 * the order they can occur:
 *
 * - **The whole text is replaced by `UNREADABLE`** when step 1 cannot run: a
 *   non-string where the type says string, a `RedactOptions` whose fields throw
 *   when read, or a text that *is* one URL whose rewrite throws (below). The
 *   caller stops wrapping.
 * - **A single URL is handed back as written** when its own `redactUrl()` throws
 *   in step 2, and the sweep carries on with the next match — so the output can
 *   be *partially* masked. `redactUrl()` throws only on its fallback path: a
 *   URL the parser rejects (`http://[?token=secret`) is rewritten as a raw query
 *   string, and a mask that `encodeURIComponent()` rejects — a lone surrogate,
 *   `{ mask: "\uD800" }` — throws there even though the options were already
 *   resolved and cached. A well-formed URL earlier in the same text is still
 *   masked (the parser substitutes U+FFFD for the surrogate), the malformed
 *   one survives with its credential. This is the a11y and console
 *   compositions' behaviour, kept byte-for-byte, and it is pinned by the
 *   `redactProse` parity fixtures rather than repaired: a caller who supplies
 *   an unencodable mask has opted out of the URL rewrite for unparseable URLs.
 *
 * This is **defence in depth for outbound error text, not a guarantee**. It
 * masks the shapes above and nothing else; in particular it is *not* the
 * substring scan `redactText()` performs. Known limits, each pinned by a test so
 * a change is visible:
 *
 * - **A credential in prose with no URL or assignment syntax is not masked.**
 *   `auth failed: Bearer secret rejected`, `Authorization: hunter2`,
 *   `X-Api-Key: sk-test-…`, `password: hunter2`, `error: {"token":"abc"}` all
 *   come back unchanged. `redact()` masks `Bearer secret` only as the *whole*
 *   value; mid-sentence it does not. No text-only rule distinguishes a secret
 *   from an identical English word, so this stays a stated limit rather than a
 *   heuristic.
 * - **A JWT glued to punctuation** (`eyJ…eyJ…sig.`) is not a bare JWT and is
 *   not masked.
 * - **Adjacent URLs with no whitespace between them** are one match:
 *   `"https://x/?ok=1","https://y/?token=abc"` is parsed as the first URL, whose
 *   `ok` value happens to contain the second, so `abc` survives. Likewise a
 *   value glued to the next scheme, `?token=abchttps://y/?ok=1`, is one URL
 *   whose `token` value is masked wholesale.
 * - **The body runs to the next whitespace**, so a closing `"`, `]` or `)`
 *   glued to the credential is masked with it, and one after a later parameter
 *   survives, percent-encoded by the parser (`[redacted]&ok=1%5D`). Everything
 *   else about the rewrite is whatever `redactUrl()` does.
 */
export function redactProse(text: string, options?: RedactOptions): string {
  if (typeof text !== "string") return UNREADABLE;
  try {
    return redact(text, options).replace(PROSE_URL, (match, prefix: string, url: string) => {
      try {
        return prefix + redactUrl(url, options);
      } catch {
        return match;
      }
    });
  } catch {
    return UNREADABLE;
  }
}
