/**
 * One owner for "a thrown value → something safe to show". Eight extensions
 * used to do this by hand, in eight slightly different ways, and the ones that
 * joined `name` and `message` before masking could no longer mask a
 * credential-carrying URL message (`core/contract.ts`, `ExtensionDiagnostics`).
 */

import { type RedactOptions, UNREADABLE, redactProse } from "./redact";

/** A thrown value, described. `name` is absent for a non-`Error` throw. */
export interface ErrorDescription {
  name?: string;
  message: string;
}

type PropertyRead = { ok: true; value: unknown } | { ok: false };

/** Read exactly once: a hostile getter gets one chance to answer, never a chance to throw out. */
function readProperty(source: object, key: "name" | "message"): PropertyRead {
  try {
    return { ok: true, value: (source as Record<string, unknown>)[key] };
  } catch {
    return { ok: false };
  }
}

/** `String(value)` of a primitive, which only a symbol can complicate — and `String()` handles that. */
function stringify(value: unknown): string {
  try {
    return String(value);
  } catch {
    return UNREADABLE;
  }
}

/**
 * `[object Tag]` via `Object.prototype.toString`, never the object's own
 * `toString` — for an `Error` that's `Error.prototype.toString`, which would
 * re-read `name`/`message`; for anything else it's code the thrower controls.
 */
function tagOf(value: object): string {
  try {
    return Object.prototype.toString.call(value);
  } catch {
    return UNREADABLE;
  }
}

function withName(name: string | undefined, message: string): ErrorDescription {
  return name === undefined ? { message } : { name, message };
}

/**
 * The raw `{ name, message }` of a thrown value, unmasked — for the
 * developer's own console, which logs the raw thrown value on a failure path
 * by design (`docs/architecture.md` §10). Anything that leaves the page goes
 * through `describeError()` instead.
 *
 * Duck-typed, not `instanceof Error`: that's false for an error from another
 * realm and *throws* for a revoked Proxy or a throwing `getPrototypeOf` trap.
 * `message`/`name` are each read exactly once and guarded; a value with no
 * string `message` is not error-like (a primitive is stringified, an object
 * described by its tag) so a hostile `toString` never runs.
 */
export function describeErrorUnmasked(error: unknown): ErrorDescription {
  if (error === null || (typeof error !== "object" && typeof error !== "function")) {
    return { message: stringify(error) };
  }
  const message = readProperty(error, "message");
  const name = readProperty(error, "name");
  const label = !name.ok
    ? UNREADABLE
    : typeof name.value === "string" && name.value.length > 0
      ? name.value
      : undefined;
  if (!message.ok) return withName(name.ok ? label : undefined, UNREADABLE);
  if (typeof message.value === "string") return withName(label, message.value);
  return withName(label, tagOf(error));
}

/**
 * A thrown value as a masked `{ name, message }`, ready for a snapshot, a
 * `title` attribute or a status line.
 *
 * `name` and `message` are masked **separately** with `redactProse()`, never
 * as a joined sentence, so a message that merely *contains* a credential URL
 * is still masked. `name` is masked too, since it's a writable own property,
 * not a class identifier (`error.name = "https://x/?token=abc"` is masked).
 * Never throws.
 */
export function describeError(error: unknown, options?: RedactOptions): ErrorDescription {
  const raw = describeErrorUnmasked(error);
  return withName(
    raw.name === undefined ? undefined : redactProse(raw.name, options),
    redactProse(raw.message, options),
  );
}

/**
 * `describeError()` joined the way `Error.prototype.toString` joins:
 * `"TypeError: boom"`, or just the message for a non-`Error` throw, or just
 * the name when the message is empty. Masked before joining, never after.
 */
export function formatError(error: unknown, options?: RedactOptions): string {
  const { name, message } = describeError(error, options);
  if (name === undefined) return message;
  if (message.length === 0) return name;
  return `${name}: ${message}`;
}
