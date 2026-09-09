import { describe, expect, it } from "vitest";
import { CollapseMachine } from "../collapse";
import type { CollapseItem } from "../collapse";

const start = (id: string, priority: number): CollapseItem => ({ id, priority, region: "start" });
const end = (id: string, priority: number): CollapseItem => ({ id, priority, region: "end" });

// The same three chips the shell tests use: 60 wide, 2px gap, a 28px ⋮ button.
const items = [start("a", 3), start("b", 1), start("c", 2)];
const sixty = Object.entries({ a: 60, b: 60, c: 60 });

const machine = () => new CollapseMachine({ gap: 2, buttonWidth: 28 });
const ids = (m: CollapseMachine) => [...m.collapsed].sort();

/**
 * Drives `m` the way the layout effect does after every commit — one full
 * reading per pass, with `a`'s width answered by `widthOfA` from the decision
 * the previous pass left — until a pass changes nothing.
 *
 * @returns how many passes flipped the decision.
 */
const settle = (
  m: CollapseMachine,
  widthOfA: (collapsed: ReadonlySet<string>) => number,
  barWidth = 1000,
  passes = 20,
): number => {
  let flips = 0;
  for (let pass = 0; pass < passes; pass += 1) {
    const changed = m.measure({
      items,
      barWidth,
      widths: [
        ["a", widthOfA(m.collapsed)],
        ["b", 60],
        ["c", 60],
      ],
    });
    if (!changed) return flips;
    flips += 1;
  }
  throw new Error(`did not settle in ${passes} passes`);
};

/** 900 while `b` is in the bar, 60 once it has collapsed: no fixed point. */
const dependsOnB = (collapsed: ReadonlySet<string>) => (collapsed.has("b") ? 60 : 900);

describe("CollapseMachine decision", () => {
  it("collapses nothing when everything fits", () => {
    const m = machine();
    expect(m.measure({ items, barWidth: 1000, widths: sixty })).toBe(false);
    expect(ids(m)).toEqual([]);
  });

  it("collapses nothing before the bar has been measured, or when it measures as nothing", () => {
    const m = machine();
    expect(m.measure({ items, widths: sixty })).toBe(false);
    expect(m.measure({ barWidth: 0 })).toBe(false);
    expect(ids(m)).toEqual([]);
  });

  it("collapses the lowest priority first, and only as far as needed", () => {
    const m = machine();
    expect(m.measure({ items, barWidth: 160, widths: sixty })).toBe(true);
    expect(ids(m)).toEqual(["b"]);
    expect(m.measure({ barWidth: 100 })).toBe(true);
    expect(ids(m)).toEqual(["b", "c"]);
  });

  it("breaks priority ties toward the later item", () => {
    const m = machine();
    m.measure({ items: [start("a", 0), start("b", 0)], barWidth: 100, widths: sixty });
    expect(ids(m)).toEqual(["b"]);
  });

  it("keeps the same set instance until the decision changes", () => {
    const m = machine();
    const before = m.collapsed;
    m.measure({ items, barWidth: 1000, widths: sixty });
    expect(m.collapsed).toBe(before);
    m.measure({ barWidth: 160 });
    const after = m.collapsed;
    expect(after).not.toBe(before);
    m.measure({ barWidth: 161 });
    expect(m.collapsed).toBe(after);
  });

  it("recomputes for a new roster with the widths it already has", () => {
    const m = machine();
    m.measure({ items, barWidth: 160, widths: sixty });
    expect(ids(m)).toEqual(["b"]);
    // `b` gone: the remaining two fit, so nothing collapses.
    expect(m.measure({ items: [start("a", 3), start("c", 2)] })).toBe(true);
    expect(ids(m)).toEqual([]);
    // The same roster again is not a change.
    expect(m.measure({ items: [start("a", 3), start("c", 2)] })).toBe(false);
  });
});

describe("CollapseMachine sticky widths", () => {
  it("keeps a collapsed item's bar width when it measures as nothing, so it can come back", () => {
    const m = machine();
    m.measure({ items, barWidth: 100, widths: sixty });
    expect(ids(m)).toEqual(["b", "c"]);

    // Collapsed items are not in the bar to be measured; jsdom says 0 for
    // everything. Neither may overwrite the width the item had in the bar.
    expect(m.measure({ widths: Object.entries({ b: 0, c: -1 }) })).toBe(false);
    expect(m.measure({ barWidth: 1000 })).toBe(true);
    expect(ids(m)).toEqual([]);
  });

  it("takes the ⋮ button's width only once it has been rendered and measures as something", () => {
    // At 154 the fallback button (28) lets `b` alone go: 2×60 + 2 + 2 + 28 = 152.
    const m = machine();
    m.measure({ items, barWidth: 154, widths: sixty, buttonWidth: 0 });
    expect(ids(m)).toEqual(["b"]);
    // Rendered wider than the fallback, the button costs `c` its place too.
    expect(m.measure({ buttonWidth: 40 })).toBe(true);
    expect(ids(m)).toEqual(["b", "c"]);
  });
});

/**
 * `barWidth` is the padding box, and both regions are always rendered with the
 * gap between them. Neither is free space, so neither may be filled with items.
 */
describe("CollapseMachine reserved width", () => {
  it("keeps the bar's own horizontal padding out of the math", () => {
    // 3×60 + 2×2 = 184 fits a 190 padding box but not the 176 it leaves:
    //   190 − 12 (padding) − 2 (the empty end region's gap) = 176 < 184
    const m = machine();
    m.measure({ items, barWidth: 190, padding: 12, widths: sixty });
    expect(ids(m)).toEqual(["b"]);
  });

  it("charges the gap an empty end region still takes when the roster has no end items", () => {
    // 3×60 + 2×2 = 184 fits 184 — but the end region takes a gap of its own.
    const m = machine();
    m.measure({ items, barWidth: 185, widths: sixty });
    expect(ids(m)).toEqual(["b"]);
    m.measure({ barWidth: 186 });
    expect(ids(m)).toEqual([]);
  });

  it("charges the gap an empty start region takes once every start item has collapsed, one pass later", () => {
    // Both regions hold items to begin with, so the flattened item math covers
    // the gap between them. Once b collapses the start region renders empty and
    // still takes that gap, which is enough to force d out too:
    //   as rendered:  3×60 + 2×2 = 184 > 153
    //   drop b:       2×60 + 2 + 2 + 28 = 152 ≤ 153, so the first pass stops
    //   start is now empty: 153 − 2 = 151 < 152, so the next pass continues
    //   drop b and d: 60 + 2 + 28 = 90 ≤ 151
    const m = machine();
    const roster = [start("b", 1), end("d", 5), end("e", 9)];
    const widths = Object.entries({ b: 60, d: 60, e: 60 });
    expect(m.measure({ items: roster, barWidth: 153, widths })).toBe(true);
    expect(ids(m)).toEqual(["b"]);
    expect(m.measure({ widths })).toBe(true);
    expect(ids(m)).toEqual(["b", "d"]);
    expect(m.measure({ widths })).toBe(false);
  });

  it("costs one gap of hysteresis: re-expansion needs one gap more room than the collapse gave up", () => {
    // All three fit in 3×60 + 2×2 = 184. A bar whose start region has
    // collapsed empty is still charged its gap, so 185 is not enough.
    const m = machine();
    const roster = [start("b", 1), end("d", 5), end("e", 9)];
    const widths = Object.entries({ b: 60, d: 60, e: 60 });
    m.measure({ items: roster, barWidth: 100, widths });
    expect(ids(m)).toEqual(["b", "d"]);
    m.measure({ barWidth: 185 });
    expect(ids(m)).toEqual(["b"]);
    m.measure({ barWidth: 186 });
    expect(ids(m)).toEqual([]);
  });

  it("charges the empty start region's gap for an end-only bar", () => {
    //   as rendered: 2×60 + 2 = 122 ≤ 123, but 123 − 2 = 121 < 122
    //   drop e:      60 + 2 + 28 = 90 ≤ 121
    const m = machine();
    m.measure({
      items: [end("d", 5), end("e", 2)],
      barWidth: 123,
      widths: Object.entries({ d: 60, e: 60 }),
    });
    expect(ids(m)).toEqual(["e"]);
  });
});

/**
 * A chip whose width depends on the collapse decision has no fixed point:
 * collapsing its neighbour changes its width, which changes the decision. The
 * machine detects the cycle instead of debouncing it — an item reading may not
 * return to a decision held since the last honest reading while the current one
 * fits — and every source of item widths, a ResizeObserver delivery or the
 * layout effect after a commit, is filtered alike.
 */
describe("CollapseMachine cycle detection", () => {
  it("a chip wider in the bar than beside a collapsed neighbour settles on the side that fits, and reports latched", () => {
    const m = machine();
    m.measure({ items, barWidth: 1000, widths: sixty });

    // The observer path: only widths arrive, one delivery per flip.
    //   a=900 in the bar: 900 + 2×60 + 2×2 = 1024 > 998 → drop b: 992 ≤ 998
    //   a=60 beside the collapsed b: 184 ≤ 998 → ∅ — a return, refused
    let flips = 0;
    for (let delivery = 0; delivery < 20; delivery += 1) {
      if (m.measure({ widths: [["a", dependsOnB(m.collapsed)]] })) flips += 1;
    }
    expect(flips).toBe(1);
    expect(m.latched).toBe(true);
    expect(ids(m)).toEqual(["b"]);
  });

  it("the synchronous case — a chip measurably different on the very next layout — terminates on the fitting side", () => {
    // The layout-effect path: a full reading per commit, bar width and roster
    // unchanged, the chip's width already reflecting the last decision. This
    // is the case that used to end in "Maximum update depth exceeded".
    const m = machine();
    m.measure({ items, barWidth: 1000, widths: sixty });

    expect(settle(m, dependsOnB)).toBe(1);
    expect(m.latched).toBe(true);
    expect(ids(m)).toEqual(["b"]);
  });

  it("settles on the fitting side whichever side the cycle starts from", () => {
    // The honest reading itself lands on ∅'s partner: `a` is cached at 900, so
    // the bar decides {b}. `a` then measures 60 beside the collapsed `b`, and
    // ∅ is new — accepted. Back in the bar `a` is 900 again: {b} is a return,
    // but ∅ has overflowed, so the return is the one move a cycle may make.
    const m = machine();
    m.measure({ items, barWidth: 1000, widths: Object.entries({ a: 900, b: 60, c: 60 }) });
    expect(ids(m)).toEqual(["b"]);
    expect(m.measure({ widths: [["a", 60]] })).toBe(true);
    expect(ids(m)).toEqual([]);
    expect(m.latched).toBe(false);
    expect(m.measure({ widths: [["a", 900]] })).toBe(true);
    expect(ids(m)).toEqual(["b"]);
    // …and from there the cycle closes: ∅ still fits, so it is refused.
    expect(m.measure({ widths: [["a", 60]] })).toBe(false);
    expect(ids(m)).toEqual(["b"]);
    expect(m.latched).toBe(true);
  });

  it("a chip that oscillates and then genuinely grows is heard: growth never returns to a held decision", () => {
    // The reviewer's case. Bar 200 (198 usable), three 60px chips; `a` reads
    // 90 and 60 alternately across the threshold for eight deliveries…
    const m = machine();
    m.measure({ items, barWidth: 200, widths: sixty });
    for (let delivery = 0; delivery < 8; delivery += 1) {
      m.measure({ widths: [["a", delivery % 2 === 0 ? 90 : 60]] });
    }
    // …and has settled on {b}, refusing the return to ∅.
    expect(ids(m)).toEqual(["b"]);
    expect(m.latched).toBe(true);

    // Now `a` grows to 190 for real, and a plain rerender commits: a full
    // reading with the bar's width and the roster unchanged.
    //   190 + 60 + 2 + 2 + 28 = 282 > 198 → drop c: 220 > 198 → drop a: 28
    expect(
      m.measure({
        items,
        barWidth: 200,
        widths: [
          ["a", 190],
          ["c", 60],
        ],
      }),
    ).toBe(true);
    expect(ids(m)).toEqual(["a", "b", "c"]);
    expect(m.latched).toBe(false);
  });

  it("several chips settling at once never repeat a decision, so none is refused", () => {
    // Nothing is measured yet. Three chips report in, one reading each, and
    // every reading moves the decision further: monotone settling.
    const m = machine();
    m.measure({ items, barWidth: 200 });
    expect(m.measure({ widths: [["a", 100]] })).toBe(false);
    expect(m.measure({ widths: [["b", 100]] })).toBe(true); // 202 > 200: b goes
    expect(m.measure({ widths: [["c", 100]] })).toBe(true); // 100+2+2+28+100 > 200: c goes too
    expect(ids(m)).toEqual(["b", "c"]);
    expect(m.latched).toBe(false);

    // And a fourth chip still gets heard.
    expect(m.measure({ items: [...items, start("d", 4)], widths: [["d", 5]] })).toBe(false);
    expect(m.measure({ widths: [["d", 80]] })).toBe(true);
    expect(ids(m)).toEqual(["a", "b", "c"]);
  });

  it("the bar widening forgets the cycle, and the widths cached through it are what it recomputes with", () => {
    const m = machine();
    m.measure({ items, barWidth: 1000, widths: sixty });
    settle(m, dependsOnB);
    expect(ids(m)).toEqual(["b"]);

    // Refused readings are still cached: `a` at 900 with `b` collapsed is not
    // a state the chip reaches on its own, but the machine takes the number.
    expect(m.measure({ widths: [["a", 900]] })).toBe(false);
    expect(ids(m)).toEqual(["b"]);

    // The bar's own width changing is the honest signal. The recompute sees
    // `a` at 900 (900 + 2×60 + 2×2 = 1024 > 999 → {b}, no change) and forgets
    // the held decisions, so the cycle is free to run — and settles again.
    expect(m.measure({ barWidth: 1001 })).toBe(false);
    expect(m.latched).toBe(false);
    expect(m.measure({ widths: [["a", 60]] })).toBe(true);
    expect(ids(m)).toEqual([]);
    expect(settle(m, dependsOnB, 1001)).toBe(1);
    expect(m.latched).toBe(true);
    expect(ids(m)).toEqual(["b"]);
  });

  it("the same bar width again is not a change and does not forget", () => {
    const m = machine();
    m.measure({ items, barWidth: 1000, widths: sixty });
    settle(m, dependsOnB);
    expect(m.measure({ barWidth: 1000, widths: [["a", 60]] })).toBe(false);
    expect(m.latched).toBe(true);
  });

  it("a roster change forgets the cycle: the world changed, the chip did not react to the decision", () => {
    const m = machine();
    m.measure({ items, barWidth: 1000, widths: sixty });
    settle(m, dependsOnB);
    expect(ids(m)).toEqual(["b"]);

    // A fourth chip arrives: the decision reflects it, cycle or no cycle.
    //   60 + 3×60 + 3×2 = 246 ≤ 998 → ∅, a return the honest reading may make
    expect(m.measure({ items: [...items, start("d", 0)], widths: [["d", 60]] })).toBe(true);
    expect(ids(m)).toEqual([]);
    expect(m.latched).toBe(false);
  });

  it("a padding or gap change is the bar's own box changing, and forgets the cycle too", () => {
    const m = machine();
    m.measure({ items, barWidth: 1000, widths: sixty });
    settle(m, dependsOnB);
    expect(ids(m)).toEqual(["b"]);
    expect(m.latched).toBe(true);

    // `--dtb-padding-x` grows while the cycle is settled: not an item reacting,
    // so the return to ∅ is allowed (60 + 2×60 + 2×2 = 184 ≤ 998 − 40).
    expect(m.measure({ padding: 40 })).toBe(true);
    expect(ids(m)).toEqual([]);
    expect(m.latched).toBe(false);

    settle(m, dependsOnB);
    expect(m.latched).toBe(true);
    expect(m.measure({ gap: 4 })).toBe(true);
    expect(ids(m)).toEqual([]);
    expect(m.latched).toBe(false);

    // The same padding and gap again are not a change.
    settle(m, dependsOnB);
    expect(m.measure({ padding: 40, gap: 4, widths: [["a", 60]] })).toBe(false);
    expect(m.latched).toBe(true);
  });

  it("does not keep the caller's roster array", () => {
    const m = machine();
    const roster = [start("a", 3), start("b", 1), start("c", 2)];
    m.measure({ items: roster, barWidth: 160, widths: sixty });
    expect(ids(m)).toEqual(["b"]);
    roster.length = 0;
    expect(m.measure({ barWidth: 100 })).toBe(true);
    expect(ids(m)).toEqual(["b", "c"]);
  });
});

/**
 * What bounds the memory cycle detection keeps, driven rather than argued.
 *
 * Every decision is a prefix of one fixed order — lowest priority first, later
 * roster index first on a tie — so a roster of `n` items admits at most `n + 1`
 * distinct decisions, and therefore at most `n + 1` signatures. The set is
 * cleared on every honest reading, so nothing carries across a resize, a
 * spacing change or a roster change either.
 */
describe("CollapseMachine under a random walk", () => {
  const roster: CollapseItem[] = [
    start("a", 5),
    start("b", 1),
    start("c", 3),
    end("d", 3),
    end("e", 2),
  ];
  /** The order `computeOverflow` collapses in: priority ascending, later index first. */
  const order = roster
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.priority - b.item.priority || b.index - a.index)
    .map(({ item }) => item.id);

  it("only ever decides a prefix of one fixed order, which is what bounds the signature set", () => {
    // A tiny LCG, so a failure is reproducible from the seed in the message.
    let seed = 20_240_919;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };

    const m = machine();
    const decisions = new Set<string>();
    let identityChanges = 0;
    let reportedChanges = 0;

    for (let step = 0; step < 20_000; step += 1) {
      const before = m.collapsed;
      const roll = next();
      const changed =
        roll < 0.5
          ? // An item-only reading: one chip reports a new width.
            m.measure({
              widths: [
                [roster[Math.floor(next() * roster.length)]!.id, 1 + Math.floor(next() * 300)],
              ],
            })
          : // An honest one: the bar's own box.
            m.measure({
              items: roster,
              barWidth: 40 + Math.floor(next() * 600),
              padding: Math.floor(next() * 3) * 8,
              gap: Math.floor(next() * 3) * 4,
            });

      if (changed) reportedChanges += 1;
      if (m.collapsed !== before) identityChanges += 1;
      // `measure` reporting a change and the `Set` instance changing are the
      // same event, in both directions: React may rely on identity alone.
      expect(changed).toBe(m.collapsed !== before);

      const collapsed = [...m.collapsed];
      const prefix = order.slice(0, collapsed.length);
      expect([...collapsed].sort(), `step ${step}`).toEqual([...prefix].sort());
      decisions.add(prefix.join(","));
    }

    expect(identityChanges).toBe(reportedChanges);
    expect(identityChanges).toBeGreaterThan(100);
    // At most one decision per prefix length, roster.length + 1 of them — the
    // ceiling on how many signatures can be held between honest readings.
    expect(decisions.size).toBeLessThanOrEqual(roster.length + 1);
  });
});
