import { describe, expect, it } from "vitest";
import { describeError, describeErrorUnmasked, formatError } from "../describeError";

const URL = "https://x/?token=abc";

describe("describeError", () => {
  it("describes an ordinary Error, masking name and message separately", () => {
    const error = new TypeError(`failed for ${URL}`);
    expect(describeError(error)).toEqual({
      name: "TypeError",
      message: "failed for https://x/?token=[redacted]",
    });
    // The message *is* the URL: masked as a whole value, not as a joined sentence.
    expect(describeError(new Error(URL))).toEqual({
      name: "Error",
      message: "https://x/?token=[redacted]",
    });
  });

  it("is duck-typed: an error-like object from another realm is described", () => {
    // What `new Error()` from an iframe or a worker looks like from here:
    // `instanceof Error` is false, the properties are there.
    const foreign = Object.assign(Object.create(null) as object, {
      name: "RangeError",
      message: `bad ${URL}`,
      stack: "RangeError: bad\n    at x",
    });
    expect(foreign instanceof Error).toBe(false);
    expect(describeError(foreign)).toEqual({
      name: "RangeError",
      message: "bad https://x/?token=[redacted]",
    });
  });

  it("reads a throwing message getter once and reports the field unreadable", () => {
    let reads = 0;
    const error = Object.defineProperty(new Error("x"), "message", {
      get() {
        reads += 1;
        throw new Error("no");
      },
    });
    expect(describeError(error)).toEqual({ name: "Error", message: "[unreadable]" });
    expect(reads).toBe(1);
  });

  it("reads a name getter once", () => {
    let reads = 0;
    const error = Object.defineProperty(new Error("boom"), "name", {
      get() {
        reads += 1;
        return "Custom";
      },
    });
    expect(describeError(error)).toEqual({ name: "Custom", message: "boom" });
    expect(reads).toBe(1);
  });

  it("masks a name overwritten with a credential", () => {
    const error = new Error("boom");
    error.name = URL;
    expect(describeError(error)).toEqual({
      name: "https://x/?token=[redacted]",
      message: "boom",
    });
    expect(formatError(error)).toBe("https://x/?token=[redacted]: boom");
  });

  it.each([
    ["boom", { message: "boom" }],
    [42, { message: "42" }],
    [null, { message: "null" }],
    [undefined, { message: "undefined" }],
    [Symbol("s"), { message: "Symbol(s)" }],
    [{ code: 7 }, { message: "[object Object]" }],
    [{ name: "X" }, { name: "X", message: "[object Object]" }],
    [{ message: 7 }, { message: "[object Object]" }],
    [{ name: "", message: "no name" }, { message: "no name" }],
    [{ name: 3, message: "bad name" }, { message: "bad name" }],
  ])("describes the non-Error throw %j", (thrown, expected) => {
    expect(describeError(thrown)).toEqual(expected);
  });

  it("describes a thrown string carrying a credential", () => {
    expect(describeError(`failed for ${URL}`)).toEqual({
      message: "failed for https://x/?token=[redacted]",
    });
  });

  it("reads each property once even when the message is not a string", () => {
    // Should-fix 6: `String(error)` ran `Error.prototype.toString`, which read
    // `name` and `message` a second time — and the second answer won.
    let messageReads = 0;
    let nameReads = 0;
    const error = Object.defineProperty(new Error("x"), "message", {
      get() {
        messageReads += 1;
        return messageReads === 1 ? 7 : "second answer";
      },
    });
    Object.defineProperty(error, "name", {
      get() {
        nameReads += 1;
        return "Custom";
      },
    });
    expect(describeError(error)).toEqual({ name: "Custom", message: "[object Error]" });
    expect(messageReads).toBe(1);
    expect(nameReads).toBe(1);
    const tagged = { message: 7, [Symbol.toStringTag]: "Custom" };
    expect(describeError(tagged)).toEqual({ message: "[object Custom]" });
  });

  it("reports a throwing name getter as [unreadable], as documented", () => {
    let reads = 0;
    const error = Object.defineProperty(new Error("boom"), "name", {
      get() {
        reads += 1;
        throw new Error("no");
      },
    });
    expect(describeError(error)).toEqual({ name: "[unreadable]", message: "boom" });
    expect(reads).toBe(1);
    expect(formatError(error)).toBe("[unreadable]: boom");
  });

  it("never calls the thrown value's own toString", () => {
    let calls = 0;
    const hostile = {
      toString() {
        calls += 1;
        throw new Error("no");
      },
    };
    expect(describeError(hostile)).toEqual({ message: "[object Object]" });
    expect(calls).toBe(0);
    const throwingTag = Object.defineProperty({}, Symbol.toStringTag, {
      get() {
        throw new Error("no");
      },
    });
    expect(describeError(throwingTag)).toEqual({ message: "[unreadable]" });
    const hostileError = Object.defineProperty(new Error("x"), "message", {
      get() {
        throw new Error("no");
      },
    });
    Object.defineProperty(hostileError, "name", { get: () => 7 });
    // Neither field is a string and the message read threw: one `[unreadable]`,
    // and `Error.prototype.toString` is never given the chance to re-read.
    expect(describeError(hostileError)).toEqual({ message: "[unreadable]" });
    expect(formatError(hostileError)).toBe("[unreadable]");
  });

  it("survives a revoked Proxy, where even `instanceof Error` throws", () => {
    const { proxy, revoke } = Proxy.revocable(new Error("x"), {});
    revoke();
    expect(() => proxy instanceof Error).toThrow(TypeError);
    expect(describeError(proxy)).toEqual({ message: "[unreadable]" });
    expect(formatError(proxy)).toBe("[unreadable]");
  });

  it("survives a getPrototypeOf trap that throws, by never asking", () => {
    const proxy = new Proxy(new Error(`boom ${URL}`), {
      getPrototypeOf() {
        throw new Error("trap");
      },
    });
    expect(() => proxy instanceof Error).toThrow("trap");
    expect(describeError(proxy)).toEqual({
      name: "Error",
      message: "boom https://x/?token=[redacted]",
    });
  });

  it("applies the caller's redact options to both fields", () => {
    const error = new Error("https://x/?zap=abc");
    error.name = "https://x/?zap=abc";
    expect(describeError(error, { extraKeys: ["zap"], mask: "***" })).toEqual({
      name: "https://x/?zap=***",
      message: "https://x/?zap=***",
    });
  });
});

describe("describeErrorUnmasked", () => {
  it("is the same extraction without the mask", () => {
    const error = new Error(`failed for ${URL}`);
    expect(describeErrorUnmasked(error)).toEqual({ name: "Error", message: `failed for ${URL}` });
    expect(describeErrorUnmasked(URL)).toEqual({ message: URL });
  });
});

describe("formatError", () => {
  it("joins like Error.prototype.toString", () => {
    expect(formatError(new TypeError("boom"))).toBe("TypeError: boom");
    expect(formatError("boom")).toBe("boom");
    expect(formatError(new Error(""))).toBe("Error");
    expect(formatError({ message: "" })).toBe("");
  });

  it("masks before joining, so a URL message stays maskable", () => {
    expect(formatError(new Error(URL))).toBe("Error: https://x/?token=[redacted]");
    expect(formatError(new Error(`failed for ${URL}`), { mask: "***" })).toBe(
      "Error: failed for https://x/?token=***",
    );
  });
});
