/**
 * The console and error tail. [dev-toolbar/ext/diagnostics]
 * (`plans/ecosystem-extensions.md` § 1B.)
 *
 * `window`'s `error` and `unhandledrejection` events, plus `console.error` and
 * `console.warn`, grouped by message into a bounded ring and folded into the
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
 * Patch state is module-level, so the usual dual-package hazard applies, in
 * the same shape `src/runtime/network.ts` documents: a page that resolves both
 * `dist/ext/diagnostics.js` and `dist/ext/diagnostics.cjs` gets two wrappers.
 * Both call through and both record, so nothing is lost or duplicated inside
 * one tail; detaching them inner-first strands the inner wrapper, which is
 * listener-less but still forwards. Resolve the package to one format.
 *
 * ## Redaction
 *
 * A captured message is whatever the app logged, so it is masked **on the way
 * in**, argument by argument, before anything is joined into a line — the rule
 * the rest of this extension follows, and the reason it can be joined at all
 * (`redact()`'s value matching is anchored, so masking an assembled sentence
 * masks nothing). Object arguments are walked by `redact()`, which is where
 * key-name matching does its work; strings get value-shape matching plus a
 * URL pass, because a credential-carrying URL *inside* a sentence is the
 * common console shape and anchored matching cannot see it.
 */
import { createRingBuffer, redact, redactUrl } from "../../runtime";
import type { RedactOptions } from "../../runtime";
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

export interface ConsoleTailOptions {
  /** Patch `console.error`. Default `true`. */
  error?: boolean;
  /** Patch `console.warn`. Default `true`. */
  warn?: boolean;
  /** Listen for `window`'s `error` event. Default `true`. */
  windowErrors?: boolean;
  /** Listen for `window`'s `unhandledrejection` event. Default `true`. */
  rejections?: boolean;
  /** Distinct grouped entries retained. Default `25`; clamped like every ring. */
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
  /** Newest first. `limit` keeps the newest N grouped entries. */
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

function install(method: PatchedMethod, listeners: Set<ConsoleListener>): (() => void) | null {
  const target = consoleObject();
  if (target === null) return null;
  const original = target[method];
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

  try {
    target[method] = wrapper;
  } catch {
    // A frozen or getter-only `console` (a hardened host, a locked-down test
    // rig). Nothing is captured from this method; nothing is broken either.
    return null;
  }

  return () => {
    // Never restore over somebody else's later patch — same rule as the
    // `fetch` interceptor: their wrapper is live and ours is not the outermost.
    try {
      if (target[method] === wrapper) target[method] = original;
    } catch {
      /* nothing left to do about it */
    }
  };
}

/** Returns `null` when the method could not be patched at all. */
function attach(method: PatchedMethod, listener: ConsoleListener): (() => void) | null {
  let current = patches[method];
  if (current === null) {
    const listeners = new Set<ConsoleListener>();
    const uninstall = install(method, listeners);
    if (uninstall === null) return null;
    current = { listeners, uninstall };
    patches[method] = current;
  }
  const installed = current;
  installed.listeners.add(listener);
  return () => {
    installed.listeners.delete(listener);
    if (installed.listeners.size > 0) return;
    installed.uninstall();
    if (patches[method] === installed) patches[method] = null;
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
 */
const URL_LIKE = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>`\\]+/gi;

/** V8 prefixes a stack with `Error: <message>`; SpiderMonkey/JSC start at the first frame. */
const FRAME = /^\s+at\s/;

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

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  stack?: unknown;
}

/** Duck-typed on purpose: `instanceof Error` is false across realms (an iframe, a worker). */
function asErrorLike(value: unknown): ErrorLike | null {
  if (value === null || typeof value !== "object") return null;
  try {
    const candidate = value as ErrorLike;
    if (typeof candidate.message === "string" && typeof candidate.name === "string") {
      return candidate;
    }
    if (typeof candidate.stack === "string" && typeof candidate.message === "string") {
      return candidate;
    }
    return null;
  } catch {
    // A hostile getter. Not an error we can read; describe it as a value.
    return null;
  }
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

  const ring = createRingBuffer<ConsoleTailEntry>(
    settings.size === undefined ? DEFAULT_TAIL_SIZE : settings.size,
  );
  const groups = new Map<string, ConsoleTailEntry>();

  let errors = 0;
  let warnings = 0;
  let dropped = 0;
  let running = false;
  let started = false;
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

  /** A foreign string: value-shape matching first, then the URL pass. */
  const maskString = (value: string): string => {
    try {
      return maskUrls(String(redact(value, redactOptions)));
    } catch {
      return "[unreadable]";
    }
  };

  /**
   * A stack, without its header. V8 repeats the raw message on the first line,
   * where the anchored matcher cannot see it — so the header is dropped rather
   * than masked, and the message is reported (masked) in `message`.
   */
  const maskStack = (value: unknown): string | null => {
    if (typeof value !== "string" || value === "" || maxStackChars === 0) return null;
    try {
      const lines = value.split("\n");
      const first = lines.findIndex((line) => FRAME.test(line));
      const frames = first > 0 ? lines.slice(first) : lines;
      const masked = frames.map((line) => maskString(line)).join("\n");
      return cap(masked, maxStackChars);
    } catch {
      return null;
    }
  };

  /** One console argument, masked before it can be joined to anything else. */
  const describeArgument = (value: unknown): string => {
    if (typeof value === "string") return cap(maskString(value), ARGUMENT_CHARS);
    const error = asErrorLike(value);
    if (error !== null) return cap(describeErrorLike(error), ARGUMENT_CHARS);
    try {
      const redacted = redact(value, redactOptions);
      if (redacted === undefined) return "undefined";
      if (typeof redacted === "string") return cap(maskUrls(redacted), ARGUMENT_CHARS);
      if (typeof redacted === "object" && redacted !== null) {
        const json = JSON.stringify(redacted);
        return cap(json === undefined ? "[unserialisable]" : maskUrls(json), ARGUMENT_CHARS);
      }
      return cap(String(redacted), ARGUMENT_CHARS);
    } catch {
      return "[unreadable]";
    }
  };

  /** Name and message masked separately, then joined — never the other way round. */
  const describeErrorLike = (error: ErrorLike): string => {
    let name = "";
    let message = "";
    try {
      name = typeof error.name === "string" ? maskString(error.name) : "";
    } catch {
      name = "";
    }
    try {
      message = typeof error.message === "string" ? maskString(error.message) : "";
    } catch {
      message = "";
    }
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
      notify();
      return;
    }

    // The ring overwrites silently; the map must lose the same entry, and the
    // report must say how many distinct messages fell off the end.
    if (ring.size === ring.capacity) {
      const evicted = ring.at(0);
      if (evicted !== undefined) {
        groups.delete(keyOf(evicted.source, evicted.message));
        dropped += 1;
      }
    }

    const entry: ConsoleTailEntry = {
      source,
      level,
      message,
      stack,
      count: 1,
      firstAt: at,
      lastAt: at,
    };
    ring.push(entry);
    groups.set(key, entry);
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

  const substitute = (template: string, rest: unknown[]): string => {
    let index = 0;
    const filled = template.replace(SPECIFIER, (token) => {
      if (token === "%%") return "%";
      if (index >= rest.length) return token;
      const argument = rest[index];
      index += 1;
      if (token === "%c") return "";
      if (token === "%d" || token === "%i") {
        const value = Number(argument);
        return Number.isFinite(value) ? String(Math.trunc(value)) : "NaN";
      }
      if (token === "%f") {
        const value = Number(argument);
        return Number.isFinite(value) ? String(value) : "NaN";
      }
      return describeArgument(argument);
    });
    // The template itself is foreign text too — masked after substitution
    // would be the "redact a sentence" mistake, so it is masked before, and
    // the pieces put into it were masked on their own.
    return [maskString(filled), ...rest.slice(index).map(describeArgument)].join(" ").trim();
  };

  const fromArguments = (
    source: ConsoleTailSource,
    level: ConsoleTailLevel,
    args: readonly unknown[],
  ): void => {
    let stack: string | null = null;
    for (const argument of args) {
      const error = asErrorLike(argument);
      if (error !== null && stack === null) {
        stack = maskStack(error.stack);
        break;
      }
    }

    const [first, ...rest] = args;
    let message: string;
    if (args.length === 0) {
      message = "(no arguments)";
    } else if (typeof first === "string" && SPECIFIER.test(first)) {
      // `test` on a /g regex advances `lastIndex`; `replace` below resets it,
      // but the next `test` would otherwise start mid-string.
      SPECIFIER.lastIndex = 0;
      message = substitute(first, rest);
    } else {
      message = args.map(describeArgument).join(" ");
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
    const parts: string[] = [];
    const error = asErrorLike(detail.error);
    if (error !== null) parts.push(describeErrorLike(error));
    else if (typeof detail.message === "string" && detail.message !== "") {
      parts.push(maskString(detail.message));
    }
    // A failed <img>/<script> load fires an `error` event with neither, and it
    // does not bubble to `window` anyway. Nothing to report rather than a row
    // that says nothing.
    if (parts.length === 0) return;

    if (typeof detail.filename === "string" && detail.filename !== "") {
      const line = typeof detail.lineno === "number" ? `:${detail.lineno}` : "";
      const column = typeof detail.colno === "number" ? `:${detail.colno}` : "";
      parts.push(`(${maskUrls(detail.filename)}${line}${column})`);
    }

    record(
      "window.error",
      "error",
      cap(parts.join(" "), maxMessageChars),
      error === null ? null : maskStack(error.stack),
    );
  };

  const onRejection = (event: Event): void => {
    const reason = (event as Event & { reason?: unknown }).reason;
    const error = asErrorLike(reason);
    const described = error === null ? describeArgument(reason) : describeErrorLike(error);
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

    if (watchError) {
      const off = attach("error", (args) => fromArguments("console.error", "error", args));
      if (off !== null) {
        stops.push(off);
        watching.push("console.error");
      }
    }
    if (watchWarn) {
      const off = attach("warn", (args) => fromArguments("console.warn", "warn", args));
      if (off !== null) {
        stops.push(off);
        watching.push("console.warn");
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

    return stop;
  };

  const status = (): ConsoleTailStatus => {
    if (!enabled) return "disabled";
    if (running) return watching.length === 0 ? "unavailable" : "capturing";
    return started ? "stopped" : "pending";
  };

  return {
    start,
    stop,
    counts: () => ({ errors, warnings }),

    clear() {
      ring.clear();
      groups.clear();
      errors = 0;
      warnings = 0;
      dropped = 0;
      notify();
    },

    report(limit) {
      const state = status();
      const observed = state === "capturing" || state === "stopped";
      const all = ring.toArray().reverse();
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
