/**
 * `/ext/flags` against the real shell, through the same `/testing` surface a
 * stranger writing an extension would use.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { cleanupToolbar, mountToolbar } from "@nejcm/dev-toolbar/testing";
import { collectCommands } from "../../../core/commands";
import { createMemoryStorage } from "../../../core/storage";
import { flags, readStoredOverrides } from "../index";
import { OVERRIDES_KEY } from "../runtime";
import type { FlagsOptions } from "../index";
import type { FlagReading, FlagValue } from "../types";
import type { ToolbarStorage } from "../../../core/contract";

const CATALOGUE: FlagReading[] = [
  {
    key: "ui-facelift",
    label: "UI Facelift 2026",
    type: "boolean",
    defaultValue: false,
    value: false,
    source: "server-rule",
  },
  { key: "new-header", type: "boolean", defaultValue: false, value: false },
  {
    key: "checkout.copy",
    type: "string",
    defaultValue: "old",
    value: "old",
    reloadBehavior: "full-reload",
  },
];

let written: string[] = [];
let applied: [string, FlagValue | undefined][] = [];

const mount = (options: FlagsOptions = {}, storage?: ToolbarStorage | null) => {
  const extension = flags({ flags: CATALOGUE, ...options });
  const result = mountToolbar(null, {
    extensions: [extension],
    instanceId: "test",
    ...(storage === undefined ? {} : { storage }),
    layout: { barWidth: 1200, itemWidth: 120 },
  });
  return { extension, ...result };
};

const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, " ").trim() ?? "";

const row = (panel: HTMLElement | null, key: string) =>
  panel?.querySelector<HTMLElement>(`[data-dtb-part="flag-row"][data-dtb-flag="${key}"]`) ?? null;

beforeEach(() => {
  written = [];
  applied = [];
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (value: string) => {
        written.push(value);
        return Promise.resolve();
      },
    },
  });
});

afterEach(() => {
  cleanupToolbar();
  document.head
    .querySelectorAll('style[data-dev-toolbar-styles="ext-flags"]')
    .forEach((node) => node.remove());
});

const record = (key: string, value: FlagValue | undefined) => {
  applied.push([key, value]);
};

describe("the compact chip", () => {
  it("counts the flags and shouts when an override is live", () => {
    const { toolbar } = mount({ onOverride: record });
    expect(text(toolbar.item("flags")?.querySelector('[data-dtb-part="flag-count"]'))).toBe("3");

    act(() => {
      toolbar.openPanel("flags");
    });
    const switchButton = row(
      toolbar.panel("flags"),
      "ui-facelift",
    )?.querySelector<HTMLButtonElement>('[data-dtb-part="flag-switch"]');
    act(() => {
      switchButton?.click();
    });

    const chip = toolbar.item("flags")?.querySelector('[data-dtb-part="flag-chip"]');
    expect(text(chip?.querySelector('[data-dtb-part="flag-count"]'))).toBe("1 overridden");
    expect(chip?.getAttribute("data-dtb-overridden")).toBe("true");
  });

  it("says so when the consumer supplied no flags", () => {
    const { toolbar } = mount({ flags: [] });
    expect(text(toolbar.item("flags")?.querySelector('[data-dtb-part="flag-count"]'))).toBe("0");
    act(() => {
      toolbar.openPanel("flags");
    });
    expect(text(toolbar.panel("flags"))).toContain("No flags were supplied");
  });
});

describe("the promoted flag", () => {
  it("renders as its own switch in the bar and flips the flag where it stands", () => {
    const { toolbar } = mount({
      onOverride: record,
      promoted: { flagKey: "ui-facelift", label: "UI Facelift 2026" },
    });
    const promoted = toolbar
      .item("flags")
      ?.querySelector<HTMLButtonElement>('[data-dtb-part="flag-promoted"]');
    expect(promoted).not.toBeNull();
    expect(text(promoted)).toContain("UI Facelift 2026");
    expect(promoted?.getAttribute("role")).toBe("switch");
    expect(promoted?.getAttribute("aria-checked")).toBe("false");

    act(() => {
      promoted?.click();
    });
    expect(applied).toEqual([["ui-facelift", true]]);
    expect(
      toolbar
        .item("flags")
        ?.querySelector('[data-dtb-part="flag-promoted"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");
    // …and it did not open the panel. A promoted flag is a control, not a link.
    expect(toolbar.activePanelId()).toBeNull();
  });

  it("keeps working when the extension collapses into the ⋮ menu", () => {
    // One extension is one overflow unit, so the promoted control collapses
    // with the chip. Collapsing must cost its position, never its capability.
    const { toolbar } = mount({
      onOverride: record,
      promoted: { flagKey: "ui-facelift" },
    });
    act(() => {
      toolbar.resize(40);
    });
    expect(toolbar.isOverflowed("flags")).toBe(true);
    act(() => {
      toolbar.openOverflow();
    });
    const promoted = toolbar
      .overflowMenu()
      ?.querySelector<HTMLButtonElement>('[data-dtb-part="flag-promoted"]');
    expect(promoted).not.toBeNull();
    act(() => {
      promoted?.click();
    });
    expect(applied).toEqual([["ui-facelift", true]]);
  });

  it("opens the panel instead of guessing when the flag is not a boolean", () => {
    const { toolbar } = mount({
      onOverride: record,
      promoted: { flagKey: "checkout.copy" },
    });
    const promoted = toolbar
      .item("flags")
      ?.querySelector<HTMLButtonElement>('[data-dtb-part="flag-promoted"]');
    expect(promoted?.getAttribute("role")).toBeNull();
    act(() => {
      promoted?.click();
    });
    expect(toolbar.activePanelId()).toBe("flags");
    expect(applied).toEqual([]);
  });
});

describe("the panel", () => {
  it("shows the effective value, the app's own value and the default", () => {
    const { toolbar } = mount({ onOverride: record });
    act(() => {
      toolbar.openPanel("flags");
    });
    const target = row(toolbar.panel("flags"), "checkout.copy");
    const input = target?.querySelector<HTMLInputElement>('[data-dtb-part="flag-input"]');
    act(() => {
      fireEvent.change(input as HTMLInputElement, { target: { value: "new" } });
      fireEvent.keyDown(input as HTMLInputElement, { key: "Enter" });
    });

    const updated = row(toolbar.panel("flags"), "checkout.copy");
    expect(text(updated?.querySelector('[data-dtb-role="effective"]'))).toBe("new");
    expect(text(updated?.querySelector('[data-dtb-role="base"]'))).toBe("old");
    expect(text(updated?.querySelector('[data-dtb-role="default"]'))).toBe("old");
    expect(updated?.getAttribute("data-dtb-source")).toBe("local-override");
    // severityFor() drives the row, so a restyled bar restyles this too.
    expect(updated?.getAttribute("data-dtb-severity")).toBe("override");
    expect(text(updated)).toContain("overridden");
  });

  it("labels a flag that needs a reload and offers the reload", () => {
    const { toolbar } = mount({ onOverride: record });
    act(() => {
      toolbar.openPanel("flags");
    });
    const input = row(toolbar.panel("flags"), "checkout.copy")?.querySelector<HTMLInputElement>(
      '[data-dtb-part="flag-input"]',
    );
    act(() => {
      fireEvent.change(input as HTMLInputElement, { target: { value: "new" } });
      fireEvent.keyDown(input as HTMLInputElement, { key: "Enter" });
    });
    const panel = toolbar.panel("flags");
    expect(text(panel)).toContain("1 override needs a reload");
    expect(text(row(panel, "checkout.copy"))).toContain("reload required");
  });

  it("clears every override from one obvious button", () => {
    const { toolbar } = mount({ onOverride: record });
    act(() => {
      toolbar.openPanel("flags");
    });
    for (const key of ["ui-facelift", "new-header"]) {
      const button = row(toolbar.panel("flags"), key)?.querySelector<HTMLButtonElement>(
        '[data-dtb-part="flag-switch"]',
      );
      act(() => {
        button?.click();
      });
    }
    const clearAll = toolbar
      .panel("flags")
      ?.querySelector<HTMLButtonElement>('[data-dtb-action="clear-all"]');
    expect(text(clearAll)).toContain("(2)");
    act(() => {
      clearAll?.click();
    });
    expect(text(toolbar.item("flags")?.querySelector('[data-dtb-part="flag-count"]'))).toBe("3");
    expect(applied.slice(-2).every(([, value]) => value === undefined)).toBe(true);
  });

  it("searches by key, label, description and owner", () => {
    const { toolbar } = mount({
      onOverride: record,
      flags: [...CATALOGUE, { key: "zzz", label: "Payments", owner: "growth", type: "boolean" }],
    });
    act(() => {
      toolbar.openPanel("flags");
    });
    const search = toolbar
      .panel("flags")
      ?.querySelector<HTMLInputElement>('[data-dtb-part="flag-search"]');
    act(() => {
      fireEvent.change(search as HTMLInputElement, {
        target: { value: "growth" },
      });
    });
    const rows = toolbar.panel("flags")?.querySelectorAll('[data-dtb-part="flag-row"]');
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.getAttribute("data-dtb-flag")).toBe("zzz");
  });
});

describe("read-only mode", () => {
  it("offers no editors and says why", () => {
    const { toolbar } = mount({});
    act(() => {
      toolbar.openPanel("flags");
    });
    const panel = toolbar.panel("flags");
    expect(
      panel?.querySelector('[data-dtb-part="flag-panel"]')?.getAttribute("data-dtb-writable"),
    ).toBe("false");
    expect(text(panel)).toContain("Read-only");
    expect(panel?.querySelectorAll('[data-dtb-part="flag-switch"]')).toHaveLength(0);
    expect(panel?.querySelectorAll('[data-dtb-part="flag-input"]')).toHaveLength(0);
    expect(panel?.querySelector<HTMLButtonElement>('[data-dtb-action="clear-all"]')?.disabled).toBe(
      true,
    );
    // Copying still works: reading is the whole point of a read-only panel.
    expect(panel?.querySelector('[data-dtb-action="copy-recipe"]')).not.toBeNull();
  });
});

describe("persistence across a reload", () => {
  it("restores the override on the next mount and re-applies it", () => {
    const storage = createMemoryStorage();
    const first = mount({ onOverride: record }, storage);
    act(() => {
      first.toolbar.openPanel("flags");
    });
    act(() => {
      row(first.toolbar.panel("flags"), "ui-facelift")
        ?.querySelector<HTMLButtonElement>('[data-dtb-part="flag-switch"]')
        ?.click();
    });
    expect(storage.getItem(`dtb:v1:test:ext:flags:${OVERRIDES_KEY}`)).toBe('{"ui-facelift":true}');

    first.unmount();
    applied = [];

    // A second mount is what a reload looks like from here: a fresh extension
    // object over the same storage.
    const second = mount({ onOverride: record }, storage);
    expect(applied).toEqual([["ui-facelift", true]]);
    expect(text(second.toolbar.item("flags")?.querySelector('[data-dtb-part="flag-count"]'))).toBe(
      "1 overridden",
    );
  });

  it("readStoredOverrides() reads the same map without mounting anything", () => {
    const storage = createMemoryStorage({
      "dtb:v1:test:ext:flags:overrides": '{"ui-facelift":true}',
    });
    expect(readStoredOverrides({ instanceId: "test", storage })).toEqual({
      "ui-facelift": true,
    });
    expect(readStoredOverrides({ instanceId: "other", storage })).toEqual({});
  });

  it("readStoredOverrides() hands back an ordinary object", () => {
    // The internal map is null-prototype so a `__proto__` key round-trips as
    // data. That representation must not cross a public API: a consumer or a
    // library calling `.hasOwnProperty()` on the result would throw.
    const storage = createMemoryStorage({
      "dtb:v1:test:ext:flags:overrides": '{"__proto__":"x","a":1}',
    });
    const result = readStoredOverrides({ instanceId: "test", storage });
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(() => result.hasOwnProperty("a")).not.toThrow();
    expect(Object.keys(result).sort()).toEqual(["__proto__", "a"]);
    expect(({} as Record<string, unknown>)["x"]).toBeUndefined();
  });

  it("persists nothing when the toolbar's storage is disabled", () => {
    const { toolbar } = mount({ onOverride: record }, null);
    act(() => {
      toolbar.openPanel("flags");
    });
    act(() => {
      row(toolbar.panel("flags"), "ui-facelift")
        ?.querySelector<HTMLButtonElement>('[data-dtb-part="flag-switch"]')
        ?.click();
    });
    // The override still applies for this session; it just does not outlive it.
    expect(applied).toEqual([["ui-facelift", true]]);
  });
});

describe("failing closed", () => {
  it("shows a throwing adapter instead of degrading to an error chip", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { toolbar } = mount({
        onOverride: () => {
          throw new Error("provider is offline");
        },
      });
      act(() => {
        toolbar.openPanel("flags");
      });
      act(() => {
        row(toolbar.panel("flags"), "ui-facelift")
          ?.querySelector<HTMLButtonElement>('[data-dtb-part="flag-switch"]')
          ?.click();
      });
      // The bar is intact — no error chip — and the failure is on screen, on
      // the banner and on the row that lied.
      expect(toolbar.errorChip("flags")).toBeNull();
      expect(text(toolbar.panel("flags"))).toContain(
        "1 override could not be applied: ui-facelift",
      );
      const failed = row(toolbar.panel("flags"), "ui-facelift");
      expect(text(failed)).toContain("override not applied");
      expect(failed?.getAttribute("data-dtb-severity")).toBe("bad");
      expect(
        failed?.querySelector('[data-dtb-tag="not-applied"]')?.getAttribute("title"),
      ).toContain("provider is offline");
    } finally {
      spy.mockRestore();
    }
  });

  it("renders a bar at all when the flags getter throws in the factory", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { toolbar } = mount({
        flags: () => {
          throw new Error("consumer getter exploded");
        },
      });
      expect(toolbar.item("flags")).not.toBeNull();
      expect(toolbar.errorChip("flags")).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("orphaned overrides", () => {
  // A renamed flag leaves its override behind, and that override is still
  // applied to the app on every mount. Not rendering it made it invisible and
  // unclearable at the same time.
  const stored = () =>
    createMemoryStorage({
      "dtb:v1:test:ext:flags:overrides": '{"checkout.v2":"on"}',
    });

  it("still applies them, and says so instead of hiding them", () => {
    const { toolbar } = mount({ onOverride: record }, stored());
    expect(applied).toEqual([["checkout.v2", "on"]]);
    expect(text(toolbar.item("flags")?.querySelector('[data-dtb-part="flag-count"]'))).toBe(
      "1 overridden",
    );

    act(() => {
      toolbar.openPanel("flags");
    });
    const orphan = row(toolbar.panel("flags"), "checkout.v2");
    expect(orphan).not.toBeNull();
    expect(text(orphan)).toContain("no longer in the catalogue");
    expect(orphan?.getAttribute("data-dtb-orphaned")).toBe("true");
    // Graded apart from a live override, so the two do not look identical.
    expect(orphan?.getAttribute("data-dtb-severity")).toBe("warn");
    // There is no application value to show, and it does not pretend there is.
    expect(text(orphan?.querySelector('[data-dtb-role="base"]'))).toBe("—");
  });

  it("can be cleared — the button is not gated on a count that excludes them", () => {
    const storage = stored();
    const { toolbar } = mount({ onOverride: record }, storage);
    act(() => {
      toolbar.openPanel("flags");
    });
    const clearAll = toolbar
      .panel("flags")
      ?.querySelector<HTMLButtonElement>('[data-dtb-action="clear-all"]');
    expect(clearAll?.disabled).toBe(false);
    expect(text(clearAll)).toContain("(1)");
    act(() => {
      clearAll?.click();
    });
    expect(applied.at(-1)).toEqual(["checkout.v2", undefined]);
    expect(storage.getItem("dtb:v1:test:ext:flags:overrides")).toBeNull();
    expect(row(toolbar.panel("flags"), "checkout.v2")).toBeNull();
  });

  it("offers only a clear, not an editor it has no definition for", () => {
    const { toolbar } = mount({ onOverride: record }, stored());
    act(() => {
      toolbar.openPanel("flags");
    });
    const orphan = row(toolbar.panel("flags"), "checkout.v2");
    expect(orphan?.querySelectorAll('[data-dtb-part="flag-input"]')).toHaveLength(0);
    expect(orphan?.querySelectorAll('[data-dtb-part="flag-switch"]')).toHaveLength(0);
    act(() => {
      orphan?.querySelector<HTMLButtonElement>('[data-dtb-action="clear"]')?.click();
    });
    expect(applied.at(-1)).toEqual(["checkout.v2", undefined]);
  });
});

describe("the editor refuses what it cannot parse", () => {
  it("does not coerce garbage into a live override of 0", () => {
    const { toolbar } = mount({
      onOverride: record,
      flags: [{ key: "rank", type: "number", defaultValue: 1, value: 2 }],
    });
    act(() => {
      toolbar.openPanel("flags");
    });
    const input = row(toolbar.panel("flags"), "rank")?.querySelector<HTMLInputElement>(
      '[data-dtb-part="flag-input"]',
    );
    act(() => {
      fireEvent.change(input as HTMLInputElement, { target: { value: "abc" } });
      fireEvent.keyDown(input as HTMLInputElement, { key: "Enter" });
    });
    expect(applied).toEqual([]);
    const target = row(toolbar.panel("flags"), "rank");
    expect(text(target)).toContain("not a number");
    expect(text(target?.querySelector('[data-dtb-role="effective"]'))).toBe("2");
    // Blur must not commit it either — tabbing away is the quieter path in.
    act(() => {
      fireEvent.blur(target?.querySelector('[data-dtb-part="flag-input"]') as HTMLInputElement);
    });
    expect(applied).toEqual([]);
    // The draft survives so it can be corrected.
    expect(
      row(toolbar.panel("flags"), "rank")?.querySelector<HTMLInputElement>(
        '[data-dtb-part="flag-input"]',
      )?.value,
    ).toBe("abc");
  });
});

describe("a failing clear", () => {
  it("says the clear did not apply, not that an override did not", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let broken = false;
      const { toolbar } = mount({
        onOverride: (key, value) => {
          if (broken && value === undefined) throw new Error("offline");
          record(key, value);
        },
      });
      act(() => {
        toolbar.openPanel("flags");
      });
      act(() => {
        row(toolbar.panel("flags"), "ui-facelift")
          ?.querySelector<HTMLButtonElement>('[data-dtb-part="flag-switch"]')
          ?.click();
      });
      broken = true;
      act(() => {
        row(toolbar.panel("flags"), "ui-facelift")
          ?.querySelector<HTMLButtonElement>('[data-dtb-action="clear"]')
          ?.click();
      });
      const target = row(toolbar.panel("flags"), "ui-facelift");
      expect(text(target)).toContain("clear not applied");
      expect(text(target)).not.toContain("override not applied");
      expect(target?.getAttribute("data-dtb-severity")).toBe("bad");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("commands", () => {
  it("contributes a toggle per boolean flag, plus the shared four", async () => {
    const { toolbar, extension } = mount({
      onOverride: record,
      promoted: { flagKey: "ui-facelift" },
    });
    expect(collectCommands([extension]).map((command) => command.id)).toEqual([
      "flags.toggle.new-header",
      "flags.toggle.ui-facelift",
      "flags.clearOverrides",
      "flags.copyRecipe",
      "flags.copyJson",
      "flags.refresh",
    ]);
    // Core aggregated them.
    expect(toolbar.context().commands.map((command) => command.id)).toContain(
      "flags.toggle.ui-facelift",
    );

    await toolbar.runCommand("flags.toggle.ui-facelift");
    expect(applied).toEqual([["ui-facelift", true]]);

    await toolbar.runCommand("flags.clearOverrides");
    expect(applied.at(-1)).toEqual(["ui-facelift", undefined]);
  });

  it("gives a flag added after mount a working command, without a reload", async () => {
    // The gap recorded in architecture.md §12.2 and closed by P2's third extension: `commands`
    // used to be a static array enumerated in the factory, so this flag got a
    // panel row and no command until the page reloaded.
    const catalogue: FlagReading[] = [
      { key: "ui-facelift", type: "boolean", defaultValue: false, value: false },
    ];
    const { toolbar } = mount({ flags: () => catalogue, onOverride: record });

    expect(toolbar.getCommands().map((command) => command.id)).not.toContain(
      "flags.toggle.late-arrival",
    );

    catalogue.push({
      key: "late-arrival",
      label: "Late arrival",
      type: "boolean",
      defaultValue: false,
      value: false,
    });
    // Whatever makes the extension re-read — a poll tick here, its own refresh
    // command — is enough. Nothing re-renders the toolbar and no extension
    // object is rebuilt.
    await toolbar.runCommand("flags.refresh");

    expect(toolbar.getCommands().map((command) => command.id)).toContain(
      "flags.toggle.late-arrival",
    );
    expect(await toolbar.runCommand("flags.toggle.late-arrival")).toBe(true);
    expect(applied.at(-1)).toEqual(["late-arrival", true]);

    // And the row is in the panel, so the two views agree.
    act(() => {
      toolbar.openPanel("flags");
    });
    expect(row(toolbar.panel("flags"), "late-arrival")).not.toBeNull();
  });

  it("copies the same redacted recipe the panel shows", async () => {
    const { toolbar } = mount({
      onOverride: record,
      flags: [{ key: "checkout.apiToken", type: "string", value: "tok-secret-1" }],
    });
    await toolbar.runCommand("flags.copyRecipe");
    expect(written.at(-1)).toContain("No local flag overrides");

    await toolbar.runCommand("flags.refresh");
    act(() => {
      toolbar.openPanel("flags");
    });
    const input = row(toolbar.panel("flags"), "checkout.apiToken")?.querySelector<HTMLInputElement>(
      '[data-dtb-part="flag-input"]',
    );
    act(() => {
      fireEvent.change(input as HTMLInputElement, {
        target: { value: "tok-secret-2" },
      });
      fireEvent.keyDown(input as HTMLInputElement, { key: "Enter" });
    });

    await toolbar.runCommand("flags.copyRecipe");
    await toolbar.runCommand("flags.copyJson");
    for (const payload of written) {
      expect(payload).not.toContain("tok-secret-1");
      expect(payload).not.toContain("tok-secret-2");
    }
    expect(written.at(-1)).toContain("[redacted]");
    // And the panel never printed it either — the editor takes a new value
    // rather than round-tripping the masked one.
    expect(text(toolbar.panel("flags"))).not.toContain("tok-secret");
    expect(
      row(toolbar.panel("flags"), "checkout.apiToken")?.querySelector<HTMLInputElement>(
        '[data-dtb-part="flag-input"]',
      )?.value,
    ).toBe("");
  });
});

/*
 * A1 regression: a read-only promoted boolean still claimed role="switch" while
 * activation only opened the panel. Pre-fix:
 * {...(view.type === "boolean" ? { role: "switch", "aria-checked": on } : {})}
 */
describe("accessibility", () => {
  it("does not claim role=switch on a read-only promoted boolean", () => {
    const { toolbar } = mount({
      promoted: { flagKey: "ui-facelift", label: "UI Facelift 2026" },
    });
    const promoted = toolbar
      .item("flags")
      ?.querySelector<HTMLButtonElement>('[data-dtb-part="flag-promoted"]');
    expect(promoted?.getAttribute("role")).toBeNull();
    expect(promoted?.hasAttribute("aria-checked")).toBe(false);

    act(() => promoted?.click());
    expect(toolbar.activePanelId()).toBe("flags");
    expect(applied).toEqual([]);
  });

  /*
   * A1 regression: the overflow wrapper was a role-less div with aria-label.
   * Pre-fix: <div data-dtb-part="flag-overflow" aria-label={label}>
   */
  it("does not put a bare aria-label on the role-less overflow wrapper", () => {
    const { toolbar } = mount({
      onOverride: record,
      promoted: { flagKey: "ui-facelift" },
    });
    act(() => toolbar.resize(40));
    act(() => toolbar.openOverflow());
    const wrapper = toolbar.overflowMenu()?.querySelector('[data-dtb-part="flag-overflow"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.getAttribute("aria-label")).toBeNull();
  });
});
