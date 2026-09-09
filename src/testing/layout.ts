/**
 * jsdom reports every element as 0x0 and ships no `ResizeObserver`, so overflow
 * collapse can never trigger there on its own. This installs a fake layout the
 * bar can measure, plus a `ResizeObserver` whose callbacks fire on `resize()`.
 *
 * The patches live on `HTMLElement.prototype` and `globalThis`, shared process-
 * wide, so installs are tracked as a stack rather than each capturing "the
 * previous value": the prototype is patched once when the stack becomes
 * non-empty and unpatched once it empties. Per-install capture would only be
 * correct if installs always restored in exact reverse order.
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
   * real prototypes come back when the *last* live install is restored, in
   * whatever order that happens. While another install is still live the
   * prototype stays patched and the next install down the stack answers
   * measurements again.
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
  proto: HTMLElement & Record<string, unknown>;
  offsetWidth: PropertyDescriptor | undefined;
  clientWidth: PropertyDescriptor | undefined;
  rect: () => DOMRect;
  resizeObserver: typeof ResizeObserver | undefined;
  hadResizeObserver: boolean;
  getComputedStyle: typeof getComputedStyle;
}

/** Live installs, most recent last. The topmost one answers every measurement. */
const stack: Install[] = [];
let baseline: Baseline | null = null;

const globals = globalThis as { ResizeObserver?: typeof ResizeObserver };

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

const widthOf = (element: Element): number => {
  const install = current();
  if (!install) return 0;
  const part = element.getAttribute("data-dtb-part");
  if (part === "bar" || part === "root") return install.barWidth;
  if (part === "overflow-button") return install.overflowButtonWidth;
  const id = element.getAttribute("data-dtb-ext-id");
  if (part === "item" && id) {
    return install.itemWidths.get(id) ?? install.defaultItemWidth;
  }
  return 0;
};

function rectOf(element: Element): DOMRectReadOnly {
  return new DOMRectReadOnly(
    0,
    0,
    widthOf(element),
    element.getAttribute("data-dtb-part") === "root" ? (current()?.rootHeight ?? 0) : 0,
  );
}

function deliver(observer: Observer): void {
  const entries = Array.from(observer.targets, (target): ResizeObserverEntry => ({
    target,
    contentRect: rectOf(target),
    borderBoxSize: [],
    contentBoxSize: [],
    devicePixelContentBoxSize: [],
  }));
  if (entries.length > 0) observer.callback(entries, observer.instance);
}

function patch(): void {
  const proto = HTMLElement.prototype as HTMLElement & Record<string, unknown>;
  baseline = {
    proto,
    offsetWidth: Object.getOwnPropertyDescriptor(proto, "offsetWidth"),
    clientWidth: Object.getOwnPropertyDescriptor(proto, "clientWidth"),
    rect: proto.getBoundingClientRect,
    resizeObserver: globals.ResizeObserver,
    hadResizeObserver: "ResizeObserver" in globals,
    getComputedStyle: globalThis.getComputedStyle,
  };

  globals.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;

  const previousStyle = baseline.getComputedStyle;
  globalThis.getComputedStyle = (element, pseudo) => {
    const style = previousStyle.call(globalThis, element, pseudo);
    const install = current();
    if (
      !install ||
      !element.hasAttribute("data-dtb-part") ||
      (install.paddingX === undefined && install.gap === undefined)
    )
      return style;
    return new Proxy(style, {
      get(target, property, receiver) {
        if (
          install.paddingX !== undefined &&
          (property === "paddingLeft" || property === "paddingRight")
        ) {
          return `${install.paddingX}px`;
        }
        if (install.gap !== undefined && (property === "columnGap" || property === "gap")) {
          return `${install.gap}px`;
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };

  for (const name of ["offsetWidth", "clientWidth"] as const) {
    Object.defineProperty(proto, name, {
      configurable: true,
      get(this: HTMLElement) {
        return widthOf(this);
      },
    });
  }

  const previousRect = baseline.rect;
  proto.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement): DOMRect {
    const install = current();
    if (!install || this.dataset["dtbPart"] !== "root") {
      return previousRect.call(this);
    }
    return DOMRect.fromRect(rectOf(this));
  };
}

function unpatch(): void {
  if (!baseline) return;
  const { proto, offsetWidth, clientWidth, rect, resizeObserver, hadResizeObserver } = baseline;
  globalThis.getComputedStyle = baseline.getComputedStyle;
  baseline = null;

  if (hadResizeObserver) {
    globals.ResizeObserver = resizeObserver;
  } else {
    delete globals.ResizeObserver;
  }
  for (const [name, descriptor] of [
    ["offsetWidth", offsetWidth],
    ["clientWidth", clientWidth],
  ] as const) {
    if (descriptor) {
      Object.defineProperty(proto, name, descriptor);
    } else {
      delete proto[name];
    }
  }
  proto.getBoundingClientRect = rect;
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
 * The fake `ResizeObserver` reports each target with its fake width and root
 * height (zero height for other targets). Box-size arrays are empty.
 * The root's `getBoundingClientRect()` returns a native `DOMRect`: `toJSON()`
 * and JSON serialization include geometry, but `Object.keys(rect)` is empty
 * and `{ ...rect }` yields `{}` because geometry uses prototype accessors.
 * Mutating width or height updates derived edges, as in a browser. Consumers
 * asserting own properties or spreading the previous plain object must adapt.
 * The host DOM must now provide `DOMRect.fromRect`; verified in jsdom,
 * unverified in happy-dom.
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
