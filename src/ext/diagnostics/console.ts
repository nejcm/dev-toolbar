/**
 * The console and error tail (`plans/ecosystem-extensions.md` § 1B). Full
 * contract is in docs/ext/diagnostics.md; this header only orients the code.
 *
 * Patches `console.error`/`console.warn` and listens for `window`'s `error`
 * and `unhandledrejection`, grouping by message into a bounded, redacted
 * tail. Always calls through, restores by identity on teardown and never
 * over a later patch (same rule as the `fetch` interceptor in
 * `src/runtime/network.ts`). A module-level depth guard prevents recursion
 * when a recorder's own logging (or `ExtensionBoundary.componentDidCatch`)
 * re-enters a patched method. `console.log` is never patched.
 *
 * Patch state is module-level, so the dual-package hazard applies (see
 * `src/runtime/network.ts`, and docs/ext/diagnostics.md § "before you ship
 * two copies"): an ESM+CJS pair detached inner-first strands a wrapper per
 * cycle.
 *
 * Stacks are masked with `redactText()`; messages, names and string
 * arguments with `redactProse()` (whole-value plus URL sweep, from
 * `/runtime`).
 */
import { describeError, redact, redactProse, redactText } from "../../runtime";
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

/** One attached source; `live()` asks fresh rather than trusting `start()`'s answer. */
interface Watch {
  source: ConsoleTailSource;
  live(): boolean;
}

// A window listener stays live until teardown removes it by identity; only a
// console patch can be taken away without telling us.
const stillListening = (): boolean => true;

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

// One live wrapper, shared by every tail in this module copy patching the same
// method of the same console object. `owners` counts tails, `listeners` counts
// the ones actually recording — they differ for an unverified patch.
interface Installed {
  owners: number;
  verified: boolean;
  /** Re-runs the read-back. A getter that threw once may answer the second time. */
  verify(): boolean;
  listeners: Set<ConsoleListener>;
  uninstall(): void;
}

// Keyed by console identity, not method name alone: a page can swap
// `globalThis.console`, so a per-method-only entry could leak across consoles.
const patches = new WeakMap<ConsoleLike, Map<PatchedMethod, Installed>>();

// Shared by every patched method: logging while a listener runs forwards to
// the original without recording again (the re-entrancy guard).
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

// The outcome of one patch attempt. `restore` is kept even when `verified` is
// false: a setter can store the wrapper while its getter throws once and then
// recovers, so a discarded handle there would leave nothing to undo it.
interface Patch {
  restore(): void;
  verified: boolean;
  /** The read-back, callable again later. See `Installed.verify`. */
  verify(): boolean;
}

function install(
  target: ConsoleLike,
  method: PatchedMethod,
  listeners: Set<ConsoleListener>,
): Patch | null {
  // Guarded: a hardened host can make this an accessor that throws, and a
  // throwing getter must be a method we skip, not an exception out of `start()`.
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

  // A silent setter swallows the assignment; reporting that as `watching`
  // would be a tail that claims to capture and records nothing.
  const verify = (): boolean => {
    try {
      return target[method] === wrapper;
    } catch {
      return false;
    }
  };

  try {
    target[method] = wrapper;
  } catch {
    // A frozen or getter-only `console` (a hardened host, a locked-down test
    // rig). A setter can also store the value and *then* throw, so from here
    // on the handle is kept: an unverified patch is still a patch to undo.
    return { restore, verified: false, verify };
  }

  return { restore, verified: verify(), verify };
}

// `null` when nothing was assigned; otherwise a teardown plus whether the
// patch was confirmed live (an unverified patch still gets a teardown).
interface Attachment {
  off(): void;
  verified: boolean;
  /** Whether this is watching right now, asked fresh rather than cached. */
  live(): boolean;
}

function attach(method: PatchedMethod, listener: ConsoleListener): Attachment | null {
  const target = consoleObject();
  if (target === null) return null;
  const known = patches.get(target);
  // Created eagerly, published only once something is actually registered in
  // it — a method we could not patch leaves no trace behind.
  const methods = known ?? new Map<PatchedMethod, Installed>();
  let current = methods.get(method) ?? null;
  if (current === null) {
    const listeners = new Set<ConsoleListener>();
    const patch = install(target, method, listeners);
    if (patch === null) return null;
    current = {
      listeners,
      uninstall: patch.restore,
      verify: patch.verify,
      owners: 0,
      verified: patch.verified,
    };
    if (known === undefined) patches.set(target, methods);
    methods.set(method, current);
  } else {
    // Re-verify every time, even a cached "verified" entry: the method may
    // have been replaced under a stable console identity since.
    current.verified = current.verify();
  }
  const installed = current;
  installed.owners += 1;
  if (installed.verified) installed.listeners.add(listener);
  let attached = true;
  return {
    verified: installed.verified,
    live: () =>
      attached &&
      installed.listeners.has(listener) &&
      consoleObject() === target &&
      installed.verify(),
    off: () => {
      if (!attached) return;
      attached = false;
      installed.owners -= 1;
      installed.listeners.delete(listener);
      if (installed.owners > 0) return;
      installed.uninstall();
      // Only if it is still the registration for this console's method: a
      // stale teardown may not evict a live one.
      if (methods.get(method) === installed) methods.delete(method);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Formatting, redacted argument by argument                                   */
/* -------------------------------------------------------------------------- */

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

// A snapshot, not the live object: reading `name`/`message`/`stack` twice
// would let a hostile getter answer differently the second time. This stays
// beside `/runtime`'s `describeError()` rather than being replaced by it
// because the tail also needs `stack`, and because a value with a `message`
// but neither `name` nor `stack` is an ordinary object here, not an error.
interface ErrorSnapshot {
  name: string | null;
  message: string | null;
  stack: string | null;
}

interface MaskedErrorSnapshot extends ErrorSnapshot {
  maskedName: string;
  maskedMessage: string;
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
  error: MaskedErrorSnapshot | null;
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

  // A `Map`, not a ring: eviction must be least-recently-repeated, and a ring
  // orders and evicts by *first* occurrence, which throws away the wrong entry.
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
  let watches: Watch[] = [];
  let stops: (() => void)[] = [];

  /* ---------------------------------------------------------------------- */
  /* Masking                                                                 */
  /* ---------------------------------------------------------------------- */

  // Whole-value shape matching, then the URL pass — `/runtime`'s
  // `redactProse()`, which never throws. This is what a message gets; stacks
  // take `redactText()` instead, for the reason in the module docblock.
  const maskString = (value: string): string => redactProse(value, redactOptions);

  const prepareError = (value: unknown): MaskedErrorSnapshot | null => {
    const error = readErrorLike(value);
    if (error === null) return null;
    // Masked by `/runtime`'s describer over the *snapshot*, not the live
    // object: its properties were each read exactly once above, and
    // `describeError()` masks name and message separately, never the join.
    const described = describeError(
      { name: error.name ?? undefined, message: error.message ?? "" },
      redactOptions,
    );
    return { ...error, maskedName: described.name ?? "", maskedMessage: described.message };
  };

  const maskStack = (error: MaskedErrorSnapshot): string | null => {
    const { stack } = error;
    if (stack === null || stack.trim() === "" || maxStackChars === 0) return null;
    try {
      return cap(redactText(stack, redactOptions), maxStackChars);
    } catch {
      return null;
    }
  };

  // `redact()` only matches a value-shaped whole leaf and keeps `Error.name`
  // verbatim, so the leaves of an already-redacted copy are re-masked here
  // before they are joined into the JSON line this module builds.
  const maskLeaves = (value: unknown, depth = 0): unknown => {
    if (typeof value === "string") return maskString(value);
    if (typeof value !== "object" || value === null) return value;
    // Past this bound the branch is unprocessed and must not be emitted —
    // returning it whole let a deep credential out under a raised `maxDepth`.
    if (depth >= MASK_DEPTH) return TRUNCATED;
    if (Array.isArray(value)) return value.map((entry) => maskLeaves(entry, depth + 1));
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[maskString(key)] = maskLeaves(entry, depth + 1);
    }
    return output;
  };

  // Takes the already-read `Argument`, never a bare value: classifying here
  // would re-read the same foreign getters `readErrorLike()` already snapshot.
  const describeArgument = ({ value, error }: Argument): string => {
    if (typeof value === "string") return cap(maskString(value), ARGUMENT_CHARS);
    if (error !== null) return cap(describeErrorLike(error), ARGUMENT_CHARS);
    try {
      const redacted = redact(value, redactOptions);
      if (redacted === undefined) return "undefined";
      if (typeof redacted === "string") return cap(maskString(redacted), ARGUMENT_CHARS);
      if (typeof redacted === "object" && redacted !== null) {
        const json = JSON.stringify(maskLeaves(redacted));
        return cap(json === undefined ? "[unserialisable]" : maskString(json), ARGUMENT_CHARS);
      }
      return cap(maskString(String(redacted)), ARGUMENT_CHARS);
    } catch {
      return "[unreadable]";
    }
  };

  /** Name and message masked separately, then joined — never the other way round. */
  const describeErrorLike = (error: MaskedErrorSnapshot): string => {
    // Both already masked, by `prepareError`, once — see `MaskedErrorSnapshot`.
    const name = error.maskedName;
    const message = error.maskedMessage;
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

  // Format-string specifiers `console.error("%s failed", name)` substitutes,
  // the way the console shows them — React's dev warnings rely on this.
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

  // Classifies an unclassified value once; a non-error-shaped one is still
  // read again by `redact()` inside `describeArgument` — walking is reading.
  const describeValue = (value: unknown): string =>
    describeArgument({ value, error: prepareError(value) });

  const fromArguments = (
    source: ConsoleTailSource,
    level: ConsoleTailLevel,
    args: readonly unknown[],
  ): void => {
    // Every argument is read here, once, and only this copy is used below —
    // classification and formatting must not ask a getter twice.
    const prepared: Argument[] = args.map((value) => ({ value, error: prepareError(value) }));

    let stack: string | null = null;
    for (const argument of prepared) {
      if (argument.error !== null) {
        stack = maskStack(argument.error);
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
    const error = prepareError(thrown);
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
      parts.push(`(${maskString(filename)}${line}${column})`);
    }

    record(
      "window.error",
      "error",
      cap(parts.join(" "), maxMessageChars),
      error === null ? null : maskStack(error),
    );
  };

  const onRejection = (event: Event): void => {
    let reason: unknown;
    try {
      reason = (event as Event & { reason?: unknown }).reason;
    } catch {
      reason = undefined;
    }
    const error = prepareError(reason);
    const described = error === null ? describeValue(reason) : describeErrorLike(error);
    record(
      "unhandledrejection",
      "error",
      // Our own prefix, joined *after* the foreign half was masked.
      cap(`Unhandled rejection: ${described}`, maxMessageChars),
      error === null ? null : maskStack(error),
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
    watches = [];
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
    watches = [];

    try {
      attachAll();
    } catch {
      // Not expected to throw, but a half-installed tail (patched with no
      // teardown registered) is the one outcome not allowed — unwind instead.
      stop();
    }
    observedAnything ||= watches.length > 0;
    return stop;
  };

  const attachAll = (): void => {
    if (watchError) {
      const patch = attach("error", (args) => fromArguments("console.error", "error", args));
      if (patch !== null) {
        // Registered whether or not it was verified: teardown first, claims
        // second.
        stops.push(patch.off);
        if (patch.verified) watches.push({ source: "console.error", live: patch.live });
      }
    }
    if (watchWarn) {
      const patch = attach("warn", (args) => fromArguments("console.warn", "warn", args));
      if (patch !== null) {
        stops.push(patch.off);
        if (patch.verified) watches.push({ source: "console.warn", live: patch.live });
      }
    }

    const target = eventTarget();
    if (target !== null) {
      if (watchWindow) {
        target.addEventListener("error", onWindowError);
        stops.push(() => target.removeEventListener("error", onWindowError));
        watches.push({ source: "window.error", live: stillListening });
      }
      if (watchRejections) {
        target.addEventListener("unhandledrejection", onRejection);
        stops.push(() => target.removeEventListener("unhandledrejection", onRejection));
        watches.push({ source: "unhandledrejection", live: stillListening });
      }
    }
  };

  // Asked fresh every time: a console patch can be taken away without telling
  // us, so an unreadable one is treated as not watched rather than throwing.
  const liveSources = (): ConsoleTailSource[] => {
    const live: ConsoleTailSource[] = [];
    for (const watch of watches) {
      try {
        if (watch.live()) live.push(watch.source);
      } catch {
        /* not watched, then */
      }
    }
    return live;
  };

  // Derived from a live read-back, not `start()`'s answer, so a console
  // swapped or re-patched later reports `unavailable`, not stale `capturing`.
  const stateOf = (live: readonly ConsoleTailSource[]): ConsoleTailStatus => {
    if (!enabled) return "disabled";
    if (!started) return "pending";
    if (running) return live.length === 0 ? "unavailable" : "capturing";
    // A start that never watched anything saw nothing, not zero — stays
    // `unavailable` rather than `stopped`.
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
      const live = liveSources();
      const state = stateOf(live);
      // A count outlives the watch that made it; only "never watched" reads as null.
      const observed = observedAnything;
      const all = [...groups.values()].reverse();
      const kept =
        limit === undefined || !Number.isFinite(limit)
          ? all
          : all.slice(0, Math.max(0, Math.floor(limit)));
      return {
        status: state,
        note: describeTail(state, live),
        watching: live,
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

// May cut through a `[redacted]` marker — accepted, since slicing only removes
// trailing characters and the secret is already replaced before `cap()` sees it.
const cap = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max)}… (${text.length - max} more characters)`;

// `window`, not `globalThis`: Node's global is an `EventTarget` too, and would
// report "capturing" on a server that can never fire either event.
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
