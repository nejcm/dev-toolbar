/**
 * The collapse decision, as a state machine with no renderer in it.
 *
 * `OverflowBar` feeds it what the DOM reports — the bar's own width, its
 * padding and gap, the `⋮` button's width and every rendered item host's width
 * — and reads back which ids are collapsed. Everything that used to make the
 * decision hard to reason about in the component lives here instead: the
 * sticky width cache, the inter-region gap hysteresis, the cycle detection
 * that settles a chip whose width depends on its own collapse, and the
 * priority arithmetic itself. Nothing here touches a DOM global, so a sequence
 * of readings drives it exactly as the bar would.
 *
 * Invariants a caller may rely on:
 *
 * - `collapsed` is the same `Set` instance until the decision changes, so
 *   identity is a cheap "did it flip" test and a safe React state value.
 * - A width that is not a positive number never overwrites a cached one. A
 *   collapsed item is not in the bar to be measured, and jsdom measures
 *   everything as 0; both keep the width the item last had in the bar.
 * - An *honest* reading — one that reports the bar's own box (width, padding,
 *   gap) or the roster changing — is the world changing, not an item reacting
 *   to the decision. It always recomputes, and it forgets every decision held
 *   since the last one.
 * - Between honest readings, item measurements may move the decision to any
 *   state not held since, but may not *return* to one already held unless the
 *   current state has overflowed. That is what terminates a chip whose width
 *   depends on the decision: its 2-cycle settles on the side that fits, after
 *   at most one round trip, and `latched` reports the refusal. A chip that
 *   genuinely grows never repeats a state, so it is always heard.
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
  /** The gap between items and between the two regions. */
  readonly gap?: number;
  /** The `⋮` button's width. Ignored unless positive: the button is only rendered once something has collapsed. */
  readonly buttonWidth?: number;
  /** Natural widths of the item hosts currently in the bar. Each is ignored unless positive. */
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
 * Why item readings are filtered by *cycle detection* rather than debounced or
 * counted.
 *
 * The case this guards is a chip that renders to a width that depends on the
 * collapse state — one wider in the bar than beside a collapsed neighbour, or
 * one sized by a neighbour that comes and goes. Collapsing it changes its
 * width, which changes the decision, so there is no fixed point to settle on
 * and no amount of debouncing converges it. Every source of item widths — a
 * `ResizeObserver` delivery, the layout effect after a commit — feeds the same
 * filter, which is what closes the synchronous case where a chip is measurably
 * different on the very next layout after the collapse: it used to loop
 * through the unlatched layout effect into React's "Maximum update depth
 * exceeded".
 *
 * A flat count of flips (the previous design) bounds that loop but cannot tell
 * it apart from a live readout that genuinely changes width several times
 * between resizes: past the count the decision froze, absolutely, until the
 * bar's own width changed — leaving chips clipped with no `⋮` to reach them.
 * Remembering the decisions held since the last honest reading tells the two
 * apart: a cycle *returns* to a decision, growth never does.
 *
 * Every decision is a prefix of one fixed order (lowest priority first, later
 * index first on a tie), so for `n` items there are at most `n + 1` distinct
 * decisions, the set of signatures is bounded by the roster, and it is cleared
 * on every honest reading. Prefixes of one order are nested, so a decision
 * that collapses more is a superset — the size comparison in {@link CollapseMachine.measure}
 * is a fit test: `computeOverflow` proposes a superset exactly when the
 * current content no longer fits, and a subset exactly when it fits with room
 * to spare. Item readings may therefore move the decision at most
 * `n + n(n + 1)` times between honest readings — each move is either to a new
 * signature or strictly larger than the last — and in practice a 2-cycle
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
   * Width the items may fill: the padding box minus the padding and minus any
   * inter-region gap the item math does not already charge for.
   * `computeOverflow` charges one gap per adjacent item pair plus one before the
   * `⋮` button, which undercounts when the start region has no items or the
   * end region has none — both still reserve a gap, since the (empty) region
   * elements are always rendered.
   *
   * The two emptiness tests differ on purpose, and the asymmetry is the point:
   *
   * - the start region is empty when every start item has *collapsed*, per the
   *   decision this machine currently holds — which is what the bar renders;
   * - the end region is empty when the roster has no end *items*, because that
   *   region also hosts the `⋮` button: once anything collapses it is never
   *   rendered empty, and the button's width is charged separately.
   *
   * Both directions therefore only ever *shrink* the available width as items
   * collapse, which is what stops the decision oscillating: the start term can
   * flip 0 → gap once, and the end term is fixed for a given roster. The cost
   * is one gap of hysteresis — a bar whose start region has collapsed empty is
   * charged a gap the flattened item math would have covered had anything come
   * back, so re-expansion needs one gap more room than the collapse gave up.
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
