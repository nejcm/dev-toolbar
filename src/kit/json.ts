import type { ToolbarStorage } from "../core/contract";

const emptyRecord = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

/** Null-prototype output keeps persisted `__proto__` as data and makes `in`/lookup consistent on every path. */
export function parseRecord<T>(
  raw: string | null,
  isValue: (value: unknown) => value is T,
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
    if (isValue(value)) output[key] = value;
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

/** Read guarded JSON from storage, returning the fallback on any failure. */
export function readJson<T>(
  storage: Pick<ToolbarStorage, "getItem">,
  key: string,
  fallback: T,
  guard: (value: unknown) => value is T,
): T {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return guard(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
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
