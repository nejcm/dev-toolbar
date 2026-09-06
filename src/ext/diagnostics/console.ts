/**
 * The console and error tail. [dev-toolbar/ext/diagnostics]
 * (`plans/ecosystem-extensions.md` § 1B.)
 *
 * `window`'s `error` and `unhandledrejection` events, plus `console.error` and
 * `console.warn`, grouped by message into a bounded tail and folded into the
 * snapshot. This is what turns the snapshot from "state at the moment of
 * capture" into "state, plus what went wrong on the way there" — the one thing
 * DevTools cannot give a ticket, because you cannot paste the console into an
 * issue.
 *
 * ## `console.log` is not patched, and there is no option to
 *
 * Errors and warnings are the signal; logs are volume. There is deliberately
 * no switch for it: an opt-in would still be a `console.log` patch shipped to
 * every consumer, and a tail full of render-loop logging is a tail nobody
 * reads.
 *
 * ## Patching rules, all four load-bearing
 *
 * 1. **It always calls through.** The original method is applied on every
 *    path, including when a recorder throws — a recorder's bug must never
 *    swallow the app's own logging. Recording happens first so a *throwing*
 *    downstream `console` still leaves the entry in the tail.
 * 2. **It restores by identity on teardown**, and never over a later patch:
 *    if something else patched `console.error` after us, its wrapper stays
 *    (the same rule, and the same reason, as the `fetch` interceptor in
 *    `/runtime` — see `src/runtime/network.ts`).
 * 3. **Every method is opt-out-able**, and `console: false` opts out of the
 *    whole feature — nothing is patched and no listener is added.
 * 4. **It cannot recurse.** One module-level depth guard spans every patched
 *    method, so anything logged *while a recorder runs* — including
 *    `ExtensionBoundary.componentDidCatch`, which calls `console.error` by
 *    design, and this extension's own failure logging — passes straight
 *    through to the original and is not recorded a second time.
 *
 * ## The dual-package hazard, measured and left alone
 *
 * Patch state is module-level, so the hazard `src/runtime/network.ts`
 * documents applies here in its sharpest form: a page that resolves both
 * `dist/ext/diagnostics.js` and `dist/ext/diagnostics.cjs` gets two module
 * copies, and the second wraps the first. While both are up, nothing is lost
 * — both call through and both record, once each. **Detaching them
 * inner-first is what costs**: rule 2 forbids restoring over the outer
 * wrapper, so the inner one stays, listener-less but still forwarding, and
 * every start/stop cycle strands one more. Executed, two module copies over
 * one `console`, inner stopped first each cycle: `console.error` throws
 * `RangeError: Maximum call stack size exceeded` from cycle 8,801 here, and
 * from about cycle 5,000 on the built ESM+CJS pair under Bun and Node. The
 * exact cycle is whatever the engine's stack depth allows; what matters is
 * that past it nothing reaches the original at all — the **host app's own
 * logging** is gone, not merely our capture.
 *
 * This is documented rather than fixed. The fix is to resolve the package to
 * one format; a bundler-level problem is not one a `Symbol.for` handshake
 * between copies can repair. That handshake was tried, and traded this loud,
 * bounded failure for silent ones: a copy that stopped first kept a cached,
 * detached listener set and went on reporting `capturing` while recording
 * nothing, and a foreign implementation squatting the same symbol could put
 * `console.error` beyond repair. A limit you can measure beats capture that
 * lies about itself.
 *
 * ## Redaction
 *
 * A captured message is whatever the app logged, so it is masked **on the way
 * in**, argument by argument, before anything is joined into a line — the rule
 * the rest of this extension follows, and the reason it can be joined at all
 * (`redact()`'s value matching is anchored, so masking an assembled sentence
 * masks nothing). Object arguments are walked by `redact()`, which is where
 * key-name matching does its work; strings get value-shape matching plus a
 * URL pass plus a *run* pass, because a credential-carrying URL — or a
 * `Bearer …` — sitting *inside* a sentence is the common console shape and
 * anchored matching cannot see it. Strings this module *builds* are masked
 * too — the leaves of a `redact()`ed object before they are joined into
 * JSON, since `redact()` keeps an `Error`'s `name` verbatim and anchored
 * matching cannot see into a finished line.
 *
 * Three rules the leaks all came from, and all three are load-bearing:
 *
 * - **Read a foreign property once.** A getter answers differently on the
 *   second read; `typeof e.message === "string" ? mask(e.message) : ""` is two
 *   reads. Everything error-shaped is snapshotted by `readErrorLike()` first.
 * - **Never mask half of something.** A URL run stops at whitespace only —
 *   ending it at a quote handed `redactUrl()` a truncated URL and left the
 *   credential sitting next to a `[redacted]` marker that claimed otherwise.
 * - **Never emit a branch you did not walk.** Whatever the masker stops
 *   short of — a stack line it did not classify, an object deeper than it
 *   descends — is dropped or `[truncated]`, never passed through verbatim.
 *   Every leak here began as something kept because it "looked harmless".
 *
 * What still escapes, pinned by tests in `__tests__/console.test.tsx`: a bare
 * secret in prose, a credential inside a stack frame's *function name*, and
 * anything reachable only through `Error.cause` or `AggregateError.errors`,
 * which are not read at all.
 */
import { redact, redactUrl } from "../../runtime";
import type { RedactOptions } from "../../runtime";
// The real clamp, not a copy of it: a restatement that matches today drifts
// tomorrow, and `size` has always produced the numbers every other ring does.
import { clampCapacity } from "../../runtime/ringBuffer";
import type {
  ConsoleTailCounts,
  ConsoleTailEntry,
  ConsoleTailLevel,
  ConsoleTailReport,
  ConsoleTailSource,
  ConsoleTailStatus,
} from "./types";
import { describeTail } from "./types";

/** Distinct grouped entries retained by default. */
export const DEFAULT_TAIL_SIZE = 25;
/** Characters kept per message by default. */
export const DEFAULT_MESSAGE_CHARS = 400;
/** Characters kept per stack by default. */
export const DEFAULT_STACK_CHARS = 1500;
/** Characters kept per non-string argument. */
const ARGUMENT_CHARS = 200;
/**
 * How deep `maskLeaves` walks a `redact()`ed copy. Matches `redact()`'s own
 * default `maxDepth`, so nothing is lost at default settings; a caller who
 * raises `maxDepth` gets `[truncated]` past this rather than unmasked text.
 */
const MASK_DEPTH = 8;
/** `redact()`'s marker for a branch it did not walk. Reused for the same reason. */
const TRUNCATED = "[truncated]";

export interface ConsoleTailOptions {
  /** Patch `console.error`. Default `true`. */
  error?: boolean;
  /** Patch `console.warn`. Default `true`. */
  warn?: boolean;
  /** Listen for `window`'s `error` event. Default `true`. */
  windowErrors?: boolean;
  /** Listen for `window`'s `unhandledrejection` event. Default `true`. */
  rejections?: boolean;
  /** Distinct grouped entries retained. Default `25`; clamped like every ring. Least recently seen is evicted first. */
  size?: number;
  /** Characters kept per message. Default `400`. */
  maxMessageChars?: number;
  /** Characters kept per stack. Default `1500`; `0` drops stacks entirely. */
  maxStackChars?: number;
}

export interface ConsoleTail {
  /** Idempotent. Returns a teardown that restores every patch it installed. */
  start(): () => void;
  stop(): void;
  /** Newest first, by *last* occurrence. `limit` keeps the newest N grouped entries. */
  report(limit?: number): ConsoleTailReport;
  /** Drops every entry and zeroes the counters. Keeps capturing. */
  clear(): void;
  /** Live totals for the chip. Counts events, not grouped entries. */
  counts(): ConsoleTailCounts;
}

export interface ConsoleTailDeps {
  redactOptions?: RedactOptions | undefined;
  /** Clock, shared with the rest of the runtime so it is guarded the same way. */
  now?: () => number;
  /** Called after an entry is recorded or grouped. Never throws out of here. */
  onChange?: () => void;
}

/* -------------------------------------------------------------------------- */
/* The global patch — one wrapper per method, many listeners                   */
/* -------------------------------------------------------------------------- */

type PatchedMethod = "error" | "warn";
type ConsoleListener = (args: readonly unknown[]) => void;

interface Installed {
  listeners: Set<ConsoleListener>;
  uninstall(): void;
}

const patches: Record<PatchedMethod, Installed | null> = { error: null, warn: null };

/**
 * Shared by every patched method. Anything logged while a listener runs is
 * forwarded to the original and not recorded — the re-entrancy guard the plan
 * calls for, and the reason a crash logged by `ExtensionBoundary` cannot feed
 * itself.
 */
let depth = 0;

type ConsoleLike = Record<string, unknown>;

const consoleObject = (): ConsoleLike | null => {
  try {
    const target = (globalThis as { console?: unknown }).console;
    if (typeof target !== "object" || target === null) return null;
    return target as ConsoleLike;
  } catch {
    return null;
  }
};

/**
 * The outcome of one patch attempt.
 *
 * `restore` and `verified` are separate on purpose. An assignment that *may*
 * have taken effect must leave a teardown behind even when we cannot confirm
 * it: a setter that stores the wrapper while the getter throws once during
 * read-back and then recovers used to give `unavailable` **and** a discarded
 * handle, so `stop()` left the wrapper installed for the life of the page.
 * The handle is kept whenever the assignment was attempted; `verified` alone
 * decides whether we claim to be watching.
 */
interface Patch {
  restore(): void;
  verified: boolean;
}

function install(
  target: ConsoleLike,
  method: PatchedMethod,
  listeners: Set<ConsoleListener>,
): Patch | null {
  // Reading a console method is a property access like any other, and a
  // hardened or instrumented host can make it an accessor that throws. It is
  // read here, inside the guard, so a throwing getter is a method we skip and
  // not an exception out of `start()` that leaves the *other* method patched
  // with nothing registered to restore it.
  let original: unknown;
  try {
    original = target[method];
  } catch {
    return null;
  }
  if (typeof original !== "function") return null;
  const call = original as (this: unknown, ...args: unknown[]) => unknown;

  const wrapper = function patchedConsoleMethod(this: unknown, ...args: unknown[]): unknown {
    // Nested log (a recorder's own, the toolbar's own, or a downstream
    // console's): forward it, record nothing.
    if (depth > 0) return call.apply(this, args);
    depth += 1;
    try {
      for (const listener of listeners) {
        try {
          listener(args);
        } catch {
          /* a recorder must never break the app's own logging */
        }
      }
      return call.apply(this, args);
    } finally {
      depth -= 1;
    }
  };

  const restore = () => {
    // Never restore over somebody else's later patch — same rule as the
    // `fetch` interceptor: their wrapper is live and ours is not the outermost.
    try {
      if (target[method] === wrapper) target[method] = original;
    } catch {
      /* nothing left to do about it */
    }
  };

  try {
    target[method] = wrapper;
  } catch {
    // A frozen or getter-only `console` (a hardened host, a locked-down test
    // rig). A setter can also store the value and *then* throw, so from here
    // on the handle is kept: an unverified patch is still a patch to undo.
    return { restore, verified: false };
  }

  // An accessor with a *silent* setter swallows the assignment and leaves the
  // original in place. Reporting that as `watching` would be the worst kind of
  // wrong: a tail that says it is capturing and records nothing.
  let verified = false;
  try {
    verified = target[method] === wrapper;
  } catch {
    // A throwing getter is not evidence that the assignment failed.
    verified = false;
  }
  return { restore, verified };
}

/**
 * `null` when nothing was assigned at all; otherwise a teardown, plus whether
 * the patch was confirmed live. An unverified patch is reported as *not*
 * watched — but its teardown is still returned, because the assignment may
 * have landed somewhere we cannot read back.
 */
interface Attachment {
  off(): void;
  verified: boolean;
}

function attach(method: PatchedMethod, listener: ConsoleListener): Attachment | null {
  let current = patches[method];
  if (current === null) {
    const target = consoleObject();
    if (target === null) return null;
    const listeners = new Set<ConsoleListener>();
    const patch = install(target, method, listeners);
    if (patch === null) return null;
    if (!patch.verified) {
      // Not registered as the live patch and given no listener: it captures
      // nothing. It is still handed back so `stop()` can undo an assignment
      // that may have taken effect behind an unreadable getter.
      return { off: patch.restore, verified: false };
    }
    current = { listeners, uninstall: patch.restore };
    patches[method] = current;
  }
  const installed = current;
  installed.listeners.add(listener);
  return {
    verified: true,
    off: () => {
      installed.listeners.delete(listener);
      if (installed.listeners.size > 0) return;
      installed.uninstall();
      if (patches[method] === installed) patches[method] = null;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Formatting, redacted argument by argument                                   */
/* -------------------------------------------------------------------------- */

/**
 * URLs, wherever they sit in a line. `redact()` matches a *whole* string that
 * is a credential-carrying URL; a console message almost never is one — it is
 * a sentence with the URL in the middle, and a signed asset URL appears the
 * same way inside a stack frame. So every `scheme://…` run is pulled out and
 * masked on its own.
 *
 * A run stops at **whitespace and nothing else**. An earlier version also
 * stopped at `"'<>\`\\` — the characters a URL is usually quoted with — which
 * cut the run short and handed `redactUrl()` a URL whose query value had been
 * left behind: `?token="LEAK"` came back as `?token=[redacted]"LEAK"`, the
 * secret intact *next to a mask that claims it is not*. The cost, measured:
 * when a URL is actually masked, the non-whitespace text right after it is
 * swallowed into the masked value and lost from the line
 * (`{"u":"https://a/?token=S","n":2}` reports as `{"u":"https://a/?token=` +
 * the mask). Text after the next space survives, an unmasked URL comes back
 * byte-for-byte, and a lost `","n":2}` is a trade anyone would take against a
 * kept credential.
 */
const URL_LIKE = /[a-z][a-z0-9+.-]*:\/\/\S+/gi;

/**
 * Whitespace, kept as its own piece by `split` so a line can be put back
 * together byte-for-byte when nothing in it matched. See `maskRuns`.
 */
const WHITESPACE = /(\s+)/;

const defaultNow = (): number => {
  try {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
  } catch {
    /* fall through to the wall clock */
  }
  try {
    return Date.now();
  } catch {
    return 0;
  }
};

/**
 * What an error-shaped argument was, read **once**.
 *
 * Not the object: a snapshot of it. Every property here used to be read again
 * for each use — classification, then formatting — and `typeof e.message`
 * followed by `mask(e.message)` is two reads of the same getter. A getter that
 * answers with a string until it has passed the type check and then with a
 * `Date` whose `toISOString()` returns the credential put that credential
 * straight into the tail. One read, then only the captured value is used, so
 * there is no second answer to give. It is also why a throwing `stack` getter
 * can no longer take the message down with it (it is caught here, not at the
 * use site).
 */
interface ErrorSnapshot {
  name: string | null;
  message: string | null;
  stack: string | null;
}

/** One property read, guarded, kept only if it is a string. */
function readString(value: object, key: "name" | "message" | "stack"): string | null {
  try {
    const read = (value as Record<string, unknown>)[key];
    return typeof read === "string" ? read : null;
  } catch {
    // A hostile or merely broken getter.
    return null;
  }
}

/** One console argument and what it turned out to be, both settled before use. */
interface Argument {
  value: unknown;
  error: ErrorSnapshot | null;
}

/** Duck-typed on purpose: `instanceof Error` is false across realms (an iframe, a worker). */
function readErrorLike(value: unknown): ErrorSnapshot | null {
  if (value === null || typeof value !== "object") return null;
  const message = readString(value, "message");
  if (message === null) return null;
  const name = readString(value, "name");
  const stack = readString(value, "stack");
  if (name === null && stack === null) return null;
  return { name, message, stack };
}

export function createConsoleTail(
  options: ConsoleTailOptions | false | undefined,
  deps: ConsoleTailDeps = {},
): ConsoleTail {
  const { redactOptions, now = defaultNow, onChange } = deps;
  const settings: ConsoleTailOptions = options === false || options === undefined ? {} : options;
  const watchError = options !== false && settings.error !== false;
  const watchWarn = options !== false && settings.warn !== false;
  const watchWindow = options !== false && settings.windowErrors !== false;
  const watchRejections = options !== false && settings.rejections !== false;
  const enabled = watchError || watchWarn || watchWindow || watchRejections;

  const maxMessageChars = positive(settings.maxMessageChars, DEFAULT_MESSAGE_CHARS);
  const maxStackChars =
    settings.maxStackChars === undefined
      ? DEFAULT_STACK_CHARS
      : Math.max(0, Math.floor(settings.maxStackChars) || 0);

  /**
   * Oldest first, keyed by group. A `Map` and not a ring, for one reason: a
   * ring orders by *first* occurrence and evicts on it too, so an error still
   * repeating every frame was reported below one seen once at startup, and was
   * the entry a full tail threw away. `report()` promises the newest N, and a
   * message that just repeated is newer than one that has not. Re-inserting on
   * a repeat moves the key to the end, which makes eviction least-recent
   * rather than first-seen and costs one `delete`/`set` per grouped hit.
   */
  const groups = new Map<string, ConsoleTailEntry>();
  // Clamped by `/runtime`'s own ring clamp, imported rather than restated: at
  // least one group, at most 1 << 24, non-finite and fractional folded in.
  const capacity = clampCapacity(settings.size === undefined ? DEFAULT_TAIL_SIZE : settings.size);

  let errors = 0;
  let warnings = 0;
  let dropped = 0;
  let running = false;
  let started = false;
  /** True once a start actually watched something. See `status()`. */
  let observedAnything = false;
  let watching: ConsoleTailSource[] = [];
  let stops: (() => void)[] = [];

  /* ---------------------------------------------------------------------- */
  /* Masking                                                                 */
  /* ---------------------------------------------------------------------- */

  const maskUrls = (text: string): string => {
    try {
      return text.replace(URL_LIKE, (match) => {
        try {
          return redactUrl(match, redactOptions);
        } catch {
          return match;
        }
      });
    } catch {
      return text;
    }
  };

  /**
   * `redact()` on one piece of a line, defensively — it is the only judge of
   * what a credential looks like, and this module never adds a second one.
   */
  const maskPiece = (piece: string): string => {
    try {
      const masked = redact(piece, redactOptions);
      return typeof masked === "string" ? masked : piece;
    } catch {
      return piece;
    }
  };

  /**
   * Credential *runs* inside a line — the same judgement `redact()` makes
   * about a whole string, asked again about each word and each adjacent pair
   * of words.
   *
   * `redact()`'s value matching is anchored (`^bearer\s+\S+$`), which is
   * right for a leaf and blind to `Error: Bearer sk-live-…`, the exact shape
   * V8 writes at the top of a stack. Rather than teach this module a second
   * notion of "credential", the line is split on whitespace and the pieces are
   * handed back to `redact()`: a pair first (`Bearer …`, `Digest …` are two
   * words), then singles (a bare JWT, a URL `maskUrls` did not reach).
   *
   * The cost is `redact()`'s own false positives, now reachable mid-sentence:
   * `"the token expired"` reports as `"the token [redacted]"`, because
   * `redact("token expired")` says so. That is the trade — a masked ordinary
   * word against a credential printed in full — and it is the same trade
   * `redact()` already made for a whole string.
   */
  const maskRuns = (text: string): string => {
    try {
      const pieces = text.split(WHITESPACE);
      for (let index = 0; index < pieces.length; index += 2) {
        const token = pieces[index] as string;
        if (token === "") continue;
        const gap = pieces[index + 1];
        const next = pieces[index + 2];
        if (gap !== undefined && next !== undefined && next !== "") {
          const pair = `${token}${gap}${next}`;
          const maskedPair = maskPiece(pair);
          if (maskedPair !== pair) {
            // The pair matched as a unit; it is replaced as a unit, so no
            // half of it is left behind claiming to have been handled.
            pieces[index] = maskedPair;
            pieces[index + 1] = "";
            pieces[index + 2] = "";
            index += 2;
            continue;
          }
        }
        pieces[index] = maskPiece(token);
      }
      return pieces.join("");
    } catch {
      return text;
    }
  };

  /** A foreign string: value-shape matching, then the URL pass, then runs. */
  const maskString = (value: string): string => {
    try {
      return maskRuns(maskUrls(String(redact(value, redactOptions))));
    } catch {
      return "[unreadable]";
    }
  };

  /**
   * The whole stack, every line masked, nothing classified.
   *
   * There were two earlier shapes and both leaked. Keeping the stack verbatim
   * exported the credential in V8's header, which repeats the raw message
   * (`Error: Bearer sk-live-…`) above the first frame. Dropping everything
   * above the first line that *looked* like a frame then leaked through the
   * frame test itself: `^\S*@\S*:\d+` is the SpiderMonkey/JSC frame shape, and
   * an `Error` whose `name` is `fake@host:1` produces a header that matches
   * it — accepted as a frame, kept unmasked. It also silently threw away
   * every stack from an engine whose frames this module had never seen.
   *
   * So: no header detection, no frame detection. Each line goes through
   * `maskString`, whose run pass is what actually catches the credential in a
   * header, and every line that exists is kept. A retained header is
   * harmless once it is masked, and an unrecognised stack is now reported
   * instead of vanishing.
   */
  const maskStack = (value: string | null): string | null => {
    if (value === null || value === "" || maxStackChars === 0) return null;
    try {
      const masked = value
        .split("\n")
        .map((line) => maskString(line))
        .join("\n");
      return cap(masked, maxStackChars);
    } catch {
      return null;
    }
  };

  /**
   * Every string inside a `redact()`ed copy, masked on its own.
   *
   * `redact()` matches keys, and matches values only when the whole value is
   * the credential — which is exactly right for a leaf and useless for the
   * JSON line this builds out of the leaves. It also keeps an `Error`'s `name`
   * verbatim, on the sound assumption that a name is `TypeError`; an argument
   * like `{error: e}` where `e.name` had been set to a credential therefore
   * arrived here intact. So the leaves are re-masked before they are joined —
   * the module's rule ("mask on the way in, then join") applied to the strings
   * this module generates, not only to the ones it is handed.
   */
  const maskLeaves = (value: unknown, depth = 0): unknown => {
    if (typeof value === "string") return maskString(value);
    if (typeof value !== "object" || value === null) return value;
    // Past the walk's own bound the branch is *unprocessed*, and an
    // unprocessed branch may not be emitted. Returning it whole is what let a
    // credential-shaped `Error.name` out under `redactOptions.maxDepth: 24`:
    // `redact()` kept the object to depth 24, this walk stopped at 8, and the
    // remainder went into the JSON verbatim. `[truncated]` is the marker
    // `redact()` uses for its own depth bound, so the reader sees the same
    // word for the same reason.
    if (depth >= MASK_DEPTH) return TRUNCATED;
    if (Array.isArray(value)) return value.map((entry) => maskLeaves(entry, depth + 1));
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      // `redact()` has already decided which keys survive; only their values
      // are rewritten here. A key is foreign text too, and it is masked with
      // the same call.
      output[maskString(key)] = maskLeaves(entry, depth + 1);
    }
    return output;
  };

  /**
   * One console argument, masked before it can be joined to anything else.
   *
   * Takes the already-read `Argument`, never a bare value: classifying here
   * would be a second read of the same foreign getters, which is the hole the
   * whole `readErrorLike()` snapshot exists to close. `describeValue()` below
   * is the one place a raw value is classified, and it does it once.
   */
  const describeArgument = ({ value, error }: Argument): string => {
    if (typeof value === "string") return cap(maskString(value), ARGUMENT_CHARS);
    if (error !== null) return cap(describeErrorLike(error), ARGUMENT_CHARS);
    try {
      const redacted = redact(value, redactOptions);
      if (redacted === undefined) return "undefined";
      if (typeof redacted === "string") return cap(maskUrls(redacted), ARGUMENT_CHARS);
      if (typeof redacted === "object" && redacted !== null) {
        const json = JSON.stringify(maskLeaves(redacted));
        return cap(json === undefined ? "[unserialisable]" : maskUrls(json), ARGUMENT_CHARS);
      }
      return cap(maskString(String(redacted)), ARGUMENT_CHARS);
    } catch {
      return "[unreadable]";
    }
  };

  /** Name and message masked separately, then joined — never the other way round. */
  const describeErrorLike = (error: ErrorSnapshot): string => {
    const name = error.name === null ? "" : maskString(error.name);
    const message = error.message === null ? "" : maskString(error.message);
    if (name === "" && message === "") return "an error with no message";
    if (name === "") return message;
    return message === "" ? name : `${name}: ${message}`;
  };

  /* ---------------------------------------------------------------------- */
  /* Recording                                                               */
  /* ---------------------------------------------------------------------- */

  const keyOf = (source: ConsoleTailSource, message: string): string => `${source} · ${message}`;

  const notify = () => {
    if (onChange === undefined) return;
    try {
      onChange();
    } catch {
      /* a reader must never break the app's own logging */
    }
  };

  const record = (
    source: ConsoleTailSource,
    level: ConsoleTailLevel,
    message: string,
    stack: string | null,
  ): void => {
    const at = clock();
    if (level === "error") errors += 1;
    else warnings += 1;

    const key = keyOf(source, message);
    const existing = groups.get(key);
    if (existing !== undefined) {
      existing.count += 1;
      existing.lastAt = at;
      if (existing.stack === null && stack !== null) existing.stack = stack;
      // Newest again: `delete` then `set` is how a `Map` is reordered.
      groups.delete(key);
      groups.set(key, existing);
      notify();
      return;
    }

    // Bounded silently, and the report must say how many distinct messages
    // fell off the end.
    while (groups.size >= capacity) {
      const oldest = groups.keys().next();
      if (oldest.done === true) break;
      groups.delete(oldest.value);
      dropped += 1;
    }

    groups.set(key, {
      source,
      level,
      message,
      stack,
      count: 1,
      firstAt: at,
      lastAt: at,
    });
    notify();
  };

  const clock = (): number => {
    try {
      const value = now();
      return typeof value === "number" && Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  };

  /**
   * `console.error("%s failed", name)` the way the console shows it.
   *
   * Worth the thirty lines because React's own dev warnings — by some distance
   * the most common `console.error` in a React app — are format strings, and a
   * tail that reported them as `"%o\n\n%s\n\n%s"` followed by the arguments
   * would be a worse copy of the thing it exists to replace. Substitution
   * happens on *already-masked* pieces, so it cannot re-assemble a sentence out
   * of raw ones. `%c` consumes its argument and emits nothing: it is CSS for a
   * console nobody is looking at.
   */
  const SPECIFIER = /%[sdifoOjc%]/g;

  const substitute = (template: string, rest: Argument[]): string => {
    let index = 0;
    const filled = template.replace(SPECIFIER, (token) => {
      if (token === "%%") return "%";
      if (index >= rest.length) return token;
      const argument = rest[index] as Argument;
      index += 1;
      if (token === "%c") return "";
      if (token === "%d" || token === "%i") {
        const value = Number(argument.value);
        return Number.isFinite(value) ? String(Math.trunc(value)) : "NaN";
      }
      if (token === "%f") {
        const value = Number(argument.value);
        return Number.isFinite(value) ? String(value) : "NaN";
      }
      return describe(argument);
    });
    // The template itself is foreign text too — masked after substitution
    // would be the "redact a sentence" mistake, so it is masked before, and
    // the pieces put into it were masked on their own.
    return [maskString(filled), ...rest.slice(index).map(describe)].join(" ").trim();
  };

  const describe = (argument: Argument): string => describeArgument(argument);

  /** A value nobody has classified yet. Reads it once, then only the snapshot. */
  const describeValue = (value: unknown): string =>
    describeArgument({ value, error: readErrorLike(value) });

  const fromArguments = (
    source: ConsoleTailSource,
    level: ConsoleTailLevel,
    args: readonly unknown[],
  ): void => {
    // Every argument is read here, once, and only this copy is used below —
    // classification and formatting must not ask a getter twice.
    const prepared: Argument[] = args.map((value) => ({ value, error: readErrorLike(value) }));

    let stack: string | null = null;
    for (const argument of prepared) {
      if (argument.error !== null) {
        stack = maskStack(argument.error.stack);
        break;
      }
    }

    const [first, ...rest] = prepared;
    let message: string;
    if (prepared.length === 0) {
      message = "(no arguments)";
    } else if (
      first !== undefined &&
      typeof first.value === "string" &&
      SPECIFIER.test(first.value)
    ) {
      // `test` on a /g regex advances `lastIndex`; `replace` below resets it,
      // but the next `test` would otherwise start mid-string.
      SPECIFIER.lastIndex = 0;
      message = substitute(first.value, rest);
    } else {
      message = prepared.map(describe).join(" ");
    }
    record(source, level, cap(message, maxMessageChars), stack);
  };

  /* ---------------------------------------------------------------------- */
  /* Window events                                                           */
  /* ---------------------------------------------------------------------- */

  const onWindowError = (event: Event): void => {
    const detail = event as Event & {
      message?: unknown;
      filename?: unknown;
      lineno?: unknown;
      colno?: unknown;
      error?: unknown;
    };
    // Read once, used once — same rule as the console arguments, and the same
    // reason: an `error` event is dispatched by whoever dispatched it.
    let raw: { message?: unknown; filename?: unknown; lineno?: unknown; colno?: unknown } = {};
    let thrown: unknown;
    try {
      raw = {
        message: detail.message,
        filename: detail.filename,
        lineno: detail.lineno,
        colno: detail.colno,
      };
      thrown = detail.error;
    } catch {
      /* a dispatched event is foreign too */
    }

    const parts: string[] = [];
    const error = readErrorLike(thrown);
    const message = typeof raw.message === "string" ? raw.message : "";
    const filename = typeof raw.filename === "string" ? raw.filename : "";
    const { lineno, colno } = raw;
    if (error !== null) parts.push(describeErrorLike(error));
    else if (message !== "") parts.push(maskString(message));
    // A failed <img>/<script> load fires an `error` event with neither, and it
    // does not bubble to `window` anyway. Nothing to report rather than a row
    // that says nothing.
    if (parts.length === 0) return;

    if (filename !== "") {
      const line = typeof lineno === "number" ? `:${lineno}` : "";
      const column = typeof colno === "number" ? `:${colno}` : "";
      parts.push(`(${maskUrls(filename)}${line}${column})`);
    }

    record(
      "window.error",
      "error",
      cap(parts.join(" "), maxMessageChars),
      error === null ? null : maskStack(error.stack),
    );
  };

  const onRejection = (event: Event): void => {
    let reason: unknown;
    try {
      reason = (event as Event & { reason?: unknown }).reason;
    } catch {
      reason = undefined;
    }
    const error = readErrorLike(reason);
    const described = error === null ? describeValue(reason) : describeErrorLike(error);
    record(
      "unhandledrejection",
      "error",
      // Our own prefix, joined *after* the foreign half was masked.
      cap(`Unhandled rejection: ${described}`, maxMessageChars),
      error === null ? null : maskStack(error.stack),
    );
  };

  /* ---------------------------------------------------------------------- */
  /* Lifecycle                                                               */
  /* ---------------------------------------------------------------------- */

  const stop = (): void => {
    if (!running) return;
    running = false;
    const pending = stops;
    stops = [];
    watching = [];
    for (const off of pending) {
      try {
        off();
      } catch {
        /* teardown may not fail */
      }
    }
  };

  const start = (): (() => void) => {
    if (!enabled || running) return stop;
    running = true;
    started = true;
    watching = [];

    try {
      attachAll();
    } catch {
      // Nothing below is expected to throw — every foreign read in it is
      // guarded. If one finds a way to anyway, a half-installed tail is the
      // one outcome that is not allowed: it would leave `console.error`
      // wrapped with no teardown registered for it. Unwind and report
      // `unavailable` rather than take the app's console down with us.
      stop();
    }
    observedAnything ||= watching.length > 0;
    return stop;
  };

  const attachAll = (): void => {
    if (watchError) {
      const patch = attach("error", (args) => fromArguments("console.error", "error", args));
      if (patch !== null) {
        // Registered whether or not it was verified: teardown first, claims
        // second.
        stops.push(patch.off);
        if (patch.verified) watching.push("console.error");
      }
    }
    if (watchWarn) {
      const patch = attach("warn", (args) => fromArguments("console.warn", "warn", args));
      if (patch !== null) {
        stops.push(patch.off);
        if (patch.verified) watching.push("console.warn");
      }
    }

    const target = eventTarget();
    if (target !== null) {
      if (watchWindow) {
        target.addEventListener("error", onWindowError);
        stops.push(() => target.removeEventListener("error", onWindowError));
        watching.push("window.error");
      }
      if (watchRejections) {
        target.addEventListener("unhandledrejection", onRejection);
        stops.push(() => target.removeEventListener("unhandledrejection", onRejection));
        watching.push("unhandledrejection");
      }
    }
  };

  const status = (): ConsoleTailStatus => {
    if (!enabled) return "disabled";
    if (running) return watching.length === 0 ? "unavailable" : "capturing";
    if (!started) return "pending";
    // "Stopped" is a claim about what was seen while running. A start that
    // never managed to watch anything — no `window`, a frozen `console` — saw
    // nothing, and reporting zero errors for it would be an observation
    // nobody made. It stays `unavailable`, and the counts stay `null`.
    return observedAnything ? "stopped" : "unavailable";
  };

  return {
    start,
    stop,
    counts: () => ({ errors, warnings }),

    clear() {
      groups.clear();
      errors = 0;
      warnings = 0;
      dropped = 0;
      notify();
    },

    report(limit) {
      const state = status();
      const observed = state === "capturing" || state === "stopped";
      const all = [...groups.values()].reverse();
      const kept =
        limit === undefined || !Number.isFinite(limit)
          ? all
          : all.slice(0, Math.max(0, Math.floor(limit)));
      return {
        status: state,
        note: describeTail(state, watching),
        watching: [...watching],
        // "Watched and saw none" and "never watched" are opposite claims; the
        // second is `null`, exactly as the responsiveness counts are.
        errors: observed ? errors : null,
        warnings: observed ? warnings : null,
        dropped: observed ? dropped : null,
        truncated: kept.length < all.length,
        // Copies: an entry keeps being grouped into after a snapshot holds it.
        entries: kept.map((entry) => ({ ...entry })),
      };
    },
  };
}

const positive = (value: number | undefined, fallback: number): number =>
  value === undefined || !Number.isFinite(value) || value <= 0 ? fallback : Math.floor(value);

const cap = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max)}… (${text.length - max} more characters)`;

/**
 * The listener target. `window`, deliberately, and not `globalThis`: Node's
 * global is an `EventTarget` too, so listening there would report `"capturing"`
 * on a server that can never fire either event.
 */
function eventTarget(): EventTarget | null {
  try {
    const win = (globalThis as { window?: unknown }).window;
    if (win === undefined || win === null) return null;
    const candidate = win as EventTarget;
    if (
      typeof candidate.addEventListener !== "function" ||
      typeof candidate.removeEventListener !== "function"
    ) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}
