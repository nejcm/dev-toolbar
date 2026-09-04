import { afterEach, describe, expect, it } from "vitest";
import { installClipboard } from "../clipboard";

const restores: (() => void)[] = [];

const install = (...args: Parameters<typeof installClipboard>) => {
  const clipboard = installClipboard(...args);
  restores.push(clipboard.restore);
  return clipboard;
};

afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});

describe("installClipboard", () => {
  it("exposes a live readonly view of completed writes", async () => {
    const clipboard = install();
    const writes = clipboard.writes;

    await navigator.clipboard.writeText("one");
    await navigator.clipboard.writeText("two");

    expect(writes).toBe(clipboard.writes);
    expect(writes).toEqual(["one", "two"]);
  });

  it("records only writes completed by a supplied writer", async () => {
    const clipboard = install(async () => {
      throw new Error("permission denied");
    });

    await expect(navigator.clipboard.writeText("nope")).rejects.toThrow("permission denied");
    expect(clipboard.writes).toEqual([]);
  });

  it("turns a synchronous writer throw into a rejected promise", async () => {
    install(() => {
      throw new Error("blocked");
    });

    let result: Promise<void> | undefined;
    expect(() => {
      result = navigator.clipboard.writeText("nope");
    }).not.toThrow();
    await expect(result).rejects.toThrow("blocked");
  });

  it("stages an unavailable clipboard explicitly", () => {
    const clipboard = install(null);

    expect(navigator.clipboard).toBeUndefined();
    expect(clipboard.writes).toEqual([]);
  });

  it("restores nested installs in any order", async () => {
    const original = navigator.clipboard;
    const outer = install();
    const inner = install();

    outer.restore();
    await navigator.clipboard.writeText("inner");
    expect(outer.writes).toEqual([]);
    expect(inner.writes).toEqual(["inner"]);

    inner.restore();
    expect(navigator.clipboard).toBe(original);
  });

  it("restores the prior clipboard and ignores repeated cleanup", () => {
    const outer = install();
    const original = navigator.clipboard;
    const inner = install();

    inner.restore();
    inner.restore();

    expect(navigator.clipboard).toBe(original);
    outer.restore();
  });
});
