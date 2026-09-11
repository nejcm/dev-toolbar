// This import must stay directly above the docblock: tsup's declaration
// rollup emits that docblock as `InstallToolbarLayoutOptions`'s JSDoc in
// `dist/testing.d.ts` only while nothing separates the two.
import type { Measurer } from "../core/measurer";

/**
 * jsdom reports every element as 0x0 and ships no `ResizeObserver`, so overflow
 * collapse can never trigger there on its own. This installs a fake layout the
 * bar measures *through core's measurer slot* — no DOM read is patched, so a
 * consumer's own `offsetWidth` or `getComputedStyle` stub is left alone — plus
 * a `ResizeObserver` whose callbacks fire on `resize()`.
 *
 * Both are `globalThis` state, shared process-wide, so installs are tracked as
 * a stack rather than each capturing "the previous value": the globals are
 * written once when the stack becomes non-empty and restored once it empties.
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
   * Retires this install. Idempotent and order-independent: the globals come
   * back only once every install has been restored.
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
 * Core's measurer slot. The key is re-derived via `Symbol.for` rather than
 * imported, so this file can reach the slot without a relative value import
 * into `../core/*` (AGENTS.md) and without core publishing an export for it.
 *
 * Like `globalThis.ResizeObserver`, it's restored per install *cycle*, not per
 * install: one `Measurer` is registered when the stack becomes non-empty and
 * `baseline` comes back once it empties, so an out-of-order `restore()` can't
 * put back a stale value. The registered object holds no state and reads
 * `current()` per call, so a `Measurer` a test registered before the first
 * install is restored intact, not clobbered.
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
 * The install's own width for an item host, keyed by extension id. Shared by
 * `measurer.itemWidth()` and `rectOf()` so a delivered rectangle reports the
 * *configured* number — the own-`offsetWidth` preference stays in
 * `itemWidth()` alone, since routing delivery through it would leak a test's
 * per-chip override into the entry's geometry.
 */
const configuredItemWidth = (host: HTMLElement): number => {
  const install = current();
  // `data-dtb-ext-id` is documented contract (docs/architecture.md).
  const id = host.dataset["dtbExtId"];
  return install && id ? (install.itemWidths.get(id) ?? install.defaultItemWidth) : 0;
};

/**
 * What core measures through while an install is live: the topmost install's
 * state, read `current()` per call and never captured.
 */
const measurer: Measurer = {
  barWidth: () => current()?.barWidth ?? 0,
  itemWidth(host) {
    // An own `offsetWidth` on the host wins over the install's widths — how a
    // test gives one chip a width that changes with the layout
    // (`src/core/__tests__/overflow.test.tsx`).
    if (Object.hasOwn(host, "offsetWidth")) return host.offsetWidth;
    return configuredItemWidth(host);
  },
  buttonWidth: (button) => (button ? (current()?.overflowButtonWidth ?? 0) : 0),
  regionGap(bar) {
    const region = bar.querySelector<HTMLElement>('[data-dtb-part="region"]');
    if (!region) return undefined;
    const gap = current()?.gap;
    // Non-finite reads as "unresolved" rather than as a pixel count, matching
    // core's own `readPx` for a real computed style.
    if (gap !== undefined) return Number.isFinite(gap) ? gap : undefined;
    // No `getComputedStyle`: read as "unresolved" so core keeps its existing
    // value instead of throwing, same as `domMeasurer`.
    if (typeof getComputedStyle !== "function") return undefined;
    const style = getComputedStyle(region);
    return readPx(style.columnGap || style.gap);
  },
  padding(bar) {
    const paddingX = current()?.paddingX;
    // `paddingX` is per side; core wants both, as `paddingLeft + paddingRight`.
    if (paddingX !== undefined) return (Number.isFinite(paddingX) ? paddingX : 0) * 2;
    if (typeof getComputedStyle !== "function") return undefined;
    const style = getComputedStyle(bar);
    return (readPx(style.paddingLeft) ?? 0) + (readPx(style.paddingRight) ?? 0);
  },
  height: () => current()?.rootHeight ?? 0,
  observe(notify) {
    // Load-bearing: a test that stubs `ResizeObserver` away under a live
    // install asserts core falls back to `window.resize`, so this must too.
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new FakeResizeObserver(() => notify());
    let observed = new Set<Element>();
    return {
      sync(nodes) {
        const next = new Set(nodes);
        for (const node of observed) {
          if (!next.has(node)) observer.unobserve(node);
        }
        for (const node of next) {
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
 * The rectangle an entry carries for one target. Core's own `notify` is
 * zero-argument and never reads this, but a *consumer's* mount effect may
 * construct a `ResizeObserver` under a live install
 * (`__tests__/lifecycle.test.tsx` pins that), so a zero rectangle there would
 * be silently wrong rather than loudly absent — hence real geometry here,
 * read straight from `measurer` (the `item` branch uses
 * `configuredItemWidth()` directly, to keep the own-`offsetWidth` preference
 * out of delivery).
 *
 * Returns `DOMRectReadOnly` to match a real `ResizeObserverEntry`: its edges
 * serialize via `toJSON()`, but `Object.keys`/spread see nothing, since
 * geometry lives on prototype accessors.
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
 * the usual home, `cleanupToolbar()` the safety net, and
 * `renderWithToolbar({ layout: … })` does it for you, tied to the React tree.
 *
 * Nested installs stack: the most recent answers measurements, and restoring
 * it hands measurement back to the one underneath.
 *
 * No DOM read is patched — core reads the fake through its measurer slot, so
 * your own width/style stubs keep working under a live install. The
 * `ResizeObserver` stub stays, since jsdom ships none and consumer code
 * constructs one directly.
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
 * effect (mount → cleanup → mount) ends up installed, not restored.
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
