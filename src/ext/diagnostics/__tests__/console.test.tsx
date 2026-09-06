/**
 * The console and error tail (`plans/ecosystem-extensions.md` § 1B).
 *
 * Patching `console` is the most invasive thing this package does, so almost
 * every test here *executes* the patch rather than inspecting a string: the
 * app's own `console.error` is replaced with a recorder before the toolbar
 * mounts, and the assertions are about what that recorder received, what the
 * global identity is afterwards, and what a nested log does.
 *
 * The two the plan calls non-negotiable are `restores console.error by
 * identity on unmount` and the `ExtensionBoundary` re-entrancy test at the
 * bottom, which throws inside a real panel while the patch is live.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import {
  cleanupToolbar,
  fakeExtensionApi,
  makeExtension,
  mountToolbar,
} from "@nejcm/dev-toolbar/testing";
import { REDACTED } from "../../../runtime";
import { diagnostics } from "../index";
import { createDiagnosticsRuntime } from "../runtime";
import { createConsoleTail } from "../console";
import type { DiagnosticsOptions } from "../index";
import type { DiagnosticsRuntimeOptions } from "../runtime";
import type { ConsoleTailEntry } from "../types";

const app = <main data-testid="app">app</main>;

const mount = (options: DiagnosticsOptions = {}, neighbours = []) =>
  mountToolbar(app, {
    extensions: [...neighbours, diagnostics(options)],
    instanceId: "test",
    layout: { barWidth: 1200, itemWidth: 90 },
  });

/** A started runtime, torn down by the caller. */
const started = (options: DiagnosticsRuntimeOptions = {}) => {
  const runtime = createDiagnosticsRuntime(options);
  const stop = runtime.start(fakeExtensionApi().api);
  return { runtime, stop };
};

const entriesOf = (report: { entries: ConsoleTailEntry[] }) => report.entries.map((e) => e.message);

/**
 * The one thing a global patch can leak past a failing test. Every test in
 * this file installs its own recorder over the real methods and restores them
 * here, so a bug in teardown fails loudly rather than poisoning the file.
 */
const REAL = { error: console.error, warn: console.warn, log: console.log };
afterEach(() => {
  cleanupToolbar();
  console.error = REAL.error;
  console.warn = REAL.warn;
  console.log = REAL.log;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* The patch itself — the care list                                            */
/* -------------------------------------------------------------------------- */

describe("patching console", () => {
  it("restores console.error and console.warn by identity on unmount", () => {
    const original = console.error;
    const originalWarn = console.warn;

    const { unmount } = mount();
    // Patched: identity actually changed, so the restore below is a claim
    // about something.
    expect(console.error).not.toBe(original);
    expect(console.warn).not.toBe(originalWarn);

    unmount();

    expect(console.error).toBe(original);
    expect(console.warn).toBe(originalWarn);
  });

  it("restores by identity when the runtime is torn down through the abort signal", () => {
    const original = console.error;
    const runtime = createDiagnosticsRuntime();
    const handle = fakeExtensionApi();
    runtime.start(handle.api);
    expect(console.error).not.toBe(original);

    handle.abort();

    expect(console.error).toBe(original);
  });

  it("never patches console.log, and has no option that would", () => {
    const original = console.log;
    const { unmount } = mount();
    expect(console.log).toBe(original);
    unmount();
    expect(console.log).toBe(original);
  });

  it("calls the app's own console.error through, with the same arguments", () => {
    const seen: unknown[][] = [];
    console.error = (...args: unknown[]) => void seen.push(args);
    const appConsole = console.error;

    const { runtime, stop } = started();
    const payload = { id: 1 };
    console.error("boom", payload);
    stop();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.[0]).toBe("boom");
    // Identity, not a copy: the app gets the object it logged.
    expect(seen[0]?.[1]).toBe(payload);
    expect(console.error).toBe(appConsole);
    expect(entriesOf(runtime.tail())).toHaveLength(1);
  });

  it("still calls through, and still records, when a reader of the tail throws", () => {
    const seen: unknown[][] = [];
    console.error = (...args: unknown[]) => void seen.push(args);

    const tail = createConsoleTail(undefined, {
      onChange: () => {
        throw new Error("a reader blew up");
      },
    });
    const stop = tail.start();
    expect(() => console.error("still logged")).not.toThrow();
    stop();

    expect(seen).toEqual([["still logged"]]);
    expect(entriesOf(tail.report())).toEqual(["still logged"]);
  });

  it("does not record a log emitted from inside another console.error", () => {
    // A third-party patch that logs while logging: without the depth guard
    // this records twice, and a patch that logged unconditionally would not
    // terminate at all.
    let depth = 0;
    const real = console.error;
    console.error = function reentrant(this: unknown, ...args: unknown[]) {
      if (depth === 0) {
        depth += 1;
        console.error("[third-party] handled");
        depth -= 1;
      }
      return real.apply(this, args as []);
    };

    const { runtime, stop } = started();
    const outer = console.error;
    console.error("outer");
    stop();
    console.error = real;

    expect(entriesOf(runtime.tail())).toEqual(["outer"]);
    expect(runtime.tail().errors).toBe(1);
    // Our wrapper was the outer one and stayed installed for the whole call.
    expect(outer).not.toBe(real);
  });

  it("refuses to restore over a later patch, and the later patch keeps working", () => {
    const original = console.error;
    const { stop } = started();
    const ours = console.error;

    const seen: unknown[][] = [];
    const later = function laterPatch(this: unknown, ...args: unknown[]) {
      seen.push(args);
      return (ours as (...a: unknown[]) => unknown).apply(this, args);
    };
    console.error = later;

    stop();

    // Same rule as the /runtime fetch interceptor: somebody else is the outer
    // wrapper now, and clobbering them back to `original` would silently
    // uninstall their instrumentation.
    expect(console.error).toBe(later);
    console.error("after teardown");
    expect(seen).toEqual([["after teardown"]]);

    console.error = original;
  });

  it("shares one wrapper between two mounted diagnostics extensions", () => {
    const original = console.error;
    const first = started({ id: "first" });
    const patched = console.error;
    const second = started({ id: "second" });

    // One patch, two recorders — not two stacked wrappers.
    expect(console.error).toBe(patched);
    console.error("shared");
    expect(entriesOf(first.runtime.tail())).toEqual(["shared"]);
    expect(entriesOf(second.runtime.tail())).toEqual(["shared"]);

    first.stop();
    // Still patched: the second recorder is still attached.
    expect(console.error).toBe(patched);
    second.stop();
    expect(console.error).toBe(original);
  });
});

/* -------------------------------------------------------------------------- */
/* Opting out                                                                  */
/* -------------------------------------------------------------------------- */

describe("opting out", () => {
  it("patches neither method and contributes no commands with `console: false`", () => {
    const original = { error: console.error, warn: console.warn };
    const extension = diagnostics({ console: false });
    const { toolbar, unmount } = mountToolbar(app, {
      extensions: [extension],
      instanceId: "test",
      layout: { barWidth: 1200, itemWidth: 90 },
    });

    expect(console.error).toBe(original.error);
    expect(console.warn).toBe(original.warn);
    expect(toolbar.getCommands().map((command) => command.id)).not.toContain(
      "diagnostics.console.export",
    );

    unmount();
  });

  it("says `disabled` rather than zero when capture is off", () => {
    const { runtime, stop } = started({ console: false });
    console.error("not captured");
    const report = runtime.tail();
    stop();

    expect(report.status).toBe("disabled");
    // "Watched and saw none" and "never watched" are opposite claims.
    expect(report.errors).toBeNull();
    expect(report.warnings).toBeNull();
    expect(report.entries).toEqual([]);
    expect(report.note).toContain("unknown");
  });

  it("turns off one method without touching the other", () => {
    const originalWarn = console.warn;
    const { runtime, stop } = started({ console: { warn: false } });

    expect(console.warn).toBe(originalWarn);
    expect(console.error).not.toBe(REAL.error);

    console.warn("ignored");
    console.error("kept");
    const report = runtime.tail();
    stop();

    expect(entriesOf(report)).toEqual(["kept"]);
    expect(report.warnings).toBe(0);
    expect(report.watching).toEqual(["console.error", "window.error", "unhandledrejection"]);
  });

  it("reports `pending` before the toolbar starts it, and `stopped` after", () => {
    const runtime = createDiagnosticsRuntime();
    expect(runtime.tail().status).toBe("pending");
    const stop = runtime.start(fakeExtensionApi().api);
    expect(runtime.tail().status).toBe("capturing");
    stop();
    expect(runtime.tail().status).toBe("stopped");
  });
});

/* -------------------------------------------------------------------------- */
/* What it captures                                                            */
/* -------------------------------------------------------------------------- */

describe("what it captures", () => {
  it("groups a repeated message instead of filling the ring with it", () => {
    console.error = () => {};
    const { runtime, stop } = started();
    for (let index = 0; index < 4; index += 1) console.error("render loop");
    const report = runtime.tail();
    stop();

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]?.count).toBe(4);
    expect(report.entries[0]?.lastAt).toBeGreaterThanOrEqual(report.entries[0]?.firstAt ?? 0);
    // The counter counts events, not entries.
    expect(report.errors).toBe(4);
  });

  it("drops the oldest distinct message when the ring is full, and says how many", () => {
    console.error = () => {};
    const { runtime, stop } = started({ console: { size: 2 } });
    console.error("one");
    console.error("two");
    console.error("three");
    // The evicted message must leave the grouping map too, or it would come
    // back as a repeat of an entry that no longer exists.
    console.error("one");
    const report = runtime.tail();
    stop();

    expect(entriesOf(report)).toEqual(["one", "three"]);
    expect(report.entries.every((entry) => entry.count === 1)).toBe(true);
    expect(report.dropped).toBe(2);
    expect(report.errors).toBe(4);
  });

  it("keeps a stack where there is one, without its header line", () => {
    console.error = () => {};
    const { runtime, stop } = started();
    console.error("failed:", new Error("kaboom"));
    const report = runtime.tail();
    stop();

    const entry = report.entries[0];
    expect(entry?.message).toContain("Error: kaboom");
    expect(entry?.stack).toContain("at ");
    // The header is where V8 repeats the raw message; it is dropped, not masked.
    expect(entry?.stack?.startsWith("Error: kaboom")).toBe(false);
  });

  it("separates warnings from errors", () => {
    console.error = () => {};
    console.warn = () => {};
    const { runtime, stop } = started();
    console.warn("careful");
    console.error("broken");
    const report = runtime.tail();
    stop();

    expect(report.errors).toBe(1);
    expect(report.warnings).toBe(1);
    expect(report.entries.map((entry) => entry.level)).toEqual(["error", "warn"]);
    expect(report.entries.map((entry) => entry.source)).toEqual(["console.error", "console.warn"]);
  });

  it("captures a window error event, with its location", () => {
    const { runtime, stop } = started();
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "Uncaught TypeError: x is not a function",
        filename: "https://app.test/assets/main.js",
        lineno: 12,
        colno: 3,
      }),
    );
    const report = runtime.tail();
    stop();

    expect(report.entries[0]?.source).toBe("window.error");
    expect(report.entries[0]?.message).toContain("x is not a function");
    expect(report.entries[0]?.message).toContain("main.js:12:3");
  });

  it("ignores a window error event carrying neither message nor error", () => {
    const { runtime, stop } = started();
    window.dispatchEvent(new Event("error"));
    const report = runtime.tail();
    stop();

    expect(report.entries).toEqual([]);
    expect(report.errors).toBe(0);
  });

  it("captures an unhandled rejection", () => {
    const { runtime, stop } = started();
    window.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), { reason: new Error("nope") }),
    );
    const report = runtime.tail();
    stop();

    expect(report.entries[0]?.source).toBe("unhandledrejection");
    expect(report.entries[0]?.message).toBe("Unhandled rejection: Error: nope");
    expect(report.entries[0]?.stack).toContain("at ");
  });

  it("stops capturing after teardown, and keeps what it already had", () => {
    console.error = () => {};
    const { runtime, stop } = started();
    console.error("before");
    stop();
    console.error("after");

    const report = runtime.tail();
    expect(entriesOf(report)).toEqual(["before"]);
    expect(report.status).toBe("stopped");
    expect(report.errors).toBe(1);
  });

  it("limits and marks the result truncated", () => {
    console.error = () => {};
    const { runtime, stop } = started();
    console.error("one");
    console.error("two");
    const limited = runtime.tail(1);
    const all = runtime.tail();
    stop();

    // Newest first.
    expect(entriesOf(limited)).toEqual(["two"]);
    expect(limited.truncated).toBe(true);
    expect(all.truncated).toBe(false);
  });

  it("clears on command, and the entries do not come back", () => {
    console.error = () => {};
    const { runtime, stop } = started();
    console.error("gone");
    runtime.clearTail();
    const report = runtime.tail();
    stop();

    expect(report.entries).toEqual([]);
    expect(report.errors).toBe(0);
    expect(report.dropped).toBe(0);
  });
});

describe("format specifiers", () => {
  it("substitutes %s, %d and %o the way the console shows them", () => {
    console.error = () => {};
    const { runtime, stop } = started();
    console.error("%s failed after %d attempts: %o", "checkout", 3, { code: "E_TIMEOUT" });
    const report = runtime.tail();
    stop();

    expect(report.entries[0]?.message).toBe(
      'checkout failed after 3 attempts: {"code":"E_TIMEOUT"}',
    );
  });

  it("drops %c and its CSS, keeps %% and appends the arguments it did not consume", () => {
    console.error = () => {};
    const { runtime, stop } = started();
    console.error("%cstyled%% %s", "color: red", "tail", "extra");
    const report = runtime.tail();
    stop();

    expect(report.entries[0]?.message).toBe("styled% tail extra");
  });

  it("leaves a specifier alone when there is no argument for it", () => {
    console.error = () => {};
    const { runtime, stop } = started();
    console.error("still %s");
    const report = runtime.tail();
    stop();

    expect(report.entries[0]?.message).toBe("still %s");
  });

  it("masks a substituted argument, not the assembled sentence", () => {
    console.error = () => {};
    const { runtime, stop } = started();
    console.error("request %o failed", { apiKey: "fmt-secret-4" });
    const report = runtime.tail();
    stop();

    expect(JSON.stringify(report)).not.toContain("fmt-secret-4");
    expect(report.entries[0]?.message).toContain(REDACTED);
  });

  it("does not treat a bare percent sign as a specifier", () => {
    console.error = () => {};
    const { runtime, stop } = started();
    console.error("100% of the batch failed", { batch: 7 });
    const report = runtime.tail();
    stop();

    expect(report.entries[0]?.message).toBe('100% of the batch failed {"batch":7}');
  });
});

describe("hostile and unusual values", () => {
  it("describes primitives, and an argument list that is empty", () => {
    console.error = () => {};
    const { runtime, stop } = started();
    console.error(404, null, undefined, true);
    console.error();
    const report = runtime.tail();
    stop();

    expect(entriesOf(report)).toEqual(["(no arguments)", "404 null undefined true"]);
  });

  it("does not break a log over a value that will not serialise", () => {
    const seen: unknown[][] = [];
    console.error = (...args: unknown[]) => void seen.push(args);
    const { runtime, stop } = started();

    // `redact()` passes a BigInt through and `JSON.stringify` throws on it.
    expect(() => console.error("balance", { amount: 1n })).not.toThrow();
    const report = runtime.tail();
    stop();

    expect(seen).toHaveLength(1);
    expect(report.entries).toHaveLength(1);
  });

  it("does not break a log over an error whose own getters throw", () => {
    const seen: unknown[][] = [];
    console.error = (...args: unknown[]) => void seen.push(args);
    const { runtime, stop } = started();

    const hostile = {
      message: "readable",
      get name(): string {
        throw new Error("hostile getter");
      },
      stack: "    at nowhere (https://app.test/x.js:1:1)",
    };
    expect(() => console.error(hostile)).not.toThrow();
    const report = runtime.tail();
    stop();

    expect(seen).toHaveLength(1);
    expect(report.entries[0]?.message).toContain("readable");
  });

  it("drops stacks entirely at `maxStackChars: 0`", () => {
    console.error = () => {};
    const { runtime, stop } = started({ console: { maxStackChars: 0 } });
    console.error(new Error("no stack wanted"));
    const report = runtime.tail();
    stop();

    expect(report.entries[0]?.stack).toBeNull();
    expect(report.entries[0]?.message).toContain("no stack wanted");
  });

  it("backfills a stack onto a grouped entry that was first seen without one", () => {
    console.error = () => {};
    const { runtime, stop } = started();
    const error = new Error("intermittent");
    // Same rendered message, one path with a stack and one without.
    console.error("Error: intermittent");
    console.error(error);
    const report = runtime.tail();
    stop();

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]?.count).toBe(2);
    expect(report.entries[0]?.stack).toContain("at ");
  });

  it("survives a console that cannot be patched at all", () => {
    const frozen = Object.freeze({ error: () => {}, warn: () => {}, log: () => {} });
    vi.stubGlobal("console", frozen);

    const runtime = createDiagnosticsRuntime();
    expect(() => runtime.start(fakeExtensionApi().api)).not.toThrow();
    const report = runtime.tail();

    // The window listeners still attached, so this is not "unavailable" —
    // but neither console method is in `watching`, which is the honest claim.
    expect(report.watching).toEqual(["window.error", "unhandledrejection"]);
    expect(globalThis.console).toBe(frozen);
    vi.unstubAllGlobals();
  });

  it("reports `unavailable` where there is nothing at all to watch", () => {
    vi.stubGlobal("console", undefined);
    vi.stubGlobal("window", undefined);

    const runtime = createDiagnosticsRuntime();
    const stop = runtime.start(fakeExtensionApi().api);
    const report = runtime.tail();
    stop();
    vi.unstubAllGlobals();

    expect(report.status).toBe("unavailable");
    expect(report.errors).toBeNull();
    expect(report.note).toContain("unknown");
  });
});

/* -------------------------------------------------------------------------- */
/* Redaction — the reason this can go in a ticket                              */
/* -------------------------------------------------------------------------- */

describe("redaction on the way in", () => {
  const capturedJson = (log: () => void, options: DiagnosticsRuntimeOptions = {}) => {
    console.error = () => {};
    console.warn = () => {};
    const { runtime, stop } = started(options);
    log();
    const snapshot = runtime.capture();
    stop();
    return { json: JSON.stringify(snapshot), snapshot };
  };

  it("masks a credential-keyed field of a logged object", () => {
    const { json } = capturedJson(() => {
      console.error("login failed", { user: "ada", sessionToken: "sess-abc-123" });
    });
    expect(json).not.toContain("sess-abc-123");
    expect(json).toContain(REDACTED);
    // The innocent half survives — this is redaction, not deletion.
    expect(json).toContain("ada");
  });

  it("masks a credential-carrying URL in the middle of a sentence", () => {
    const { json } = capturedJson(() => {
      console.error("GET https://api.test/v1/me?access_token=tok-secret-9 failed with 401");
    });
    expect(json).not.toContain("tok-secret-9");
    expect(json).toContain("access_token=");
    expect(json).toContain(REDACTED);
  });

  it("masks a signed asset URL inside a stack frame", () => {
    // The realistic leak: a CDN-signed bundle URL in every frame of a stack.
    const error = new Error("chunk failed");
    error.stack = [
      "Error: chunk failed",
      "    at load (https://cdn.test/app.js?token=sig-secret-7:1:1)",
      "    at main (https://cdn.test/app.js?token=sig-secret-7:2:2)",
    ].join("\n");
    const { json } = capturedJson(() => void console.error(error));

    expect(json).not.toContain("sig-secret-7");
    expect(json).toContain(REDACTED);
  });

  it("does not repeat an unmasked message through the stack header", () => {
    const error = new Error("failed for https://api.test/x?api_key=hdr-secret-3");
    const { snapshot, json } = capturedJson(() => void console.error(error));

    expect(json).not.toContain("hdr-secret-3");
    // The message is reported, masked, in `message` — not smuggled in via the
    // header line of `stack`.
    expect(snapshot.console.entries[0]?.message).toContain(REDACTED);
  });

  it("honours redactOptions.extraKeys", () => {
    const { json } = capturedJson(
      () => {
        console.error("state", { workspaceSeed: "seed-secret-1" });
      },
      { redactOptions: { extraKeys: ["workspaceSeed"] } },
    );
    expect(json).not.toContain("seed-secret-1");
  });

  it("cannot mask a bare secret written into prose — the documented limit", () => {
    // Pinned rather than wished away: `redact()` matches key names and whole
    // value shapes, and "the password is hunter2" is neither. The panel shows
    // the text before it is copied precisely because of this.
    const { json } = capturedJson(() => {
      console.error("the password is hunter2");
    });
    expect(json).toContain("hunter2");
  });

  it("masks the reason of an unhandled rejection", () => {
    console.error = () => {};
    const { runtime, stop } = started();
    window.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), {
        reason: { refreshToken: "rt-secret-5" },
      }),
    );
    const report = runtime.tail();
    stop();

    expect(JSON.stringify(report)).not.toContain("rt-secret-5");
    expect(report.entries[0]?.message).toContain(REDACTED);
  });

  it("truncates a very long message instead of pasting a megabyte into a ticket", () => {
    console.error = () => {};
    const { runtime, stop } = started({ console: { maxMessageChars: 40 } });
    console.error("x".repeat(500));
    const report = runtime.tail();
    stop();

    expect(report.entries[0]?.message.length).toBeLessThan(120);
    expect(report.entries[0]?.message).toContain("more characters");
  });
});

/* -------------------------------------------------------------------------- */
/* The snapshot, the summary and the chip                                      */
/* -------------------------------------------------------------------------- */

describe("what the snapshot and the chip say", () => {
  it("folds the tail into the snapshot and into the rendered Markdown", () => {
    console.error = () => {};
    const { runtime, stop } = started();
    console.error("first failure");
    console.error("first failure");
    runtime.capture();
    const markdown = runtime.render("markdown");
    const snapshot = runtime.latest();
    stop();

    expect(snapshot?.console.status).toBe("capturing");
    expect(snapshot?.console.entries[0]?.count).toBe(2);
    expect(markdown).toContain("## Console — 2 errors, 0 warnings");
    expect(markdown).toContain("first failure");
  });

  it("publishes the counters to the roster summary without the messages", () => {
    console.error = () => {};
    const { runtime, stop } = started();
    console.error("private detail");
    const summary = JSON.stringify(runtime.summary());
    stop();

    expect(summary).toContain('"errors":1');
    expect(summary).toContain('"status":"capturing"');
    // A roster read is not the place for redacted foreign text.
    expect(summary).not.toContain("private detail");
  });

  it("writes the counters to the store off the current task, not during it", async () => {
    console.error = () => {};
    const { runtime, stop } = started();

    console.error("logged during a render");
    // Synchronously unchanged: React reports its own dev warnings through
    // console.error *during render*, and writing to an external store there
    // is what produces "cannot update a component while rendering".
    expect(runtime.store.peek().errors).toBe(0);

    await Promise.resolve();
    expect(runtime.store.peek().errors).toBe(1);
    stop();
  });

  it("counts on the chip, live, without a capture", async () => {
    console.error = () => {};
    const { toolbar, unmount } = mount();
    expect(toolbar.item("diagnostics")?.querySelector('[data-dtb-part="diag-errors"]')).toBeNull();

    await act(async () => {
      console.error("something broke");
      console.warn("and something is odd");
      await Promise.resolve();
    });

    const badge = toolbar.item("diagnostics")?.querySelector('[data-dtb-part="diag-errors"]');
    expect(badge?.textContent).toBe("2");
    expect(badge?.getAttribute("data-dtb-tone")).toBe("error");
    expect(badge?.getAttribute("data-dtb-errors")).toBe("1");
    expect(toolbar.item("diagnostics")?.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Diagnostics, 1 error, 1 warning",
    );

    unmount();
  });

  it("returns the tail from its command, with the same masking the snapshot has", async () => {
    console.error = () => {};
    const { toolbar, unmount } = mount();
    await act(async () => {
      console.error("boom", { apiKey: "cmd-secret-2" });
    });

    const command = toolbar.getCommands().find((c) => c.id === "diagnostics.console.export");
    const report = await command?.run({ limit: 5 });
    expect(JSON.stringify(report)).not.toContain("cmd-secret-2");
    expect(JSON.stringify(report)).toContain(REDACTED);

    const clear = toolbar.getCommands().find((c) => c.id === "diagnostics.console.clear");
    await clear?.run();
    expect((await command?.run())?.entries).toEqual([]);

    unmount();
  });

  it("refuses a non-numeric limit rather than silently returning everything", async () => {
    const { toolbar, unmount } = mount();
    const command = toolbar.getCommands().find((c) => c.id === "diagnostics.console.export");
    await expect(async () => command?.run({ limit: "5" })).rejects.toThrow("finite number");
    unmount();
  });
});

/* -------------------------------------------------------------------------- */
/* Re-entrancy through core's own ExtensionBoundary                            */
/* -------------------------------------------------------------------------- */

describe("ExtensionBoundary re-entrancy", () => {
  it("records a crashing panel's log once and does not recurse through it", async () => {
    const seen: unknown[][] = [];
    let calls = 0;
    // The app's own logging pipeline logs while logging — a breadcrumb shim, a
    // console mirror, a second devtool. That nested call must reach the real
    // console and must not enter the tail.
    console.error = function recorder(...args: unknown[]) {
      seen.push(args);
      calls += 1;
      if (calls > 50) throw new Error("console.error recursed");
      if (String(args[0]).includes("crashed")) console.error("[app] mirrored");
    };

    const { toolbar, unmount } = mountToolbar(app, {
      extensions: [
        makeExtension({ id: "boom", label: "Boom", panel: true, throwInPanel: true }),
        diagnostics(),
      ],
      instanceId: "test",
      layout: { barWidth: 1200, itemWidth: 90 },
    });

    // Core's boundary calls console.error by design, from inside a React
    // commit, while our patch is live. If the guard were missing this either
    // records the same crash repeatedly or never returns.
    act(() => toolbar.openPanel("boom"));
    await act(async () => {
      await Promise.resolve();
    });

    // The app's console still received the boundary's log.
    const boundaryLogs = seen.filter((args) =>
      String(args[0]).includes('extension "boom" crashed'),
    );
    expect(boundaryLogs).toHaveLength(1);

    const command = toolbar.getCommands().find((c) => c.id === "diagnostics.console.export");
    const report = (await command?.run()) as { entries: ConsoleTailEntry[]; errors: number | null };
    const crash = report.entries.filter((entry) => entry.message.includes('"boom" crashed'));
    expect(crash).toHaveLength(1);
    expect(crash[0]?.count).toBe(1);
    // The mirrored log went to the real console and nowhere else.
    expect(seen.some((args) => args[0] === "[app] mirrored")).toBe(true);
    expect(report.entries.some((entry) => entry.message.includes("[app] mirrored"))).toBe(false);
    // Bounded: a recursing patch would produce hundreds of these, or blow the
    // stack before it got here.
    expect(report.errors).toBeLessThan(10);
    // The failure is visible where a bug report will find it.
    expect(
      toolbar.item("diagnostics")?.querySelector('[data-dtb-part="diag-errors"]'),
    ).not.toBeNull();

    unmount();
  });
});
