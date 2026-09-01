/**
 * The snapshot builder, attacked on purpose.
 *
 * Everything this extension produces goes into a ticket, so the tests that
 * matter are the ones that try to get a credential out of it: nested under an
 * innocent key, hidden in a value shape rather than a key, behind a getter that
 * throws, inside a contribution that will not serialise. And the other half of
 * the job — that a snapshot which could not read something *says so*, in the
 * output, not only in a console nobody will see.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { REDACTED } from "../../../runtime";
import { collectDiagnostics } from "../../../core/diagnostics";
import {
  countOccurrences,
  createDiagnosticsRuntime,
  renderJson,
  renderMarkdown,
  startDownload,
} from "../runtime";
import type {
  DevToolbarExtension,
  ExtensionDiagnostics,
  ExtensionRuntimeApi,
} from "../../../core/contract";
import type { DiagnosticSnapshot } from "../types";

const storage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
};

type Roster =
  | readonly ExtensionDiagnostics[]
  | (() => readonly ExtensionDiagnostics[]);

/** A minimal `ExtensionRuntimeApi` with a controllable diagnostics roster. */
const api = (roster: Roster = []): ExtensionRuntimeApi => ({
  signal: new AbortController().signal,
  isVisible: () => true,
  subscribeVisibility: () => () => {},
  storage: storage(),
  getCommands: () => [],
  runCommand: async () => false,
  getDiagnostics: typeof roster === "function" ? roster : () => roster,
});

const started = (
  options: Parameters<typeof createDiagnosticsRuntime>[0] = {},
  roster: Roster = [],
) => {
  const runtime = createDiagnosticsRuntime(options);
  const stop = runtime.start(api(roster));
  return { runtime, stop };
};

const find = (snapshot: DiagnosticSnapshot, id: string) =>
  snapshot.contributions.find((entry) => entry.id === id);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* Redaction, adversarially                                                    */
/* -------------------------------------------------------------------------- */

describe("redaction on the way in", () => {
  it("masks a credential nested under innocent keys, at depth", () => {
    const { runtime, stop } = started({}, [
      {
        id: "app-state",
        label: "App state",
        status: "ok",
        data: {
          settings: {
            profile: {
              identity: { refreshToken: "rt-nested-secret", name: "Ada" },
            },
          },
        },
      },
    ]);
    const snapshot = runtime.capture();
    const json = renderJson(snapshot);

    expect(json).not.toContain("rt-nested-secret");
    expect(json).toContain(REDACTED);
    // Not over-masked: the sibling is still readable, or the snapshot is useless.
    expect(json).toContain("Ada");
    stop();
  });

  it("masks credential-shaped values under keys that look innocent", () => {
    const { runtime, stop } = started({}, [
      {
        id: "notes",
        label: "Notes",
        status: "ok",
        data: {
          note: "Bearer abcdefghijklmnop",
          jot: "aaaaaaaa.bbbbbbbb.cccccccc",
          docs: "https://api.test/v1?access_token=super-secret&page=2",
        },
      },
    ]);
    const json = renderJson(runtime.capture());

    expect(json).not.toContain("abcdefghijklmnop");
    expect(json).toContain("Bearer [redacted]");
    expect(json).not.toContain("aaaaaaaa.bbbbbbbb.cccccccc");
    expect(json).not.toContain("super-secret");
    // The rest of the URL survives, so the row is still worth reading.
    expect(json).toContain("page=2");
    stop();
  });

  it("does NOT catch a bare secret under an innocent key — the documented limit", () => {
    // `redact()` is key- and value-shape matching, not a scanner. Pinning the
    // limit is the point: a test suite that only demonstrated successes would
    // imply a guarantee this extension does not make, and the panel exists
    // precisely so a human is the last check.
    const { runtime, stop } = started({}, [
      { id: "x", label: "X", status: "ok", data: { memo: "tok-live-abcdef" } },
    ]);
    expect(renderJson(runtime.capture())).toContain("tok-live-abcdef");
    stop();
  });

  it("redacts before serialising, which is what the Markdown proves", () => {
    // §11.3's trap: had the builder stringified the contribution and then
    // redacted the string, every nested key would have been characters in a
    // value and this token would be in the ticket verbatim. The Markdown is the
    // interesting side because it fences JSON *inside* text — the exact shape
    // that tempted the wrong order.
    const { runtime, stop } = started({}, [
      {
        id: "env",
        label: "Environment",
        status: "ok",
        data: { extra: { identity: { authToken: "abcdef123456" } } },
      },
    ]);
    const markdown = renderMarkdown(runtime.capture());
    expect(markdown).not.toContain("abcdef123456");
    expect(markdown).toContain(REDACTED);
    stop();
  });

  it("masks the page URL and the referrer by name, not by luck", () => {
    // The address bar after an OAuth implicit callback is the single most
    // likely credential carrier in the whole snapshot, so `readPage` calls
    // `redactUrl` on it explicitly rather than hoping the generic value pass
    // recognises the string. `history.replaceState` is how jsdom lets a test
    // put a real query on `location`.
    const original = `${location.pathname}${location.search}${location.hash}`;
    history.replaceState({}, "", "/cb?access_token=leaky&page=2");
    const referrer = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "referrer",
    );
    Object.defineProperty(document, "referrer", {
      configurable: true,
      get: () => "https://idp.test/authorize?client_secret=also-leaky",
    });

    const { runtime, stop } = started();
    const snapshot = runtime.capture();
    const json = renderJson(snapshot);

    history.replaceState({}, "", original);
    if (referrer) Object.defineProperty(document, "referrer", referrer);
    else Reflect.deleteProperty(document, "referrer");

    expect(json).not.toContain("leaky");
    expect(json).not.toContain("also-leaky");
    expect(snapshot.page.url).toContain("access_token=%5Bredacted%5D");
    // Not over-masked: the innocent half of the query survives.
    expect(snapshot.page.url).toContain("page=2");
    expect(snapshot.page.referrer).toContain("client_secret=%5Bredacted%5D");
    stop();
  });

  it("redacts a long task's container attribution", () => {
    // The monitor already runs `redactUrl` over `containerSrc`; this is the
    // reader's own pass, which catches a credential-shaped value in the
    // container *name* — markup the host page controls.
    let emit: ((entries: unknown[]) => void) | null = null;
    class Fake {
      static supportedEntryTypes = ["longtask", "event", "layout-shift"];
      #callback: (list: { getEntries(): unknown[] }) => void;
      constructor(callback: (list: { getEntries(): unknown[] }) => void) {
        this.#callback = callback;
      }
      observe({ type }: { type: string }) {
        if (type !== "longtask") return;
        emit = (entries) => this.#callback({ getEntries: () => entries });
      }
      disconnect() {}
    }
    vi.stubGlobal("PerformanceObserver", Fake);

    const { runtime, stop } = started({ windowMs: 1_000_000 });
    (emit as unknown as (entries: unknown[]) => void)([
      {
        entryType: "longtask",
        startTime: 1,
        duration: 90,
        attribution: [
          {
            containerType: "iframe",
            containerName: "Bearer abcdefghijklmnop",
            containerSrc: "https://cdn.test/w.js?api_key=super-secret",
          },
        ],
      },
    ]);

    const snapshot = runtime.capture();
    const json = renderJson(snapshot);
    expect(snapshot.responsiveness.longTasks.count).toBe(1);
    expect(json).not.toContain("abcdefghijklmnop");
    expect(json).not.toContain("super-secret");
    expect(snapshot.responsiveness.longTasks.worst?.attribution).toContain(
      "Bearer [redacted]",
    );
    stop();
  });

  it("redacts a contributor's thrown message, through the real pipeline", () => {
    // Deliberately routed through `collectDiagnostics` with an extension that
    // genuinely throws, rather than through a hand-built roster entry.
    //
    // The version this replaces handed the reader a *bare* URL as `error` — a
    // string core never emitted, because core used to join `"Error: " + message`
    // first. So the test passed while the real pipeline leaked: the anchored
    // matcher cannot see an `https://` behind a prefix. A fixture that cannot
    // be produced by the code under test proves nothing about the code under
    // test, and this one actively reassured a reader that error text carrying a
    // URL was scrubbed.
    const failing: DevToolbarExtension = {
      id: "net",
      label: "Net",
      diagnostics: () => {
        // What fetch, undici and axios all throw: the request URL in the
        // message.
        throw new Error("https://api.test/refresh?refresh_token=super-secret");
      },
    };
    const { runtime, stop } = started({}, () => collectDiagnostics([failing]));
    const snapshot = runtime.capture();

    expect(renderJson(snapshot)).not.toContain("super-secret");
    expect(renderMarkdown(snapshot)).not.toContain("super-secret");
    // The name still survives, in front of the masked message.
    expect(find(snapshot, "net")?.error).toBe(
      "Error: https://api.test/refresh?refresh_token=%5Bredacted%5D",
    );
    expect(snapshot.omissions[0]?.reason).toContain(
      "refresh_token=%5Bredacted%5D",
    );
    stop();
  });

  it("redacts the error's name as well as its message", () => {
    // `error.name` is a writable own property, not a class identifier the
    // runtime guarantees, so it is foreign data on both sides of a join this
    // package performs. Masking only the message was half the rule.
    const named = (name: string, message: string) => {
      const error = new Error(message);
      error.name = name;
      return error;
    };
    const failing: DevToolbarExtension = {
      id: "net",
      label: "Net",
      diagnostics: () => {
        throw named("Bearer roster-name-LEAK", "boom");
      },
    };
    const { runtime, stop } = started(
      {
        // `describeSafely`'s path, with a JWT-shaped name.
        app: () => {
          throw named("aaaaaaaa.bbbbbbbb.cccccccc", "nope");
        },
      },
      () => collectDiagnostics([failing]),
    );
    const snapshot = runtime.capture();
    const corpus = `${renderJson(snapshot)}\n${renderMarkdown(snapshot)}`;

    expect(corpus).not.toContain("roster-name-LEAK");
    expect(corpus).not.toContain("aaaaaaaa.bbbbbbbb.cccccccc");
    expect(find(snapshot, "net")?.error).toBe("Bearer [redacted]: boom");
    expect(snapshot.omissions.find((o) => o.id === "app")?.reason).toContain(
      "[redacted]: nope",
    );
    // An ordinary name is left alone, or every report would be unreadable.
    stop();
  });

  it("leaves an ordinary error name readable", () => {
    const failing: DevToolbarExtension = {
      id: "net",
      label: "Net",
      diagnostics: () => {
        throw new TypeError("no");
      },
    };
    const { runtime, stop } = started({}, () => collectDiagnostics([failing]));
    expect(find(runtime.capture(), "net")?.error).toBe("TypeError: no");
    stop();
  });

  it("redacts a source's and an app getter's thrown message", () => {
    // The two sibling paths through this extension's own `describeParts`,
    // which had the identical join.
    const { runtime, stop } = started({
      app: () => {
        throw new Error("https://idp.test/token?access_token=APP-LEAK");
      },
      sources: [
        {
          id: "router",
          read: () => {
            throw new TypeError("https://api.test/x?access_token=SRC-LEAK");
          },
        },
      ],
    });
    const snapshot = runtime.capture();
    const json = renderJson(snapshot);

    expect(json).not.toContain("APP-LEAK");
    expect(json).not.toContain("SRC-LEAK");
    expect(find(snapshot, "router")?.error).toBe(
      "TypeError: https://api.test/x?access_token=%5Bredacted%5D",
    );
    expect(
      snapshot.omissions.map((entry) => entry.id).sort(),
    ).toEqual(["app", "router"]);
    for (const omission of snapshot.omissions) {
      expect(omission.reason).toContain("access_token=%5Bredacted%5D");
    }
    stop();
  });

  it("redacts the message of a getter that throws while redact() walks it", () => {
    // `finish()`'s path, which prefixed twice: "redacting it threw — Error: …".
    const hostile = {
      get token(): string {
        throw new Error("https://api.test/x?client_secret=WALK-LEAK");
      },
    };
    const { runtime, stop } = started({}, [
      { id: "g", label: "G", status: "ok", data: hostile },
    ]);
    const snapshot = runtime.capture();

    expect(renderJson(snapshot)).not.toContain("WALK-LEAK");
    expect(find(snapshot, "g")?.error).toBe(
      "redacting it threw — Error: https://api.test/x?client_secret=%5Bredacted%5D",
    );
    stop();
  });

  it("redacts the failed-snapshot omission reason", () => {
    // The worst place to miss it: the omissions banner of the very report that
    // says nothing below it is complete. This path had no redaction at all.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const runtime = createDiagnosticsRuntime({
      sources: {
        // Not an array, so the `for…of` in the build throws — and the value it
        // throws with is under our control here only because `Symbol.iterator`
        // is the thing missing; the message is the engine's. So force a
        // credential-carrying message explicitly.
        [Symbol.iterator]: () => {
          throw new Error("https://api.test/boot?password=BUILD-LEAK");
        },
      } as never,
    });
    const snapshot = runtime.capture();

    expect(snapshot.omissions[0]?.label).toBe("The whole snapshot");
    expect(renderJson(snapshot)).not.toContain("BUILD-LEAK");
    expect(renderMarkdown(snapshot)).not.toContain("BUILD-LEAK");
    expect(snapshot.omissions[0]?.reason).toContain("password=%5Bredacted%5D");
  });

  it("does not pretend to find a credential embedded in a sentence", () => {
    // The other half of the anchored-matching limit, pinned so nobody reads the
    // test above as a guarantee that error text is scrubbed.
    const { runtime, stop } = started({}, [
      {
        id: "net",
        label: "Net",
        status: "failed",
        error: "refresh failed for Bearer abcdefghijklmnop",
      },
    ]);
    expect(renderJson(runtime.capture())).toContain("abcdefghijklmnop");
    stop();
  });

  it("keeps a key literally called __proto__ as data", () => {
    const raw: Record<string, unknown> = {};
    Object.defineProperty(raw, "__proto__", {
      value: { nested: "kept" },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const { runtime, stop } = started({}, [
      { id: "p", label: "P", status: "ok", data: raw },
    ]);
    expect(renderJson(runtime.capture())).toContain("kept");
    stop();
  });

  it("counts the masks it applied, so masking is visible", () => {
    const { runtime, stop } = started({}, [
      {
        id: "s",
        label: "S",
        status: "ok",
        data: { apiKey: "one", nested: { password: "two" } },
      },
    ]);
    runtime.capture();
    expect(runtime.maskedCount()).toBe(2);
    // The panel's count and the footer of the very text it displays must agree.
    // They did not: the footer says ``masked as `[redacted]` `` and the first
    // version counted occurrences in the rendered Markdown, so it counted its
    // own sentence. Found in a browser, at 6 against 5.
    expect(runtime.render("markdown")).toContain("2 values masked");
    expect(runtime.render("json")).toContain("apiKey");
    stop();
  });

  it("counts a mask that was percent-encoded into a URL query", () => {
    // The OAuth-callback shape, which §11.3 and this extension both call the
    // most likely credential carrier in the whole snapshot. `redact()` masks it
    // through `URLSearchParams.set`, which percent-encodes the mask, so the
    // literal string never appears — and a literal count therefore reported
    // *zero maskings* over a snapshot whose only sensitive datum had just been
    // masked. The footer then read "No values were masked… none matched here",
    // which is a false statement in the one document that argues masking is
    // visible.
    const { runtime, stop } = started({}, [
      {
        id: "env",
        label: "Env",
        status: "ok",
        data: { apiEndpoint: "https://api.test/v2?access_token=super-secret" },
      },
    ]);
    runtime.capture();
    const json = runtime.render("json");

    expect(json).not.toContain("super-secret");
    expect(json).toContain("access_token=%5Bredacted%5D");
    // The crux: the literal form is nowhere in the snapshot.
    expect(json).not.toContain(REDACTED);

    expect(runtime.maskedCount()).toBe(1);
    const markdown = runtime.render("markdown");
    expect(markdown).toContain("1 value masked");
    expect(markdown).not.toContain("No values were masked");
    stop();
  });

  it("counts both encodings together without double-counting either", () => {
    const { runtime, stop } = started({}, [
      {
        id: "env",
        label: "Env",
        status: "ok",
        data: {
          apiEndpoint: "https://api.test/v2?access_token=super-secret",
          apiKey: "plain-secret",
        },
      },
    ]);
    runtime.capture();
    expect(runtime.maskedCount()).toBe(2);
    stop();
  });

  it("does not double-count a mask that percent-encodes to itself", () => {
    // `[redacted]` encodes to something different, so the two searches never
    // overlap for the default. A plain-ASCII mask encodes to itself, and
    // counting both unconditionally would report every masking twice.
    const { runtime, stop } = started({ redactOptions: { mask: "MASKED" } }, [
      { id: "s", label: "S", status: "ok", data: { apiKey: "one" } },
    ]);
    runtime.capture();
    expect(runtime.render("json")).toContain("MASKED");
    expect(runtime.maskedCount()).toBe(1);
    stop();
  });

  it("honours a custom mask and extraKeys", () =>{
    const { runtime, stop } = started(
      { redactOptions: { mask: "██", extraKeys: ["favouritecolour"] } },
      [
        {
          id: "s",
          label: "S",
          status: "ok",
          data: { favouriteColour: "green" },
        },
      ],
    );
    runtime.capture();
    const json = runtime.render("json");
    expect(json).not.toContain("green");
    expect(json).toContain("██");
    expect(runtime.maskedCount()).toBe(1);
    expect(runtime.render("markdown")).toContain("1 value masked as `██`");
    stop();
  });
});

/* -------------------------------------------------------------------------- */
/* Completeness                                                                */
/* -------------------------------------------------------------------------- */

describe("omissions are visible", () => {
  it("records a contributor that threw, in the roster and in the banner", () => {
    const { runtime, stop } = started({}, [
      { id: "ok", label: "Fine", status: "ok", data: { a: 1 } },
      { id: "boom", label: "Boom", status: "failed", error: "Error: exploded" },
    ]);
    const snapshot = runtime.capture();

    expect(find(snapshot, "boom")).toEqual({
      id: "boom",
      label: "Boom",
      status: "failed",
      error: "Error: exploded",
    });
    expect(snapshot.omissions.map((entry) => entry.id)).toEqual(["boom"]);
    // Both output formats say so, and the Markdown says it *before* the data.
    const markdown = renderMarkdown(snapshot);
    expect(markdown).toContain("Incomplete — 1 thing could not be included");
    expect(markdown.indexOf("Incomplete")).toBeLessThan(
      markdown.indexOf("## Page"),
    );
    expect(renderJson(snapshot)).toContain('"omissions"');
    stop();
  });

  it("lists an extension that contributed nothing rather than dropping it", () => {
    const { runtime, stop } = started({}, [
      { id: "quiet", label: "Quiet", status: "absent" },
    ]);
    const snapshot = runtime.capture();
    expect(find(snapshot, "quiet")?.status).toBe("absent");
    expect(snapshot.omissions[0]?.reason).toContain("declares no diagnostics()");
    expect(renderMarkdown(snapshot)).toContain("Quiet — `quiet`");
    stop();
  });

  it("survives an unserialisable contribution and names the culprit", () => {
    const { runtime, stop } = started({}, [
      { id: "big", label: "Big", status: "ok", data: { size: 10n } },
      { id: "next", label: "Next", status: "ok", data: { fine: true } },
    ]);
    const snapshot = runtime.capture();

    expect(find(snapshot, "big")?.status).toBe("unserialisable");
    expect(find(snapshot, "big")?.error).toContain("BigInt");
    // One bad contribution must not cost the reader the whole snapshot.
    expect(find(snapshot, "next")?.status).toBe("ok");
    expect(() => renderJson(snapshot)).not.toThrow();
    expect(renderJson(snapshot)).toContain('"fine": true');
    expect(snapshot.omissions.map((entry) => entry.id)).toEqual(["big"]);
    stop();
  });

  it("survives a contribution whose getter throws while redact walks it", () => {
    const hostile = {
      get token(): string {
        throw new Error("getter exploded");
      },
    };
    const { runtime, stop } = started({}, [
      { id: "g", label: "G", status: "ok", data: hostile },
    ]);
    const snapshot = runtime.capture();
    expect(find(snapshot, "g")?.status).toBe("failed");
    expect(find(snapshot, "g")?.error).toContain("redacting it threw");
    expect(snapshot.omissions).toHaveLength(1);
    stop();
  });

  it("turns a cycle into a tag rather than a serialisation failure", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic["self"] = cyclic;
    const { runtime, stop } = started({}, [
      { id: "c", label: "C", status: "ok", data: cyclic },
    ]);
    const snapshot = runtime.capture();
    expect(find(snapshot, "c")?.status).toBe("ok");
    expect(renderJson(snapshot)).toContain("[circular]");
    stop();
  });

  it("treats a contributor that returned undefined as absent, not as ok", () => {
    const { runtime, stop } = started({}, [
      { id: "u", label: "U", status: "ok", data: undefined },
    ]);
    const snapshot = runtime.capture();
    expect(find(snapshot, "u")?.status).toBe("absent");
    expect(snapshot.omissions).toHaveLength(1);
    stop();
  });

  it("says the roster could not be read at all before start(api)", () => {
    const runtime = createDiagnosticsRuntime();
    const snapshot = runtime.capture();
    expect(snapshot.toolbar.gathered).toBe(false);
    expect(snapshot.contributions).toEqual([]);
    expect(snapshot.omissions[0]?.id).toBe("*");
    expect(snapshot.omissions[0]?.reason).toContain("had not started");
    // And that is not confusable with "everything was fine and empty".
    expect(renderMarkdown(snapshot)).toContain("Incomplete");
  });

  it("contains core's own aggregation failure rather than letting it escape", () => {
    const { runtime, stop } = started({}, () => {
      throw new Error("core exploded");
    });
    const snapshot = runtime.capture();
    expect(snapshot.toolbar.gathered).toBe(false);
    expect(snapshot.omissions.some((entry) => entry.id === "*")).toBe(true);
    expect(
      snapshot.contributions.find((entry) => entry.id === "*")?.error,
    ).toContain("core's getDiagnostics() threw");
    stop();
  });

  it("does not list itself", () => {
    const { runtime, stop } = started({ id: "diagnostics" }, [
      { id: "diagnostics", label: "Diagnostics", status: "absent" },
      { id: "other", label: "Other", status: "ok", data: 1 },
    ]);
    const snapshot = runtime.capture();
    expect(snapshot.contributions.map((entry) => entry.id)).toEqual(["other"]);
    expect(snapshot.toolbar.capturedBy).toBe("diagnostics");
    stop();
  });
});

/* -------------------------------------------------------------------------- */
/* Consumer-supplied context                                                   */
/* -------------------------------------------------------------------------- */

describe("app context and sources", () => {
  it("reads a function app context and redacts it", () => {
    const { runtime, stop } = started({
      app: () => ({ release: "2026.9.1", session: "sess-abc" }),
    });
    const snapshot = runtime.capture();
    expect(snapshot.app).toEqual({ release: "2026.9.1", session: REDACTED });
    expect(snapshot.omissions).toEqual([]);
    expect(renderMarkdown(snapshot)).toContain("## App context");
    stop();
  });

  it("degrades to a visible omission when the app getter throws", () => {
    const { runtime, stop } = started(
      {
        app: () => {
          throw new Error("no session yet");
        },
      },
      [{ id: "quiet", label: "Quiet", status: "absent" }],
    );
    const snapshot = runtime.capture();
    expect(snapshot.app).toBeNull();
    // First, not merely present: the app context is the section a reader looks
    // for before anything else, so its absence leads the list. That needs at
    // least one other omission to mean anything.
    expect(snapshot.omissions.map((entry) => entry.id)).toEqual([
      "app",
      "quiet",
    ]);
    expect(snapshot.omissions[0]?.reason).toContain("no session yet");
    expect(renderMarkdown(snapshot)).not.toContain("## App context");
    stop();
  });

  it("treats a source exactly like an extension contribution", () => {
    const { runtime, stop } = started({
      sources: [
        { id: "router", label: "Router", read: () => ({ path: "/x" }) },
        {
          id: "store",
          read: () => {
            throw new Error("store is mid-migration");
          },
        },
      ],
    });
    const snapshot = runtime.capture();
    expect(find(snapshot, "router")?.data).toEqual({ path: "/x" });
    expect(find(snapshot, "store")?.status).toBe("failed");
    expect(find(snapshot, "store")?.label).toBe("store");
    expect(snapshot.omissions.map((entry) => entry.id)).toEqual(["store"]);
    stop();
  });

  it("never throws out of capture() when the whole build fails", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // A plausible consumer mistake — `sources` given as an object rather than
    // an array — reaches a `for…of` that no inner `try` covers. What matters is
    // not this particular input but that the outer guard exists and that what
    // comes back still says, in the output, that it is not complete.
    const runtime = createDiagnosticsRuntime({
      sources: { router: () => 1 } as never,
    });
    const snapshot = runtime.capture();

    expect(snapshot.omissions[0]?.label).toBe("The whole snapshot");
    expect(snapshot.omissions[0]?.reason).toContain("building it threw");
    expect(renderMarkdown(snapshot)).toContain("Incomplete");
    expect(() => renderJson(snapshot)).not.toThrow();
    expect(error).toHaveBeenCalled();
  });

  it("produces a failed snapshot even when Date is broken as well", () => {
    // The regression test this replaces asserted only that `capture()` did not
    // throw with a patched `Date` — but nothing in it made the *build* fail, so
    // `failedSnapshot` was never reached and the assertion passed against the
    // very defect it claimed to pin. Reverting `failedSnapshot`'s `nowIso()` to
    // `new Date().toISOString()` survived the whole suite. The two conditions
    // have to be present together: a build that fails, and a clock that fails
    // while the failure is being reported.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const realDate = Date;
    vi.stubGlobal(
      "Date",
      class extends realDate {
        override toISOString(): string {
          throw new Error("clock exploded");
        }
      },
    );
    const runtime = createDiagnosticsRuntime({
      sources: { router: () => 1 } as never,
    });
    const captured: DiagnosticSnapshot[] = [];
    expect(() => {
      captured.push(runtime.capture());
    }).not.toThrow();
    vi.stubGlobal("Date", realDate);

    const snapshot = captured[0] as DiagnosticSnapshot;
    // The failed-snapshot path specifically: this is what `failedSnapshot`
    // stamps, and it is unreachable from `buildSnapshot`.
    expect(snapshot.omissions[0]?.label).toBe("The whole snapshot");
    expect(snapshot.generatedAt).toBe("unknown");
    expect(() => renderJson(snapshot)).not.toThrow();
    expect(renderMarkdown(snapshot)).toContain("Incomplete");
    expect(error).toHaveBeenCalled();
  });

  it("produces a failed snapshot when the responsiveness monitor throws too", () => {
    // The other half of the same rule: the failure path reads the monitor, so
    // a monitor that cannot be read must not turn "the capture failed" into a
    // throw. Replacing the reader's guard with a bare `monitor.report()` also
    // survived the suite before this existed.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const runtime = createDiagnosticsRuntime({
      now: () => {
        throw new Error("clock exploded");
      },
    });
    const captured: DiagnosticSnapshot[] = [];
    expect(() => {
      captured.push(runtime.capture());
    }).not.toThrow();

    const snapshot = captured[0] as DiagnosticSnapshot;
    expect(snapshot.omissions[0]?.label).toBe("The whole snapshot");
    expect(snapshot.responsiveness.longTasks.support).toBe("failed");
    expect(snapshot.responsiveness.longTasks.note).toContain(
      "could not be read",
    );
    expect(snapshot.responsiveness.longTasks.count).toBeNull();
    expect(renderMarkdown(snapshot)).toContain("Incomplete");
    expect(error).toHaveBeenCalled();
  });

  it("survives a host whose performance.now throws, end to end", () => {
    // Not hypothetical: an instrumentation shim or a clock mock left on in a
    // dev build does this. Three separate clocks are read during one capture —
    // this module's, the responsiveness monitor's, and the throttled store's —
    // and the store's is read *after* the build, on the publish, so guarding
    // only the first two leaves the failure path able to fail.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("performance", {
      now: () => {
        throw new Error("perf exploded");
      },
    });
    const runtime = createDiagnosticsRuntime();
    expect(() => runtime.capture()).not.toThrow();
    expect(runtime.latest()).not.toBeNull();
  });

  it("degrades rather than throwing when the host has broken Date", () => {
    // The error path must not be able to fail the same way the happy path can:
    // `failedSnapshot` used to call `new Date().toISOString()` itself, so a
    // patched clock turned "the capture failed" into a throw out of a click
    // handler. Found by this test, not by review.
    const realDate = Date;
    vi.stubGlobal(
      "Date",
      class extends realDate {
        override toISOString(): string {
          throw new Error("clock exploded");
        }
      },
    );
    const runtime = createDiagnosticsRuntime();
    const captured: DiagnosticSnapshot[] = [];
    expect(() => {
      captured.push(runtime.capture());
    }).not.toThrow();
    vi.stubGlobal("Date", realDate);
    expect(captured[0]?.generatedAt).toBe("unknown");
  });
});

/* -------------------------------------------------------------------------- */
/* Rendering, naming, copying, downloading                                     */
/* -------------------------------------------------------------------------- */

describe("output", () => {
  it("says it is complete, with a count, when nothing was omitted", () => {
    const { runtime, stop } = started({}, [
      { id: "a", label: "A", status: "ok", data: 1 },
    ]);
    const markdown = renderMarkdown(runtime.capture());
    expect(markdown).toContain("Complete: 1 of 1 contributions included.");
    expect(markdown).not.toContain("Incomplete");
    stop();
  });

  it("never prints a bare null where a window was simply empty", () => {
    // The browser found this one, and jsdom could not: jsdom reports every
    // entry type as unsupported, which short-circuits to `_unknown_`. The
    // interesting case needs an engine that *is* observing over a quiet window,
    // where the naive rendering printed "worst null ms (null)" — which reads as
    // a bug in the tool rather than as a minute in which nothing happened.
    class Idle {
      static supportedEntryTypes = ["longtask", "event", "layout-shift"];
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("PerformanceObserver", Idle);
    const { runtime, stop } = started();
    const markdown = renderMarkdown(runtime.capture());

    expect(markdown).toContain("- **Interactions:** 0");
    expect(markdown).toContain("- **Long tasks:** 0");
    expect(markdown).toContain("- **Layout shifts:** 0");
    expect(markdown).not.toMatch(/\bnull\b/);
    stop();
  });

  it("keeps the panel's mask count and the footer's in agreement", () => {
    // They did not, in a browser, at 6 against 5: `maskedCount` counted
    // occurrences in the *rendered* text, and the footer of that text contains
    // the mask in a sentence about itself. Both now derive from the snapshot.
    const { runtime, stop } = started({}, [
      { id: "s", label: "S", status: "ok", data: { apiKey: "one" } },
    ]);
    runtime.capture();
    expect(runtime.maskedCount()).toBe(1);
    expect(runtime.render("markdown")).toContain("1 value masked as `[redacted]`");
    // The rendered Markdown genuinely contains the mask twice — once in the
    // data, once in the footer's own sentence — which is exactly the trap.
    expect(countOccurrences(runtime.render("markdown"), REDACTED)).toBe(2);
    stop();
  });

  it("fences a contribution with a longer run of backticks than it contains", () => {
    const { runtime, stop } = started({}, [
      { id: "md", label: "MD", status: "ok", data: { readme: "```js\nx\n```" } },
    ]);
    expect(renderMarkdown(runtime.capture())).toContain("````json");
    stop();
  });

  it("measures the longest run rather than assuming four is enough", () => {
    // A README that itself escapes a fence holds four backticks. A hard-coded
    // four-backtick fence around it ends early and spills the rest of the
    // snapshot into the surrounding prose.
    const { runtime, stop } = started({}, [
      { id: "md", label: "MD", status: "ok", data: { readme: "````\nx\n````" } },
    ]);
    const markdown = renderMarkdown(runtime.capture());
    expect(markdown).toContain("`````json");
    // The block still closes after the data, so the sections that follow are
    // still headings rather than fenced text.
    expect(markdown).toContain("\n---\n");
    stop();
  });

  it("escapes pipes and newlines in the Page table", () => {
    // Every value in that table is foreign. A raw `|` splits the row into extra
    // columns and a newline ends the table outright.
    vi.stubGlobal("navigator", {
      userAgent: "Fake/1.0 | evil\n| --- |\n| injected | row |",
      language: "en",
    });
    const { runtime, stop } = started();
    const markdown = renderMarkdown(runtime.capture());
    const table = markdown.slice(
      markdown.indexOf("## Page"),
      markdown.indexOf("## Responsiveness"),
    );
    expect(table).toContain("Fake/1.0 \\| evil");
    expect(table).not.toContain("| injected | row |");
    // One header separator, not two.
    expect(table.split("| --- | --- |")).toHaveLength(2);
    stop();
  });

  it("keeps a filename free of characters a filesystem will not take", () => {
    const { runtime, stop } = started();
    const name = runtime.filename("json");
    expect(name).not.toContain(":");
    // A `.` inside the stamp would read as a second extension.
    expect(name.split(".")).toHaveLength(2);
    expect(name.endsWith(".json")).toBe(true);
    stop();
  });

  it("derives a predictable filename from generatedAt", () => {
    const { runtime, stop } = started();
    const snapshot = runtime.capture();
    const stamp = snapshot.generatedAt.replace(/[:.]/g, "-");
    expect(runtime.filename("json")).toBe(
      `dev-toolbar-diagnostics-${stamp}.json`,
    );
    expect(runtime.filename("markdown")).toBe(
      `dev-toolbar-diagnostics-${stamp}.md`,
    );
    // Stable across calls, because it reads the captured snapshot rather than
    // the clock: a filename that moved between the button and the toast would
    // make the download unfindable.
    expect(runtime.filename("json")).toBe(runtime.filename("json"));
    stop();
  });

  it("renders the same text copy and download send", async () => {
    const writes: string[] = [];
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: async (text: string) => void writes.push(text),
      },
    });
    const { runtime, stop } = started({}, [
      { id: "a", label: "A", status: "ok", data: { n: 1 } },
    ]);
    runtime.capture();
    await expect(runtime.copy("markdown")).resolves.toBe(true);
    expect(writes[0]).toBe(runtime.render("markdown"));
    stop();
  });

  it("reports a failed copy rather than claiming success", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: async () => {
          throw new Error("not focused");
        },
      },
    });
    const { runtime, stop } = started();
    runtime.capture();
    await expect(runtime.copy("json")).resolves.toBe(false);
    stop();
  });

  it("reports a failed copy when there is no clipboard API at all", async () => {
    vi.stubGlobal("navigator", {});
    const { runtime, stop } = started();
    await expect(runtime.copy("json")).resolves.toBe(false);
    stop();
  });

  it("persists the chosen format through the extension's storage", () => {
    const { runtime, stop } = started();
    expect(runtime.readFormat()).toBe("markdown");
    runtime.writeFormat("json");
    expect(runtime.readFormat()).toBe("json");
    stop();
  });

  it("falls back to markdown when the stored format is nonsense", () => {
    const runtime = createDiagnosticsRuntime();
    const store = storage();
    store.setItem("format", "yaml");
    runtime.start({ ...api(), storage: store });
    expect(runtime.readFormat()).toBe("markdown");
  });

  it("ensure() captures once and latest() does not capture at all", () => {
    const { runtime, stop } = started();
    expect(runtime.latest()).toBeNull();
    const first = runtime.ensure();
    expect(runtime.ensure()).toBe(first);
    expect(runtime.latest()).toBe(first);
    expect(runtime.capture()).not.toBe(first);
    stop();
  });
});

describe("startDownload", () => {
  it("returns null rather than throwing where object URLs do not exist", () => {
    // jsdom implements no `URL.createObjectURL`, which is the honest test of
    // the fail-closed path — and of `download()` reporting `false` upward.
    const { runtime, stop } = started();
    expect(runtime.download("json")).toBe(false);
    stop();
  });

  it("clicks an anchor it appends and removes, and defers revocation", () => {
    const created: string[] = [];
    const revoked: string[] = [];
    let clicked: { href: string; download: string; inDocument: boolean } | null =
      null;
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: (blob: Blob) => {
        created.push(blob.type);
        return "blob:fake";
      },
      revokeObjectURL: (url: string) => void revoked.push(url),
    });
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      clicked = {
        href: this.href,
        download: this.download,
        inDocument: document.body.contains(this),
      };
    };

    const revoke = startDownload("hello", "a.md", "text/markdown");
    HTMLAnchorElement.prototype.click = realClick;

    expect(revoke).not.toBeNull();
    expect(created).toEqual(["text/markdown"]);
    expect(clicked).toEqual({
      href: "blob:fake",
      download: "a.md",
      // Firefox has historically ignored click() on a detached anchor.
      inDocument: true,
    });
    // And it is gone again immediately — the host document is left as found.
    expect(document.querySelectorAll("a[download]")).toHaveLength(0);
    // Not revoked synchronously: several browsers cancel the download if it is.
    expect(revoked).toEqual([]);
    revoke?.();
    expect(revoked).toEqual(["blob:fake"]);
    // Idempotent.
    revoke?.();
    expect(revoked).toEqual(["blob:fake"]);
  });

  it("bounds the revoker list without cancelling a download still in flight", () => {
    const revoked: string[] = [];
    let n = 0;
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => `blob:${(n += 1)}`,
      revokeObjectURL: (url: string) => void revoked.push(url),
    });
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = () => {};

    const { runtime, stop } = started();
    runtime.capture();
    // More than the old fixed cap of 8. Forcing the oldest revoker at a fixed
    // depth would have cancelled downloads 1..4 while they were still in
    // flight — a large snapshot over a slow disk is exactly this shape.
    for (let index = 0; index < 12; index += 1) {
      expect(runtime.download("json")).toBe(true);
    }
    expect(revoked).toEqual([]);

    // They are all still tracked, so teardown gets every one of them.
    stop();
    HTMLAnchorElement.prototype.click = realClick;
    expect(revoked).toHaveLength(12);
  });

  it("revokes on a timer, and revokes only what is still live on teardown", () => {
    // Note on what this does *not* pin: the pruning of spent revokers is a
    // memory-only property with no observable effect, because every revoker is
    // idempotent — teardown replaying a spent one calls nothing. That is also
    // why pruning is safe. What is observable, and is asserted here, is that
    // nothing is revoked early and that everything is revoked in the end.
    const revoked: string[] = [];
    let n = 0;
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => `blob:${(n += 1)}`,
      revokeObjectURL: (url: string) => void revoked.push(url),
    });
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = () => {};
    vi.useFakeTimers();

    const { runtime, stop } = started();
    runtime.capture();
    for (let index = 0; index < 5; index += 1) runtime.download("json");
    // Their own 60 s timers fire, so all five are now spent.
    vi.advanceTimersByTime(61_000);
    expect(revoked).toHaveLength(5);

    // The next download prunes them: teardown revokes only what is still live,
    // rather than replaying five no-ops it is still holding closures for.
    runtime.download("json");
    stop();
    vi.useRealTimers();
    HTMLAnchorElement.prototype.click = realClick;
    expect(revoked).toHaveLength(6);
  });

  it("starts a download even when setTimeout refuses", () => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:x",
      revokeObjectURL: () => {},
    });
    const realTimeout = globalThis.setTimeout;
    const realClick = HTMLAnchorElement.prototype.click;
    let clicked = false;
    HTMLAnchorElement.prototype.click = () => {
      clicked = true;
    };
    vi.stubGlobal("setTimeout", () => {
      throw new Error("no timers for you");
    });

    const revoke = startDownload("x", "a.md", "text/markdown");

    vi.stubGlobal("setTimeout", realTimeout);
    HTMLAnchorElement.prototype.click = realClick;
    // The download is the user's click; a missing revocation timer is not a
    // reason to refuse it. The URL is revoked on teardown instead.
    expect(clicked).toBe(true);
    expect(revoke).not.toBeNull();
    expect(revoke?.spent()).toBe(false);
  });

  it("revokes every outstanding object URL on teardown", () => {
    const revoked: string[] = [];
    let n = 0;
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => `blob:${(n += 1)}`,
      revokeObjectURL: (url: string) => void revoked.push(url),
    });
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = () => {};

    const { runtime, stop } = started();
    runtime.capture();
    expect(runtime.download("json")).toBe(true);
    expect(runtime.download("markdown")).toBe(true);
    stop();
    HTMLAnchorElement.prototype.click = realClick;

    expect(revoked).toEqual(["blob:1", "blob:2"]);
  });
});

describe("countOccurrences", () => {
  it("counts non-overlapping occurrences and tolerates an empty needle", () => {
    expect(countOccurrences("aaaa", "aa")).toBe(2);
    expect(countOccurrences("abc", "z")).toBe(0);
    expect(countOccurrences("abc", "")).toBe(0);
  });
});
