import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { CONTRACT_VERSION } from "../contract";
import type { DevToolbarExtension, ExtensionRuntimeApi } from "../contract";
import { DevToolbar } from "../DevToolbar";
import { DevToolbarInset } from "../DevToolbarInset";
import { useDevToolbar, useToolbarCommands } from "../context";
import { runCommand } from "../commands";
import { isApplePlatform } from "../shortcut";
import { STORAGE_PREFIX } from "../storage";

const panelExtension = (
  id: string,
  overrides: Partial<DevToolbarExtension> = {},
): DevToolbarExtension => ({
  id,
  label: id,
  compact: ({ isPanelOpen, openPanel, closePanel }) => (
    <button type="button" onClick={() => (isPanelOpen ? closePanel() : openPanel())}>
      {id}
    </button>
  ),
  panel: () => <div data-testid={`panel-${id}`}>{id} panel</div>,
  ...overrides,
});

/** Fires the default toggle chord for whichever platform the test host reports. */
const fireToggleShortcut = (
  target: Window | Element = window,
  overrides: Record<string, unknown> = {},
) =>
  fireEvent.keyDown(target, {
    key: ".",
    code: "Period",
    shiftKey: true,
    ...(isApplePlatform() ? { metaKey: true } : { ctrlKey: true }),
    ...overrides,
  });

const activePanelIds = () =>
  [...document.querySelectorAll('[data-dtb-part="panel"]')]
    .filter((node) => !node.hasAttribute("hidden"))
    .map((node) => (node as HTMLElement).dataset["dtbExtId"]);

const mountedPanelIds = () =>
  [...document.querySelectorAll('[data-dtb-part="panel"]')].map(
    (node) => (node as HTMLElement).dataset["dtbExtId"],
  );

let warn: Mock<typeof console.warn>;
let error: Mock<typeof console.error>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
});

describe("DevToolbar rendering", () => {
  it("renders children untouched and portals the bar to document.body", () => {
    const { container } = render(
      <DevToolbar instanceId="t" extensions={[panelExtension("a")]}>
        <main data-testid="app">app</main>
      </DevToolbar>,
    );

    expect(container.innerHTML).toBe('<main data-testid="app">app</main>');
    const root = document.body.querySelector("[data-dev-toolbar]");
    expect(root).not.toBeNull();
    expect(root!.parentElement).toBe(document.body);
    expect(root!.getAttribute("data-dtb-position")).toBe("bottom");
  });

  it("renders nothing but children when disabled", () => {
    render(
      <DevToolbar instanceId="t" enabled={false} extensions={[panelExtension("a")]}>
        <main data-testid="app">app</main>
      </DevToolbar>,
    );
    expect(document.querySelector("[data-dev-toolbar]")).toBeNull();
    expect(screen.getByTestId("app")).toBeTruthy();
  });

  it("injects the stylesheet once, and not at all with injectStyles={false}", () => {
    const first = render(
      <DevToolbar instanceId="a" extensions={[]}>
        <div />
      </DevToolbar>,
    );
    render(
      <DevToolbar instanceId="b" extensions={[]}>
        <div />
      </DevToolbar>,
    );
    expect(document.head.querySelectorAll("style[data-dev-toolbar-styles]").length).toBe(1);
    first.unmount();

    document.head
      .querySelectorAll("style[data-dev-toolbar-styles]")
      .forEach((node) => node.remove());
    render(
      <DevToolbar instanceId="c" injectStyles={false} extensions={[]}>
        <div />
      </DevToolbar>,
    );
    expect(document.head.querySelectorAll("style[data-dev-toolbar-styles]").length).toBe(0);
  });
});

describe("panels", () => {
  it("keeps a single panel open at a time", () => {
    render(
      <DevToolbar instanceId="t" extensions={[panelExtension("a"), panelExtension("b")]}>
        <div />
      </DevToolbar>,
    );

    fireEvent.click(screen.getByRole("button", { name: "a" }));
    expect(activePanelIds()).toEqual(["a"]);

    fireEvent.click(screen.getByRole("button", { name: "b" }));
    expect(activePanelIds()).toEqual(["b"]);

    fireEvent.click(screen.getByRole("button", { name: "b" }));
    expect(activePanelIds()).toEqual([]);
  });

  it("unmounts a closed panel unless keepMounted is set", () => {
    render(
      <DevToolbar
        instanceId="t"
        extensions={[panelExtension("plain"), panelExtension("sticky", { keepMounted: true })]}
      >
        <div />
      </DevToolbar>,
    );

    fireEvent.click(screen.getByRole("button", { name: "plain" }));
    expect(mountedPanelIds()).toEqual(["plain"]);
    fireEvent.click(screen.getByRole("button", { name: "plain" }));
    expect(mountedPanelIds()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "sticky" }));
    expect(activePanelIds()).toEqual(["sticky"]);
    fireEvent.click(screen.getByRole("button", { name: "sticky" }));
    expect(mountedPanelIds()).toEqual(["sticky"]);
    expect(activePanelIds()).toEqual([]);
  });
});

describe("panel resize", () => {
  it("persists the height once, on pointerup, not on every pointermove", () => {
    render(
      <DevToolbar instanceId="resize" extensions={[panelExtension("a")]}>
        <div />
      </DevToolbar>,
    );
    fireEvent.click(screen.getByRole("button", { name: "a" }));

    const resizer = document.querySelector('[data-dtb-part="panel-resizer"]')!;
    const key = `${STORAGE_PREFIX}:resize:panelHeight`;
    const setItem = vi.spyOn(window.localStorage, "setItem");

    // jsdom has no PointerEvent, so dispatch MouseEvents under the pointer
    // type names — they carry the clientY the resizer reads.
    const pointer = (type: string, clientY: number) =>
      new MouseEvent(type, { clientY, bubbles: true });

    fireEvent(resizer, pointer("pointerdown", 500));
    for (const clientY of [490, 480, 470, 460]) {
      fireEvent(window, pointer("pointermove", clientY));
    }

    const writesDuringDrag = setItem.mock.calls.filter((call) => call[0] === key).length;
    expect(writesDuringDrag).toBe(0);
    // The panel still tracks the drag live.
    const panel = document.querySelector('[data-dtb-part="panel"]') as HTMLElement;
    expect(panel.style.getPropertyValue("--dtb-panel-height")).toBe("360px");

    fireEvent(window, pointer("pointerup", 460));
    expect(setItem.mock.calls.filter((call) => call[0] === key).length).toBe(1);
    expect(window.localStorage.getItem(key)).toBe("360");

    setItem.mockRestore();
  });
});

describe("error containment", () => {
  it("degrades a throwing compact slot to an error chip and keeps the bar", () => {
    const boom: DevToolbarExtension = {
      id: "boom",
      label: "Boom",
      compact: () => {
        throw new Error("compact exploded");
      },
    };

    render(
      <DevToolbar instanceId="t" extensions={[boom, panelExtension("ok")]}>
        <div />
      </DevToolbar>,
    );

    const chip = document.querySelector('[data-dtb-part="error-chip"][data-dtb-ext-id="boom"]');
    expect(chip).not.toBeNull();
    expect(chip!.getAttribute("title")).toBe("compact exploded");
    expect(screen.getByRole("button", { name: "ok" })).toBeTruthy();
    expect(document.querySelector('[data-dtb-part="bar"]')).not.toBeNull();
  });

  it("degrades a throwing panel slot without taking down the bar", () => {
    const boom: DevToolbarExtension = {
      id: "boom",
      label: "Boom",
      compact: ({ openPanel }) => (
        <button type="button" onClick={openPanel}>
          boom
        </button>
      ),
      panel: () => {
        throw new Error("panel exploded");
      },
    };

    render(
      <DevToolbar instanceId="t" extensions={[boom, panelExtension("ok")]}>
        <div />
      </DevToolbar>,
    );

    fireEvent.click(screen.getByRole("button", { name: "boom" }));
    expect(
      document.querySelector('[data-dtb-part="error-chip"][data-dtb-slot="panel"]'),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "ok" })).toBeTruthy();
  });

  it("re-renders the slot when the error chip's retry is clicked", () => {
    let shouldThrow = true;
    const flaky: DevToolbarExtension = {
      id: "flaky",
      label: "Flaky",
      compact: () => {
        if (shouldThrow) throw new Error("transient");
        return <span data-testid="flaky-recovered">fine</span>;
      },
    };

    render(
      <DevToolbar instanceId="t" extensions={[flaky]}>
        <div />
      </DevToolbar>,
    );

    const chip = () =>
      document.querySelector('[data-dtb-part="error-chip"][data-dtb-ext-id="flaky"]');
    expect(chip()).not.toBeNull();
    // The label is still what the chip reads out; the retry is the chip itself.
    expect(chip()!.textContent).toBe("Flaky: error");

    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Flaky: error. Retry" }));

    expect(chip()).toBeNull();
    expect(screen.getByTestId("flaky-recovered")).toBeTruthy();
  });

  it("leaves an overlay chip inert — there is nothing sensible to click", () => {
    const boom: DevToolbarExtension = {
      id: "boom",
      label: "Boom",
      overlay: () => {
        throw new Error("overlay exploded");
      },
    };

    render(
      <DevToolbar instanceId="t" extensions={[boom]}>
        <div />
      </DevToolbar>,
    );

    const chip = document.querySelector('[data-dtb-part="error-chip"][data-dtb-slot="overlay"]');
    expect(chip).not.toBeNull();
    expect(chip!.querySelector('[data-dtb-part="error-retry"]')).toBeNull();
  });
});

describe("contract version", () => {
  it("warns on mismatch and stays quiet on a match", () => {
    render(
      <DevToolbar
        instanceId="t"
        extensions={[
          { id: "old", label: "Old", contractVersion: CONTRACT_VERSION + 1 },
          { id: "new", label: "New", contractVersion: CONTRACT_VERSION },
          { id: "silent", label: "Silent" },
        ]}
      >
        <div />
      </DevToolbar>,
    );

    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.filter((message) => message.includes('"old"')).length).toBe(1);
    expect(messages.some((message) => message.includes('"new"'))).toBe(false);
    expect(messages.some((message) => message.includes('"silent"'))).toBe(false);
  });

  it("warns once per extension id across re-renders with fresh inline arrays", () => {
    const view = render(
      <DevToolbar
        instanceId="t"
        extensions={[
          { id: "old", label: "Old", contractVersion: CONTRACT_VERSION + 1 },
          { id: "older", label: "Older", contractVersion: CONTRACT_VERSION + 2 },
        ]}
      >
        <div />
      </DevToolbar>,
    );

    // A fresh array literal on every render is the misuse ADR-001 calls likely,
    // and is exactly what an un-deduped warning would flood the console for.
    for (let index = 0; index < 2; index += 1) {
      view.rerender(
        <DevToolbar
          instanceId="t"
          extensions={[
            { id: "old", label: "Old", contractVersion: CONTRACT_VERSION + 1 },
            { id: "older", label: "Older", contractVersion: CONTRACT_VERSION + 2 },
          ]}
        >
          <div />
        </DevToolbar>,
      );
    }

    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.filter((message) => message.includes('"old"')).length).toBe(1);
    expect(messages.filter((message) => message.includes('"older"')).length).toBe(1);
  });
});

describe("persistence", () => {
  it("persists visibility, position and panel state under dtb:v1:<instanceId>", () => {
    const Controls = () => {
      const toolbar = useDevToolbar();
      return (
        <button type="button" onClick={() => toolbar.setPosition("top")}>
          move
        </button>
      );
    };

    render(
      <DevToolbar instanceId="persist" extensions={[panelExtension("a")]}>
        <Controls />
      </DevToolbar>,
    );

    fireEvent.click(screen.getByRole("button", { name: "move" }));
    fireEvent.click(screen.getByRole("button", { name: "a" }));

    expect(window.localStorage.getItem(`${STORAGE_PREFIX}:persist:position`)).toBe('"top"');
    expect(window.localStorage.getItem(`${STORAGE_PREFIX}:persist:activePanel`)).toBe('"a"');
  });

  it("writes nothing when storage={null}", () => {
    render(
      <DevToolbar instanceId="none" storage={null} extensions={[panelExtension("a")]}>
        <div />
      </DevToolbar>,
    );

    fireEvent.click(screen.getByRole("button", { name: "a" }));
    fireToggleShortcut();

    const keys = Object.keys(window.localStorage).filter((key) => key.startsWith(STORAGE_PREFIX));
    expect(keys).toEqual([]);
  });
});

describe("toggle shortcut", () => {
  it("toggles visibility on Ctrl/Cmd+Shift+.", () => {
    render(
      <DevToolbar instanceId="t" extensions={[panelExtension("a")]}>
        <div />
      </DevToolbar>,
    );
    expect(document.querySelector("[data-dev-toolbar]")).not.toBeNull();

    fireToggleShortcut();
    expect(document.querySelector("[data-dev-toolbar]")).toBeNull();

    fireToggleShortcut();
    expect(document.querySelector("[data-dev-toolbar]")).not.toBeNull();
  });

  it("does nothing when shortcut={null}", () => {
    render(
      <DevToolbar instanceId="t" shortcut={null} extensions={[panelExtension("a")]}>
        <div />
      </DevToolbar>,
    );
    fireToggleShortcut();
    expect(document.querySelector("[data-dev-toolbar]")).not.toBeNull();
  });

  it("ignores a chord the host app already handled", () => {
    render(
      <DevToolbar instanceId="t" extensions={[panelExtension("a")]}>
        <div />
      </DevToolbar>,
    );

    const handled = (event: KeyboardEvent) => event.preventDefault();
    document.addEventListener("keydown", handled);
    try {
      // Dispatched on the body so it bubbles document -> window, the order a
      // real app handler sees.
      fireToggleShortcut(document.body);
    } finally {
      document.removeEventListener("keydown", handled);
    }

    expect(document.querySelector("[data-dev-toolbar]")).not.toBeNull();
  });

  it("ignores a chord fired mid-composition", () => {
    render(
      <DevToolbar instanceId="t" extensions={[panelExtension("a")]}>
        <div />
      </DevToolbar>,
    );

    fireToggleShortcut(window, { isComposing: true });
    expect(document.querySelector("[data-dev-toolbar]")).not.toBeNull();
  });

  it("ignores auto-repeat while the chord is held", () => {
    render(
      <DevToolbar instanceId="t" extensions={[panelExtension("a")]}>
        <div />
      </DevToolbar>,
    );

    fireToggleShortcut();
    expect(document.querySelector("[data-dev-toolbar]")).toBeNull();

    fireToggleShortcut(window, { repeat: true });
    expect(document.querySelector("[data-dev-toolbar]")).toBeNull();
  });

  it("still toggles from an editable target", () => {
    render(
      <DevToolbar instanceId="t" extensions={[panelExtension("a")]}>
        <input aria-label="host input" />
      </DevToolbar>,
    );

    const input = screen.getByLabelText("host input");
    input.focus();
    fireToggleShortcut(input);
    expect(document.querySelector("[data-dev-toolbar]")).toBeNull();
  });
});

describe("lifecycle", () => {
  it("starts each extension once with a signal and reports visibility", () => {
    const seen: ExtensionRuntimeApi[] = [];
    const visibility: boolean[] = [];
    const dispose = vi.fn();
    const start = vi.fn((api: ExtensionRuntimeApi) => {
      seen.push(api);
      api.subscribeVisibility((visible) => visibility.push(visible));
      return dispose;
    });

    const extensions = [{ id: "live", label: "Live", start }];
    const view = render(
      <DevToolbar instanceId="t" extensions={extensions}>
        <div />
      </DevToolbar>,
    );

    view.rerender(
      <DevToolbar instanceId="t" extensions={[...extensions]}>
        <div />
      </DevToolbar>,
    );
    expect(start).toHaveBeenCalledTimes(1);
    expect(seen[0]!.isVisible()).toBe(true);
    expect(seen[0]!.signal.aborted).toBe(false);

    fireToggleShortcut();
    expect(visibility).toEqual([false]);
    expect(seen[0]!.signal.aborted).toBe(false);

    view.unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(seen[0]!.signal.aborted).toBe(true);
  });

  it("tears down running extensions when enabled flips to false", () => {
    const dispose = vi.fn();
    let api: ExtensionRuntimeApi | null = null;
    const start = vi.fn((received: ExtensionRuntimeApi) => {
      api = received;
      return dispose;
    });
    const extensions = [{ id: "live", label: "Live", start }];

    const view = render(
      <DevToolbar instanceId="t" enabled extensions={extensions}>
        <div />
      </DevToolbar>,
    );
    expect(start).toHaveBeenCalledTimes(1);
    expect(api!.signal.aborted).toBe(false);

    view.rerender(
      <DevToolbar instanceId="t" enabled={false} extensions={extensions}>
        <div />
      </DevToolbar>,
    );

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(api!.signal.aborted).toBe(true);
    expect(document.querySelector("[data-dev-toolbar]")).toBeNull();

    // Re-enabling starts a fresh run with a fresh signal.
    view.rerender(
      <DevToolbar instanceId="t" enabled extensions={extensions}>
        <div />
      </DevToolbar>,
    );
    expect(start).toHaveBeenCalledTimes(2);
    expect(api!.signal.aborted).toBe(false);
  });

  it("leaves the document untouched while disabled", () => {
    render(
      <DevToolbar
        instanceId="t"
        enabled={false}
        extensions={[{ id: "old", label: "Old", contractVersion: CONTRACT_VERSION + 1 }]}
      >
        <div />
      </DevToolbar>,
    );

    // The instance's own name is the one it would have written; the unsuffixed
    // name is not `t`'s to write at all, and is asserted only so a future
    // default-instance regression cannot hide here.
    expect(document.documentElement.style.getPropertyValue("--dev-toolbar-height-t")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--dev-toolbar-height")).toBe("");
    expect(warn).not.toHaveBeenCalled();
  });

  it("namespaces extension storage by id", () => {
    const start = (api: ExtensionRuntimeApi) => {
      api.storage.setItem("k", "v");
    };
    render(
      <DevToolbar instanceId="inst" extensions={[{ id: "e", label: "E", start }]}>
        <div />
      </DevToolbar>,
    );
    expect(window.localStorage.getItem(`${STORAGE_PREFIX}:inst:ext:e:k`)).toBe("v");
  });

  it("keeps the mount-time instanceId after the prop changes", () => {
    const written: string[] = [];
    const storage = {
      getItem: () => null,
      setItem: (key: string) => {
        written.push(key);
      },
      removeItem: (key: string) => {
        written.push(key);
      },
    };
    const write = (api: ExtensionRuntimeApi) => {
      api.storage.setItem("k", "v");
    };
    const a: DevToolbarExtension = { id: "a", label: "A", start: write };
    const b: DevToolbarExtension = { id: "b", label: "B", start: write };

    const { rerender } = render(
      <DevToolbar instanceId="one" storage={storage} extensions={[a]}>
        <div />
      </DevToolbar>,
    );
    rerender(
      <DevToolbar instanceId="two" storage={storage} extensions={[a, b]}>
        <div />
      </DevToolbar>,
    );

    expect(written).toContain(`${STORAGE_PREFIX}:one:ext:b:k`);
    expect(written.filter((key) => !key.startsWith(`${STORAGE_PREFIX}:one:`))).toEqual([]);
    expect(
      document.querySelector('[data-dtb-part="root"]')?.getAttribute("data-dtb-instance"),
    ).toBe("one");
  });
});

describe("commands and dynamic registration", () => {
  it("aggregates commands and runs them by id without rendering a palette", async () => {
    const run = vi.fn();
    const Commands = () => {
      const commands = useToolbarCommands();
      return <span data-testid="commands">{commands.map((c) => c.id).join(",")}</span>;
    };

    render(
      <DevToolbar
        instanceId="t"
        extensions={[{ id: "a", label: "A", commands: [{ id: "a.run", label: "Run", run }] }]}
      >
        <Commands />
      </DevToolbar>,
    );

    expect(screen.getByTestId("commands").textContent).toBe("a.run");
    expect(document.querySelector('[data-dtb-part="command-palette"]')).toBeNull();

    await act(async () => {
      expect(await runCommand("a.run")).toBe(true);
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(await runCommand("missing")).toBe(false);
  });

  it("registers extensions dynamically through the context", () => {
    const Register = () => {
      const { register } = useDevToolbar();
      useEffect(
        () => register({ id: "dyn", label: "Dyn", compact: () => <span>dyn</span> }),
        [register],
      );
      return null;
    };

    const view = render(
      <DevToolbar instanceId="t" extensions={[]}>
        <Register />
      </DevToolbar>,
    );
    expect(document.querySelector('[data-dtb-ext-id="dyn"]')).not.toBeNull();

    view.unmount();
  });
});

describe("DevToolbarInset", () => {
  it("pads by the published height variable and collapses when hidden", () => {
    render(
      <DevToolbar instanceId="t" extensions={[]}>
        <DevToolbarInset data-testid="inset">app</DevToolbarInset>
      </DevToolbar>,
    );

    const inset = screen.getByTestId("inset");
    expect(inset.style.paddingBottom).toBe(
      "var(--dev-toolbar-height-t, var(--dev-toolbar-height, 0px))",
    );

    fireToggleShortcut();
    expect(screen.getByTestId("inset").style.paddingBottom).toBe("0px");
  });
});

describe("the height variable", () => {
  /**
   * jsdom measures everything as 0x0, so the height a root reports is stubbed
   * per instance — `data-dtb-instance` is on the portalled root, which is the
   * element the effect observes.
   */
  const stubHeights = (heights: Record<string, number>) =>
    vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement): DOMRect {
        const instance = this.dataset["dtbInstance"];
        const height = instance === undefined ? 0 : (heights[instance] ?? 0);
        return {
          height,
          width: 0,
          top: 0,
          left: 0,
          right: 0,
          bottom: height,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      });

  const read = (name: string) => document.documentElement.style.getPropertyValue(name);

  it("publishes the unsuffixed variable for the default instance", () => {
    const rect = stubHeights({ default: 24 });
    render(
      <DevToolbar extensions={[]}>
        <div />
      </DevToolbar>,
    );

    expect(read("--dev-toolbar-height")).toBe("24px");
    expect(read("--dev-toolbar-height-default")).toBe("24px");
    rect.mockRestore();
  });

  it("gives each instance its own variable, and a survivor keeps its value", () => {
    const rect = stubHeights({ alpha: 24, beta: 36 });
    const alpha = render(
      <DevToolbar instanceId="alpha" extensions={[]}>
        <div />
      </DevToolbar>,
    );
    render(
      <DevToolbar instanceId="beta" extensions={[]}>
        <div />
      </DevToolbar>,
    );

    expect(read("--dev-toolbar-height-alpha")).toBe("24px");
    expect(read("--dev-toolbar-height-beta")).toBe("36px");

    alpha.unmount();

    expect(read("--dev-toolbar-height-alpha")).toBe("");
    expect(read("--dev-toolbar-height-beta")).toBe("36px");
    rect.mockRestore();
  });

  it("keeps a non-default instance out of the unsuffixed variable", () => {
    const rect = stubHeights({ alpha: 24 });
    render(
      <DevToolbar instanceId="alpha" extensions={[]}>
        <div />
      </DevToolbar>,
    );

    expect(read("--dev-toolbar-height-alpha")).toBe("24px");
    expect(read("--dev-toolbar-height")).toBe("");
    rect.mockRestore();
  });

  it("reduces an instanceId to characters a custom property can carry", () => {
    const rect = stubHeights({ "a b/c": 24 });
    render(
      <DevToolbar instanceId="a b/c" extensions={[]}>
        <div />
      </DevToolbar>,
    );

    expect(read("--dev-toolbar-height-a_b_c")).toBe("24px");
    rect.mockRestore();
  });
});

describe("duplicate extension ids", () => {
  /**
   * The merge in `DevToolbar` is documented in `docs/architecture.md` §3 only
   * as "props first, then dynamic registrations, de-duplicated by `id`". That
   * fixes which *source* wins; which entry wins inside one `extensions` array
   * is not written down anywhere, so the first two tests pin what the code
   * does rather than specify it: the first occurrence wins and the later one is
   * dropped whole — no render, no `start()`, no commands, and no warning.
   */
  const dup = (
    label: string,
    overrides: Partial<DevToolbarExtension> = {},
  ): DevToolbarExtension => ({
    id: "dup",
    label,
    compact: () => <span data-testid={`compact-${label}`}>{label}</span>,
    ...overrides,
  });

  it("renders only the first of a duplicated id", () => {
    render(
      <DevToolbar instanceId="t" extensions={[dup("first"), dup("second")]}>
        <div />
      </DevToolbar>,
    );

    expect(document.querySelectorAll('[data-dtb-ext-id="dup"]').length).toBe(1);
    expect(screen.getByTestId("compact-first")).toBeTruthy();
    expect(screen.queryByTestId("compact-second")).toBeNull();
  });

  it("never starts the dropped duplicate, and takes none of its commands", () => {
    const firstStart = vi.fn();
    const secondStart = vi.fn();
    const Commands = () => {
      const commands = useToolbarCommands();
      return <span data-testid="commands">{commands.map((c) => c.id).join(",")}</span>;
    };

    render(
      <DevToolbar
        instanceId="t"
        extensions={[
          dup("first", {
            start: firstStart,
            commands: [{ id: "dup.first", label: "First", run: () => {} }],
          }),
          dup("second", {
            start: secondStart,
            commands: [{ id: "dup.second", label: "Second", run: () => {} }],
          }),
        ]}
      >
        <Commands />
      </DevToolbar>,
    );

    expect(firstStart).toHaveBeenCalledTimes(1);
    expect(secondStart).not.toHaveBeenCalled();
    expect(screen.getByTestId("commands").textContent).toBe("dup.first");
    // The duplicate is dropped before the identity check ever sees it, so the
    // "rebuilt after it started" warning must not fire for a second object
    // that simply lost the merge.
    expect(warn).not.toHaveBeenCalled();
  });

  it("lets a prop entry win over a dynamic registration of the same id", () => {
    // This half *is* documented: §3 says props come first in the merge.
    const Register = () => {
      const { register } = useDevToolbar();
      useEffect(() => register(dup("registered")), [register]);
      return null;
    };

    render(
      <DevToolbar instanceId="t" extensions={[dup("from-props")]}>
        <Register />
      </DevToolbar>,
    );

    expect(document.querySelectorAll('[data-dtb-ext-id="dup"]').length).toBe(1);
    expect(screen.getByTestId("compact-from-props")).toBeTruthy();
    expect(screen.queryByTestId("compact-registered")).toBeNull();
  });
});

describe("the container prop", () => {
  let host: HTMLElement | null = null;

  afterEach(() => {
    host?.remove();
    host = null;
  });

  const makeHost = () => {
    host = document.createElement("div");
    host.id = "toolbar-host";
    document.body.append(host);
    return host;
  };

  it("portals the bar into the given element instead of document.body", () => {
    const target = makeHost();
    render(
      <DevToolbar instanceId="t" container={target} extensions={[panelExtension("a")]}>
        <div />
      </DevToolbar>,
    );

    const root = document.querySelector("[data-dev-toolbar]");
    expect(root).not.toBeNull();
    expect(root!.parentElement).toBe(target);
    expect([...document.body.children].includes(root!)).toBe(false);
    // Everything the bar hosts moves with it, not just the root.
    expect(target.querySelector('[data-dtb-part="bar"]')).not.toBeNull();
  });

  it("falls back to document.body for container={null}", () => {
    // `container` is typed `HTMLElement | null` and the default is documented
    // as `document.body`; `null` is coalesced, so it means "the default"
    // rather than "nowhere".
    render(
      <DevToolbar instanceId="t" container={null} extensions={[panelExtension("a")]}>
        <div />
      </DevToolbar>,
    );

    const root = document.querySelector("[data-dev-toolbar]");
    expect(root!.parentElement).toBe(document.body);
  });

  it("moves the bar when the container changes", () => {
    const target = makeHost();
    const view = render(
      <DevToolbar instanceId="t" extensions={[panelExtension("a")]}>
        <div />
      </DevToolbar>,
    );
    expect(document.querySelector("[data-dev-toolbar]")!.parentElement).toBe(document.body);

    view.rerender(
      <DevToolbar instanceId="t" container={target} extensions={[panelExtension("a")]}>
        <div />
      </DevToolbar>,
    );

    const roots = document.querySelectorAll("[data-dev-toolbar]");
    expect(roots.length).toBe(1);
    expect(roots[0]!.parentElement).toBe(target);
  });
});

describe("an extension list with nothing visible in it", () => {
  it("renders the bar chrome empty rather than dropping it", () => {
    // Not written down as such, but it follows from §2's `hidden` table plus
    // the fact that the bar is chrome: a hidden extension is absent, and an
    // empty bar is still a bar. Pins that the toolbar does not collapse to
    // nothing — the height variable a consumer insets by stays published.
    render(
      <DevToolbar
        instanceId="t"
        extensions={[panelExtension("a", { hidden: true }), panelExtension("b", { hidden: true })]}
      >
        <div />
      </DevToolbar>,
    );

    expect(document.querySelector("[data-dev-toolbar]")).not.toBeNull();
    const bar = document.querySelector('[data-dtb-part="bar"]');
    expect(bar).not.toBeNull();
    expect(bar!.querySelectorAll('[data-dtb-part="item"]').length).toBe(0);
    expect(document.querySelector('[data-dtb-part="overflow-button"]')).toBeNull();
    expect(document.querySelector('[data-dtb-part="panel"]')).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--dev-toolbar-height-t")).toBe("0px");
  });

  it("renders the same empty bar for extensions={[]}", () => {
    render(
      <DevToolbar instanceId="t" extensions={[]}>
        <div />
      </DevToolbar>,
    );

    const bar = document.querySelector('[data-dtb-part="bar"]');
    expect(bar).not.toBeNull();
    expect(bar!.querySelectorAll('[data-dtb-part="item"]').length).toBe(0);
    expect(bar!.querySelectorAll('[data-dtb-part="region"]').length).toBe(2);
  });
});
