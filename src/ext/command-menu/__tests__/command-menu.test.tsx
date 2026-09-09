/**
 * `/ext/command-menu` against the real shell, through the same `/testing`
 * surface a stranger writing an extension would use.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { cleanupToolbar, makeExtension, mountToolbar } from "@nejcm/dev-toolbar/testing";
import { createMemoryStorage } from "../../../core/storage";
import { commandMenu } from "../index";
import { RECENT_KEY } from "../runtime";
import type { CommandMenuOptions } from "../index";
import type { DevToolbarExtension, ToolbarCommand, ToolbarStorage } from "../../../core/contract";

let ran: string[] = [];

const command = (
  id: string,
  label: string,
  group?: string,
  run?: () => void | Promise<void>,
): ToolbarCommand => ({
  id,
  label,
  ...(group === undefined ? {} : { group }),
  run: run ?? (() => void ran.push(id)),
});

const producers = (): DevToolbarExtension[] => [
  makeExtension({
    id: "flags",
    commands: [
      command("flags.toggle.a", "Toggle flag: A", "Flags"),
      command("flags.clear", "Clear all local flag overrides", "Flags"),
    ],
  }),
  makeExtension({
    id: "metrics",
    commands: [command("metrics.reset", "Reset metrics", "Metrics")],
  }),
];

const mount = (
  options: CommandMenuOptions = {},
  extra: DevToolbarExtension[] = producers(),
  storage?: ToolbarStorage,
) => {
  const extension = commandMenu({ apple: false, ...options });
  const result = mountToolbar(
    <button data-testid="app-button" type="button">
      app
    </button>,
    {
      extensions: [extension, ...extra],
      instanceId: "test",
      ...(storage === undefined ? {} : { storage }),
      layout: { barWidth: 1200, itemWidth: 120 },
    },
  );
  return { extension, ...result };
};

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const input = () => document.querySelector<HTMLInputElement>('[role="combobox"]');
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
const labels = () =>
  options().map(
    (option) => option.querySelector('[data-dtb-part="cmd-option-label"]')?.textContent,
  );
const activeOption = () =>
  document.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');

const press = (key: string, init: Partial<KeyboardEventInit> = {}) => {
  const target = dialog();
  if (!target) throw new Error("the palette is not open");
  fireEvent.keyDown(target, { key, ...init });
};

const hotkey = () => fireEvent.keyDown(window, { key: "k", ctrlKey: true });

const type = (value: string) => {
  fireEvent.change(input() as HTMLInputElement, { target: { value } });
};

beforeEach(() => {
  ran = [];
});

afterEach(() => {
  cleanupToolbar();
  vi.restoreAllMocks();
});

describe("opening and dismissing", () => {
  it("opens on the shortcut and focuses the search field", () => {
    mount();
    expect(dialog()).toBeNull();
    hotkey();
    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(input());
  });

  it("restores focus to whatever had it, on both ways out", async () => {
    const { getByTestId } = mount();
    const appButton = getByTestId("app-button") as HTMLButtonElement;
    act(() => appButton.focus());

    hotkey();
    expect(document.activeElement).toBe(input());
    press("Escape");
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(appButton);

    // ... and after running something, not just after dismissing.
    hotkey();
    await act(async () => {
      press("Enter");
    });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(appButton);
  });

  it("toggles closed on the same shortcut, and closes on the scrim", () => {
    mount();
    hotkey();
    hotkey();
    expect(dialog()).toBeNull();

    hotkey();
    const scrim = () => document.querySelector('[data-dtb-part="cmd-scrim"]') as HTMLElement;
    // A right-click reaching for a context menu is not a dismissal. Dispatched
    // by hand: Testing Library's `pointerDown` synthesizes an event that
    // carries no `button` at all, so it cannot express the case.
    scrim().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 2 }));
    expect(dialog()).not.toBeNull();
    fireEvent.pointerDown(scrim());
    expect(dialog()).toBeNull();
  });

  it("opens from the bar chip too", () => {
    const { toolbar } = mount();
    const trigger = toolbar.item("command-menu")?.querySelector<HTMLButtonElement>("button");
    expect(trigger?.getAttribute("aria-keyshortcuts")).toBe("Control+K");
    act(() => trigger?.click());
    expect(dialog()).not.toBeNull();
  });

  it("still opens on the shortcut when its own chip has collapsed", () => {
    const { toolbar } = mount({ priority: 0 }, [makeExtension({ id: "wide", priority: 90 })]);
    toolbar.resize(100);
    expect(toolbar.isOverflowed("command-menu")).toBe(true);
    expect(toolbar.item("command-menu")).toBeNull();
    hotkey();
    expect(dialog()).not.toBeNull();
  });

  it("closes when the bar is hidden, and does not reopen when it comes back", () => {
    const { toolbar } = mount();
    hotkey();
    expect(dialog()).not.toBeNull();

    act(() => toolbar.setVisible(false));
    expect(dialog()).toBeNull();

    // The overlay only renders while the bar is visible, so a palette left open
    // would be suspended rather than dismissed — and would reappear uninvited.
    act(() => toolbar.setVisible(true));
    expect(dialog()).toBeNull();
  });

  it("does not answer the shortcut while the bar is hidden", () => {
    const { toolbar } = mount();
    act(() => toolbar.setVisible(false));
    hotkey();
    expect(dialog()).toBeNull();
    act(() => toolbar.setVisible(true));
    // Nothing was queued up behind the hidden bar.
    expect(dialog()).toBeNull();
    hotkey();
    expect(dialog()).not.toBeNull();
  });

  it("binds nothing when the shortcut is disabled", () => {
    mount({ shortcut: null });
    hotkey();
    expect(dialog()).toBeNull();
  });
});

describe("searching and keyboard navigation", () => {
  it("lists every aggregated command, grouped, with the first row active", () => {
    mount();
    hotkey();
    expect(labels()).toEqual(["Toggle flag: A", "Clear all local flag overrides", "Reset metrics"]);
    expect(
      [...document.querySelectorAll('[role="group"]')].map((group) =>
        group.getAttribute("aria-label"),
      ),
    ).toEqual(["Flags", "Metrics"]);
    expect(activeOption()?.dataset["dtbCommandId"]).toBe("flags.toggle.a");
  });

  it("filters as you type and keeps the cursor on a real row", () => {
    mount();
    hotkey();
    type("reset");
    expect(labels()).toEqual(["Reset metrics"]);
    expect(activeOption()?.dataset["dtbCommandId"]).toBe("metrics.reset");

    type("zzz");
    expect(options()).toHaveLength(0);
    expect(document.querySelector('[data-dtb-part="cmd-empty"]')?.textContent).toContain(
      "No matching command",
    );
    // Nothing is active, so Enter cannot run something the user cannot see.
    expect(input()?.getAttribute("aria-activedescendant")).toBeNull();
    press("Enter");
    expect(ran).toEqual([]);
  });

  it("moves with the arrows, wraps at both ends, and honours Home/End", () => {
    mount();
    hotkey();
    const idOf = () => activeOption()?.dataset["dtbCommandId"];
    press("ArrowDown");
    expect(idOf()).toBe("flags.clear");
    press("ArrowUp");
    expect(idOf()).toBe("flags.toggle.a");
    press("ArrowUp");
    expect(idOf()).toBe("metrics.reset");
    press("Home");
    expect(idOf()).toBe("flags.toggle.a");
    press("End");
    expect(idOf()).toBe("metrics.reset");
  });

  it("keeps focus in the field on Tab, as aria-modal promises", () => {
    mount();
    hotkey();
    // jsdom implements no sequential focus navigation, so asserting on
    // activeElement here would pass whether or not the handler existed. What
    // actually stops the browser moving focus is the preventDefault.
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    (dialog() as HTMLElement).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input());
  });

  it("ignores Escape while an IME is composing, so a cancelled candidate keeps the query", () => {
    mount();
    hotkey();
    type("reset");
    fireEvent.keyDown(dialog() as HTMLElement, {
      key: "Escape",
      isComposing: true,
    });
    expect(dialog()).not.toBeNull();
    expect(input()?.value).toBe("reset");
    press("Escape");
    expect(dialog()).toBeNull();
  });

  it("ignores Enter while an IME is composing a candidate", () => {
    mount();
    hotkey();
    fireEvent.keyDown(dialog() as HTMLElement, {
      key: "Enter",
      isComposing: true,
    });
    expect(dialog()).not.toBeNull();
    expect(ran).toEqual([]);
  });

  /*
   * Regression: Arrow/Home/End moved the palette during IME composition while
   * Escape and Enter already checked isComposing.
   */
  it("ignores arrow and Home/End navigation while an IME is composing", () => {
    mount();
    hotkey();
    const idOf = () => activeOption()?.dataset["dtbCommandId"];
    expect(idOf()).toBe("flags.toggle.a");
    fireEvent.keyDown(dialog() as HTMLElement, {
      key: "ArrowDown",
      isComposing: true,
    });
    expect(idOf()).toBe("flags.toggle.a");
    fireEvent.keyDown(dialog() as HTMLElement, {
      key: "End",
      isComposing: true,
    });
    expect(idOf()).toBe("flags.toggle.a");
  });
});

describe("running", () => {
  it("runs the active command on Enter and closes", async () => {
    mount();
    hotkey();
    press("ArrowDown");
    await act(async () => {
      press("Enter");
    });
    expect(ran).toEqual(["flags.clear"]);
    expect(dialog()).toBeNull();
  });

  it("runs the row that was pointed at", async () => {
    mount();
    hotkey();
    await act(async () => {
      fireEvent.pointerDown(options()[2] as HTMLElement);
      fireEvent.click(options()[2] as HTMLElement);
    });
    expect(ran).toEqual(["metrics.reset"]);
  });

  /*
   * Regression: pointerdown ran the command, so touch could not cancel a slow
   * run and the first finger-down executed whatever was under it.
   */
  it("does not run on pointerdown alone — only on click", async () => {
    mount();
    hotkey();
    fireEvent.pointerDown(options()[0] as HTMLElement);
    expect(ran).toEqual([]);
    await act(async () => {
      fireEvent.click(options()[0] as HTMLElement);
    });
    expect(ran).toEqual(["flags.toggle.a"]);
  });

  it("keeps the palette open and shows the failure when a command throws", async () => {
    mount({}, [
      makeExtension({
        id: "bad",
        commands: [
          command("bad.one", "Explodes", "Bad", () => {
            throw new Error("the provider is offline");
          }),
        ],
      }),
    ]);
    hotkey();
    await act(async () => {
      press("Enter");
    });
    expect(dialog()).not.toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("the provider is offline");
  });

  it("says so when the chosen command has gone since it was listed", async () => {
    let present = true;
    mount({}, [
      makeExtension({
        id: "vanishing",
        commands: () => (present ? [command("gone.one", "Here for now")] : []),
      }),
    ]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    hotkey();
    expect(labels()).toEqual(["Here for now"]);
    present = false;
    await act(async () => {
      press("Enter");
    });
    expect(dialog()).not.toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("no longer available");
    expect(ran).toEqual([]);
  });

  it("runs one command at a time, however hard Enter is pressed", async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    mount({}, [
      makeExtension({
        id: "slow",
        commands: [
          command("slow.one", "Takes a while", "Slow", () => {
            calls += 1;
            return new Promise<void>((resolve) => {
              release = resolve;
            });
          }),
        ],
      }),
    ]);
    hotkey();
    press("Enter");
    press("Enter");
    fireEvent.pointerDown(options()[0] as HTMLElement);
    fireEvent.click(options()[0] as HTMLElement);
    expect(calls).toBe(1);
    expect(options()[0]?.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      release?.();
    });
    expect(calls).toBe(1);
    expect(dialog()).toBeNull();
  });
});

describe("the aggregation it reads", () => {
  it("re-enumerates on every open, so a command added after mount is there", async () => {
    let grown = false;
    mount({}, [
      makeExtension({
        id: "grower",
        commands: () =>
          grown
            ? [command("g.one", "First"), command("g.late", "Added later")]
            : [command("g.one", "First")],
      }),
    ]);

    hotkey();
    expect(labels()).toEqual(["First"]);
    press("Escape");

    grown = true;
    hotkey();
    expect(labels()).toEqual(["First", "Added later"]);
    press("ArrowDown");
    await act(async () => {
      press("Enter");
    });
    expect(ran).toEqual(["g.late"]);
  });

  it("never lists a hidden extension's commands", () => {
    mount({}, [
      makeExtension({
        id: "secret",
        hidden: true,
        commands: [command("secret.one", "Secret")],
      }),
      makeExtension({ id: "open", commands: [command("open.one", "Open")] }),
    ]);
    hotkey();
    expect(labels()).toEqual(["Open"]);
  });
});

describe("recents", () => {
  it("remembers what was run and offers it first next time", async () => {
    const storage = createMemoryStorage();
    mount({}, producers(), storage);
    hotkey();
    press("ArrowUp");
    await act(async () => {
      press("Enter");
    });
    expect(ran).toEqual(["metrics.reset"]);
    expect(storage.getItem(`dtb:v1:test:ext:command-menu:${RECENT_KEY}`)).toBe('["metrics.reset"]');

    hotkey();
    expect(labels()?.[0]).toBe("Reset metrics");
    expect(document.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe("Recent");
  });

  it("forgets a recent whose command no longer exists", async () => {
    const storage = createMemoryStorage();
    const key = `dtb:v1:test:ext:command-menu:${RECENT_KEY}`;
    storage.setItem(key, '["metrics.reset","renamed.away"]');
    mount({}, producers(), storage);
    hotkey();
    // The display always filtered dead ids; storage did not, so they sat in the
    // six-slot list forever, crowding out entries nobody could see them displace.
    expect(storage.getItem(key)).toBe('["metrics.reset"]');
    expect(labels()?.[0]).toBe("Reset metrics");
  });

  it("removes the key rather than storing an empty list", async () => {
    const storage = createMemoryStorage();
    const key = `dtb:v1:test:ext:command-menu:${RECENT_KEY}`;
    storage.setItem(key, '["renamed.away"]');
    mount({}, producers(), storage);
    hotkey();
    // Every recent was pruned: storage holds only what differs from "none".
    expect(storage.getItem(key)).toBeNull();
    expect(document.querySelector('[role="group"][aria-label="Recent"]')).toBeNull();
  });

  /*
   * Regression, kept at the panel: storage was once read before the shortcut
   * listener was registered, so a throwing adapter left a half-started palette
   * that never opened.
   */
  it("opens, runs and remembers for the session over a throwing storage adapter", async () => {
    const broken: ToolbarStorage = {
      getItem: () => {
        throw new Error("site data blocked");
      },
      setItem: () => {
        throw new Error("site data blocked");
      },
      removeItem: () => {
        throw new Error("site data blocked");
      },
    };
    mount({}, producers(), broken);
    expect(() => hotkey()).not.toThrow();
    expect(dialog()).not.toBeNull();
    await act(async () => {
      press("Enter");
    });
    expect(ran).toHaveLength(1);
    // Reopens: the palette is intact, only the recents did not persist.
    hotkey();
    expect(dialog()).not.toBeNull();
  });

  it("remembers nothing when asked not to", async () => {
    const storage = createMemoryStorage();
    mount({ rememberRecent: false }, producers(), storage);
    hotkey();
    await act(async () => {
      press("Enter");
    });
    expect(storage.getItem(`dtb:v1:test:ext:command-menu:${RECENT_KEY}`)).toBeNull();
  });
});

describe("accessibility", () => {
  it("is a combobox over a listbox, in a modal dialog", () => {
    mount();
    hotkey();
    const box = input() as HTMLInputElement;
    expect(dialog()?.getAttribute("aria-modal")).toBe("true");
    expect(dialog()?.getAttribute("aria-label")).toBe("Commands");
    expect(box.getAttribute("aria-expanded")).toBe("true");
    expect(box.getAttribute("aria-autocomplete")).toBe("list");

    const list = document.querySelector('[role="listbox"]') as HTMLElement;
    expect(box.getAttribute("aria-controls")).toBe(list.id);
    expect(list.id).not.toBe("");

    // The active row is named, and the name resolves to an element that exists.
    const active = box.getAttribute("aria-activedescendant") as string;
    expect(document.getElementById(active)).toBe(activeOption());

    press("ArrowDown");
    expect(box.getAttribute("aria-activedescendant")).not.toBe(active);
    expect(document.getElementById(box.getAttribute("aria-activedescendant") as string)).toBe(
      activeOption(),
    );
  });

  it("marks exactly one option selected at a time", () => {
    mount();
    hotkey();
    press("ArrowDown");
    expect(
      options().filter((option) => option.getAttribute("aria-selected") === "true"),
    ).toHaveLength(1);
  });
});

describe("a chord a host command and this palette both claim", () => {
  it("gives the palette the chord: its listener is registered first and preventDefault stops core's", () => {
    const menu = commandMenu({ apple: false, shortcut: "Mod+K" });
    mountToolbar(<div />, {
      instanceId: "test",
      bindCommandShortcuts: true,
      extensions: [
        menu,
        makeExtension({
          id: "host",
          commands: [{ ...command("host.open", "Open the host thing"), shortcut: "Mod+K" }],
        }),
      ],
      layout: { barWidth: 1200, itemWidth: 120 },
    });

    hotkey();

    // The palette opened, and the command core would otherwise have bound
    // did not run: one chord, one handler.
    expect(dialog()).not.toBeNull();
    expect(ran).toEqual([]);
  });

  it("lets core's binding have the chord while the bar is hidden, since the palette declines it", () => {
    const menu = commandMenu({ apple: false, shortcut: "Mod+K" });
    mountToolbar(<div />, {
      instanceId: "test",
      bindCommandShortcuts: true,
      defaultVisible: false,
      extensions: [
        menu,
        makeExtension({
          id: "host",
          commands: [{ ...command("host.open", "Open the host thing"), shortcut: "Mod+K" }],
        }),
      ],
      layout: { barWidth: 1200, itemWidth: 120 },
    });

    hotkey();

    expect(dialog()).toBeNull();
    expect(ran).toEqual(["host.open"]);
  });
});

describe("modifier glyphs in shortcut hints", () => {
  const glyphs = (root: Element) =>
    [...root.querySelectorAll('[data-dtb-part="cmd-glyph"]')].map((el) => el.textContent);

  it("wraps each Apple modifier symbol in the chip's hint, leaving the text intact", () => {
    mount({ apple: true, shortcut: "Mod+K" });
    const hint = document.querySelector<HTMLElement>('[data-dtb-part="cmd-trigger"]');
    expect(hint?.textContent).toBe("⌘K");
    expect(glyphs(hint!)).toEqual(["⌘"]);
  });

  it("does the same in a palette option's hint, and wraps nothing for letters", () => {
    // Author-supplied shortcut strings are shown verbatim on every platform.
    mount({}, [
      makeExtension({
        id: "host",
        commands: [
          { ...command("host.chord", "Run the chord"), shortcut: "⌘⇧P" },
          { ...command("host.plain", "Run the plain one"), shortcut: "Ctrl+K" },
        ],
      }),
    ]);
    hotkey();
    const hints = [...document.querySelectorAll<HTMLElement>('[data-dtb-part="cmd-option-hint"]')];
    expect(hints.map((el) => el.textContent)).toEqual(["⌘⇧P", "Ctrl+K"]);
    expect(glyphs(hints[0]!)).toEqual(["⌘", "⇧"]);
    expect(glyphs(hints[1]!)).toEqual([]);
  });
});

describe("a failed command's error text is outbound", () => {
  const failWith = async (thrown: unknown) => {
    const { extension } = mount({}, [
      makeExtension({
        id: "throwing",
        commands: [
          command("bad.one", "Explodes", "Bad", () => {
            throw thrown;
          }),
        ],
      }),
    ]);
    hotkey();
    await act(async () => {
      press("Enter");
    });
    return {
      snapshot: extension.diagnostics?.() as { error: unknown },
      alert: document.querySelector('[role="alert"]')?.textContent ?? null,
    };
  };

  it("masks a credential-carrying URL before it reaches the snapshot", async () => {
    const { snapshot, alert } = await failWith(new Error("failed for https://x/?token=abc"));
    expect(snapshot.error).toBe("failed for https://x/?token=[redacted]");
    expect(snapshot.error).not.toContain("abc");
    expect(alert).not.toContain("abc");
  });

  it("records a message getter that throws instead of throwing itself", async () => {
    const hostile = Object.defineProperty(new Error("x"), "message", {
      get() {
        throw new Error("no");
      },
    });
    const { snapshot } = await failWith(hostile);
    expect(snapshot.error).toBe("[unreadable]");
    expect(dialog()).not.toBeNull();
  });

  it("describes a non-string message by its tag, as a string", async () => {
    const { snapshot } = await failWith(Object.assign(new Error("x"), { message: 42 }));
    expect(snapshot.error).toBe("[object Error]");
  });
});
