/**
 * The handle's own contract, as opposed to what the tests using it happen to
 * exercise: that `runCommand()` really is `act()`-wrapped, that `rerender()`
 * keeps the toolbar it rendered, that an id is not a selector fragment, and
 * that the captured context dies with the tree.
 */
import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { mountToolbar } from "../lifecycle";
import { makeExtension } from "../makeExtension";
import type { DevToolbarExtension } from "../../core/contract";

/** Tracked by `mountToolbar`, so `vitest.setup.ts` tears every mount down. */
const mount = mountToolbar;

describe("renderWithToolbar handle", () => {
  it("act()-wraps runCommand, so a command that sets state needs no act() of its own", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    let bump: (() => void) | null = null;
    const Compact = () => {
      const [count, setCount] = useState(0);
      // Published from an effect rather than during render: the command below
      // is what calls it, and a render-time side effect is its own bug.
      useEffect(() => {
        bump = () => setCount((value) => value + 1);
      }, []);
      return <span data-dtb-part="count">{count}</span>;
    };

    const counter: DevToolbarExtension = {
      id: "counter",
      label: "Counter",
      compact: () => <Compact />,
      commands: [
        {
          id: "counter.bump",
          label: "Bump",
          // Awaits first: the state it sets lands in a later microtask, which
          // is exactly what a synchronous `act()` would fail to flush.
          run: async () => {
            await Promise.resolve();
            bump?.();
          },
        },
      ],
    };

    const { toolbar } = mount(null, { extensions: [counter] });
    expect(toolbar.part("count")?.textContent).toBe("0");

    // No `act()` here on purpose — the handle owns that.
    expect(await toolbar.runCommand("counter.bump")).toBe(true);
    expect(toolbar.part("count")?.textContent).toBe("1");

    const warnings = error.mock.calls.filter((call) => String(call[0]).includes("not wrapped in"));
    expect(warnings).toEqual([]);
    error.mockRestore();
  });

  it("rerenders the consumer UI inside the same toolbar", () => {
    const { toolbar, rerender } = mount(<div data-dtb-part="consumer">first</div>, {
      extensions: [makeExtension({ id: "one", label: "One" })],
      layout: true,
    });

    expect(toolbar.root()).not.toBeNull();
    toolbar.setPosition("top");

    rerender(<div data-dtb-part="consumer">second</div>);

    // The toolbar is still mounted — RTL's own `rerender` would have replaced
    // the whole tree with the bare `ui`.
    expect(toolbar.root()).not.toBeNull();
    expect(toolbar.part("consumer")?.textContent).toBe("second");
    expect(toolbar.item("one")).not.toBeNull();
    // Same instance, so its preferences and its layout install survived.
    expect(toolbar.position()).toBe("top");
    expect(toolbar.height()).toBe("30px");

    // And it stays a live handle: the mutators still reach the tree.
    toolbar.openPanel("one");
    expect(toolbar.activePanelId()).toBe("one");

    rerender();
    expect(toolbar.root()).not.toBeNull();
    expect(toolbar.part("consumer")).toBeNull();
  });

  it("escapes an extension id rather than interpolating it into the selector", () => {
    const awkward = 'a"b';
    const backslash = String.raw`c\d`;

    // Spied before the mount: one of these extensions throws on purpose.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { toolbar } = mount(null, {
      extensions: [
        makeExtension({ id: awkward, label: "Quote", panel: "quoted panel", overlay: "over" }),
        makeExtension({ id: backslash, label: "Backslash" }),
        makeExtension({ id: 'broken"quote', label: "Broken", throwInCompact: true }),
      ],
    });

    expect(toolbar.item(awkward)?.textContent).toBe("Quote");
    expect(toolbar.item(backslash)?.textContent).toBe("Backslash");
    expect(toolbar.overlay(awkward)).not.toBeNull();
    expect(toolbar.errorChip('broken"quote')?.textContent).toBe("Broken: error");

    toolbar.openPanel(awkward);
    expect(toolbar.panel(awkward)?.textContent).toContain("quoted panel");

    // A miss is still a miss, not a match on the neighbour.
    expect(toolbar.item('a"z')).toBeNull();
    error.mockRestore();
  });

  it("escapes through its own fallback on a host without CSS.escape", () => {
    // jsdom always has `CSS.escape`, so the fallback branch is only reachable
    // by taking it away — which is also the only way to prove it is correct.
    // It is inherited, not an own property, so `delete` would remove nothing:
    // shadow it with `undefined`, and drop that shadow again afterwards.
    const css = globalThis.CSS as unknown as { escape?: (value: string) => string };
    const own = Object.getOwnPropertyDescriptor(css, "escape");
    try {
      css.escape = undefined;
      expect(typeof globalThis.CSS.escape).toBe("undefined");

      const quote = 'a"b';
      const backslash = String.raw`c\d`;
      const newline = "e\nf";

      const { toolbar } = mount(null, {
        extensions: [
          makeExtension({ id: quote, label: "Quote" }),
          makeExtension({ id: backslash, label: "Backslash" }),
          // A raw newline cannot sit unescaped in a CSS string at all: `\`
          // in front of it is not enough, it needs the `\a ` hex form.
          makeExtension({ id: newline, label: "Newline" }),
        ],
      });

      expect(toolbar.item(quote)?.textContent).toBe("Quote");
      expect(toolbar.item(backslash)?.textContent).toBe("Backslash");
      expect(toolbar.item(newline)?.textContent).toBe("Newline");
      expect(toolbar.item('a"z')).toBeNull();
    } finally {
      if (own) Object.defineProperty(css, "escape", own);
      else delete css.escape;
    }
  });

  it("stops handing out the context once the tree is unmounted", () => {
    const { toolbar, unmount } = mount(null, {
      extensions: [makeExtension({ id: "one", label: "One" })],
    });
    expect(toolbar.context().visible).toBe(true);

    unmount();

    expect(() => toolbar.context()).toThrow(/is not mounted/);
    expect(toolbar.root()).toBeNull();
  });
});
