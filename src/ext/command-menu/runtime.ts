/**
 * Everything `/ext/command-menu` owns that is not React. [dev-toolbar/ext/command-menu]
 *
 * This extension is the odd one out: the other three *produce* commands, and
 * this one is the only consumer of the aggregation core has been building since
 * P0. It reads that aggregation through `ExtensionRuntimeApi.getCommands()`,
 * not through `useToolbarCommands()` — an extension on its own subpath cannot
 * import a *value* from core (§7), and the hook is a value.
 *
 * Two consequences shape everything below.
 *
 * **The list is only ever correct at the moment it is asked for.** With the
 * function form of `commands`, an extension can start contributing one without
 * anything telling core. So the palette re-enumerates when it opens, every
 * time, and runs by `id` through core rather than by holding a captured object.
 *
 * **Running a command runs somebody else's code.** It may throw, it may reject,
 * and it may have vanished between being listed and being chosen. All three are
 * shown in the palette rather than thrown at the host application.
 */
import { createThrottledStore } from "../../runtime";
import type { ThrottledStore } from "../../runtime";
import type { ExtensionRuntimeApi, ToolbarCommand } from "../../core/contract";
import { filterCommands } from "./types";
import type { CommandMatch } from "./types";

/** Storage key holding the recently-run ids, most recent first. */
export const RECENT_KEY = "recent";
/** How many recents are remembered. */
export const RECENT_LIMIT = 6;

export const DEFAULT_SHORTCUT = "Mod+K";

export interface CommandMenuSnapshot {
  open: boolean;
  query: string;
  /** Index into `results`. `-1` when there is nothing to run. */
  activeIndex: number;
  /** What `getCommands()` returned when the palette last enumerated. */
  commands: readonly ToolbarCommand[];
  /** `commands` filtered and ordered for display. */
  results: readonly CommandMatch[];
  /** Id of a command whose `run()` has not settled yet. */
  running: string | null;
  /** A failed run, or a command that disappeared. Cleared by the next attempt. */
  error: string | null;
  /** False until `start(api)` has run — before that there is no aggregation to read. */
  ready: boolean;
  recent: readonly string[];
}

export interface CommandMenuRuntimeOptions {
  /** `"Mod+K"` by default; `null` binds no key. */
  shortcut?: string | null;
  /**
   * Override platform detection for `Mod`. Default: Meta on Apple platforms,
   * Ctrl everywhere else — the same rule core's own shortcut follows.
   */
  apple?: boolean;
  /** Remember recently-run commands. Default `true`. */
  rememberRecent?: boolean;
}

export interface CommandMenuRuntime {
  readonly store: ThrottledStore<CommandMenuSnapshot>;
  readonly shortcut: ParsedHotkey | null;
  start(api: ExtensionRuntimeApi): () => void;
  /** Re-enumerates and opens. */
  open(): void;
  close(): void;
  toggle(): void;
  setQuery(query: string): void;
  /** Moves the active row, wrapping at both ends. */
  move(delta: number): void;
  setActiveIndex(index: number): void;
  /** Re-enumerates without changing anything else. */
  refresh(): void;
  /** Runs the active row, or a specific id. Resolves when it has settled. */
  run(id?: string): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Hotkey                                                                      */
/* -------------------------------------------------------------------------- */

export interface ParsedHotkey {
  key: string;
  code: string | null;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  mod: boolean;
}

/**
 * A local parser, not core's.
 *
 * `parseShortcut` in core is a *value*, and the one rule this extension keeps
 * absolutely is that it imports only types from core (§7). This is the first
 * duplication of it; if a second extension needs one, it moves to `/runtime`
 * the way `ensureStyleSheet` did (§11.2) rather than becoming a third copy.
 */
export function parseHotkey(input: string): ParsedHotkey | null {
  const parsed: ParsedHotkey = {
    key: "",
    code: null,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    mod: false,
  };
  for (const raw of input.split("+")) {
    const part = raw.trim();
    if (part === "") continue;
    switch (part.toLowerCase()) {
      case "mod":
      case "cmdorctrl":
        parsed.mod = true;
        break;
      case "ctrl":
      case "control":
        parsed.ctrl = true;
        break;
      case "meta":
      case "cmd":
      case "command":
        parsed.meta = true;
        break;
      case "alt":
      case "option":
        parsed.alt = true;
        break;
      case "shift":
        parsed.shift = true;
        break;
      default:
        parsed.key = part.toLowerCase();
        break;
    }
  }
  if (parsed.key === "") return null;
  if (parsed.key.length === 1) {
    if (parsed.key >= "a" && parsed.key <= "z") {
      parsed.code = `Key${parsed.key.toUpperCase()}`;
    } else if (parsed.key >= "0" && parsed.key <= "9") {
      parsed.code = `Digit${parsed.key}`;
    }
  }
  return parsed;
}

export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
    ?.platform;
  const value = String(data ?? navigator.platform ?? navigator.userAgent ?? "");
  return /mac|iphone|ipad|ipod|darwin/i.test(value);
}

/** Exact in both directions: `Mod+K` must not fire for Ctrl+Shift+K. */
export function matchesHotkey(
  event: KeyboardEvent,
  hotkey: ParsedHotkey,
  apple: boolean = isApplePlatform(),
): boolean {
  let needCtrl = hotkey.ctrl;
  let needMeta = hotkey.meta;
  if (hotkey.mod) {
    if (apple) needMeta = true;
    else needCtrl = true;
  }
  if (event.ctrlKey !== needCtrl) return false;
  if (event.metaKey !== needMeta) return false;
  if (event.altKey !== hotkey.alt) return false;
  if (event.shiftKey !== hotkey.shift) return false;
  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  if (key === hotkey.key) return true;
  return hotkey.code !== null && event.code === hotkey.code;
}

/** What the trigger prints, e.g. `⌘K` or `Ctrl K`. */
export function describeHotkey(
  hotkey: ParsedHotkey | null,
  apple: boolean = isApplePlatform(),
): string {
  if (!hotkey) return "";
  const parts: string[] = [];
  if (hotkey.mod) parts.push(apple ? "⌘" : "Ctrl");
  if (hotkey.ctrl) parts.push(apple ? "⌃" : "Ctrl");
  if (hotkey.alt) parts.push(apple ? "⌥" : "Alt");
  if (hotkey.shift) parts.push(apple ? "⇧" : "Shift");
  if (hotkey.meta && !hotkey.mod) parts.push(apple ? "⌘" : "Meta");
  parts.push(hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key);
  return apple ? parts.join("") : parts.join("+");
}

/** The `aria-keyshortcuts` spelling, which is not the printed one. */
export function ariaKeyshortcuts(
  hotkey: ParsedHotkey | null,
  apple: boolean = isApplePlatform(),
): string | undefined {
  if (!hotkey) return undefined;
  const parts: string[] = [];
  if (hotkey.mod) parts.push(apple ? "Meta" : "Control");
  if (hotkey.ctrl) parts.push("Control");
  if (hotkey.meta && !hotkey.mod) parts.push("Meta");
  if (hotkey.alt) parts.push("Alt");
  if (hotkey.shift) parts.push("Shift");
  parts.push(hotkey.key.toUpperCase());
  return parts.join("+");
}

/* -------------------------------------------------------------------------- */
/* Runtime                                                                     */
/* -------------------------------------------------------------------------- */

const EMPTY: readonly ToolbarCommand[] = [];

function readRecent(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === "string")
      .slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

export function createCommandMenuRuntime(
  options: CommandMenuRuntimeOptions = {},
): CommandMenuRuntime {
  const { shortcut = DEFAULT_SHORTCUT, apple = isApplePlatform(), rememberRecent = true } = options;

  const hotkey = shortcut === null ? null : parseHotkey(shortcut);

  const store = createThrottledStore<CommandMenuSnapshot>(
    {
      open: false,
      query: "",
      activeIndex: -1,
      commands: EMPTY,
      results: [],
      running: null,
      error: null,
      ready: false,
      recent: [],
    },
    // A palette answers keystrokes. Coalescing them would drop the frame the
    // typist is steering by, so this store publishes on write; it is used for
    // the `useSyncExternalStore` shape, not for the throttling.
    { intervalMs: 0 },
  );

  let api: ExtensionRuntimeApi | null = null;

  const enumerate = (): readonly ToolbarCommand[] => {
    if (!api) return EMPTY;
    try {
      return api.getCommands();
    } catch (error) {
      // Core contains a throwing `commands()` already, so this should be
      // unreachable — but the palette is a *reader*, and a reader that lets an
      // aggregation failure escape takes the toolbar down with it.
      // eslint-disable-next-line no-console
      console.error(
        "[dev-toolbar/ext/command-menu] the command aggregation threw. " +
          "Showing an empty palette.",
        error,
      );
      return EMPTY;
    }
  };

  /** Recompute `results` and clamp the cursor. Never lets it point at nothing. */
  const derive = (snapshot: CommandMenuSnapshot, keepActiveId?: string): CommandMenuSnapshot => {
    const results = filterCommands(snapshot.commands, snapshot.query, snapshot.recent);
    let activeIndex = results.length === 0 ? -1 : 0;
    if (keepActiveId !== undefined) {
      const found = results.findIndex((match) => match.command.id === keepActiveId);
      if (found >= 0) activeIndex = found;
    }
    return { ...snapshot, results, activeIndex };
  };

  const activeId = (snapshot: CommandMenuSnapshot): string | undefined =>
    snapshot.results[snapshot.activeIndex]?.command.id;

  const persistRecent = (ids: readonly string[]) => {
    if (!rememberRecent || !api) return;
    try {
      api.storage.setItem(RECENT_KEY, JSON.stringify(ids));
    } catch {
      /* storage is best-effort; a palette must not fail because it is full */
    }
  };

  const open = () => {
    store.update((snapshot) => {
      const commands = enumerate();
      // Prune recents that no longer exist. The display filtered them already,
      // but storage did not, so a renamed command sat in the six-slot list
      // forever, crowding out real ones nobody could see it displacing.
      const live = new Set(commands.map((command) => command.id));
      const recent = snapshot.recent.filter((id) => live.has(id));
      if (recent.length !== snapshot.recent.length) persistRecent(recent);
      return derive({
        ...snapshot,
        open: true,
        query: "",
        error: null,
        running: null,
        commands,
        recent,
      });
    });
  };

  const close = () => {
    store.update((snapshot) =>
      snapshot.open
        ? { ...snapshot, open: false, query: "", results: [], activeIndex: -1, error: null }
        : snapshot,
    );
  };

  const toggle = () => {
    if (store.peek().open) close();
    else open();
  };

  const run = async (id?: string): Promise<void> => {
    const snapshot = store.peek();
    // One at a time. Enter repeats, and a pointerdown lands on a row that is
    // still busy — without this, a slow async command runs twice concurrently
    // and `aria-busy` is the only thing that ever said otherwise.
    if (snapshot.running !== null) return;
    const target = id ?? activeId(snapshot);
    if (target === undefined) return;

    store.set({ ...snapshot, running: target, error: null });
    let ok = false;
    let message: string | null = null;
    try {
      ok = api === null ? false : await api.runCommand(target);
      if (!ok) message = "That command is no longer available.";
    } catch (error) {
      message = error instanceof Error && error.message !== "" ? error.message : String(error);
    }

    if (!ok) {
      // Stay open: the palette is where the failure can be read, and closing
      // over it would leave the user with a command that silently did nothing.
      store.update((current) => ({
        ...current,
        running: null,
        error: message,
      }));
      return;
    }

    const recent = [target, ...store.peek().recent.filter((entry) => entry !== target)].slice(
      0,
      RECENT_LIMIT,
    );
    persistRecent(recent);
    store.update((current) => ({
      ...current,
      open: false,
      query: "",
      results: [],
      activeIndex: -1,
      running: null,
      error: null,
      recent,
    }));
  };

  return {
    store,
    shortcut: hotkey,

    start(runtimeApi) {
      api = runtimeApi;
      const recent = rememberRecent ? readRecent(runtimeApi.storage.getItem(RECENT_KEY)) : [];
      store.set({ ...store.peek(), ready: true, recent });

      const onKeyDown = (event: KeyboardEvent) => {
        if (!hotkey || event.repeat) return;
        // The overlay slot only renders while the bar is visible, so opening
        // while it is hidden would set a state nothing paints — and then paint
        // it, uninvited, whenever the bar came back. Core reports visibility
        // rather than pausing anybody; this is the extension deciding what that
        // means for itself, which is the whole point of the api.
        if (!runtimeApi.isVisible()) return;
        if (!matchesHotkey(event, hotkey, apple)) return;
        event.preventDefault();
        toggle();
      };

      // Hiding the bar dismisses an open palette, rather than suspending it
      // behind a bar that is not there.
      const stopWatchingVisibility = runtimeApi.subscribeVisibility((visible) => {
        if (!visible) close();
      });

      if (typeof window !== "undefined") {
        window.addEventListener("keydown", onKeyDown);
      }

      return () => {
        if (typeof window !== "undefined") {
          window.removeEventListener("keydown", onKeyDown);
        }
        stopWatchingVisibility();
        api = null;
        store.set({ ...store.peek(), open: false, ready: false });
      };
    },

    open,
    close,
    toggle,

    setQuery(query) {
      store.update((snapshot) => derive({ ...snapshot, query, error: null }));
    },

    move(delta) {
      store.update((snapshot) => {
        const count = snapshot.results.length;
        if (count === 0) return snapshot;
        const next = (((snapshot.activeIndex + delta) % count) + count) % count;
        return next === snapshot.activeIndex ? snapshot : { ...snapshot, activeIndex: next };
      });
    },

    setActiveIndex(index) {
      store.update((snapshot) =>
        index < 0 || index >= snapshot.results.length || index === snapshot.activeIndex
          ? snapshot
          : { ...snapshot, activeIndex: index },
      );
    },

    refresh() {
      store.update((snapshot) => {
        const keep = activeId(snapshot);
        return derive(
          { ...snapshot, commands: enumerate() },
          ...(keep === undefined ? [] : ([keep] as [string])),
        );
      });
    },

    run,
  };
}
