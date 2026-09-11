/**
 * Core collects and renders nothing, the way it does for commands — what's
 * asserted here is that the roster is complete. A reader can't tell an extension
 * that had nothing to say from one that blew up unless core tells it apart.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectDiagnostics, resetDiagnosticsWarnings } from "../diagnostics";
import type { DevToolbarExtension } from "../contract";

const ext = (id: string, extra: Partial<DevToolbarExtension> = {}): DevToolbarExtension => ({
  id,
  label: id.toUpperCase(),
  ...extra,
});

beforeEach(() => {
  resetDiagnosticsWarnings();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("collectDiagnostics", () => {
  it("returns one entry per extension, in extension order", () => {
    const entries = collectDiagnostics([
      ext("a", { diagnostics: () => ({ n: 1 }) }),
      ext("b"),
      ext("c", { diagnostics: () => "hello" }),
    ]);
    expect(entries.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(entries[0]).toEqual({
      id: "a",
      label: "A",
      status: "ok",
      data: { n: 1 },
    });
  });

  it("lists an extension that declares no diagnostics() as present-but-absent", () => {
    // The assertion that matters: `b` is *in* the roster — dropping it would
    // make an incomplete snapshot look complete.
    const entries = collectDiagnostics([ext("b")]);
    expect(entries).toEqual([{ id: "b", label: "B", status: "absent" }]);
  });

  it("turns a throw into data rather than only a log line", () => {
    const entries = collectDiagnostics([
      ext("boom", {
        diagnostics: () => {
          throw new TypeError("no");
        },
      }),
      ext("after", { diagnostics: () => 1 }),
    ]);
    expect(entries[0]).toEqual({
      id: "boom",
      label: "BOOM",
      status: "failed",
      error: "no",
      errorName: "TypeError",
    });
    // The failure must not cost the extensions after it.
    expect(entries[1]?.status).toBe("ok");
  });

  it.each(["message", "name"])("contains an Error with a throwing %s getter", (property) => {
    class HostileError extends Error {
      constructor() {
        super();
        Object.defineProperty(this, property, {
          get() {
            throw new Error(`${property} getter failed`);
          },
        });
      }
    }

    const entries = collectDiagnostics([
      ext("boom", {
        diagnostics: () => {
          throw new HostileError();
        },
      }),
      ext("after", { diagnostics: () => 1 }),
    ]);
    expect(entries).toEqual([
      {
        id: "boom",
        label: "BOOM",
        status: "failed",
        error: "threw a value that could not be described",
      },
      { id: "after", label: "AFTER", status: "ok", data: 1 },
    ]);
  });

  it("hands over the message and the name unjoined, so a reader can redact", () => {
    // Why this is a split, not a joined string: redact() matches whole-value shapes,
    // so a message that is itself a credential-carrying URL is maskable on its own
    // but not behind an "Error: " prefix. Core can't redact (no `/runtime` import)
    // but can avoid making redaction impossible.
    const url = "https://api.test/refresh?refresh_token=super-secret";
    const entries = collectDiagnostics([
      ext("net", {
        diagnostics: () => {
          throw new Error(url);
        },
      }),
    ]);
    expect(entries[0]?.error).toBe(url);
    expect(entries[0]?.errorName).toBe("Error");
    // Nothing in core has prefixed it.
    expect(entries[0]?.error?.startsWith("http")).toBe(true);
  });

  it("describes a thrown non-Error, including one whose toString throws", () => {
    const hostile = {
      toString() {
        throw new Error("even describing me fails");
      },
    };
    const entries = collectDiagnostics([
      ext("s", {
        diagnostics: () => {
          throw "just a string";
        },
      }),
      ext("h", {
        diagnostics: () => {
          throw hostile;
        },
      }),
    ]);
    expect(entries[0]?.error).toBe("just a string");
    expect(entries[0]?.errorName).toBeUndefined();
    expect(entries[1]?.error).toBe("threw a value that could not be described");
    expect(entries[1]?.errorName).toBeUndefined();
  });

  it("excludes hidden extensions entirely — not even as absent", () => {
    const entries = collectDiagnostics([
      ext("visible", { diagnostics: () => 1 }),
      ext("gone", { hidden: true, diagnostics: () => "secret" }),
    ]);
    expect(entries.map((entry) => entry.id)).toEqual(["visible"]);
  });

  it("keeps the first of a duplicated id", () => {
    const entries = collectDiagnostics([
      ext("dup", { diagnostics: () => "first" }),
      ext("dup", { diagnostics: () => "second" }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.data).toBe("first");
  });

  it("does not recurse when an extension aggregates from inside diagnostics()", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const list: DevToolbarExtension[] = [];
    list.push(
      ext("re", {
        diagnostics: () => ({ nested: collectDiagnostics(list) }),
      }),
    );
    const entries = collectDiagnostics(list);
    expect(entries[0]?.status).toBe("ok");
    expect(entries[0]?.data).toEqual({ nested: [] });
    expect(String(error.mock.calls[0]?.[0])).toContain("getDiagnostics() was called from inside");
    // Once per process, not once per pass.
    collectDiagnostics(list);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("releases the reentrancy guard after a throwing pass", () => {
    collectDiagnostics([
      ext("x", {
        diagnostics: () => {
          throw new Error("boom");
        },
      }),
    ]);
    // If the guard leaked, this second call would return [] instead.
    expect(collectDiagnostics([ext("y", { diagnostics: () => 2 })])).toEqual([
      { id: "y", label: "Y", status: "ok", data: 2 },
    ]);
  });

  it("falls back to the id when an extension has no label", () => {
    const entries = collectDiagnostics([{ id: "nolabel" } as unknown as DevToolbarExtension]);
    expect(entries[0]?.label).toBe("nolabel");
  });
});
