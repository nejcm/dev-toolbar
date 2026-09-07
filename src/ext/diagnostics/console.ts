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
 * every start/stop cycle strands one more. Executed on the built ESM+CJS pair
 * over one `console`, inner stopped first each cycle: **under Node 26.4.0,
 * `console.error` throws `RangeError: Maximum call stack size exceeded` from
 * cycle 10,408** (stable across runs); **under Bun 1.4.0 the same loop still
 * forwarded after 20,000 cycles** and never threw. The number is a property of
 * the engine's stack depth, not of this package — quote it with its engine or
 * not at all. What matters is not the cycle but what happens past it: nothing
 * reaches the original, so the **host app's own logging** is gone, not merely
 * our capture. An engine that never runs out simply keeps paying a frame per
 * cycle instead.
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
 * URL pass, because a credential-carrying URL sitting *inside* a sentence is
 * the common console shape and anchored matching cannot see it. Strings this
 * module *builds* are masked too — the leaves of a `redact()`ed object before
 * they are joined into JSON, since `redact()` keeps an `Error`'s `name`
 * verbatim and anchored matching cannot see into a finished line.
 *
 * ### `redact()` is the only judge of a credential, and it is not asked twice
 *
 * There is exactly one thing in this module that decides what a credential
 * looks like, and it is `redact()` looking at a **whole value**. Three
 * mechanisms tried to be a second one — a frame classifier, then a header
 * classifier, then a whitespace tokeniser that re-asked `redact()` about each
 * word and each adjacent pair — and all three shipped a leak. The tokeniser
 * missed a credential the message split across a newline, masked `token
 * Bearer` while shipping the overlapping secret beside the marker, and turned
 * `"the token expired"` into `"the token [redacted]"` on the way.
 *
 * A stack header leaks for one reason and it is not a matching problem: V8
 * repeats `\`${name}: ${message}\`` above the first frame, so a credential in
 * either half appears there *as part of a longer string*. The header carries
 * nothing the tail does not already report — the message line is built from
 * the same two halves, masked — so `maskStack()` **deletes** it and keeps
 * every remaining line. Deletion is why this is the last shape: substituting
 * the masked halves for the raw ones leaked on overlapping halves (a `name` of
 * `Bearer A` inside a `Digest realm="Bearer A",nonce="…"` message — replacing
 * the name rewrote the text the message replacement needed to match, and
 * reversing the order only moved the hole), and nothing that removes text can
 * corrupt what is left. See `maskStack()`.
 *
 * Three rules the leaks all came from, and all three are load-bearing:
 *
 * - **Read a foreign property once.** A getter answers differently on the
 *   second read; `typeof e.message === "string" ? mask(e.message) : ""` is two
 *   reads. Everything that classifies as error-shaped is snapshotted by
 *   `readErrorLike()` first and only the snapshot is used after that. The
 *   guarantee stops at classification: an argument that is *not* error-shaped
 *   is handed to `redact()`, which walks it and reads its properties itself,
 *   so "read once" is a claim about a classified `ErrorSnapshot`, not about
 *   every value the tail is given.
 * - **Never mask half of something.** A URL run stops at whitespace only —
 *   ending it at a quote handed `redactUrl()` a truncated URL and left the
 *   credential sitting next to a `[redacted]` marker that claimed otherwise.
 * - **Never emit a branch you did not walk.** Whatever the masker stops
 *   short of — an object deeper than it descends — is `[truncated]`, never
 *   passed through verbatim. Every leak here began as something kept because
 *   it "looked harmless".
 *
 * ## Nothing is re-patched, and nothing claims to be watching what it is not
 *
 * `start()` patches the console that is live at that moment, and it never
 * patches again on its own: a tail that silently re-wrapped whatever object
 * appeared at `globalThis.console` would be patching consoles nobody asked it
 * to. What it does do is **ask again**. Every `attach()` re-runs the
 * read-back, whatever the cached registration says, and `report()` re-derives
 * the status from a live read-back rather than from the answer `start()` got.
 *
 * So the two ways a patch stops being live are both visible instead of
 * silent — executed, both of them:
 *
 * - **The method is replaced under a stable console identity.** Start a tail
 *   on `A`, then `A.error = something else`. The registration is keyed by
 *   `(console, method)` and that key is unchanged, so nothing is re-installed;
 *   the read-back fails, and the tail reports `unavailable` with an empty
 *   `watching` instead of `capturing`. A second tail started in that state is
 *   told the same thing rather than adopting a dead wrapper.
 * - **The whole console is swapped.** `globalThis.console = B` leaves `B`
 *   unpatched. The wrapper on `A` stays restorable by identity, so nothing is
 *   stranded, and because the target we hold is no longer the live console the
 *   tail reports `unavailable` — not `capturing` with counts nobody observed.
 *   The wrapper on `A` does keep recording if anything still calls `A.error`
 *   directly, so `unavailable` can arrive with entries and a non-zero count.
 *   That is deliberate: a count is a claim about what was seen, and the status
 *   is a claim about what is being watched. Measured: `status: "unavailable"`,
 *   `watching: []`, `errors: 1`, one entry.
 *
 * A **transparent `Proxy`** is the case that stays open, and it cannot be
 * closed from here: `new Proxy(A, {})` is a distinct object, so it is a
 * distinct `WeakMap` key addressing the same underlying property. Executed —
 * start tail 1 on `A`, then `globalThis.console = new Proxy(A, {})` and start
 * tail 2: tail 2 installs a second wrapper *around tail 1's*, only tail 2
 * captures (the shared depth guard silences the inner one), and stopping tail
 * 1 first strands tail 2's wrapper because teardown never restores over a
 * later patch. No key can tell a transparent `Proxy` from its target, so this
 * is documented rather than detected.
 *
 * What still escapes, pinned by tests in `__tests__/console.test.tsx`: **a
 * credential written into prose**, which now explicitly includes an `Error`
 * *message* like `"failed: token Bearer sk-live-…"` — the message and the
 * stack both carry it, because the whole string is not a credential and
 * nothing here judges parts of one; a credential inside a stack frame's
 * *function name*; a header an engine **transforms** rather than repeats (an
 * upper-cased `name`, say), which is not the text `maskStack()` compares
 * against and therefore survives as a line of the stack; and anything
 * reachable only through `Error.cause` or `AggregateError.errors`, which are
 * not read at all.
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

/**
 * One source this tail attached to, and how to ask whether it is still
 * attached. `watching` used to be a plain list of source names, fixed at
 * `start()`: the answer from then, reported forever after. `live()` is what
 * makes the report a present-tense claim.
 */
interface Watch {
  source: ConsoleTailSource;
  live(): boolean;
}

/**
 * A `window` listener's liveness. It is held by a reference this module owns
 * and removed by identity on teardown, so there is nothing to re-read: while
 * the tail is running, it is listening. Only a console *patch* can be taken
 * away without telling us, and that is what `Attachment.live()` re-reads.
 */
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

/**
 * One live wrapper, shared by every tail in this module copy that patches the
 * same method **of the same console object**.
 *
 * `owners` counts tails, `listeners` counts the ones actually recording. They
 * differ for an unverified patch, which is registered — so a second tail from
 * this module copy does not wrap our own wrapper — but adds no listener and
 * claims nothing.
 */
interface Installed {
  owners: number;
  verified: boolean;
  /** Re-runs the read-back. A getter that threw once may answer the second time. */
  verify(): boolean;
  listeners: Set<ConsoleListener>;
  uninstall(): void;
}

/**
 * Registrations, owned by *console identity* and then by method.
 *
 * A page can change `globalThis.console` underneath us (a test rig stubbing
 * it, a hardened host swapping it), and a registration made on one console
 * says nothing about another: keeping a single entry per method name and
 * comparing its target made every later tail on a *third* console inherit the
 * wrong answer. Keying by the object instead is what makes "is this method
 * already ours?" a question about the object in front of us — a page that
 * returns to a console we are still patching finds the wrapper that is there
 * and shares it, instead of wrapping our own wrapper (which the shared `depth`
 * guard then silences, and which teardown cannot unwind in either order).
 *
 * A `WeakMap`, so a console the page has dropped is collectable with its
 * registrations.
 */
const patches = new WeakMap<ConsoleLike, Map<PatchedMethod, Installed>>();

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
  /** The read-back, callable again later. See `Installed.verify`. */
  verify(): boolean;
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

  // An accessor with a *silent* setter swallows the assignment and leaves the
  // original in place. Reporting that as `watching` would be the worst kind of
  // wrong: a tail that says it is capturing and records nothing. A throwing
  // getter is not evidence that the assignment failed either way, so it reads
  // as unverified and stays askable.
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

/**
 * `null` when nothing was assigned at all; otherwise a teardown, plus whether
 * the patch was confirmed live. An unverified patch is reported as *not*
 * watched — but its teardown is still returned, because the assignment may
 * have landed somewhere we cannot read back.
 */
interface Attachment {
  off(): void;
  verified: boolean;
  /**
   * Whether this attachment is watching *right now*, asked fresh. Three things
   * have to hold, and each one failed on its own in a reviewer's hands: our
   * listener is registered, the console we patched is still the live one (a
   * page that swapped `globalThis.console` leaves us holding a patched object
   * nothing calls), and the read-back still finds our wrapper (a page that
   * replaced the method under a stable console identity leaves the
   * registration keyed correctly and dead).
   */
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
    // Ask again — *every* time, whatever the cached entry says — rather than
    // install a second wrapper over our own. The reason an unverified patch is
    // registered at all is that a read-back can fail once (a getter that threw
    // during the assignment and has since recovered), and installing again
    // would wrap our own wrapper, so the outer teardown would "restore" the
    // inner one and strand it forever. Re-asking only when the entry was
    // *unverified* was its own defect: a page that replaced the method under a
    // stable console identity left a registration that still said `verified`,
    // so every later tail adopted a dead wrapper and reported `capturing`
    // while recording nothing.
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

/**
 * The snapshot plus what masking made of the two halves V8 writes above the
 * first frame. The masked forms are the line the tail shows
 * (`describeErrorLike()`); the raw ones are what `maskStack()` compares the
 * head of the stack against before deleting it. Masking either half twice
 * would be two answers to the same question.
 */
interface MaskedErrorSnapshot extends ErrorSnapshot {
  maskedName: string;
  maskedMessage: string;
}

/**
 * The name an engine writes into the header when the error has none. Not a
 * guess about shape — `Error.prototype.toString` and V8's stack formatter both
 * fall back to it, and V8's formatter treats an empty `name` as absent — so
 * for a `message`-only error the known header text is `` `Error: ${message}` ``
 * and nothing else. Leaving it out was a leak, measured: an error-shaped object
 * with no `name` property, or one whose `name` was set to `""` after
 * construction, put its raw credential-carrying message back into the stack.
 */
const DEFAULT_ERROR_NAME = "Error";

/**
 * The stack with the header line removed, or unchanged when it has none.
 *
 * The header is the one place in a stack where the `name` and the `message`
 * appear, and both are known here **exactly** — so this is a comparison
 * against known text, never a test for what a header looks like. Two earlier
 * versions did test for that and both leaked: dropping everything above the
 * first *recognised* frame threw away frameless stacks and every stack from an
 * unfamiliar engine, and `^\S*@\S*:\d+` accepted the header of an `Error`
 * whose `name` was `fake@host:1`.
 *
 * Whichever known form the stack **starts with** is removed with the rest of
 * its line. Matching the prefix of the whole stack rather than of the first
 * line is deliberate: a message containing a newline spreads the header over
 * several lines (`new Error("Bearer\nsk-live-…")`), and deleting only the
 * first of them would leave the second half of a credential behind.
 *
 * The forms are tried most-specific-first, because `${name}: ${message}` has
 * to win over either half alone. Over-deletion is possible — a `message` of `""` and
 * a `name` of `Error` also prefixes a first line reading `ErrorFoo: bar` — and
 * it is acceptable in a way that rewriting is not: removing text can lose a
 * frame, but it cannot leave a credential next to a marker claiming it was
 * handled, and it cannot corrupt the text another replacement was about to
 * match. That is the whole reason this replaces substitution.
 */
function withoutHeader(stack: string, name: string | null, message: string | null): string {
  const named = name ?? "";
  const said = message ?? "";
  const forms: string[] = [];
  if (said !== "") {
    if (named !== "") forms.push(`${named}: ${said}`);
    // The message-only shape: no usable `name`, so the engine wrote its own.
    forms.push(`${DEFAULT_ERROR_NAME}: ${said}`);
    forms.push(said);
  }
  // Last, and only ever a real one: a bare `Error` would be needed only where
  // both halves are empty, and a header with nothing in it has nothing to leak.
  if (named !== "") forms.push(named);
  for (const form of forms) {
    if (form === "" || !stack.startsWith(form)) continue;
    // Whatever an engine appended to the header shares its line and goes with
    // it; no engine puts a frame on that line.
    const rest = stack.slice(form.length);
    const newline = rest.indexOf("\n");
    return newline === -1 ? "" : rest.slice(newline + 1);
  }
  return stack;
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
  let watches: Watch[] = [];
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
   * A foreign string: whole-value shape matching, then the URL pass. That is
   * the entire mechanism — see the module docblock for the three that tried to
   * be more than this and leaked.
   */
  const maskString = (value: string): string => {
    try {
      return maskUrls(redact(value, redactOptions));
    } catch {
      return "[unreadable]";
    }
  };

  /**
   * Classify once, and mask both halves of the header once, here. The masked
   * halves are what `describeErrorLike()` joins into the line the tail shows;
   * the raw ones stay on the snapshot because `maskStack()` compares the head
   * of the stack against them. Masking either twice would be two answers to
   * the same question.
   */
  const prepareError = (value: unknown): MaskedErrorSnapshot | null => {
    const error = readErrorLike(value);
    if (error === null) return null;
    return {
      ...error,
      maskedName: error.name === null ? "" : maskString(error.name),
      maskedMessage: maskString(error.message ?? ""),
    };
  };

  /**
   * The stack with its header line deleted, and every remaining line masked.
   *
   * The stack leaks for one specific reason: V8 writes `\`${name}: ${message}\``
   * above the first frame, and `redact()`'s value matching is anchored, so
   * `Bearer sk-live-…` is a credential and `Error: Bearer sk-live-…` is not.
   * **Both halves of that header carry the hazard**, so both had to go, and
   * three shapes of *rewriting* it leaked before this one:
   *
   * - masking line by line missed a credential the message split across a
   *   newline (the header became `Error: Bearer`, the secret a line of its
   *   own, and neither is a credential alone);
   * - re-tokenising every line into words and adjacent pairs masked `token
   *   Bearer` and shipped the overlapping secret beside the marker, and
   *   reported `"the token expired"` as `"the token [redacted]"`;
   * - substituting the masked halves for the raw ones leaked on **overlapping
   *   halves**: a `name` of `Bearer A` under a message of
   *   `Digest realm="Bearer A",nonce="FULL_SECRET_123"` exported the nonce,
   *   because replacing the name rewrote the text the message replacement
   *   needed to match. Reversing the order moves the hole to the other overlap
   *   rather than closing it.
   *
   * So the header is **removed**, by `withoutHeader()`, against the known raw
   * text — no scanner, no tokeniser, no frame shape. A deletion cannot
   * overlap-corrupt what is left, which is the entire reason it replaces
   * substitution. Nothing is lost by it either: the header's only content is
   * the `name` and the `message`, and the line the tail shows is those two
   * halves, masked. A stack that is *only* a header therefore has no lines
   * left, and `null` — no stack — is the honest report of that.
   *
   * Everything that remains goes through `maskString` like any other foreign
   * string, unchanged from before: whole-value matching plus the URL pass. A
   * credential inside a frame's function name still survives, and so does one
   * in prose — documented limits, and the reason the panel shows you the text
   * before you copy it.
   *
   * Takes the snapshot rather than loose strings: the `name` and `message` it
   * compares against have to be the ones read **once**, and a parameter list
   * is an invitation to pass a freshly-read one.
   */
  const maskStack = (error: MaskedErrorSnapshot): string | null => {
    const { stack, name, message } = error;
    if (stack === null || stack === "" || maxStackChars === 0) return null;
    try {
      const frames = withoutHeader(stack, name, message);
      if (frames.trim() === "") return null;
      return cap(maskString(frames), maxStackChars);
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

  /**
   * A value nobody has classified yet. Classifies it once; if it *is*
   * error-shaped, only the snapshot is used from here on. A value that is not
   * error-shaped is read again by `redact()` inside `describeArgument`, which
   * is unavoidable — walking an object is reading it.
   */
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
      parts.push(`(${maskUrls(filename)}${line}${column})`);
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
      // Nothing below is expected to throw — every foreign read in it is
      // guarded. If one finds a way to anyway, a half-installed tail is the
      // one outcome that is not allowed: it would leave `console.error`
      // wrapped with no teardown registered for it. Unwind and report
      // `unavailable` rather than take the app's console down with us.
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

  /**
   * Every source still attached, asked fresh. A window listener is held by a
   * reference we own and removed by identity, so it stays live until teardown;
   * a console patch is re-read every time, because the page can take it away
   * without telling us. Never throws: an unreadable console is not a watched
   * one.
   */
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

  /**
   * Derived from a *live* read-back, not from the answer `start()` got. A tail
   * whose console was swapped or whose method was replaced under it used to go
   * on reporting `capturing` with the sources it once attached to; it reports
   * `unavailable` now — nothing here can be watched any more — which is the
   * same claim, for the same reason, as a start that never managed to watch
   * anything.
   */
  const stateOf = (live: readonly ConsoleTailSource[]): ConsoleTailStatus => {
    if (!enabled) return "disabled";
    if (!started) return "pending";
    if (running) return live.length === 0 ? "unavailable" : "capturing";
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
      const live = liveSources();
      const state = stateOf(live);
      // A count is a claim about what was watched, so it survives the watch
      // ending: a tail that captured four errors and then had its console
      // swapped still saw four. What may never read as zero is a tail that
      // never watched anything — the same rule as before, now the only rule.
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

/**
 * Truncation, and it may cut anywhere — including through a `[redacted]`
 * marker. Executed: a `maxMessageChars` of 12 over `Bearer sk-live-…` yields
 * `Bearer [reda… (5 more characters)`.
 *
 * That is accepted rather than fixed, deliberately. Slicing only ever
 * *removes* trailing characters, so a cut mask cannot reveal anything: the
 * secret was already replaced before `cap()` saw the string, and a shortened
 * marker is a cosmetic blemish on a caller who asked for a twelve-character
 * message. Teaching `cap()` to avoid cutting a mask would give this module a
 * second notion of what a mask looks like — the exact shape of the three
 * classifiers that leaked here — for a caller nobody has.
 */
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
