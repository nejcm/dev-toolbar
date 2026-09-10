import { describe, expect, it } from "vitest";
import type {
  CompactDefaults,
  CompactParts,
  CompactPresentation,
  CompactPreset,
  CompactRenderContext,
} from "../presentation";
import {
  renderCompact,
  resolveAccessibleName,
  resolveCompactControl,
  resolveCompactParts,
  resolveIcon,
  resolvePresentation,
} from "../presentation";

// Every member of the union, listed as a Record so adding a preset without
// extending the table below fails to type-check rather than going untested.
const PRESET_MEMBERS: Record<CompactPreset, true> = {
  default: true,
  icon: true,
  "icon-value": true,
  "icon-label": true,
  label: true,
  value: true,
};

interface TruthRow {
  preset: CompactPreset;
  hasIcon: boolean;
  isOverflowed: boolean;
  expected: CompactParts | null;
}

const none = (value: boolean, icon = false): CompactParts => ({ icon, text: "none", value });
const short = (icon = false): CompactParts => ({ icon, text: "short", value: false });
const full = (value: boolean, icon = false): CompactParts => ({ icon, text: "full", value });

// The full matrix: six presets x hasIcon x isOverflowed. Pure, so the whole
// thing is cheap, and it is the only place the two guarantees are pinned.
const TRUTH_TABLE: readonly TruthRow[] = [
  // "default" resolves to null everywhere, which is what lets an extension read
  // `parts === null ? <today's tree> : <driven tree>`.
  { preset: "default", hasIcon: false, isOverflowed: false, expected: null },
  { preset: "default", hasIcon: true, isOverflowed: false, expected: null },
  { preset: "default", hasIcon: false, isOverflowed: true, expected: null },
  { preset: "default", hasIcon: true, isOverflowed: true, expected: null },

  // In the bar, with an icon supplied.
  { preset: "icon", hasIcon: true, isOverflowed: false, expected: none(false, true) },
  { preset: "icon-value", hasIcon: true, isOverflowed: false, expected: none(true, true) },
  { preset: "icon-label", hasIcon: true, isOverflowed: false, expected: short(true) },
  { preset: "label", hasIcon: true, isOverflowed: false, expected: short() },
  { preset: "value", hasIcon: true, isOverflowed: false, expected: none(true) },

  // In the bar, with no icon supplied. Guarantee 1: "icon" paints text instead
  // of nothing; the other icon-bearing presets keep their own other part.
  { preset: "icon", hasIcon: false, isOverflowed: false, expected: short() },
  { preset: "icon-value", hasIcon: false, isOverflowed: false, expected: none(true) },
  { preset: "icon-label", hasIcon: false, isOverflowed: false, expected: short() },
  { preset: "label", hasIcon: false, isOverflowed: false, expected: short() },
  { preset: "value", hasIcon: false, isOverflowed: false, expected: none(true) },

  // In the overflow menu, with an icon. Guarantee 2: text is always "full".
  { preset: "icon", hasIcon: true, isOverflowed: true, expected: full(false, true) },
  { preset: "icon-value", hasIcon: true, isOverflowed: true, expected: full(true, true) },
  { preset: "icon-label", hasIcon: true, isOverflowed: true, expected: full(false, true) },
  { preset: "label", hasIcon: true, isOverflowed: true, expected: full(false) },
  { preset: "value", hasIcon: true, isOverflowed: true, expected: full(true) },

  // In the overflow menu, with no icon.
  { preset: "icon", hasIcon: false, isOverflowed: true, expected: full(false) },
  { preset: "icon-value", hasIcon: false, isOverflowed: true, expected: full(true) },
  { preset: "icon-label", hasIcon: false, isOverflowed: true, expected: full(false) },
  { preset: "label", hasIcon: false, isOverflowed: true, expected: full(false) },
  { preset: "value", hasIcon: false, isOverflowed: true, expected: full(true) },
];

describe("resolveCompactParts", () => {
  it.each(TRUTH_TABLE)(
    "$preset with hasIcon $hasIcon and isOverflowed $isOverflowed",
    ({ expected, hasIcon, isOverflowed, preset }) => {
      expect(resolveCompactParts(preset, { hasIcon, isOverflowed })).toEqual(expected);
    },
  );

  it("covers every preset member in both places and with and without an icon", () => {
    const members = Object.keys(PRESET_MEMBERS).sort();
    const covered = [...new Set(TRUTH_TABLE.map((row) => row.preset))].sort();
    expect(covered).toEqual(members);
    expect(TRUTH_TABLE).toHaveLength(members.length * 4);
    // Length plus exhaustive membership still admits a duplicated row paying for
    // a missing combination, so pin the cells themselves as distinct.
    const cells = new Set(
      TRUTH_TABLE.map((row) => `${row.preset}/${row.hasIcon}/${row.isOverflowed}`),
    );
    expect(cells.size).toBe(members.length * 4);
  });

  it("never paints an icon for a preset that does not name one", () => {
    for (const row of TRUTH_TABLE) {
      if (row.preset === "label" || row.preset === "value") {
        expect(row.expected?.icon).toBe(false);
        expect(resolveCompactParts(row.preset, row)?.icon).toBe(false);
      }
    }
  });

  it("never resolves a wordless, iconless, valueless control", () => {
    for (const row of TRUTH_TABLE) {
      const parts = resolveCompactParts(row.preset, row);
      if (parts !== null) {
        expect(parts.icon || parts.value || parts.text !== "none").toBe(true);
      }
    }
  });
});

describe("resolvePresentation", () => {
  it("defaults to the default preset when unconfigured", () => {
    expect(resolvePresentation(undefined)).toEqual({ preset: "default" });
  });

  it("takes a bare preset as shorthand", () => {
    expect(resolvePresentation<number>("icon-value")).toEqual({ preset: "icon-value" });
  });

  it("fills in the preset on a shape that omits it, keeping the other knobs", () => {
    const name = (value: number): string => `n${value}`;
    const resolved = resolvePresentation<number>({ icon: "*", name });

    expect(resolved.preset).toBe("default");
    expect(resolved.icon).toBe("*");
    expect(resolved.name).toBe(name);
  });

  it("keeps an explicit preset on the full shape", () => {
    expect(resolvePresentation<number>({ preset: "value" }).preset).toBe("value");
  });
});

describe("resolveIcon", () => {
  it("returns a node as-is", () => {
    expect(resolveIcon<number>("*", 1)).toBe("*");
  });

  it("invokes a function icon with the control's own view data", () => {
    expect(resolveIcon<number>((value) => `icon-${value}`, 7)).toBe("icon-7");
  });

  it("passes an absent icon through as absent", () => {
    expect(resolveIcon<number>(undefined, 1)).toBeUndefined();
  });
});

describe("resolveAccessibleName", () => {
  it("keeps the extension's own name when unconfigured", () => {
    expect(resolveAccessibleName<number>(undefined, 1, "Metrics")).toBe("Metrics");
  });

  it("uses the override when it says something", () => {
    expect(resolveAccessibleName<number>((value) => `Memory ${value}`, 3, "Metrics")).toBe(
      "Memory 3",
    );
  });

  it.each(["", " ", "\t\n "])("ignores the whitespace-only override %j", (blank) => {
    expect(resolveAccessibleName<number>(() => blank, 1, "Metrics")).toBe("Metrics");
  });
});

// The two composed helpers, over a `TView` of `number` and `ReactNode`s that are
// plain strings: what they compose is React-free, and keeping this file free of
// JSX keeps the whole matrix above cheap. `/ext/metrics`'
// `__tests__/presentation.test.tsx` is where they are proved against real DOM.

/** Stand-ins for an extension's own `"default"` tree, distinguishable by place. */
const DEFAULTS: CompactDefaults = {
  bar: { icon: false, text: "short", value: true },
  overflow: { icon: true, text: "full", value: false },
};

describe("resolveCompactControl", () => {
  it("resolves a function icon and the preset's parts together", () => {
    const control = resolveCompactControl<number>(
      { preset: "icon-value", icon: (value) => `icon-${value}` },
      4,
      { isOverflowed: false, defaults: DEFAULTS },
    );

    expect(control.icon).toBe("icon-4");
    expect(control.parts).toEqual({ icon: true, text: "none", value: true });
  });

  const NO_ICON: readonly [string, CompactPresentation<number>["icon"]][] = [
    ["an absent icon", undefined],
    ["an icon a function declined to supply", () => undefined],
    ["a null icon", null],
  ];

  it.each(NO_ICON)("applies guarantee 1 per control, given %s", (_case, icon) => {
    const control = resolveCompactControl<number>({ preset: "icon", icon }, 1, {
      isOverflowed: false,
      defaults: DEFAULTS,
    });

    // The `undefined | null` guard is here rather than in `resolveCompactParts`
    // because a function icon can decline for one control and supply for the
    // next, so `hasIcon` is per control.
    expect(control.parts).toEqual({ icon: false, text: "short", value: false });
  });

  it.each([
    [false, DEFAULTS.bar],
    [true, DEFAULTS.overflow],
  ])(
    'falls back to the extension\'s own parts under "default" (overflowed: %s)',
    (isOverflowed, expected) => {
      const control = resolveCompactControl<number>({ preset: "default", icon: "*" }, 1, {
        isOverflowed,
        defaults: DEFAULTS,
      });

      // Kit does not know what `"default"` means for any extension: the caller
      // hands both trees in, and this choice between them is the thing that would
      // otherwise be copied nine times.
      expect(control.parts).toBe(expected);
      // The icon still resolves under `"default"`; the parts are what decline it.
      expect(control.icon).toBe("*");
    },
  );
});

describe("renderCompact", () => {
  const place = { icon: "*", isOverflowed: false, isPanelOpen: true };

  it("returns the fallback untouched when there is no callback", () => {
    expect(renderCompact<number>({ preset: "icon" }, 1, place, "preset")).toBe("preset");
  });

  it("assembles the context the callback is handed", () => {
    const seen: CompactRenderContext[] = [];
    const rendered = renderCompact<number>(
      {
        preset: "icon-label",
        render: (data, ctx) => {
          seen.push(ctx);
          return `custom-${data}`;
        },
      },
      9,
      { icon: "*", isOverflowed: true, isPanelOpen: false },
      "preset",
    );

    expect(rendered).toBe("custom-9");
    expect(seen).toEqual([
      {
        preset: "icon-label",
        icon: "*",
        isOverflowed: true,
        isPanelOpen: false,
        fallback: "preset",
      },
    ]);
  });

  it("falls through to the fallback when the callback returns undefined", () => {
    // The opt-out is per control rather than per extension, so it cannot be a
    // per-extension `render === undefined` check.
    expect(
      renderCompact<number>({ preset: "icon", render: () => undefined }, 1, place, "preset"),
    ).toBe("preset");
  });

  it("honours a callback that returns a falsy node rather than treating it as absent", () => {
    // `null` and `""` are nodes a consumer may mean; only `undefined` defers.
    expect(renderCompact<number>({ preset: "icon", render: () => null }, 1, place, "preset")).toBe(
      null,
    );
    expect(renderCompact<number>({ preset: "icon", render: () => "" }, 1, place, "preset")).toBe(
      "",
    );
  });

  it("is honoured in the ⋮ menu too, with isOverflowed as the hook", () => {
    // ADR-004's deliberate deviation: the "always paint text" guarantee holds
    // by construction for every preset and is not enforced for a callback.
    const render = (_data: number, ctx: CompactRenderContext) =>
      ctx.isOverflowed ? "menu" : "bar";

    expect(renderCompact<number>({ preset: "icon", render }, 1, place, "preset")).toBe("bar");
    expect(
      renderCompact<number>(
        { preset: "icon", render },
        1,
        { ...place, isOverflowed: true },
        "preset",
      ),
    ).toBe("menu");
  });
});
