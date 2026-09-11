/**
 * A prototype-patching layout fixture, for testing the DOM adapter itself.
 *
 * `src/testing/layout.ts` no longer patches `HTMLElement.prototype` — it
 * registers a `Measurer` on core's slot instead, so jsdom's uniform 0x0 never
 * reaches it. That leaves `domMeasurer` itself untested against real DOM
 * reads, which is what this repo-internal fixture is for: `src/core/__tests__/
 * measurer.test.ts` uses it to prove `domMeasurer` reaches `clientWidth`,
 * `offsetWidth`, `getComputedStyle` and `getBoundingClientRect()`.
 *
 * Deliberately simpler than `src/testing/layout.ts`: one install at a time, no
 * `ResizeObserver`, no measurer registration.
 */

export interface DomLayoutOptions {
  /** Width reported for `[data-dtb-part="bar"]` and `"root"`. Default `800`. */
  barWidth?: number;
  /** Width reported for an item without an explicit entry. Default `80`. */
  itemWidth?: number;
  /** Per-extension-id item widths, keyed by `data-dtb-ext-id`. */
  itemWidths?: Record<string, number>;
  /** Width reported for `[data-dtb-part="overflow-button"]`. Default `28`. */
  overflowButtonWidth?: number;
  /** Padding reported on each horizontal side. Omitted leaves computed styles alone. */
  paddingX?: number;
  /** Gap reported between items. Omitted leaves computed styles alone. */
  gap?: number;
  /** Height reported by the root's `getBoundingClientRect()`. Default `30`. */
  rootHeight?: number;
}

export interface DomLayoutHandle {
  /** Changes the reported bar width. */
  resize(width: number): void;
  /** Overrides one item's reported width. */
  setItemWidth(extensionId: string, width: number): void;
  /** Puts every patched read back. Idempotent. */
  restore(): void;
}

interface State {
  barWidth: number;
  rootHeight: number;
  defaultItemWidth: number;
  overflowButtonWidth: number;
  itemWidths: Map<string, number>;
  paddingX: number | undefined;
  gap: number | undefined;
}

let live: State | undefined;

const widthOf = (element: Element): number => {
  if (!live) return 0;
  const part = element.getAttribute("data-dtb-part");
  if (part === "bar" || part === "root") return live.barWidth;
  if (part === "overflow-button") return live.overflowButtonWidth;
  const id = element.getAttribute("data-dtb-ext-id");
  if (part === "item" && id) return live.itemWidths.get(id) ?? live.defaultItemWidth;
  return 0;
};

/**
 * Patches the DOM reads `domMeasurer` performs, for one install.
 *
 * Always pair with `restore()` — the patches are process-wide, so a leaked
 * install measures the rest of the file.
 */
export function patchDomLayout(options: DomLayoutOptions = {}): DomLayoutHandle {
  const state: State = {
    barWidth: options.barWidth ?? 800,
    rootHeight: options.rootHeight ?? 30,
    defaultItemWidth: options.itemWidth ?? 80,
    overflowButtonWidth: options.overflowButtonWidth ?? 28,
    itemWidths: new Map(Object.entries(options.itemWidths ?? {})),
    paddingX: options.paddingX,
    gap: options.gap,
  };

  const proto = HTMLElement.prototype as HTMLElement & Record<string, unknown>;
  const previous = {
    offsetWidth: Object.getOwnPropertyDescriptor(proto, "offsetWidth"),
    clientWidth: Object.getOwnPropertyDescriptor(proto, "clientWidth"),
    rect: proto.getBoundingClientRect,
    computedStyle: globalThis.getComputedStyle,
  };

  live = state;

  for (const name of ["offsetWidth", "clientWidth"] as const) {
    Object.defineProperty(proto, name, {
      configurable: true,
      get(this: HTMLElement) {
        return widthOf(this);
      },
    });
  }

  proto.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement): DOMRect {
    if (!live || this.dataset["dtbPart"] !== "root") return previous.rect.call(this);
    return new DOMRect(0, 0, widthOf(this), live.rootHeight);
  };

  globalThis.getComputedStyle = (element, pseudo) => {
    const style = previous.computedStyle.call(globalThis, element, pseudo);
    if (!live || !element.hasAttribute("data-dtb-part")) return style;
    if (live.paddingX === undefined && live.gap === undefined) return style;
    return new Proxy(style, {
      get(target, property, receiver) {
        if (
          live?.paddingX !== undefined &&
          (property === "paddingLeft" || property === "paddingRight")
        ) {
          return `${live.paddingX}px`;
        }
        if (live?.gap !== undefined && (property === "columnGap" || property === "gap")) {
          return `${live.gap}px`;
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };

  return {
    resize(width) {
      state.barWidth = width;
    },
    setItemWidth(extensionId, width) {
      state.itemWidths.set(extensionId, width);
    },
    restore() {
      if (live !== state) return;
      live = undefined;
      globalThis.getComputedStyle = previous.computedStyle;
      proto.getBoundingClientRect = previous.rect;
      for (const [name, descriptor] of [
        ["offsetWidth", previous.offsetWidth],
        ["clientWidth", previous.clientWidth],
      ] as const) {
        if (descriptor) {
          Object.defineProperty(proto, name, descriptor);
        } else {
          delete proto[name];
        }
      }
    },
  };
}
