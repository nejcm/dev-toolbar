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

/**
 * One property, read exactly once and never again: a hostile getter gets a
 * single chance to answer and no chance to throw out of here.
 */
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
 * How an object with no string `message` is described: its `[object Tag]`, by
 * `Object.prototype.toString` — never by the object's own `toString`, which for
 * an `Error` is `Error.prototype.toString` and would read `name` and `message`
 * a second time, and for anything else is code the thrower controls. The only
 * thing this reads is `Symbol.toStringTag`, guarded.
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
 * developer's own console, which logs the raw thrown value on a failure path by
 * design (`docs/architecture.md` §10). Anything that leaves the page goes
 * through `describeError()` instead.
 *
 * Duck-typed, not `instanceof Error`: that is false for an error from another
 * realm (an iframe, a worker) and *throws* for a revoked Proxy or a
 * `getPrototypeOf` trap that throws, so classification never asks the value
 * what it is. `message` and `name` are each read exactly once, guarded, and
 * nothing afterwards touches the object again: a read that throws makes that
 * field `UNREADABLE` and nothing else — unless both throw, when nothing about
 * the value is legible and it is one `UNREADABLE` message with no name; a
 * `name` that is not a non-empty string is omitted. A value with no string
 * `message` is not error-like — a primitive
 * is stringified, an object is described by its tag (`tagOf`), so a hostile
 * `toString` never runs and a getter never gets a second question.
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
 * - `name` and `message` are masked **separately**, never as a joined
 *   sentence, and each with `redactProse()`, so a message that *is* a
 *   credential-carrying URL and a message that merely *contains* one are both
 *   masked, and `Unexpected token export` is not.
 * - `name` is a writable own property, not a class identifier, so it is
 *   masked too: `error.name = "https://x/?token=abc"` comes back masked.
 * - Never throws: extraction is `describeErrorUnmasked`, masking is
 *   `redactProse`, and neither does.
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
