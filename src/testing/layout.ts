/**
 * jsdom reports every element as 0×0 and ships no `ResizeObserver`, so the
 * overflow collapse can never trigger there on its own. This installs a fake
 * layout the bar can measure, plus a `ResizeObserver` whose callbacks fire when
 * you call `resize()`.
 *
 * The patches live on `HTMLElement.prototype` and on `globalThis`, which are
 * shared by every install in the process. So they are *not* captured per
 * install: this module keeps a stack of live installs, patches the prototype
 * once when the stack becomes non-empty and unpatches it once when the stack
 * empties. The alternative — each install remembering "the previous value" —
 * is only correct when installs are restored in exactly reverse order, and
 * silently leaks a fake prototype getter for the rest of the process when they
 * are not.
 */

export interface InstallToolbarLayoutOptions {
  /** Width reported for the bar element. Default `800`. */
  barWidth?: number;
  /** Width reported for any item without an explicit entry. Default `80`. */
  itemWidth?: number;
  /** Per-extension-id item widths. */
  itemWidths?: Record<string, number>;
  /** Width reported for the `···` button. Default `28`. */
  overflowButtonWidth?: number;
  /** Height reported for the toolbar root, i.e. `--dev-toolbar-height`. Default `30`. */
  rootHeight?: number;
}

export interface ToolbarLayoutHandle {
  /** Sets the bar width and notifies every observer. Wrap in `act()` yourself. */
  resize(width: number): void;
  /** Overrides one item's measured width. */
  setItemWidth(extensionId: string, width: number): void;
  /** Sets the reported root height (drives `--dev-toolbar-height`). */
  setRootHeight(height: number): void;
  /**
   * Fires every observer without changing anything. Callbacks receive an empty
   * entry array, so they must re-read the DOM to see a size.
   */
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

type Observer = { callback: ResizeObserverCallback; instance: ResizeObserver };

interface Install {
  barWidth: number;
  rootHeight: number;
  defaultItemWidth: number;
  overflowButtonWidth: number;
  itemWidths: Map<string, number>;
  observers: Set<Observer>;
  live: boolean;
}

interface Baseline {
  proto: HTMLElement & Record<string, unknown>;
  offsetWidth: PropertyDescriptor | undefined;
  clientWidth: PropertyDescriptor | undefined;
  rect: () => DOMRect;
  resizeObserver: typeof ResizeObserver | undefined;
  hadResizeObserver: boolean;
}

/**
 * Live installs, most recent last. The topmost one answers every measurement,
 * which is what the previous per-install implementation did for the only order
 * it got right (nested installs, restored innermost first).
 */
const stack: Install[] = [];
let baseline: Baseline | null = null;

const globals = globalThis as { ResizeObserver?: typeof ResizeObserver };

const current = (): Install | undefined => stack[stack.length - 1];

/**
 * Bound to whichever install was topmost when it was constructed, so
 * `handle.flush()` fires the observers created under that handle even after a
 * later install has been pushed on top of it.
 */
class FakeResizeObserver implements ResizeObserver {
  private readonly entry: Observer;
  private readonly owner: Install | undefined;
  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, instance: this };
    this.owner = current();
  }
  observe(): void {
    this.owner?.observers.add(this.entry);
  }
  unobserve(): void {
    this.owner?.observers.delete(this.entry);
  }
  disconnect(): void {
    this.owner?.observers.delete(this.entry);
  }
}

const widthOf = (element: HTMLElement): number => {
  const install = current();
  if (!install) return 0;
  const part = element.dataset["dtbPart"];
  if (part === "bar" || part === "root") return install.barWidth;
  if (part === "overflow-button") return install.overflowButtonWidth;
  const id = element.dataset["dtbExtId"];
  if (part === "item" && id) {
    return install.itemWidths.get(id) ?? install.defaultItemWidth;
  }
  return 0;
};

function patch(): void {
  const proto = HTMLElement.prototype as HTMLElement & Record<string, unknown>;
  baseline = {
    proto,
    offsetWidth: Object.getOwnPropertyDescriptor(proto, "offsetWidth"),
    clientWidth: Object.getOwnPropertyDescriptor(proto, "clientWidth"),
    rect: proto.getBoundingClientRect,
    resizeObserver: globals.ResizeObserver,
    hadResizeObserver: "ResizeObserver" in globals,
  };

  globals.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;

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
    const width = install.barWidth;
    const height = install.rootHeight;
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    } as DOMRect;
  };
}

function unpatch(): void {
  if (!baseline) return;
  const { proto, offsetWidth, clientWidth, rect, resizeObserver, hadResizeObserver } = baseline;
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
  const at = stack.indexOf(install);
  if (at !== -1) stack.splice(at, 1);
  if (stack.length === 0) unpatch();
}

/** Handle → install, so the internals below need no field on the public type. */
const installs = new WeakMap<ToolbarLayoutHandle, Install>();

/**
 * Installs the fake layout. Always pair with `restore()` — an `afterEach` is
 * the usual home, and `cleanupToolbar()` is the safety net when one is missed.
 * `renderWithToolbar({ layout: … })` does this for you, and ties the teardown
 * to the React tree so Testing Library's `cleanup()` covers it.
 *
 * Nested installs stack: the most recent one answers measurements, and
 * restoring it hands measurement back to the one underneath. `restore()` is
 * idempotent and may be called in any order.
 *
 * The fake `ResizeObserver` ignores its observed targets: every callback is
 * invoked with an **empty entry array**, so code under test must re-read the
 * DOM (`offsetWidth`, `getBoundingClientRect()`, which this install answers)
 * instead of reading `entries[0].contentRect`. Core does exactly that. An
 * extension that trusts the entries sees nothing change here — measure from
 * the element, or drive that extension with a fake of your own.
 */
export function installToolbarLayout(
  options: InstallToolbarLayoutOptions = {},
): ToolbarLayoutHandle {
  if (typeof HTMLElement === "undefined") {
    throw new Error("[dev-toolbar/testing] installToolbarLayout() needs a DOM environment.");
  }

  const install: Install = {
    barWidth: options.barWidth ?? 800,
    rootHeight: options.rootHeight ?? 30,
    defaultItemWidth: options.itemWidth ?? 80,
    overflowButtonWidth: options.overflowButtonWidth ?? 28,
    itemWidths: new Map(Object.entries(options.itemWidths ?? {})),
    observers: new Set<Observer>(),
    live: false,
  };

  const flush = () => {
    // Copied: a callback may disconnect its observer mid-flush.
    for (const observer of Array.from(install.observers)) {
      observer.callback([], observer.instance);
    }
  };

  const handle: ToolbarLayoutHandle = {
    resize(width) {
      install.barWidth = width;
      flush();
    },
    setItemWidth(extensionId, width) {
      install.itemWidths.set(extensionId, width);
      flush();
    },
    setRootHeight(height) {
      install.rootHeight = height;
      flush();
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
 * Internal. Re-pushes a handle whose `restore()` has already run.
 *
 * Only `renderWithToolbar`'s layout-owner effect uses this, so that a
 * StrictMode double-invoked effect (mount → cleanup → mount) ends up with the
 * layout installed rather than restored. The handle keeps its own widths, so a
 * re-install measures exactly as it did before.
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
