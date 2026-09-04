import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import {
  DEFAULT_SHORTCUT,
  matchesShortcut,
  parseShortcut,
  resetShortcutWarnings,
} from "../shortcut";

const parsed = parseShortcut(DEFAULT_SHORTCUT);

const event = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("shortcut parsing", () => {
  it("parses the default", () => {
    expect(parsed).toMatchObject({ key: ".", code: "Period", mod: true, shift: true });
  });

  it("resolves Mod to Meta on Apple platforms and Ctrl elsewhere, exclusively", () => {
    const meta = event({ key: ".", metaKey: true, shiftKey: true });
    const ctrl = event({ key: ".", ctrlKey: true, shiftKey: true });

    expect(matchesShortcut(meta, parsed!, true)).toBe(true);
    expect(matchesShortcut(ctrl, parsed!, true)).toBe(false);

    expect(matchesShortcut(ctrl, parsed!, false)).toBe(true);
    expect(matchesShortcut(meta, parsed!, false)).toBe(false);
  });

  it("requires an exact modifier match", () => {
    const ctrlK = parseShortcut("Ctrl+K")!;

    expect(matchesShortcut(event({ key: "k", ctrlKey: true }), ctrlK)).toBe(true);
    // Extra modifiers must not match.
    expect(matchesShortcut(event({ key: "k", ctrlKey: true, metaKey: true }), ctrlK)).toBe(false);
    expect(matchesShortcut(event({ key: "k", ctrlKey: true, altKey: true }), ctrlK)).toBe(false);
    expect(matchesShortcut(event({ key: "k", ctrlKey: true, shiftKey: true }), ctrlK)).toBe(false);
  });

  it("matches by physical code when the shifted character differs", () => {
    expect(
      matchesShortcut(
        event({ key: ">", code: "Period", ctrlKey: true, shiftKey: true }),
        parsed!,
        false,
      ),
    ).toBe(true);
  });

  it("rejects missing modifiers", () => {
    expect(matchesShortcut(event({ key: ".", shiftKey: true }), parsed!, true)).toBe(false);
    expect(matchesShortcut(event({ key: ".", metaKey: true }), parsed!, true)).toBe(false);
  });

  it("returns null for a modifier-only shortcut", () => {
    expect(parseShortcut("Shift+")).toBeNull();
  });
});

/**
 * Original bug: every token `parseShortcut` did not recognise as a modifier was
 * assigned to `key`, last one winning, silently. So `"Ctrl+Shfit+K"` bound
 * plain Ctrl+K, and a modifier-only input like `"Mod+Shift"` returned `null` —
 * which `DevToolbar` cannot tell apart from the documented `shortcut={null}`
 * opt-out, so the toggle simply never worked and nothing said why.
 */
describe("parseShortcut diagnostics", () => {
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    resetShortcutWarnings();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    resetShortcutWarnings();
  });

  const messages = () => warn.mock.calls.map((call) => String(call[0]));

  it("warns when a misspelled modifier is swallowed as a second key token", () => {
    const result = parseShortcut("Ctrl+Shfit+K");

    // The binding itself is unchanged — the last token still wins — but it is
    // no longer silent about having dropped one.
    expect(result).toMatchObject({ key: "k", ctrl: true, shift: false });
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toContain('shortcut "Ctrl+Shfit+K"');
    expect(messages()[0]).toContain("2 non-modifier tokens");
  });

  it("warns when the input names only modifiers, which is indistinguishable from the opt-out", () => {
    expect(parseShortcut("Mod+Shift")).toBeNull();

    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toContain("names only modifiers");
    expect(messages()[0]).not.toContain("shortcut={null}");
  });

  it("appends a caller-supplied hint, which is how the toggle names the opt-out", () => {
    expect(
      parseShortcut(
        "Mod+Shift",
        "Pass `shortcut={null}` to disable the toggle shortcut deliberately.",
      ),
    ).toBeNull();

    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toContain("shortcut={null}");
  });

  it("warns for an empty input too, rather than reading it as a deliberate opt-out", () => {
    expect(parseShortcut("   ")).toBeNull();
    expect(messages()).toHaveLength(1);
  });

  it("warns once per distinct input, so a re-render cannot flood the console", () => {
    parseShortcut("Ctrl+Shfit+K");
    parseShortcut("Ctrl+Shfit+K");
    parseShortcut("Ctrl+Shfit+K");
    expect(messages()).toHaveLength(1);

    parseShortcut("Ctrl+Slhift+J");
    expect(messages()).toHaveLength(2);
  });

  it("says nothing about a well-formed chord", () => {
    expect(parseShortcut("Mod+Shift+.")).not.toBeNull();
    expect(parseShortcut("Ctrl+Alt+K")).not.toBeNull();
    expect(messages()).toEqual([]);
  });
});

describe("the space key", () => {
  it('resolves "Space" to the key a space bar actually reports, and to its code', () => {
    const shortcut = parseShortcut("Mod+Space");
    expect(shortcut).toMatchObject({ key: " ", code: "Space", mod: true });
  });

  it("matches a space press by key and by code", () => {
    const shortcut = parseShortcut("Mod+Space")!;
    expect(matchesShortcut(event({ key: " ", ctrlKey: true }), shortcut, false)).toBe(true);
    expect(
      matchesShortcut(
        event({ key: "Unidentified", code: "Space", ctrlKey: true }),
        shortcut,
        false,
      ),
    ).toBe(true);
    expect(matchesShortcut(event({ key: "k", ctrlKey: true }), shortcut, false)).toBe(false);
  });
});
