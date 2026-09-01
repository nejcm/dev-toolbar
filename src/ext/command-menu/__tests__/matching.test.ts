/**
 * What the palette shows for a given query and a given aggregation. Pure — no
 * DOM — because ordering is the part that is easy to get subtly wrong and hard
 * to see going wrong through a rendered list.
 */
import { describe, expect, it } from "vitest";
import {
  filterCommands,
  OTHER_SECTION,
  RECENT_SECTION,
  scoreCommand,
  sectionsOf,
} from "../types";
import type { ToolbarCommand } from "../../../core/contract";

const make = (
  id: string,
  label: string,
  group?: string,
  keywords?: string[],
): ToolbarCommand => ({
  id,
  label,
  ...(group === undefined ? {} : { group }),
  ...(keywords === undefined ? {} : { keywords }),
  run: () => {},
});

const ids = (matches: { command: ToolbarCommand }[]) =>
  matches.map((match) => match.command.id);

describe("scoreCommand", () => {
  it("returns a positive score for everything on an empty query", () => {
    expect(scoreCommand(make("a", "Anything"), "")).toBeGreaterThan(0);
    expect(scoreCommand(make("a", "Anything"), "   ")).toBeGreaterThan(0);
  });

  it("ranks an exact label above a prefix above a word start above an infix", () => {
    const query = "reset";
    const exact = scoreCommand(make("a", "reset"), query);
    const prefix = scoreCommand(make("b", "Reset everything"), query);
    const word = scoreCommand(make("c", "Hard reset now"), query);
    const infix = scoreCommand(make("d", "Unresettable"), query);
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(infix);
    expect(infix).toBeGreaterThan(0);
  });

  it("weighs the label above keywords above the group", () => {
    expect(scoreCommand(make("x", "flags"), "flags")).toBeGreaterThan(
      scoreCommand(make("x", "Zzz", undefined, ["flags"]), "flags"),
    );
    expect(
      scoreCommand(make("x", "Zzz", undefined, ["flags"]), "flags"),
    ).toBeGreaterThan(scoreCommand(make("x", "Zzz", "flags"), "flags"));
  });

  it("requires every term to match something, so typing more only narrows", () => {
    const command = make("flags.copyJson", "Copy flag overrides as JSON", "Flags");
    expect(scoreCommand(command, "copy json")).toBeGreaterThan(0);
    expect(scoreCommand(command, "copy zebra")).toBe(0);
  });

  it("falls back to a subsequence, so 'cfo' still finds 'Copy flag overrides'", () => {
    expect(scoreCommand(make("a", "Copy flag overrides"), "cfo")).toBeGreaterThan(0);
    expect(scoreCommand(make("a", "Copy flag overrides"), "cfz")).toBe(0);
  });
});

describe("filterCommands", () => {
  const commands = [
    make("flags.toggle.a", "Toggle flag: A", "Flags"),
    make("flags.clear", "Clear all local flag overrides", "Flags"),
    make("metrics.reset", "Reset metrics", "Metrics"),
    make("loose", "No group at all"),
  ];

  it("browses in aggregation order, sectioned by consecutive group", () => {
    const matches = filterCommands(commands, "");
    expect(ids(matches)).toEqual([
      "flags.toggle.a",
      "flags.clear",
      "metrics.reset",
      "loose",
    ]);
    expect(sectionsOf(matches).map((section) => section.section)).toEqual([
      "Flags",
      "Metrics",
      OTHER_SECTION,
    ]);
  });

  it("pulls recents to the front, in recency order, under their own heading", () => {
    const matches = filterCommands(commands, "", ["metrics.reset", "loose"]);
    expect(ids(matches)).toEqual([
      "metrics.reset",
      "loose",
      "flags.toggle.a",
      "flags.clear",
    ]);
    const sections = sectionsOf(matches);
    expect(sections[0]).toEqual({ section: RECENT_SECTION, from: 0, to: 1 });
  });

  it("drops the headings while searching and orders purely by score", () => {
    const matches = filterCommands(commands, "flag");
    // Both score the same — "flag" starts a word in each label — so the tie
    // falls back to aggregation order rather than to anything arbitrary.
    expect(ids(matches)).toEqual(["flags.toggle.a", "flags.clear"]);
    expect(ids(filterCommands(commands, "clear"))).toEqual(["flags.clear"]);
    expect(sectionsOf(matches).map((section) => section.section)).toEqual([""]);
  });

  it("puts the better match first even when it was aggregated last", () => {
    const ordered = [
      make("weak", "Hard reset the counters"),
      make("strong", "Reset metrics"),
    ];
    expect(ids(filterCommands(ordered, "reset"))).toEqual(["strong", "weak"]);
  });

  it("breaks a score tie by recency, then by aggregation order", () => {
    const tied = [make("a", "Same name"), make("b", "Same name")];
    expect(ids(filterCommands(tied, "same"))).toEqual(["a", "b"]);
    expect(ids(filterCommands(tied, "same", ["b"]))).toEqual(["b", "a"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterCommands(commands, "zzzz")).toEqual([]);
    expect(sectionsOf([])).toEqual([]);
  });
});
