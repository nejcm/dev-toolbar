/**
 * `src/ext/command-menu/runtime.ts` re-derives hotkey parsing rather than
 * value-importing `src/core/shortcut.ts` — that is only safe while the two
 * copies agree. This is the test that keeps them agreeing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isApplePlatform as coreIsApplePlatform,
  matchesShortcut,
  parseShortcut,
} from "../../../core/shortcut";
import { isApplePlatform, matchesHotkey, parseHotkey } from "../runtime";

const MODIFIER_ALIASES = [
  "mod",
  "cmdorctrl",
  "ctrl",
  "control",
  "meta",
  "cmd",
  "command",
  "alt",
  "option",
  "shift",
] as const;

const PRINTABLE_KEYS = Array.from({ length: 0x7e - 0x21 + 1 }, (_, index) =>
  String.fromCharCode(0x21 + index),
);

// Named keys `codeFor` resolves outside the printable-ASCII table — the old
// hand-picked list covered these explicitly. A new *alias* in core's modifier
// switch is undetectable by any closed chord list; only a new physical key or
// CODES entry is caught structurally below.
const NAMED_KEYS = [
  "Mod+Enter",
  "Mod+Escape",
  "Mod+Tab",
  "Mod+F1",
  "Mod+ArrowDown",
  "Mod+Space",
  "Ctrl+Alt+Shift+P",
] as const;

const CHORDS = [
  ...PRINTABLE_KEYS.map((key) => `Mod+${key}`),
  ...MODIFIER_ALIASES.flatMap((alias) => [`${alias}+k`, `Mod+${alias}+k`]),
  ...NAMED_KEYS,
  "Mod+Shift",
  "Shift+",
  "",
  "  mod + k  ",
] as const;

const PARSEABLE_CHORDS = CHORDS.filter((chord) => parseShortcut(chord) !== null);

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

/** Mirrors core's Mod rule so events are built independently of either parser. */
function resolveModifiers(
  parsed: NonNullable<ReturnType<typeof parseShortcut>>,
  apple: boolean,
): Pick<KeyboardEventInit, "ctrlKey" | "metaKey" | "altKey" | "shiftKey"> {
  let needCtrl = parsed.ctrl;
  let needMeta = parsed.meta;
  if (parsed.mod) {
    if (apple) needMeta = true;
    else needCtrl = true;
  }
  return {
    ctrlKey: needCtrl,
    metaKey: needMeta,
    altKey: parsed.alt,
    shiftKey: parsed.shift,
  };
}

type MatchScenario = {
  name: string;
  build: (
    parsed: NonNullable<ReturnType<typeof parseShortcut>>,
    apple: boolean,
  ) => KeyboardEventInit;
};

const MATCH_SCENARIOS: MatchScenario[] = [
  {
    name: "exact key match",
    build: (parsed, apple) => ({
      ...resolveModifiers(parsed, apple),
      key: parsed.key,
      ...(parsed.code ? { code: parsed.code } : {}),
    }),
  },
  {
    name: "shifted char with matching code",
    build: (parsed, apple) => {
      const mods = resolveModifiers(parsed, apple);
      if (parsed.code === "Period") {
        return { ...mods, key: ">", code: "Period" };
      }
      if (parsed.code?.startsWith("Key")) {
        return { ...mods, key: "œ", code: parsed.code };
      }
      if (parsed.code) {
        return { ...mods, key: "≠", code: parsed.code };
      }
      return { ...mods, key: parsed.key };
    },
  },
  {
    name: "wrong modifier",
    build: (parsed, apple) => {
      const mods = resolveModifiers(parsed, apple);
      if (parsed.shift) return { ...mods, shiftKey: false, key: parsed.key };
      if (parsed.alt) return { ...mods, altKey: false, key: parsed.key };
      if (parsed.mod) {
        return apple
          ? { ...mods, metaKey: false, key: parsed.key }
          : { ...mods, ctrlKey: false, key: parsed.key };
      }
      if (parsed.ctrl) return { ...mods, ctrlKey: false, key: parsed.key };
      if (parsed.meta) return { ...mods, metaKey: false, key: parsed.key };
      return { ...mods, shiftKey: true, key: parsed.key };
    },
  },
  {
    name: "extra modifier",
    build: (parsed, apple) => {
      const mods = resolveModifiers(parsed, apple);
      const base = { ...mods, key: parsed.key };
      if (!parsed.mod && !parsed.meta) {
        return { ...base, metaKey: true };
      }
      if (!parsed.alt) {
        return { ...base, altKey: true };
      }
      return { ...base, shiftKey: true };
    },
  },
  {
    name: "wrong code",
    build: (parsed, apple) => ({
      ...resolveModifiers(parsed, apple),
      key: parsed.key === "z" ? "x" : "z",
      code: "WrongCode",
    }),
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("command-menu/runtime mirrors core/shortcut", () => {
  describe.each(CHORDS)("parseHotkey(%j)", (chord) => {
    it("matches parseShortcut", () => {
      expect(parseHotkey(chord)).toEqual(parseShortcut(chord));
    });
  });

  describe.each(PARSEABLE_CHORDS)("matchesHotkey parity for %j", (chord) => {
    const parsedShortcut = parseShortcut(chord)!;
    const parsedHotkey = parseHotkey(chord)!;

    describe.each([true, false] as const)("apple=%s", (apple) => {
      describe.each(MATCH_SCENARIOS)("$name", ({ name, build }) => {
        it("agrees with matchesShortcut", () => {
          const eventInit = build(parsedShortcut, apple);
          const keyboardEvent = key(eventInit);
          expect(
            matchesHotkey(keyboardEvent, parsedHotkey, apple),
            `${chord} / apple=${apple} / ${name}`,
          ).toBe(matchesShortcut(keyboardEvent, parsedShortcut, apple));
        });
      });
    });
  });

  describe("isApplePlatform", () => {
    it("matches core on a Mac user agent", () => {
      vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh)" });
      expect(isApplePlatform()).toBe(true);
      expect(isApplePlatform()).toBe(coreIsApplePlatform());
    });

    it("matches core on a Windows user agent", () => {
      vi.stubGlobal("navigator", { platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0)" });
      expect(isApplePlatform()).toBe(false);
      expect(isApplePlatform()).toBe(coreIsApplePlatform());
    });

    it("prefers userAgentData.platform over navigator.platform", () => {
      vi.stubGlobal("navigator", {
        userAgentData: { platform: "macOS" },
        platform: "Win32",
      });
      expect(isApplePlatform()).toBe(true);
      expect(isApplePlatform()).toBe(coreIsApplePlatform());
    });
  });
});
