/**
 * A named, validated, persisted preference — the one guarded interface over
 * `api.storage` that every first-party extension reads and writes through.
 *
 * Three operations and two encodings, deliberately nothing more:
 *
 * - **read** — the stored value if it passes the type guard, else the fallback;
 * - **write** — store the value, or *remove* it when it equals the fallback, so
 *   storage holds only what differs from the default;
 * - **remove** — drop the key.
 *
 * A storage adapter is consumer code, and a throwing `getItem`/`setItem`/
 * `removeItem` (a browser with site data blocked, a full quota, a sandboxed
 * iframe) must never take down a panel or a click handler. Every path here
 * swallows the throw and degrades: a read returns the fallback, a write or
 * remove does nothing. `null`/`undefined` storage degrades the same way.
 *
 * Encodings: `"string"` stores the value byte-for-byte (what `tab`, `format`
 * and the override maps write today), `"json"` runs it through `JSON`. A raw
 * value is never JSON-wrapped, so a consumer's persisted `tab` from before an
 * extension adopted this module still reads back.
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
 * `fallback` is both what a read returns when nothing valid is stored and the
 * value a write treats as "nothing to store" — writing it removes the key.
 * `isValue` vets what comes back out of storage; a value that fails it reads
 * as the fallback. `encoding: "string"` is only available when `T` is a string
 * (or `null` for "nothing chosen yet"); anything else has to be `"json"`. The
 * conditional is tuple-wrapped so it does not distribute over a union: a
 * `Preference<string | number>` must resolve to `"json"`, not admit `"string"`
 * and hand `setItem` a number.
 *
 * Two edges of "remove when it equals the fallback" worth knowing:
 *
 * - A `"string"` preference removes on `null` *regardless of* `fallback`. With a
 *   non-null fallback, `write(null)` then `read()` returns the fallback, not
 *   `null` — write and read are not inverses for that shape. No first-party
 *   preference has it; every raw-string default is `null` or a real string.
 * - A `"json"` preference compares its `JSON.stringify` output, so the
 *   comparison is key-order sensitive: with `fallback: { a: 1, b: 2 }`, writing
 *   `{ a: 1, b: 2 }` removes but `{ b: 2, a: 1 }` stores. Inert while every
 *   first-party default is `{}`, `[]` or a scalar.
 */
export interface Preference<T> {
  readonly key: string;
  readonly encoding: [T] extends [string | null] ? PreferenceEncoding : "json";
  readonly fallback: T;
  readonly isValue: (value: unknown) => value is T;
}

type Reader = Pick<ToolbarStorage, "getItem"> | null | undefined;
type Writer = Pick<ToolbarStorage, "setItem" | "removeItem"> | null | undefined;
type Remover = Pick<ToolbarStorage, "removeItem"> | null | undefined;

function readGuarded<T>(
  storage: Reader,
  key: string,
  fallback: T,
  isValue: (value: unknown) => value is T,
  decode: (raw: string) => unknown,
): T {
  // Adapter, decoder and guard are all wrapped: a throw from any of them is
  // "nothing valid stored", never a crash during render.
  try {
    const raw = storage?.getItem(key) ?? null;
    if (raw === null) return fallback;
    const decoded = decode(raw);
    return isValue(decoded) ? decoded : fallback;
  } catch {
    return fallback;
  }
}

const identity = (raw: string): unknown => raw;
const parseJson = (raw: string): unknown => JSON.parse(raw);

/** The stored value when it passes `isValue`, otherwise `fallback`. Never throws. */
export function readPreference<T>(storage: Reader, preference: Preference<T>): T {
  return readGuarded(
    storage,
    preference.key,
    preference.fallback,
    preference.isValue,
    preference.encoding === "string" ? identity : parseJson,
  );
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
  return readGuarded(storage, key, fallback, guard, parseJson);
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
    const value = new URLSearchParams(location.search).get(param);
    return value === "reset" || value === "clear" || value === "off";
  } catch {
    return false;
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
   * Query parameter of the kill switch; see `resetRequested`. **Default `null`:
   * the switch is off.** A caller that wants the escape hatch — and a reader of
   * a map that mutates the app should — passes its own param, as the flags and
   * theme-editor factories do with `DEFAULT_RESET_PARAM` / `DEFAULT_THEME_PARAM`.
   */
  resetParam?: string | null;
}

/**
 * Reads a persisted map **without mounting anything** — for an app that has
 * to agree with the panel on first paint, before `start()` has run.
 *
 * `isEntry` vets each entry by value *and name*: the mounted runtime's own
 * validators go here, so what the app seeds itself with is exactly what the
 * panel will accept. Entries that fail are dropped, not the whole map.
 *
 * Returns a plain object, never the null-prototype map the parsers build:
 * this crosses a public API, where `.hasOwnProperty()` on the result must not
 * throw.
 *
 * The `?…=reset` kill switch is **off unless `resetParam` is passed**; see
 * `StoredRecordOptions.resetParam`.
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
