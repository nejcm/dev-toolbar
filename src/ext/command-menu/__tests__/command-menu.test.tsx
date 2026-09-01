/**
 * `/ext/command-menu` against the real shell, through the same `/testing`
 * surface a stranger writing an extension would use.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { renderWithToolbar, makeExtension } from "@nejcm/dev-toolbar/testing";
import { createMemoryStorage } from "../../../core/storage";
import { commandMenu } from "../index";
import { RECENT_KEY } from "../runtime";
import type { CommandMenuOptions } from "../index";
import type {
  DevToolbarExtension,
  ToolbarCommand,
  ToolbarStorage,
} from "../../../core/contract";

let unmountAll: (() => void)[] = [];
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
  const result = renderWithToolbar(
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
  unmountAll.push(result.unmount);
  return { extension, ...result };
};

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const input = () => document.querySelector<HTMLInputElement>('[role="combobox"]');
const options = () => [
  ...document.querySelectorAll<HTMLElement>('[role="option"]'),
];
const labels = () =>
  options().map((option) =>
    option.querySelector('[data-dtb-part="cmd-option-label"]')?.textContent,
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
  for (const unmount of unmountAll.splice(0)) unmount();
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
    const scrim = () =>
      document.querySelector('[data-dtb-part="cmd-scrim"]') as HTMLElement;
    // A right-click reaching for a context menu is not a dismissal. Dispatched
    // by hand: Testing Library's `pointerDown` synthesizes an event that
    // carries no `button` at all, so it cannot express the case.
    scrim().dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 2 }),
    );
    expect(dialog()).not.toBeNull();
    fireEvent.pointerDown(scrim());
    expect(dialog()).toBeNull();
  });

  it("opens from the bar chip too", () => {
    const { toolbar } = mount();
    const trigger = toolbar
      .item("command-menu")
      ?.querySelector<HTMLButtonElement>("button");
    expect(trigger?.getAttribute("aria-keyshortcuts")).toBe("Control+K");
    act(() => trigger?.click());
    expect(dialog()).not.toBeNull();
  });

  it("still opens on the shortcut when its own chip has collapsed", () => {
    const { toolbar } = mount({ priority: 0 }, [
      makeExtension({ id: "wide", priority: 90 }),
    ]);
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
    expect(labels()).toEqual([
      "Toggle flag: A",
      "Clear all local flag overrides",
      "Reset metrics",
    ]);
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
    expect(
      document.querySelector('[data-dtb-part="cmd-empty"]')?.textContent,
    ).toContain("No matching command");
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
    });
    expect(ran).toEqual(["metrics.reset"]);
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
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "the provider is offline",
    );
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
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "no longer available",
    );
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
    expect(storage.getItem(`dtb:v1:test:ext:command-menu:${RECENT_KEY}`)).toBe(
      '["metrics.reset"]',
    );

    hotkey();
    expect(labels()?.[0]).toBe("Reset metrics");
    expect(
      document.querySelector('[role="group"]')?.getAttribute("aria-label"),
    ).toBe("Recent");
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

  it("remembers nothing when asked not to", async () => {
    const storage = createMemoryStorage();
    mount({ rememberRecent: false }, producers(), storage);
    hotkey();
    await act(async () => {
      press("Enter");
    });
    expect(
      storage.getItem(`dtb:v1:test:ext:command-menu:${RECENT_KEY}`),
    ).toBeNull();
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
    expect(
      document.getElementById(
        box.getAttribute("aria-activedescendant") as string,
      ),
    ).toBe(activeOption());
  });

  it("marks exactly one option selected at a time", () => {
    mount();
    hotkey();
    press("ArrowDown");
    expect(
      options().filter(
        (option) => option.getAttribute("aria-selected") === "true",
      ),
    ).toHaveLength(1);
  });
});
