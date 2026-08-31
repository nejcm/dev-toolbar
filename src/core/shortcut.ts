export interface ParsedShortcut {
  key: string;
  code: string | null;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  /** `Mod` = Cmd on Apple platforms, Ctrl elsewhere. Accepts either. */
  mod: boolean;
}

export const DEFAULT_SHORTCUT = "Mod+Shift+.";

const CODES: Record<string, string> = {
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

function codeFor(key: string): string | null {
  if (key.length === 1) {
    if (key >= "a" && key <= "z") return `Key${key.toUpperCase()}`;
    if (key >= "0" && key <= "9") return `Digit${key}`;
    return CODES[key] ?? null;
  }
  return null;
}

/** Parses `"Mod+Shift+."`, `"Ctrl+Alt+K"`, … Returns null when unusable. */
export function parseShortcut(input: string): ParsedShortcut | null {
  const parts = input
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length === 0) return null;

  const shortcut: ParsedShortcut = {
    key: "",
    code: null,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    mod: false,
  };

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
      default:
        shortcut.key = part.toLowerCase();
        break;
    }
  }

  if (shortcut.key === "") return null;
  shortcut.code = codeFor(shortcut.key);
  return shortcut;
}

/**
 * True on macOS/iOS, where `Mod` means Meta (Cmd). Everywhere else `Mod` means
 * Ctrl.
 */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const data = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData?.platform;
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
