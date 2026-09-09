// The type import sits above the docblock on purpose: tsup's declaration
// rollup emits that docblock as `InstallToolbarLayoutOptions`'s JSDoc in
// `dist/testing.d.ts`, and only while nothing separates the two. Its bytes
// are published; the measurer notes live on the declarations below instead.
import type { Measurer } from "../core/measurer";

/**
 * jsdom reports every element as 0x0 and ships no `ResizeObserver`, so overflow
 * collapse can never trigger there on its own. This installs a fake layout the
 * bar measures *through core's measurer slot* — no DOM read is patched, so a
 * consumer's own `offsetWidth` or `getComputedStyle` stub is left alone — plus
 * a `ResizeObserver` whose callbacks fire on `resize()`, since jsdom has none.
 *
 * Both of those are `globalThis` state, shared process-wide, so installs are
 * tracked as a stack rather than each capturing "the previous value": the
 * globals are written once when the stack becomes non-empty and put back once
 * it empties. Per-install capture would only be correct if installs always
 * restored in exact reverse order.
 */
export interface InstallToolbarLayoutOptions {
  /** Width reported for the bar element. Default `800`. */
  barWidth?: number;
  /** Width reported for any item without an explicit entry. Default `80`. */
  itemWidth?: number;
  /** Per-extension-id item widths. */
  itemWidths?: Record<string, number>;
  /** Width reported for the `⋮` button. Default `28`. */
  overflowButtonWidth?: number;
  /** Padding on each horizontal side of toolbar parts. Omitted leaves computed styles unchanged. */
  paddingX?: number;
  /** Gap between toolbar items and regions. Omitted leaves computed styles unchanged. */
  gap?: number;
  /** Height reported for the toolbar root, i.e. `--dev-toolbar-height`. Default `30`. */
  rootHeight?: number;
}

export interface ToolbarLayoutObserver {
  /** Returns a snapshot of this observer's current targets, empty after disconnect. */
  getTargets(): readonly Element[];
  /** Fires only this observer with its current targets. Wrap in `act()` yourself. */
  flush(): void;
}

/** Only width setters can defer delivery, to isolate bar and item observer callbacks in tests. */
export interface ToolbarLayoutHandle {
  /** Sets the bar width; pass `false` to defer notification. Wrap in `act()` yourself. */
  resize(width: number, notify?: boolean): void;
  /** Overrides one item's measured width; pass `false` to defer notification. */
  setItemWidth(extensionId: string, width: number, notify?: boolean): void;
  /** Sets the reported root height (drives `--dev-toolbar-height`). */
  setRootHeight(height: number): void;
  /** Sets horizontal padding and notifies every observer. Wrap in `act()` yourself. */
  setPaddingX(padding: number): void;
  /** Sets the gap and notifies every observer. Wrap in `act()` yourself. */
  setGap(gap: number): void;
  /** Returns observer handles in construction order, including disconnected observers. */
  getObservers(): readonly ToolbarLayoutObserver[];
  /** Fires every observer with one measured entry per observed target. */
  flush(): void;
  /**
   * Retires this install.
   *
   * Idempotent and order-independent: calling it twice is a no-op, and the
   * globals come back when the *last* live install is restored, in whatever
   * order that happens. While another install is still live the measurer stays
   * registered and the next install down the stack answers measurements again.
   */
  restore(): void;
}

type Observer = {
  callback: ResizeObserverCallback;
  instance: ResizeObserver;
  targets: Set<Element>;
};

interface Install {
  paddingX: number | undefined;
  gap: number | undefined;
  barWidth: number;
  rootHeight: number;
  defaultItemWidth: number;
  overflowButtonWidth: number;
  itemWidths: Map<string, number>;
  observers: Set<Observer>;
  observerHandles: ToolbarLayoutObserver[];
  live: boolean;
}

interface Baseline {
  /** The slot's own descriptor before the first install wrote to it, if any. */
  measurer: PropertyDescriptor | undefined;
  resizeObserver: typeof ResizeObserver | undefined;
  hadResizeObserver: boolean;
}

/** Live installs, most recent last. The topmost one answers every measurement. */
const stack: Install[] = [];
let baseline: Baseline | null = null;

/**
 * Core's measurer slot, and how it joins the install stack above.
 *
 * The key is re-derived rather than imported: the symbol lives in the global
 * registry precisely so a second copy of a module can reach the same slot,
 * which is what lets this file name it without a relative value import into
 * `../core/*` (AGENTS.md) and without core publishing an export for it.
 *
 * The slot is process-wide global state, like `globalThis.ResizeObserver`
 * alongside it, so it gets no bookkeeping of its own: one `Measurer` is
 * registered when the stack becomes non-empty and the descriptor captured in
 * `baseline` comes back once it empties. That is not per-install capture — it
 * is per install cycle, so an out-of-order `restore()` cannot put back a stale
 * value. Nesting needs nothing from the slot at all: the registered object
 * holds no state and reads `current()` per call, so restoring any install
 * hands measurement to whatever is topmost afterwards. A `Measurer` a test
 * registered before the first install is therefore restored, not clobbered.
 */
const MEASURER_SLOT = Symbol.for("@nejcm/dev-toolbar.measurer");
const globals = globalThis as {
  ResizeObserver?: typeof ResizeObserver;
  [MEASURER_SLOT]?: Measurer;
};

const current = (): Install | undefined => stack[stack.length - 1];

/**
 * Bound to whichever install was topmost at construction, so `handle.flush()`
 * fires observers created under that handle even after a later install is
 * pushed on top of it.
 */
class FakeResizeObserver implements ResizeObserver {
  private readonly entry: Observer;
  private readonly owner: Install | undefined;
  private readonly targets = new Set<Element>();
  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, instance: this, targets: this.targets };
    this.owner = current();
    this.owner?.observerHandles.push({
      getTargets: () => Array.from(this.targets),
      flush: () => {
        if (this.owner?.live && this.owner.observers.has(this.entry)) deliver(this.entry);
      },
    });
  }
  observe(target: Element): void {
    this.targets.add(target);
    this.owner?.observers.add(this.entry);
  }
  unobserve(target: Element): void {
    this.targets.delete(target);
    if (this.targets.size === 0) this.owner?.observers.delete(this.entry);
  }
  disconnect(): void {
    this.targets.clear();
    this.owner?.observers.delete(this.entry);
  }
}

function readPx(raw: string): number | undefined {
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The install's own width for an item host, keyed by its extension id.
 *
 * Shared by `measurer.itemWidth()` and `rectOf()` below so a delivered
 * rectangle reports the *configured* number. The own-`offsetWidth` preference
 * stays in `itemWidth()` alone and deliberately does not live here: it exists
 * so a test can give one chip a width that changes with its own collapse, and
 * routing delivery through it would leak that preference into an entry's
 * geometry — a host with a configured `123` and an own getter returning `999`
 * would deliver `999`, and invoke the getter, where the DOM-patching fake
 * delivered `123` and never touched it.
 */
const configuredItemWidth = (host: HTMLElement): number => {
  const install = current();
  // The published `itemWidths` option is keyed by extension id, and the
  // attribute carrying it is documented contract (docs/architecture.md).
  const id = host.dataset["dtbExtId"];
  return install && id ? (install.itemWidths.get(id) ?? install.defaultItemWidth) : 0;
};

/**
 * What core measures through while an install is live: the topmost install's
 * state, read `current()` per call and never captured. `barWidth` and `height`
 * ignore their argument because an install reports one bar width and one root
 * height, as its options say.
 */
const measurer: Measurer = {
  barWidth: () => current()?.barWidth ?? 0,
  itemWidth(host) {
    // An own `offsetWidth` on the host wins over the install's widths. That is
    // how a test gives one chip a width that changes with the layout
    // (`src/core/__tests__/overflow.test.tsx`) without reaching in here, and
    // it is what an instance accessor did back when a prototype getter
    // answered this — an own property shadows a prototype one.
    if (Object.hasOwn(host, "offsetWidth")) return host.offsetWidth;
    return configuredItemWidth(host);
  },
  buttonWidth: (button) => (button ? (current()?.overflowButtonWidth ?? 0) : 0),
  regionGap(bar) {
    // Still gated on a region existing, so a bar without one reads as "no gap"
    // exactly as it does through `getComputedStyle`.
    const region = bar.querySelector<HTMLElement>('[data-dtb-part="region"]');
    if (!region) return undefined;
    const gap = current()?.gap;
    // The `Number.isFinite` checks here and below keep a non-finite override
    // reading as "unresolved" rather than as a pixel count — what
    // `Number.parseFloat("NaNpx")` gave when this went through a computed
    // style, and what core's own `readPx` still does for a real one.
    if (gap !== undefined) return Number.isFinite(gap) ? gap : undefined;
    // The same guard `domMeasurer` puts on this read, for the same reason: a
    // host DOM without `getComputedStyle` must read as "unresolved" so core
    // keeps the value its collapse machine already has, rather than throwing.
    // It sits at the fallthrough rather than at the top of the method because
    // a configured `gap` is an answer this fake owns and can still give.
    if (typeof getComputedStyle !== "function") return undefined;
    const style = getComputedStyle(region);
    return readPx(style.columnGap || style.gap);
  },
  padding(bar) {
    const paddingX = current()?.paddingX;
    // `paddingX` is per side; core wants both, as `paddingLeft + paddingRight`.
    if (paddingX !== undefined) return (Number.isFinite(paddingX) ? paddingX : 0) * 2;
    // As in `regionGap()` above, and in `domMeasurer.padding()`.
    if (typeof getComputedStyle !== "function") return undefined;
    const style = getComputedStyle(bar);
    return (readPx(style.paddingLeft) ?? 0) + (readPx(style.paddingRight) ?? 0);
  },
  height: () => current()?.rootHeight ?? 0,
  observe(notify) {
    // Load-bearing, not defensive: a test that stubs `ResizeObserver` away
    // under a live install is asserting core observes nothing and falls back
    // to `window.resize`, so the fake must report the absence too.
    if (typeof ResizeObserver === "undefined") return undefined;
    // A `FakeResizeObserver`, so this observer is one of the install's
    // `getObservers()` handles: `flush()` on that handle fires this `notify`
    // and no other, and a deferred width setter reaches neither until asked.
    // The callback takes the entries a real one would and drops them — core's
    // `notify` is zero-argument and re-reads through the measurer instead.
    const observer = new FakeResizeObserver(() => notify());
    let observed = new Set<Element>();
    return {
      sync(nodes) {
        const next = new Set(nodes);
        for (const node of observed) {
          if (!next.has(node)) observer.unobserve(node);
        }
        for (const node of next) {
          // Re-observing an unchanged target would re-register it for nothing.
          if (!observed.has(node)) observer.observe(node);
        }
        observed = next;
      },
      disconnect() {
        observer.disconnect();
        observed.clear();
      },
    };
  },
};

/**
 * The rectangle an entry carries for one target, answered through the measurer.
 *
 * Core's `notify` is zero-argument, so the shell never reads this — but the
 * fake owns `globalThis.ResizeObserver`, and a *consumer's* own mount effect
 * constructs one under a live install (`__tests__/lifecycle.test.tsx` pins
 * that). A zero rectangle there is silently wrong rather than loudly absent:
 * `if (entry.contentRect.width < 500) collapse()` takes the wrong branch with
 * no error to read. So the geometry stays synthesized.
 *
 * Nothing here reads DOM geometry. `getAttribute` is a part name, not a
 * measurement, and the widths come from the same `measurer` object literal
 * above — reached directly, because `deliver()` is module-local in this file
 * and never routes through core's `MeasurementObserver`. The `item` branch
 * takes the shared `configuredItemWidth()` rather than `measurer.itemWidth()`
 * so the own-`offsetWidth` preference stays out of delivery.
 *
 * `DOMRectReadOnly`, because that is what a real `ResizeObserverEntry` hands
 * over: `toJSON()` and JSON serialization include the derived edges, while
 * `Object.keys(rect)` is empty and `{ ...rect }` yields `{}` because geometry
 * lives on prototype accessors.
 */
const rectOf = (target: Element): DOMRectReadOnly => {
  const part = target.getAttribute("data-dtb-part");
  const host = target as HTMLElement;
  if (part === "root") {
    return new DOMRectReadOnly(0, 0, measurer.barWidth(host), measurer.height(host));
  }
  if (part === "bar") return new DOMRectReadOnly(0, 0, measurer.barWidth(host), 0);
  if (part === "overflow-button") return new DOMRectReadOnly(0, 0, measurer.buttonWidth(host), 0);
  if (part === "item") return new DOMRectReadOnly(0, 0, configuredItemWidth(host), 0);
  return new DOMRectReadOnly(0, 0, 0, 0);
};

/** Fires one observer with one measured entry per target. */
function deliver(observer: Observer): void {
  const entries = Array.from(observer.targets, (target): ResizeObserverEntry => ({
    target,
    // A fresh instance per entry, evaluated at delivery: an entry a consumer
    // captured at one flush keeps the numbers it was delivered with.
    contentRect: rectOf(target),
    borderBoxSize: [],
    contentBoxSize: [],
    devicePixelContentBoxSize: [],
  }));
  if (entries.length > 0) observer.callback(entries, observer.instance);
}

/** Claims the two globals an install answers through, saving what was there. */
function patch(): void {
  baseline = {
    measurer: Object.getOwnPropertyDescriptor(globals, MEASURER_SLOT),
    resizeObserver: globals.ResizeObserver,
    hadResizeObserver: "ResizeObserver" in globals,
  };

  Object.defineProperty(globals, MEASURER_SLOT, {
    configurable: true,
    writable: true,
    value: measurer,
  });
  globals.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
}

function unpatch(): void {
  if (!baseline) return;
  const { resizeObserver, hadResizeObserver } = baseline;
  if (baseline.measurer) {
    Object.defineProperty(globals, MEASURER_SLOT, baseline.measurer);
  } else {
    delete globals[MEASURER_SLOT];
  }
  baseline = null;

  if (hadResizeObserver) {
    globals.ResizeObserver = resizeObserver;
  } else {
    delete globals.ResizeObserver;
  }
}

function activate(install: Install): void {
  if (install.live) return;
  install.live = true;
  stack.push(install);
  if (stack.length === 1) patch();
}

function deactivate(install: Install): void {
  if (!install.live) return;
  install.live = false;
  install.observers.clear();
  install.observerHandles.length = 0;
  const at = stack.indexOf(install);
  if (at !== -1) stack.splice(at, 1);
  if (stack.length === 0) unpatch();
}

/** Handle → install, so the internals below need no field on the public type. */
const installs = new WeakMap<ToolbarLayoutHandle, Install>();

/**
 * Installs the fake layout. Always pair with `restore()` — an `afterEach` is
 * the usual home, and `cleanupToolbar()` is the safety net when one is missed.
 * `renderWithToolbar({ layout: … })` does this for you, tied to the React tree
 * so Testing Library's `cleanup()` covers it.
 *
 * Nested installs stack: the most recent answers measurements, and restoring
 * it hands measurement back to the one underneath. `restore()` is idempotent
 * and order-independent.
 *
 * No DOM read is patched — not the element width getters, not
 * `getComputedStyle`: core reads the fake through its measurer slot instead,
 * so your own components' width and style stubs keep working under a live
 * install. The `ResizeObserver` stub stays, because jsdom ships none at all
 * and ordinary consumer code constructs one.
 *
 * The fake `ResizeObserver` reports one entry per observed target with a
 * synthetic `contentRect` — the bar's width for a bar, that width and the root
 * height for the root, the `⋮` width for the overflow button, the configured
 * width for an item, zero for anything else — answered through the same
 * measurer, so no DOM read happens in delivery either. Box-size arrays are
 * empty. Each `contentRect` is a `DOMRectReadOnly`, as a real entry's is:
 * `toJSON()` and JSON serialization include the derived edges, but
 * `Object.keys(rect)` is empty and `{ ...rect }` yields `{}` because geometry
 * uses prototype accessors, and an entry already delivered is never rewritten
 * by a later setter.
 */
export function installToolbarLayout(
  options: InstallToolbarLayoutOptions = {},
): ToolbarLayoutHandle {
  if (typeof HTMLElement === "undefined") {
    throw new Error("[dev-toolbar/testing] installToolbarLayout() needs a DOM environment.");
  }

  const install: Install = {
    paddingX: options.paddingX,
    gap: options.gap,
    barWidth: options.barWidth ?? 800,
    rootHeight: options.rootHeight ?? 30,
    defaultItemWidth: options.itemWidth ?? 80,
    overflowButtonWidth: options.overflowButtonWidth ?? 28,
    itemWidths: new Map(Object.entries(options.itemWidths ?? {})),
    observers: new Set<Observer>(),
    observerHandles: [],
    live: false,
  };

  const flush = () => {
    // Copied: a callback may disconnect its observer mid-flush.
    for (const observer of Array.from(install.observers)) {
      deliver(observer);
    }
  };

  const handle: ToolbarLayoutHandle = {
    resize(width, notify = true) {
      install.barWidth = width;
      if (notify) flush();
    },
    setItemWidth(extensionId, width, notify = true) {
      install.itemWidths.set(extensionId, width);
      if (notify) flush();
    },
    setRootHeight(height) {
      install.rootHeight = height;
      flush();
    },
    setPaddingX(padding) {
      install.paddingX = padding;
      flush();
    },
    setGap(gap) {
      install.gap = gap;
      flush();
    },
    getObservers() {
      return [...install.observerHandles];
    },
    flush,
    restore() {
      deactivate(install);
    },
  };

  installs.set(handle, install);
  activate(install);
  return handle;
}

/**
 * Internal. Re-pushes a handle whose `restore()` has already run. Used by
 * `renderWithToolbar`'s layout-owner effect so a StrictMode double-invoked
 * effect (mount → cleanup → mount) ends up installed, not restored. The handle
 * keeps its own widths, so a re-install measures exactly as before.
 */
export function reinstallToolbarLayout(handle: ToolbarLayoutHandle): void {
  const install = installs.get(handle);
  if (install) activate(install);
}

/** Internal. Retires every live install. The engine behind `cleanupToolbar()`. */
export function restoreToolbarLayouts(): void {
  while (stack.length > 0) {
    // Top down, so the last `deactivate` is the one that unpatches.
    deactivate(stack[stack.length - 1] as Install);
  }
}
