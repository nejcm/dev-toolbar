/**
 * The palette's non-React half: the hotkey parser it has to own (core's is a
 * value, and this extension imports only types), and the fail-closed edges.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ariaKeyshortcuts,
  createCommandMenuRuntime,
  describeHotkey,
  matchesHotkey,
  parseHotkey,
  RECENT_KEY,
  RECENT_LIMIT,
} from "../runtime";
import type { ExtensionRuntimeApi, ToolbarCommand } from "../../../core/contract";

afterEach(() => {
  vi.restoreAllMocks();
});

const key = (init: Partial<KeyboardEventInit> & { key: string }) =>
  new KeyboardEvent("keydown", init);

const api = (
  overrides: Partial<ExtensionRuntimeApi> = {},
): ExtensionRuntimeApi => {
  const store = new Map<string, string>();
  return {
    signal: new AbortController().signal,
    isVisible: () => true,
    subscribeVisibility: () => () => {},
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, value) => void store.set(k, value),
      removeItem: (k) => void store.delete(k),
    },
    getCommands: () => [],
    runCommand: async () => false,
    ...overrides,
  };
};

const command = (id: string): ToolbarCommand => ({ id, label: id, run: () => {} });

describe("parseHotkey", () => {
  it("parses modifiers and keeps the physical code for letters", () => {
    expect(parseHotkey("Mod+K")).toMatchObject({
      key: "k",
      code: "KeyK",
      mod: true,
      shift: false,
    });
    expect(parseHotkey("Ctrl+Alt+Shift+P")).toMatchObject({
      ctrl: true,
      alt: true,
      shift: true,
      mod: false,
    });
  });

  it("returns null when there is no key to bind", () => {
    expect(parseHotkey("Mod+Shift")).toBeNull();
    expect(parseHotkey("")).toBeNull();
  });
});

describe("matchesHotkey", () => {
  const modK = parseHotkey("Mod+K");

  it("resolves Mod per platform, exclusively", () => {
    expect(matchesHotkey(key({ key: "k", ctrlKey: true }), modK!, false)).toBe(true);
    expect(matchesHotkey(key({ key: "k", metaKey: true }), modK!, false)).toBe(false);
    expect(matchesHotkey(key({ key: "k", metaKey: true }), modK!, true)).toBe(true);
    expect(matchesHotkey(key({ key: "k", ctrlKey: true }), modK!, true)).toBe(false);
  });

  it("matches modifiers exactly, so Mod+K is not Mod+Shift+K", () => {
    expect(
      matchesHotkey(key({ key: "k", ctrlKey: true, shiftKey: true }), modK!, false),
    ).toBe(false);
  });

  it("falls back to the physical code when a layout reports another character", () => {
    expect(
      matchesHotkey(key({ key: "œ", code: "KeyK", ctrlKey: true }), modK!, false),
    ).toBe(true);
  });
});

describe("describeHotkey / ariaKeyshortcuts", () => {
  it("prints the platform's own spelling, and names the ARIA one separately", () => {
    const modK = parseHotkey("Mod+Shift+K");
    expect(describeHotkey(modK, true)).toBe("⌘⇧K");
    expect(describeHotkey(modK, false)).toBe("Ctrl+Shift+K");
    expect(ariaKeyshortcuts(modK, true)).toBe("Meta+Shift+K");
    expect(ariaKeyshortcuts(modK, false)).toBe("Control+Shift+K");
  });

  it("says nothing when no key is bound", () => {
    expect(describeHotkey(null)).toBe("");
    expect(ariaKeyshortcuts(null)).toBeUndefined();
  });
});

describe("createCommandMenuRuntime", () => {
  it("shows an empty palette rather than letting an aggregation failure escape", () => {
    const errors: unknown[][] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args);
    });
    const runtime = createCommandMenuRuntime({ shortcut: null });
    const stop = runtime.start(
      api({
        getCommands: () => {
          throw new Error("aggregation exploded");
        },
      }),
    );
    expect(() => runtime.open()).not.toThrow();
    expect(runtime.store.peek().open).toBe(true);
    expect(runtime.store.peek().results).toEqual([]);
    expect(String(errors[0]?.[0])).toContain("[dev-toolbar/ext/command-menu]");
    stop();
  });

  it("survives unreadable recents in storage", () => {
    const runtime = createCommandMenuRuntime({ shortcut: null });
    const stop = runtime.start(
      api({
        storage: {
          getItem: () => "{not json",
          setItem: () => {},
          removeItem: () => {},
        },
      }),
    );
    expect(runtime.store.peek().recent).toEqual([]);
    stop();
  });

  it("caps recents and puts the newest first", async () => {
    const ids = Array.from({ length: RECENT_LIMIT + 2 }, (_, i) => `c${i}`);
    const commands = ids.map(command);
    const written: string[] = [];
    const runtime = createCommandMenuRuntime({ shortcut: null });
    const stop = runtime.start(
      api({
        getCommands: () => commands,
        runCommand: async () => true,
        storage: {
          getItem: () => null,
          setItem: (_k, value) => void written.push(value),
          removeItem: () => {},
        },
      }),
    );
    for (const id of ids) {
      runtime.open();
      await runtime.run(id);
    }
    const last = JSON.parse(written.at(-1) as string) as string[];
    expect(last).toHaveLength(RECENT_LIMIT);
    expect(last[0]).toBe(ids.at(-1));
    stop();
  });

  it("stops answering the key once its lifecycle has been torn down", () => {
    const runtime = createCommandMenuRuntime({ apple: false });
    const stop = runtime.start(api());
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    expect(runtime.store.peek().open).toBe(true);
    stop();
    expect(runtime.store.peek().open).toBe(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    expect(runtime.store.peek().open).toBe(false);
  });

  it("persists nothing before start(), and reads what start() found", () => {
    const runtime = createCommandMenuRuntime({ shortcut: null });
    expect(runtime.store.peek().ready).toBe(false);
    const stop = runtime.start(
      api({
        storage: {
          getItem: (k) => (k === RECENT_KEY ? '["a","b"]' : null),
          setItem: () => {},
          removeItem: () => {},
        },
      }),
    );
    expect(runtime.store.peek()).toMatchObject({ ready: true, recent: ["a", "b"] });
    stop();
  });
});
