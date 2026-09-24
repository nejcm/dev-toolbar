/**
 * A named, validated, persisted preference — the one guarded interface over
 * `api.storage` that every first-party extension reads and writes through.
 * Read returns the fallback when nothing valid is stored; write removes the
 * key instead of storing the fallback, so storage only holds what differs
 * from default.
 *
 * A throwing `getItem` becomes fallback in `readPreference`/`readJson`, or
 * unreadable in `readPreferenceIfReadable`.
 * Write failures are swallowed; no adapter failure escapes into a panel or handler.
 *
 * Encodings: `"string"` stores byte-for-byte so a pre-existing raw value
 * (e.g. a persisted `tab`) still reads back; `"json"` runs it through `JSON`.
 */
import type { ToolbarStorage } from "../core/contract";

/* ------------------------------------------------------------------ */
/* Parsers over a raw string                                            */
/* ------------------------------------------------------------------ */

const emptyRecord = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

/** Null-prototype output keeps persisted `__proto__` as data and makes `in`/lookup consistent on every path. */
export function parseRecord<T>(
  raw: string | null,
  isValue: (value: unknown, name: string) => value is T,
): Record<string, T> {
  if (raw === null) return emptyRecord();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyRecord();
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return emptyRecord();
  }

  const output = emptyRecord<T>();
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (isValue(value, key)) output[key] = value;
  }
  return output;
}

/** Parse a persisted array, keep guarded values, and optionally cap its length. */
export function parseList<T>(
  raw: string | null,
  isValue: (value: unknown) => value is T,
  limit?: number,
): T[] {
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];
  const values = parsed.filter(isValue);
  return limit === undefined ? values : values.slice(0, Math.max(0, Math.trunc(limit)));
}

/* ------------------------------------------------------------------ */
/* The preference                                                       */
/* ------------------------------------------------------------------ */

/** How a preference's value is laid down in storage. */
export type PreferenceEncoding = "string" | "json";

/**
 * A named, validated, persisted preference.
 *
 * `fallback` is both what a read returns when nothing valid is stored and
 * what a write treats as "nothing to store" (removes the key instead).
 * `isValue` vets what comes back out of storage; a failing value reads as the
 * fallback. `encoding: "string"` is only available when `T` is a string (or
 * `null`); the conditional is tuple-wrapped so it doesn't distribute over a
 * union — `Preference<string | number>` must resolve to `"json"`.
 *
 * Two edges worth knowing: a `"string"` preference removes on `null`
 * regardless of `fallback`, so write/read aren't inverses when `fallback` is
 * non-null; a `"json"` preference compares `JSON.stringify` output, which is
 * key-order sensitive (`{a:1,b:2}` and `{b:2,a:1}` are not equal). Neither
 * edge is hit by any first-party preference today.
 */
export interface Preference<T> {
  readonly key: string;
  readonly encoding: [T] extends [string | null] ? PreferenceEncoding : "json";
  readonly fallback: T;
  readonly isValue: (value: unknown) => value is T;
}

/** A preference read that distinguishes an unreadable adapter from a readable fallback. */
export type PreferenceRead<T> =
  | { readonly readable: true; readonly value: T }
  | { readonly readable: false };

type Reader = Pick<ToolbarStorage, "getItem"> | null | undefined;
type Writer = Pick<ToolbarStorage, "setItem" | "removeItem"> | null | undefined;
type Remover = Pick<ToolbarStorage, "removeItem"> | null | undefined;

function readGuarded<T>(
  storage: Reader,
  key: string,
  fallback: T,
  isValue: (value: unknown) => value is T,
  decode: (raw: string) => unknown,
): PreferenceRead<T> {
  let raw: string | null;
  try {
    raw = storage?.getItem(key) ?? null;
  } catch {
    return { readable: false };
  }

  if (raw === null) return { readable: true, value: fallback };
  // Decoder and validator throws stay readable; only an adapter read failure is unreadable.
  try {
    const decoded = decode(raw);
    return { readable: true, value: isValue(decoded) ? decoded : fallback };
  } catch {
    return { readable: true, value: fallback };
  }
}

const identity = (raw: string): unknown => raw;
const parseJson = (raw: string): unknown => JSON.parse(raw);

/** Like `readPreference`, but reports when the adapter could not answer. Never throws. */
export function readPreferenceIfReadable<T>(
  storage: Reader,
  preference: Preference<T>,
): PreferenceRead<T> {
  return readGuarded(
    storage,
    preference.key,
    preference.fallback,
    preference.isValue,
    preference.encoding === "string" ? identity : parseJson,
  );
}

/** The stored value when it passes `isValue`, otherwise `fallback`. Never throws. */
export function readPreference<T>(storage: Reader, preference: Preference<T>): T {
  const result = readPreferenceIfReadable(storage, preference);
  return result.readable ? result.value : preference.fallback;
}

/**
 * Stores `value`, or removes the key when `value` equals the fallback — so a
 * preference put back to its default leaves nothing behind. Never throws.
 * "Equals" is `===` for `"string"` and identical `JSON.stringify` output for
 * `"json"` (key-order sensitive; see `Preference`).
 */
export function writePreference<T>(
  storage: Writer,
  preference: Preference<T>,
  value: NoInfer<T>,
): void {
  if (storage === null || storage === undefined) return;
  try {
    if (preference.encoding === "string") {
      // `null` is "nothing chosen": there is no byte string to store for it,
      // so it removes even when `fallback` is a real string (see `Preference`).
      if (value === null || value === preference.fallback) storage.removeItem(preference.key);
      // `encoding === "string"` is only admitted when `[T] extends [string | null]`
      // and `null` was handled above, so `value` is a string here. TS cannot
      // narrow a type parameter through a sibling discriminant, hence the cast.
      else storage.setItem(preference.key, value as string);
      return;
    }
    const encoded = JSON.stringify(value);
    if (encoded === undefined || encoded === JSON.stringify(preference.fallback)) {
      storage.removeItem(preference.key);
    } else {
      storage.setItem(preference.key, encoded);
    }
  } catch {
    // A custom adapter is consumer code. Losing persistence is survivable;
    // throwing out of a click handler is not.
  }
}

/** Drops the key. Never throws. */
export function removePreference(storage: Remover, preference: { readonly key: string }): void {
  try {
    storage?.removeItem(preference.key);
  } catch {
    /* see writePreference */
  }
}

/* ------------------------------------------------------------------ */
/* The un-named forms, kept for callers that hold only a key            */
/* ------------------------------------------------------------------ */

/** Read guarded JSON from storage, returning the fallback on any failure. */
export function readJson<T>(
  storage: Pick<ToolbarStorage, "getItem">,
  key: string,
  fallback: T,
  guard: (value: unknown) => value is T,
): T {
  const result = readGuarded(storage, key, fallback, guard, parseJson);
  return result.readable ? result.value : fallback;
}

/** Write JSON to storage without letting serialization or adapter failures escape. */
export function writeJson(
  storage: Pick<ToolbarStorage, "setItem">,
  key: string,
  value: unknown,
): void {
  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) storage.setItem(key, serialized);
  } catch {
    return;
  }
}

/* ------------------------------------------------------------------ */
/* Reading before mount                                                 */
/* ------------------------------------------------------------------ */

/**
 * Core's key prefix, hand-maintained because the kit may value-import nothing
 * from core. `__tests__/preference.test.ts` asserts it equals core's
 * `STORAGE_PREFIX`, the same way `src/ext/__tests__/contract-version.test.ts`
 * closes the contract number.
 */
export const STORAGE_PREFIX = "dtb:v1";

/**
 * The full storage key core hands an extension for `key`:
 * `dtb:v1:<instanceId>:ext:<extensionId>:<key>`. For code that has to reach a
 * preference *before* the toolbar mounts, when there is no `api.storage` yet.
 */
export function extensionStorageKey(instanceId: string, extensionId: string, key: string): string {
  return `${STORAGE_PREFIX}:${instanceId}:ext:${extensionId}:${key}`;
}

/** A kill-switch value. A shared recipe on the same param is anything else. */
function isResetValue(value: string | null): boolean {
  return value === "reset" || value === "clear" || value === "off";
}

/**
 * True when the URL asks for a persisted map to be dropped:
 * `?<param>=reset`, `=clear` or `=off`. `null` disables the switch.
 *
 * Exists because overrides persist and mutate the app: one that breaks the
 * page badly enough also breaks the toolbar you'd use to remove it, and
 * "clear your localStorage" isn't an escape hatch you can talk someone
 * through over chat.
 */
export function resetRequested(param: string | null | undefined): boolean {
  if (param === null || param === undefined) return false;
  try {
    if (typeof location === "undefined" || typeof location.search !== "string") {
      return false;
    }
    return isResetValue(new URLSearchParams(location.search).get(param));
  } catch {
    return false;
  }
}

/**
 * Removes `?<param>=reset` (also `=clear` and `=off`) in a microtask after
 * the switch has been honoured. Rechecks the URL before changing it.
 * Every other query param, the hash and `history.state` stay. `null` is a
 * disabled switch. Never throws — a sandboxed iframe's `replaceState` can.
 */
export function stripResetParam(param: string | null | undefined): void {
  if (param === null || param === undefined || param === "") return;
  const strip = () => {
    try {
      if (typeof location === "undefined" || typeof location.href !== "string") return;
      if (typeof history === "undefined" || typeof history.replaceState !== "function") return;
      const url = new URL(location.href);
      if (!isResetValue(url.searchParams.get(param))) return;
      url.searchParams.delete(param);
      history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // SSR, or a sandboxed iframe whose replaceState throws.
    }
  };
  if (typeof queueMicrotask === "function") queueMicrotask(strip);
  else void Promise.resolve().then(strip);
}

/**
 * The current page's origin and path with only `?<param>=reset`, for a panel's
 * copy row. The rest of the query and the hash are dropped: the switch works on
 * any page, and a link meant to be pasted must not carry a `?token=` along.
 * `null` when the switch is disabled or there is no URL to read.
 */
export function resetUrl(param: string | null | undefined): string | null {
  if (param === null || param === undefined || param === "") return null;
  try {
    if (typeof location === "undefined" || typeof location.href !== "string") return null;
    const url = new URL(location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set(param, "reset");
    return url.href;
  } catch {
    return null;
  }
}

export interface StoredRecordOptions {
  /** The `instanceId` the toolbar mounts with. Default `"default"`. */
  instanceId?: string;
  /** The extension's `id`. */
  extensionId: string;
  /** The preference's own key inside the extension's scope. */
  key: string;
  /** Where to read. Default: `localStorage` when there is one, else nothing. */
  storage?: Pick<ToolbarStorage, "getItem"> | null;
  /**
   * Query parameter of the kill switch; see `resetRequested`. Default `null`
   * (off) — pass one to opt in, as the flags and theme-editor factories do.
   */
  resetParam?: string | null;
}

/**
 * Reads a persisted map **without mounting anything** — for an app that has
 * to agree with the panel on first paint, before `start()` has run.
 *
 * `isEntry` should be the same validator the mounted runtime uses, so seeded
 * state is exactly what the panel will accept; failing entries are dropped,
 * not the whole map. Returns a plain object (not the null-prototype map the
 * parsers build) since this crosses a public API where `.hasOwnProperty()`
 * must not throw. The `?…=reset` kill switch is off unless `resetParam` is passed.
 */
export function readStoredRecord<T>(
  options: StoredRecordOptions,
  isEntry: (value: unknown, name: string) => value is T,
): Record<string, T> {
  const { instanceId = "default", extensionId, key, resetParam = null } = options;
  if (resetRequested(resetParam)) return {};
  let raw: string | null = null;
  try {
    const source =
      options.storage === undefined
        ? typeof localStorage === "undefined"
          ? null
          : localStorage
        : options.storage;
    raw = source?.getItem(extensionStorageKey(instanceId, extensionId, key)) ?? null;
  } catch {
    return {};
  }
  return { ...parseRecord(raw, isEntry) };
}
