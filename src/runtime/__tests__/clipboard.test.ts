import { afterEach, describe, expect, it, vi } from "vitest";
import { writeClipboardText, writeClipboardTextOrThrow } from "../clipboard";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("writeClipboardText", () => {
  it("resolves true only when the write completed", async () => {
    const writes: string[] = [];
    vi.stubGlobal("navigator", {
      clipboard: { writeText: async (text: string) => void writes.push(text) },
    });
    await expect(writeClipboardText("hello")).resolves.toBe(true);
    expect(writes).toEqual(["hello"]);
  });

  it("resolves false when the API is absent", async () => {
    vi.stubGlobal("navigator", {});
    await expect(writeClipboardText("x")).resolves.toBe(false);
    vi.stubGlobal("navigator", undefined);
    await expect(writeClipboardText("x")).resolves.toBe(false);
  });

  it("resolves false when writeText rejects — a denied permission, an unfocused document", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: async () => {
          throw new Error("Document is not focused.");
        },
      },
    });
    await expect(writeClipboardText("x")).resolves.toBe(false);
  });

  it("resolves false when writeText throws synchronously", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: () => {
          throw new Error("nope");
        },
      },
    });
    await expect(writeClipboardText("x")).resolves.toBe(false);
  });

  it("resolves false when reading navigator.clipboard itself throws", async () => {
    // A sandboxed frame can make the property access itself throw.
    vi.stubGlobal("navigator", {
      get clipboard(): never {
        throw new Error("blocked by permissions policy");
      },
    });
    await expect(writeClipboardText("x")).resolves.toBe(false);
  });
});

describe("writeClipboardTextOrThrow", () => {
  it("resolves quietly when the write happened", async () => {
    const writes: string[] = [];
    vi.stubGlobal("navigator", {
      clipboard: { writeText: async (text: string) => void writes.push(text) },
    });
    await expect(writeClipboardTextOrThrow("hello")).resolves.toBeUndefined();
    expect(writes).toEqual(["hello"]);
  });

  it("throws when it did not, so a palette has something to report", async () => {
    // A silent resolve here is how copy commands used to appear to succeed
    // while doing nothing — the palette only surfaces a message when the
    // command throws.
    vi.stubGlobal("navigator", {});
    await expect(writeClipboardTextOrThrow("x")).rejects.toThrow("The clipboard is unavailable");
  });

  it("carries a caller-supplied hint into the message", async () => {
    vi.stubGlobal("navigator", {});
    await expect(writeClipboardTextOrThrow("x", "It is in the Diagnostics panel.")).rejects.toThrow(
      "It is in the Diagnostics panel.",
    );
  });
});
