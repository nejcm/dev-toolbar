/**
 * jsdom reports every element as 0×0 and ships no `ResizeObserver`, so the
 * overflow collapse can never trigger there on its own. This installs a fake
 * layout the bar can measure, plus a `ResizeObserver` whose callbacks fire when
 * you call `resize()`.
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
  /** Fires every observer without changing anything. */
  flush(): void;
  /** Restores the real prototypes and the previous `ResizeObserver`. */
  restore(): void;
}

type Observer = { callback: ResizeObserverCallback; instance: ResizeObserver };

/**
 * Installs the fake layout. Always pair with `restore()` — an `afterEach` is
 * the usual home. `renderWithToolbar({ layout: … })` does this for you.
 */
export function installToolbarLayout(
  options: InstallToolbarLayoutOptions = {},
): ToolbarLayoutHandle {
  if (typeof HTMLElement === "undefined") {
    throw new Error("[dev-toolbar/testing] installToolbarLayout() needs a DOM environment.");
  }

  let barWidth = options.barWidth ?? 800;
  let rootHeight = options.rootHeight ?? 30;
  const defaultItemWidth = options.itemWidth ?? 80;
  const overflowButtonWidth = options.overflowButtonWidth ?? 28;
  const itemWidths = new Map(Object.entries(options.itemWidths ?? {}));

  const observers = new Set<Observer>();

  const previousResizeObserver = (globalThis as { ResizeObserver?: typeof ResizeObserver })
    .ResizeObserver;

  class FakeResizeObserver implements ResizeObserver {
    private readonly entry: Observer;
    constructor(callback: ResizeObserverCallback) {
      this.entry = { callback, instance: this };
    }
    observe(): void {
      observers.add(this.entry);
    }
    unobserve(): void {
      observers.delete(this.entry);
    }
    disconnect(): void {
      observers.delete(this.entry);
    }
  }

  (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
    FakeResizeObserver as unknown as typeof ResizeObserver;

  const proto = HTMLElement.prototype;
  const previousOffsetWidth = Object.getOwnPropertyDescriptor(proto, "offsetWidth");
  const previousClientWidth = Object.getOwnPropertyDescriptor(proto, "clientWidth");
  const previousRect = proto.getBoundingClientRect;

  const widthOf = (element: HTMLElement): number => {
    const part = element.dataset["dtbPart"];
    if (part === "bar" || part === "root") return barWidth;
    if (part === "overflow-button") return overflowButtonWidth;
    const id = element.dataset["dtbExtId"];
    if (part === "item" && id) {
      return itemWidths.get(id) ?? defaultItemWidth;
    }
    return 0;
  };

  Object.defineProperty(proto, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return widthOf(this);
    },
  });
  Object.defineProperty(proto, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return widthOf(this);
    },
  });

  proto.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement): DOMRect {
    if (this.dataset["dtbPart"] !== "root") {
      return previousRect.call(this);
    }
    const width = barWidth;
    const height = rootHeight;
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

  const flush = () => {
    // Copied: a callback may disconnect its observer mid-flush.
    for (const observer of Array.from(observers)) {
      observer.callback([], observer.instance);
    }
  };

  return {
    resize(width) {
      barWidth = width;
      flush();
    },
    setItemWidth(extensionId, width) {
      itemWidths.set(extensionId, width);
      flush();
    },
    setRootHeight(height) {
      rootHeight = height;
      flush();
    },
    flush,
    restore() {
      observers.clear();
      if (previousResizeObserver === undefined) {
        delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
      } else {
        (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
          previousResizeObserver;
      }
      if (previousOffsetWidth) {
        Object.defineProperty(proto, "offsetWidth", previousOffsetWidth);
      } else {
        delete (proto as unknown as Record<string, unknown>)["offsetWidth"];
      }
      if (previousClientWidth) {
        Object.defineProperty(proto, "clientWidth", previousClientWidth);
      } else {
        delete (proto as unknown as Record<string, unknown>)["clientWidth"];
      }
      proto.getBoundingClientRect = previousRect;
    },
  };
}
