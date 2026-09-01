import { describe, expect, it } from "vitest";
import { DEFAULT_SHORTCUT, matchesShortcut, parseShortcut } from "../shortcut";

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
