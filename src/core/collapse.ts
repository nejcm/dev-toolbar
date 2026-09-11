/**
 * The collapse decision, as a state machine with no renderer in it.
 *
 * `OverflowBar` feeds it DOM measurements (bar width, padding, gap, `⋮` button
 * width, item widths) and reads back which ids are collapsed. Nothing here
 * touches a DOM global, so a sequence of readings drives it exactly as the
 * bar would.
 *
 * Invariants a caller may rely on:
 *
 * - `collapsed` is the same `Set` instance until the decision changes, so
 *   identity is a cheap "did it flip" test and a safe React state value.
 * - A width that is not a positive number never overwrites a cached one —
 *   a collapsed item isn't in the bar to measure, and jsdom measures
 *   everything as 0.
 * - An *honest* reading (the bar's own box or the roster changing, as opposed
 *   to an item reacting to the decision) always recomputes and forgets every
 *   decision held since the last one. Between honest readings, item
 *   measurements may move the decision to any state not held since, but may
 *   not *return* to one already held unless the current state has
 *   overflowed — this is what terminates a chip whose own width depends on
 *   the decision, and `latched` reports the refusal.
 * - No bar width, or one that is not positive, collapses nothing: a
 *   non-measuring host (SSR, jsdom without a fake layout) renders everything.
 */

export interface CollapseItem {
  readonly id: string;
  /** Lowest collapses first; ties break toward the later item. */
  readonly priority: number;
  /** Which region hosts the item — the inter-region gap depends on it. */
  readonly region: "start" | "end";
}

/**
 * What one measurement pass observed. Every field is optional: a reading
 * carries only what its source can see, and a field left out keeps the value
 * the machine already has.
 */
export interface CollapseReading {
  /** The items in bar order, start region first. */
  readonly items?: readonly CollapseItem[];
  /** The bar's padding-box width (`clientWidth`). A change here reopens the latch. */
  readonly barWidth?: number;
  /** The bar's horizontal padding, both sides summed. */
  readonly padding?: number;
  /**
   * The gap between items and between the two regions. A gap *increase*
   * always arrives, since it narrows the regions; a gap *decrease* while
   * content already fits resizes nothing, so it can wait for the next bar
   * reading — leaving the bar more collapsed than it needs to be, with every
   * item still reachable through the button. See docs/architecture.md §5.
   */
  readonly gap?: number;
  /** The `⋮` button's width. Ignored unless positive: the button is only rendered once something has collapsed. */
  readonly buttonWidth?: number;
  /** Measured item-host widths, subject to CSS caps such as max-width. Ignored unless positive. */
  readonly widths?: Iterable<readonly [id: string, width: number]>;
}

export interface CollapseOptions {
  /** Gap assumed until a reading reports one. */
  readonly gap: number;
  /** `⋮` button width assumed until a reading reports one. */
  readonly buttonWidth: number;
}

const EMPTY: ReadonlySet<string> = new Set<string>();

/**
 * Why item readings are filtered by *cycle detection* rather than debounced
 * or counted.
 *
 * A chip can render to a width that depends on the collapse decision itself
 * (wider in the bar than beside a collapsed neighbour); collapsing it changes
 * its width, which changes the decision, so there's no fixed point for
 * debouncing to converge toward. Left unfiltered this used to loop through
 * the unlatched layout effect into React's "Maximum update depth exceeded".
 *
 * A flat flip-count (the previous design) bounds that loop but can't tell it
 * apart from a live readout that genuinely changes width several times
 * between resizes — past the count the decision froze until the bar's own
 * width changed, leaving chips clipped with no `⋮` to reach them. Remembering
 * the decisions held since the last honest reading tells the two apart: a
 * cycle *returns* to a decision, growth never does. Every decision is a
 * prefix of one fixed priority order, so the set of possible decisions (and
 * so the seen-set) is bounded by the roster size — in practice a 2-cycle
 * settles after one round trip.
 */
export class CollapseMachine {
  #items: readonly CollapseItem[] = [];
  readonly #widths = new Map<string, number>();
  #barWidth: number | undefined;
  #padding = 0;
  #gap: number;
  #buttonWidth: number;
  #collapsed: ReadonlySet<string> = EMPTY;
  /** Signatures of every decision held since the last honest reading. */
  readonly #seen = new Set<string>();
  #latched = false;

  constructor(options: CollapseOptions) {
    this.#gap = options.gap;
    this.#buttonWidth = options.buttonWidth;
  }

  /** The ids collapsed into the `⋮` menu. Same instance until the decision changes. */
  get collapsed(): ReadonlySet<string> {
    return this.#collapsed;
  }

  /**
   * Whether the last item-driven proposal to change the decision was refused
   * as a return to a decision already held since the last honest reading —
   * the machine has detected a cycle and settled. Cleared by an honest reading
   * or by any accepted move, so a chip that then genuinely grows is heard.
   */
  get latched(): boolean {
    return this.#latched;
  }

  /**
   * Takes a reading and decides again.
   *
   * @returns whether the collapsed set changed.
   */
  measure(reading: CollapseReading): boolean {
    let honest = false;
    if (reading.items !== undefined && !sameRoster(this.#items, reading.items)) {
      // Copied: the caller keeps its array and may mutate it later.
      this.#items = [...reading.items];
      honest = true;
    }
    if (reading.barWidth !== undefined && reading.barWidth !== this.#barWidth) {
      this.#barWidth = reading.barWidth;
      honest = true;
    }
    if (reading.padding !== undefined && reading.padding !== this.#padding) {
      this.#padding = reading.padding;
      honest = true;
    }
    if (reading.gap !== undefined && reading.gap !== this.#gap) {
      this.#gap = reading.gap;
      honest = true;
    }
    if (reading.buttonWidth !== undefined && reading.buttonWidth > 0) {
      this.#buttonWidth = reading.buttonWidth;
    }
    if (reading.widths) {
      for (const [id, width] of reading.widths) {
        if (width > 0) this.#widths.set(id, width);
      }
    }
    return this.#decide(honest);
  }

  /**
   * `honest` marks a reading that reports the world changing rather than an
   * item reacting to the decision: the bar's own box, or the roster. It forgets
   * the decisions held so far and is never refused. Anything else may move the
   * decision only to a state not held since, or — when the current content has
   * overflowed — back to a larger one; a return to a state that still fits is
   * the cycle, and is refused.
   */
  #decide(honest: boolean): boolean {
    if (honest) {
      this.#seen.clear();
      this.#latched = false;
    }
    const next = computeOverflow(
      this.#items.map((item) => ({
        id: item.id,
        priority: item.priority,
        width: this.#widths.get(item.id) ?? 0,
      })),
      this.#available(),
      this.#buttonWidth,
      this.#gap,
    );
    if (sameSet(this.#collapsed, next)) {
      if (honest) this.#seen.add(this.#signature(next));
      return false;
    }
    const signature = this.#signature(next);
    if (!honest && this.#seen.has(signature) && next.size < this.#collapsed.size) {
      this.#latched = true;
      return false;
    }
    this.#collapsed = next;
    this.#seen.add(signature);
    this.#latched = false;
    return true;
  }

  /** The decision as a string, in roster order, so two equal sets compare equal. */
  #signature(decision: ReadonlySet<string>): string {
    return JSON.stringify(
      this.#items.filter((item) => decision.has(item.id)).map((item) => item.id),
    );
  }

  /**
   * Width the items may fill: the padding box minus padding, minus any
   * inter-region gap `computeOverflow`'s per-pair math doesn't already charge
   * for — both regions reserve a gap since their (possibly empty) elements
   * are always rendered.
   *
   * The two emptiness checks differ on purpose: start is empty when every
   * start item has *collapsed* (per the current decision); end is empty only
   * when the roster has no end *items*, since that region also hosts the `⋮`
   * button and is never emptied by collapsing. Both directions only ever
   * *shrink* available width as items collapse, which is what stops the
   * decision oscillating — at the cost of one gap of hysteresis on
   * re-expansion.
   */
  #available(): number {
    if (this.#barWidth === undefined) return 0;
    const startEmpty = !this.#items.some(
      (item) => item.region === "start" && !this.#collapsed.has(item.id),
    );
    const endEmpty = !this.#items.some((item) => item.region === "end");
    const reserved = this.#padding + (startEmpty ? this.#gap : 0) + (endEmpty ? this.#gap : 0);
    return Math.max(0, this.#barWidth - reserved);
  }
}

interface MeasuredItem {
  id: string;
  priority: number;
  width: number;
}

/**
 * Decides which item ids collapse into the overflow menu.
 *
 * Lowest `priority` collapses first; ties break toward the later item. Returns
 * an empty set when `available` is not a positive number, so a non-measuring
 * environment renders everything.
 */
function computeOverflow(
  items: readonly MeasuredItem[],
  available: number,
  overflowButtonWidth: number,
  gap: number,
): Set<string> {
  const overflow = new Set<string>();
  if (!(available > 0) || items.length === 0) return overflow;

  const widthOf = (list: readonly MeasuredItem[]) =>
    list.reduce((sum, item) => sum + item.width, 0) + Math.max(0, list.length - 1) * gap;

  if (widthOf(items) <= available) return overflow;

  const candidates = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.priority - b.item.priority || b.index - a.index);

  for (const candidate of candidates) {
    overflow.add(candidate.item.id);
    const remaining = items.filter((item) => !overflow.has(item.id));
    const needed = widthOf(remaining) + (remaining.length > 0 ? gap : 0) + overflowButtonWidth;
    if (needed <= available) break;
  }

  return overflow;
}

function sameRoster(a: readonly CollapseItem[], b: readonly CollapseItem[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index] as CollapseItem;
    const y = b[index] as CollapseItem;
    if (x.id !== y.id || x.priority !== y.priority || x.region !== y.region) return false;
  }
  return true;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}
