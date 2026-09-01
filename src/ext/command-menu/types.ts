/**
 * Matching and ordering for the palette. [dev-toolbar/ext/command-menu]
 *
 * Pure functions, deliberately: what a palette shows for a given query and a
 * given aggregation is the part worth pinning down in tests, and it is the part
 * with no DOM in it.
 */
import type { ToolbarCommand } from "../../core/contract";

/** One row. `section` is the heading it renders under, `""` for none. */
export interface CommandMatch {
  command: ToolbarCommand;
  /** Higher is a better match. `0` only ever appears for an unfiltered list. */
  score: number;
  section: string;
  /** True when it is in the recently-run list. */
  recent: boolean;
}

/** Heading for the recents section. Exported so a consumer can search for it. */
export const RECENT_SECTION = "Recent";
/** Heading for commands whose extension declared no `group`. */
export const OTHER_SECTION = "Other";

const FIELD_WEIGHTS: readonly [keyof ToolbarCommand | "keyword", number][] = [
  ["label", 3],
  ["keyword", 2],
  ["group", 1],
  ["id", 1],
];

/** Does `haystack` contain the letters of `needle` in order? The loosest match. */
function subsequence(haystack: string, needle: string): boolean {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return needle.length === 0;
}

/** 0 when the term does not appear at all. Prefix beats word-start beats infix. */
function fieldScore(field: string, term: string): number {
  const haystack = field.toLowerCase();
  if (haystack === term) return 8;
  if (haystack.startsWith(term)) return 6;
  // A term starting any word — "over" in "Clear all local flag overrides".
  if (new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}`).test(haystack)) return 4;
  if (haystack.includes(term)) return 3;
  if (subsequence(haystack, term)) return 1;
  return 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Score for one command against one whitespace-separated query.
 *
 * Every term must match *something* (AND, not OR): typing more can only ever
 * narrow, which is the behaviour a keyboard user is steering by. `0` means it
 * is filtered out.
 */
export function scoreCommand(command: ToolbarCommand, query: string): number {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 1;

  let total = 0;
  for (const term of terms) {
    let best = 0;
    for (const [field, weight] of FIELD_WEIGHTS) {
      if (field === "keyword") {
        for (const keyword of command.keywords ?? []) {
          best = Math.max(best, fieldScore(keyword, term) * weight);
        }
        continue;
      }
      const value = command[field];
      if (typeof value !== "string") continue;
      best = Math.max(best, fieldScore(value, term) * weight);
    }
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

/**
 * The displayed list, in display order.
 *
 * Two modes, on purpose:
 *
 * - **No query** — browsing. Recently run commands first under their own
 *   heading, then everything else in aggregation order, which already clusters
 *   by extension; consecutive runs of the same `group` become the sections.
 * - **A query** — searching. One flat list ordered by score, with no headings,
 *   because a heading that a scored order keeps re-splitting is noise. Each row
 *   still shows its own group.
 *
 * Ordering is total and deterministic in both modes — score, then recency, then
 * the aggregation order — so the row under the cursor does not move when an
 * unrelated pass re-enumerates.
 */
export function filterCommands(
  commands: readonly ToolbarCommand[],
  query: string,
  recent: readonly string[] = [],
): CommandMatch[] {
  const recentRank = new Map(recent.map((id, index) => [id, index]));
  const scored = commands
    .map((command, index) => ({ command, index, score: scoreCommand(command, query) }))
    .filter((entry) => entry.score > 0);

  const searching = query.trim() !== "";

  if (searching) {
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const rankA = recentRank.get(a.command.id) ?? Number.MAX_SAFE_INTEGER;
      const rankB = recentRank.get(b.command.id) ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return a.index - b.index;
    });
    return scored.map((entry) => ({
      command: entry.command,
      score: entry.score,
      section: "",
      recent: recentRank.has(entry.command.id),
    }));
  }

  const recents = scored
    .filter((entry) => recentRank.has(entry.command.id))
    .sort(
      (a, b) => (recentRank.get(a.command.id) as number) - (recentRank.get(b.command.id) as number),
    );
  const rest = scored.filter((entry) => !recentRank.has(entry.command.id));

  return [
    ...recents.map((entry) => ({
      command: entry.command,
      score: entry.score,
      section: RECENT_SECTION,
      recent: true,
    })),
    ...rest.map((entry) => ({
      command: entry.command,
      score: entry.score,
      section: entry.command.group ?? OTHER_SECTION,
      recent: false,
    })),
  ];
}

/** Consecutive runs of the same `section`, in display order. */
export function sectionsOf(
  matches: readonly CommandMatch[],
): { section: string; from: number; to: number }[] {
  const sections: { section: string; from: number; to: number }[] = [];
  matches.forEach((match, index) => {
    const last = sections[sections.length - 1];
    if (last && last.section === match.section) last.to = index;
    else sections.push({ section: match.section, from: index, to: index });
  });
  return sections;
}
