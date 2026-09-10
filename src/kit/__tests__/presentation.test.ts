import { describe, expect, it } from "vitest";
import type { CompactParts, CompactPreset } from "../presentation";
import {
  resolveAccessibleName,
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
