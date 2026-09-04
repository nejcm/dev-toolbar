/**
 * The one nonce policy the seven factories share: the factory option wins, an
 * empty option defers to the slot prop core forwards, and neither means
 * `undefined`. Each factory's own tests assert it end to end; this pins the
 * rule itself.
 */
import { describe, expect, it } from "vitest";
import { resolveStyleNonce } from "../nonce";

describe("resolveStyleNonce", () => {
  it("prefers the factory option over the slot prop", () => {
    expect(resolveStyleNonce("from-option", "from-slot")).toBe("from-option");
  });

  it("falls back to the slot prop when there is no option", () => {
    expect(resolveStyleNonce(undefined, "from-slot")).toBe("from-slot");
  });

  it("defers to the slot prop when the option is an empty string", () => {
    expect(resolveStyleNonce("", "from-slot")).toBe("from-slot");
  });

  it("is undefined when neither is set", () => {
    expect(resolveStyleNonce(undefined, undefined)).toBeUndefined();
  });
});
