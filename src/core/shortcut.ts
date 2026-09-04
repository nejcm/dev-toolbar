export interface ParsedShortcut {
  key: string;
  code: string | null;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  /**
   * `Mod` = Cmd on Apple platforms, Ctrl elsewhere — exclusively. On a Mac
   * `Mod+Shift+.` matches Cmd+Shift+. and *not* Ctrl+Shift+.
   */
  mod: boolean;
}

export const DEFAULT_SHORTCUT = "Mod+Shift+.";

const CODES: Record<string, string> = {
  " ": "Space",
  ".": "Period",
  ",": "Comma",
  "/": "Slash",
  ";": "Semicolon",
  "'": "Quote",
  "[": "BracketLeft",
  "]": "BracketRight",
  "\\": "Backslash",
  "-": "Minus",
  "=": "Equal",
  "`": "Backquote",
};

/**
 * Spelled-out names for keys that cannot survive `"a+b"` splitting or a trim.
 * `" "` is the `KeyboardEvent.key` a space bar reports, and `parseShortcut`
 * filters empty parts, so `"Mod+Space"` is the only way to write it.
 */
const KEY_ALIASES: Record<string, string> = {
  space: " ",
  spacebar: " ",
};

function codeFor(key: string): string | null {
  if (key.length === 1) {
    if (key >= "a" && key <= "z") return `Key${key.toUpperCase()}`;
    if (key >= "0" && key <= "9") return `Digit${key}`;
    return CODES[key] ?? null;
  }
  return null;
}

const warnedShortcuts = new Set<string>();

/** Test seam: the warning is per process and would leak between cases. */
export function resetShortcutWarnings(): void {
  warnedShortcuts.clear();
}

function warnOnce(input: string, reason: string, hint?: string): void {
  if (warnedShortcuts.has(input)) return;
  warnedShortcuts.add(input);
  // eslint-disable-next-line no-console
  console.warn(
    `[dev-toolbar] shortcut "${input}" ${reason}.` + (hint === undefined ? "" : ` ${hint}`),
  );
}

/**
 * Parses `"Mod+Shift+."`, `"Ctrl+Alt+K"`, … Returns null when unusable.
 *
 * Every token that is not a recognised modifier is treated as *the* key, so a
 * misspelled modifier (`"Ctrl+Shfit+K"`) would otherwise be silently swallowed
 * by the one that follows it and bind `Ctrl+K`. More than one non-modifier
 * token is therefore a typo by definition: the last one still wins (changing
 * that would be a behaviour break for anyone relying on it) but it warns, once
 * per distinct input string. A modifier-only input returns `null`, which
 * `DevToolbar` cannot distinguish from the documented `shortcut={null}`
 * opt-out — so that warns too. `hint` is appended as-is; pass the toggle
 * opt-out sentence only from that path, not from command chords.
 */
export function parseShortcut(input: string, hint?: string): ParsedShortcut | null {
  const parts = input
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part !== "");

  const shortcut: ParsedShortcut = {
    key: "",
    code: null,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    mod: false,
  };

  let keyTokens = 0;
  for (const part of parts) {
    switch (part.toLowerCase()) {
      case "mod":
      case "cmdorctrl":
        shortcut.mod = true;
        break;
      case "ctrl":
      case "control":
        shortcut.ctrl = true;
        break;
      case "meta":
      case "cmd":
      case "command":
        shortcut.meta = true;
        break;
      case "alt":
      case "option":
        shortcut.alt = true;
        break;
      case "shift":
        shortcut.shift = true;
        break;
      default: {
        keyTokens += 1;
        const lower = part.toLowerCase();
        shortcut.key = KEY_ALIASES[lower] ?? lower;
        break;
      }
    }
  }

  if (keyTokens === 0) {
    warnOnce(input, "names only modifiers and so binds nothing", hint);
    return null;
  }
  if (keyTokens > 1) {
    warnOnce(
      input,
      `names ${keyTokens} non-modifier tokens; "${shortcut.key}" won and the rest ` +
        "were dropped (a misspelled modifier is the usual cause)",
      hint,
    );
  }
  shortcut.code = codeFor(shortcut.key);
  return shortcut;
}

/**
 * True on macOS/iOS, where `Mod` means Meta (Cmd). Everywhere else `Mod` means
 * Ctrl.
 */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
    ?.platform;
  const value = String(data ?? navigator.platform ?? navigator.userAgent ?? "");
  return /mac|iphone|ipad|ipod|darwin/i.test(value);
}

/**
 * Matches by `key` or by physical `code`, because a shifted punctuation key
 * reports its shifted character (`Shift+.` is `">"` on a US layout).
 *
 * Modifier matching is exact in both directions: `Ctrl+K` does not match
 * `Ctrl+Meta+K`. `Mod` resolves to Meta on Apple platforms and Ctrl elsewhere,
 * exclusively — pass `apple` to override the detection (tests, embedded hosts).
 */
export function matchesShortcut(
  event: KeyboardEvent,
  shortcut: ParsedShortcut,
  apple: boolean = isApplePlatform(),
): boolean {
  let needCtrl = shortcut.ctrl;
  let needMeta = shortcut.meta;
  if (shortcut.mod) {
    if (apple) needMeta = true;
    else needCtrl = true;
  }

  if (event.ctrlKey !== needCtrl) return false;
  if (event.metaKey !== needMeta) return false;
  if (event.altKey !== shortcut.alt) return false;
  if (event.shiftKey !== shortcut.shift) return false;

  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  if (key === shortcut.key) return true;
  return shortcut.code !== null && event.code === shortcut.code;
}
