import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  createPoller,
  createStyleInjector,
  matchesQuery,
  parseList,
  parseRecord,
  readJson,
  writeJson,
} from "../index";
import type { Severity, SeverityWithOverride } from "../index";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const isString = (value: unknown): value is string => typeof value === "string";

describe("severity types", () => {
  it("exports the shared vocabularies", () => {
    expectTypeOf<Severity>().toEqualTypeOf<"unknown" | "ok" | "warn" | "bad">();
    expectTypeOf<SeverityWithOverride>().toEqualTypeOf<Severity | "override">();
  });
});

describe("parseRecord", () => {
  it("filters values and preserves __proto__ as data", () => {
    const parsed = parseRecord('{"__proto__":"safe","name":"toolbar","count":3}', isString);

    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(parsed["__proto__"]).toBe("safe");
    expect(parsed["name"]).toBe("toolbar");
    expect(Object.keys(parsed).sort()).toEqual(["__proto__", "name"]);
  });

  it.each([null, "nope", "null", "[]", '"text"'])(
    "returns a null-prototype empty record for %s",
    (raw) => {
      const parsed = parseRecord(raw, isString);
      expect(Object.getPrototypeOf(parsed)).toBeNull();
      expect(Object.keys(parsed)).toEqual([]);
    },
  );
});

describe("parseList", () => {
  it("filters values and applies the limit after filtering", () => {
    expect(parseList('["first",2,"second","third"]', isString, 2)).toEqual(["first", "second"]);
  });

  it("returns every guarded value without a limit", () => {
    expect(parseList('["first",false,"second"]', isString)).toEqual(["first", "second"]);
  });

  it.each([null, "nope", "{}"])("returns an empty list for %s", (raw) => {
    expect(parseList(raw, isString)).toEqual([]);
  });

  it("treats a negative limit as zero", () => {
    expect(parseList('["first"]', isString, -1)).toEqual([]);
  });
});

describe("readJson", () => {
  const isSettings = (value: unknown): value is { enabled: boolean } =>
    value !== null &&
    typeof value === "object" &&
    typeof (value as { enabled?: unknown }).enabled === "boolean";

  it("returns guarded stored JSON", () => {
    const storage = { getItem: () => '{"enabled":true}' };
    expect(readJson(storage, "settings", { enabled: false }, isSettings)).toEqual({
      enabled: true,
    });
  });

  it.each([null, "nope", '{"enabled":"yes"}'])("returns the fallback for %s", (raw) => {
    const fallback = { enabled: false };
    expect(readJson({ getItem: () => raw }, "settings", fallback, isSettings)).toBe(fallback);
  });

  it("returns the fallback when storage or the guard throws", () => {
    const fallback = { enabled: false };
    expect(
      readJson(
        {
          getItem: () => {
            throw new Error("blocked");
          },
        },
        "settings",
        fallback,
        isSettings,
      ),
    ).toBe(fallback);
    expect(
      readJson(
        { getItem: () => "{}" },
        "settings",
        fallback,
        (
          _value,
        ): _value is {
          enabled: boolean;
        } => {
          throw new Error("bad guard");
        },
      ),
    ).toBe(fallback);
  });
});

describe("writeJson", () => {
  it("serializes a value before storing it", () => {
    const setItem = vi.fn();
    writeJson({ setItem }, "settings", { enabled: true });
    expect(setItem).toHaveBeenCalledWith("settings", '{"enabled":true}');
  });

  it("does not throw when serialization or storage fails", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(() => writeJson({ setItem: vi.fn() }, "settings", circular)).not.toThrow();
    expect(() =>
      writeJson(
        {
          setItem: () => {
            throw new Error("blocked");
          },
        },
        "settings",
        true,
      ),
    ).not.toThrow();
  });

  it("does not call storage when JSON has no representation", () => {
    const setItem = vi.fn();
    writeJson({ setItem }, "settings", undefined);
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe("createPoller", () => {
  it("floors finite intervals at 250ms", () => {
    vi.useFakeTimers();
    const poll = vi.fn();
    const stop = createPoller(poll, { intervalMs: 10 });

    vi.advanceTimersByTime(249);
    expect(poll).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(poll).toHaveBeenCalledTimes(1);
    stop();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "uses 1000ms for a non-finite interval (%s)",
    (intervalMs) => {
      vi.useFakeTimers();
      const poll = vi.fn();
      const stop = createPoller(poll, { intervalMs });

      vi.advanceTimersByTime(999);
      expect(poll).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(poll).toHaveBeenCalledTimes(1);
      stop();
    },
  );

  it("uses a caller-supplied fallback for a non-finite interval", () => {
    vi.useFakeTimers();
    const poll = vi.fn();
    const stop = createPoller(poll, { intervalMs: Number.NaN, fallbackMs: 4000 });

    vi.advanceTimersByTime(3999);
    expect(poll).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(poll).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stops on abort and through the returned teardown", () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const poll = vi.fn();
    const stop = createPoller(poll, { intervalMs: 250, signal: controller.signal });

    vi.advanceTimersByTime(250);
    controller.abort();
    vi.advanceTimersByTime(500);
    stop();
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("does not schedule an aborted signal or a non-function callback", () => {
    vi.useFakeTimers();
    const interval = vi.spyOn(globalThis, "setInterval");
    const controller = new AbortController();
    controller.abort();

    createPoller(vi.fn(), { intervalMs: 250, signal: controller.signal });
    createPoller(null as unknown as () => void, { intervalMs: 250 });
    expect(interval).not.toHaveBeenCalled();
  });
});

describe("createStyleInjector", () => {
  it("binds the entry and CSS while forwarding the document and nonce", () => {
    const inject = createStyleInjector("kit-test", ".kit-test{display:block}");
    const style = inject(document, "nonce-value");

    expect(style?.getAttribute("data-dev-toolbar-styles")).toBe("kit-test");
    expect(style?.textContent).toBe(".kit-test{display:block}");
    expect(style?.nonce).toBe("nonce-value");
    expect(inject(document, "other-nonce")).toBe(style);
    style?.remove();
  });

  it("returns null without a usable document", () => {
    const inject = createStyleInjector("kit-test", ".kit-test{}");
    expect(inject({ head: null } as unknown as Document)).toBeNull();
  });
});

describe("matchesQuery", () => {
  it("matches case-insensitively across defined values", () => {
    expect(matchesQuery(["Feature flags", undefined, "Owner: Platform"], " platform ")).toBe(true);
    expect(matchesQuery(["Feature flags"], "metrics")).toBe(false);
  });

  it("matches every haystack for a blank query", () => {
    expect(matchesQuery([], "  ")).toBe(true);
  });
});
