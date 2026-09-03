/**
 * The pure half of `/ext/overlays`: what an overlay is, what it costs, and every
 * DOM *reading* helper the surfaces share. [dev-toolbar/ext/overlays]
 *
 * Nothing here writes to the document — host-touching code stays small, in one
 * place, and read-only (the runtime owns the one stylesheet exception).
 */

/* -------------------------------------------------------------------------- */
/* The catalogue                                                               */
/* -------------------------------------------------------------------------- */

/**
 * §3G lists thirteen candidate overlay modes; these four ship because each
 * answers a question the code alone can't, and each has a knowable cost (see
 * `OVERLAY_META[…].cost`). The other nine were left out:
 *
 * - **Re-render flash**, **slow React commits** — not observable from outside
 *   React without hooking `__REACT_DEVTOOLS_GLOBAL_HOOK__` or a `Profiler`;
 *   belongs to whoever owns the host's React tree.
 * - **Component boundaries**, **design-token violations**, **feature
 *   ownership**, **experiment variant** — need per-element metadata only the
 *   app can attach (§3F's `data-source`); once attached, `boxes` is one CSS
 *   rule away from showing it.
 * - **Z-index stacking contexts**, **scroll containers** — both need
 *   `getComputedStyle` on every element on every mutation, the cost profile
 *   §3G warns against.
 * - **Style engine (legacy vs new)** — specific to one app's own migration;
 *   a consumer marks elements and uses `boxes` instead.
 * - **Offline / sync state** — a status signal, not an overlay; belongs in
 *   §3I's debugging controls or `/ext/environment`'s `syncStatus`.
 *
 * Also unimplemented: §3G's *disable overlays before screenshots*. No
 * screenshot facility exists to hook; `disableAll()` is the manual
 * equivalent for any future capture feature to call.
 */
export type OverlayId = "boxes" | "grid" | "inspect" | "focus";

/** Stable order. Every surface — panel, palette, storage — reads this one. */
export const OVERLAY_IDS: readonly OverlayId[] = ["boxes", "grid", "inspect", "focus"];

export interface OverlayMeta {
  id: OverlayId;
  /** Panel row and command label. */
  label: string;
  /** One line, in the panel. */
  summary: string;
  /** Honest cost, shown in the panel rather than buried in a doc comment. */
  cost: string;
  /** True for the one overlay that reaches outside our own layer. */
  touchesHost?: boolean;
}

export const OVERLAY_META: Record<OverlayId, OverlayMeta> = {
  boxes: {
    id: "boxes",
    label: "Layout boxes",
    summary:
      "Outlines every element in the page, so nesting, stray wrappers and collapsed boxes are visible.",
    cost: "One stylesheet, no measurement. Costs a full repaint on toggle and slightly more paint work per frame after that; the only overlay whose cost grows with document size.",
    touchesHost: true,
  },
  grid: {
    id: "grid",
    label: "Column grid",
    summary:
      "A column and baseline grid over the viewport, for checking alignment against the design's own grid.",
    cost: "Free. One gradient-painted element; nothing is measured or observed.",
  },
  inspect: {
    id: "inspect",
    label: "Element inspector",
    summary: "Follows the pointer: box model, size and accessible name of whatever is under it.",
    cost: "One rect and one getComputedStyle on the hovered element per frame, plus one accessible-name resolution per hover until a non-geometry DOM mutation (a document-wide MutationObserver watches for those). One ResizeObserver on the hovered element, diffed so it is not re-attached every frame. Fires when the pointer moves, the page scrolls, the window resizes, the hovered element resizes, or a class/style change happens anywhere in the document.",
  },
  focus: {
    id: "focus",
    label: "Focus order",
    summary:
      "Numbers every tabbable element in tab order and flags the ones with no accessible name.",
    cost: "One narrow querySelectorAll per application DOM-mutation burst (debounced), which is also where accessible names are resolved. A scroll, resize or geometry-mutation frame then costs one getBoundingClientRect per retained element and nothing else. Up to focusLimit ResizeObserver targets (200 by default), or one more than that when the inspector is on too, diffed so elements are not re-observed every frame. Not covered: a sibling growing above a badge when that sibling is not tabbable; <details> opening; font-swap reflow. Capped at 200.",
  },
};

/** Which overlays are on. */
export type OverlayFlags = Record<OverlayId, boolean>;

export const NO_OVERLAYS: OverlayFlags = Object.freeze({
  boxes: false,
  grid: false,
  inspect: false,
  focus: false,
}) as OverlayFlags;

export const countEnabled = (flags: OverlayFlags): number =>
  OVERLAY_IDS.reduce((total, id) => total + (flags[id] ? 1 : 0), 0);

/* -------------------------------------------------------------------------- */
/* Geometry                                                                    */
/* -------------------------------------------------------------------------- */

/** Viewport-space rectangle. Plain data so a snapshot can be compared cheaply. */
export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Edges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const ZERO_EDGES: Edges = { top: 0, right: 0, bottom: 0, left: 0 };

/** What the inspector draws. Built from one element, once per frame. */
export interface HoverTarget {
  rect: RectLike;
  margin: Edges;
  padding: Edges;
  /** `div#main.card.card--wide` */
  description: string;
  /** `320 × 48` */
  size: string;
  /** Resolved accessible name, or `null` when there is none to resolve. */
  name: string | null;
  role: string | null;
  /** True when the element is `position: fixed` or `sticky` — its rect moves. */
  pinned: boolean;
}

/** One badge in the focus-order overlay. */
export interface FocusItem {
  /** Stable within a scan, for React keys. */
  key: string;
  /** 1-based position in tab order. */
  index: number;
  rect: RectLike;
  tag: string;
  /** Accessible name, or `null` — which is the thing the overlay is flagging. */
  name: string | null;
  /** A positive `tabindex`, which reorders the sequence and is worth seeing. */
  tabIndex: number | null;
  /**
   * True when `aria-hidden="true"` though the element is still a Tab stop —
   * surfaced because ARIA state does not change tab order.
   */
  ariaHidden: boolean;
}

export interface OverlaysSnapshot {
  enabled: OverlayFlags;
  activeCount: number;
  /** `null` unless `inspect` is on and the pointer is over host content. */
  hover: HoverTarget | null;
  focusItems: readonly FocusItem[];
  /** True when the scan hit `focusLimit` and stopped. */
  focusTruncated: boolean;
  /** Number of tabbable elements found with no accessible name. */
  unnamedCount: number;
  /** False until `start(api)` has run, and again after it is torn down. */
  ready: boolean;
  /** False while the bar is hidden: nothing is drawn and nothing is observed. */
  active: boolean;
  /**
   * Set when an overlay's own measuring threw. Every overlay is turned off when
   * this happens — a measurement that throws once throws every frame, and an
   * extension drawing over an application has no business retrying at 60 Hz.
   */
  error: string | null;
}

/* -------------------------------------------------------------------------- */
/* Reading the host document — read-only, everywhere                           */
/* -------------------------------------------------------------------------- */

/**
 * Everything focusable by `Tab` in practice. `[tabindex]` is matched and then
 * filtered on the parsed value, since `[tabindex="-1"]` is programmatically
 * focusable but not tabbable.
 */
export const TABBABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "audio[controls]",
  "video[controls]",
  "iframe",
  "[contenteditable]",
  "[tabindex]",
].join(",");

/**
 * True for anything belonging to a dev toolbar — ours or another instance's.
 * Every scan and pointer read goes through this, so overlays measure the
 * application and never the tool itself.
 */
export function isInToolbar(node: Node | null): boolean {
  if (node === null) return false;
  const element = node.nodeType === 1 ? (node as Element) : (node.parentElement as Element | null);
  if (!element || typeof element.closest !== "function") return false;
  return element.closest("[data-dev-toolbar]") !== null;
}

const MAX_CLASSES = 3;

/** `div#main.card.card--wide` — the CSS-ish shorthand a developer reads fastest. */
export function describeElement(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = element.id === "" ? "" : `#${element.id}`;
  // `className` is not a string on SVG elements, hence classList.
  const classes = [...element.classList];
  const shown = classes
    .slice(0, MAX_CLASSES)
    .map((name) => `.${name}`)
    .join("");
  const rest = classes.length > MAX_CLASSES ? `+${classes.length - MAX_CLASSES}` : "";
  return `${tag}${id}${shown}${rest}`;
}

/**
 * `textContent`, minus the parts a screen reader won't read (skips
 * `aria-hidden`/`hidden` subtrees, like `accname` does). Plain `textContent`
 * would read the `×` inside `<button><span aria-hidden="true">×</span></button>`
 * and call the most common unnamed control "named".
 */
function visibleText(element: Element): string | null {
  let text = "";
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        text += child.nodeValue ?? "";
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (el.getAttribute("aria-hidden") === "true") continue;
      if (el.hasAttribute("hidden")) continue;
      walk(el);
    }
  };
  walk(element);
  return trim(text);
}

const NAME_FROM_CONTENT = new Set([
  "a",
  "button",
  "summary",
  "td",
  "th",
  "legend",
  "option",
  "label",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

const trim = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
};

/**
 * A deliberately partial accessible-name computation (the full `accname` algorithm
 * needs the whole tree). Covers the cases that actually produce an unnamed
 * control — icon-only button, `<img>` with no `alt`, an unlinked `<label>` — in
 * spec priority order. Documented as a heuristic in the panel: false positives
 * here would make developers stop trusting the badges.
 */
export function accessibleName(element: Element): string | null {
  const aria = trim(element.getAttribute("aria-label"));
  if (aria !== null) return aria;

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy !== null) {
    const doc = element.ownerDocument;
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => {
        const target = doc?.getElementById(id) ?? null;
        return target === null ? null : visibleText(target);
      })
      .filter((part): part is string => part !== null);
    if (parts.length > 0) return parts.join(" ");
  }

  const tag = element.tagName.toLowerCase();

  if (tag === "img" || tag === "area") {
    // An empty `alt` is a *decision* — the image is decorative — so it counts as
    // named. A missing one is the bug.
    const alt = element.getAttribute("alt");
    if (alt !== null) return trim(alt) ?? "";
  }

  if (tag === "input" || tag === "select" || tag === "textarea") {
    const control = element as HTMLInputElement;
    const type = (control.getAttribute("type") ?? "").toLowerCase();
    if (type === "submit" || type === "button" || type === "reset") {
      const value = trim(control.getAttribute("value"));
      if (value !== null) return value;
    }
    if (type === "image") {
      const alt = trim(control.getAttribute("alt"));
      if (alt !== null) return alt;
    }
    if (control.labels && control.labels.length > 0) {
      const text = trim([...control.labels].map((label) => visibleText(label) ?? "").join(" "));
      if (text !== null) return text;
    }
    const wrapping = element.closest("label");
    if (wrapping) {
      const text = visibleText(wrapping);
      if (text !== null) return text;
    }
  }

  if (NAME_FROM_CONTENT.has(tag) || element.getAttribute("role") !== null) {
    const text = visibleText(element);
    if (text !== null) return text;
    // An icon-only control is the interesting case: no text of its own, but a
    // titled or labelled descendant still names it.
    const inner = element.querySelector("[aria-label],[title],img[alt]");
    if (inner) {
      const nested =
        trim(inner.getAttribute("aria-label")) ??
        trim(inner.getAttribute("title")) ??
        trim(inner.getAttribute("alt"));
      if (nested !== null) return nested;
    }
  }

  return trim(element.getAttribute("title"));
}

/** Explicit `tabindex`, or `null` when there is none or it is not a number. */
export function tabIndexOf(element: Element): number | null {
  const raw = element.getAttribute("tabindex");
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export const toRect = (rect: DOMRect): RectLike => ({
  x: Math.round(rect.left * 100) / 100,
  y: Math.round(rect.top * 100) / 100,
  width: Math.round(rect.width * 100) / 100,
  height: Math.round(rect.height * 100) / 100,
});

const px = (value: string | undefined): number => {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
};

/** `margin` / `padding` edges out of one computed style. Never throws. */
export function edgesOf(style: CSSStyleDeclaration | null, which: "margin" | "padding"): Edges {
  if (style === null) return ZERO_EDGES;
  return {
    top: px(style.getPropertyValue(`${which}-top`)),
    right: px(style.getPropertyValue(`${which}-right`)),
    bottom: px(style.getPropertyValue(`${which}-bottom`)),
    left: px(style.getPropertyValue(`${which}-left`)),
  };
}

/**
 * True when this element is worth a badge: it has a box and is at least
 * partly on screen. `width === 0 && height === 0` is a cheap `display: none`
 * check that avoids a `getComputedStyle` call per element, keeping the focus
 * scan linear in tabbables rather than style resolutions.
 */
export function isPaintedRect(
  rect: RectLike,
  viewport: { width: number; height: number },
): boolean {
  if (rect.width <= 0 && rect.height <= 0) return false;
  if (rect.y > viewport.height || rect.y + rect.height < 0) return false;
  if (rect.x > viewport.width || rect.x + rect.width < 0) return false;
  return true;
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Reads the persisted flag map. Fail-closed: unparseable JSON, a non-object,
 * an unknown id, or a non-boolean value all mean *off* — a corrupted blob
 * must never leave the page covered in outlines with no way back.
 */
export function parseFlags(raw: string | null): OverlayFlags {
  const flags: OverlayFlags = { ...NO_OVERLAYS };
  if (raw === null) return flags;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return flags;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return flags;
  }
  const bag = parsed as Record<string, unknown>;
  for (const id of OVERLAY_IDS) {
    if (bag[id] === true) flags[id] = true;
  }
  return flags;
}

export const serializeFlags = (flags: OverlayFlags): string =>
  JSON.stringify(Object.fromEntries(OVERLAY_IDS.map((id) => [id, flags[id] === true])));

/* -------------------------------------------------------------------------- */
/* Snapshot comparison                                                         */
/* -------------------------------------------------------------------------- */

const sameRect = (a: RectLike, b: RectLike): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

const sameEdges = (a: Edges, b: Edges): boolean =>
  a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;

/**
 * Every field the inspector draws from, not just the ones identifying the
 * element. Margin/padding must be compared too: under `box-sizing: border-box`
 * a hover state can change padding without moving the border rect, so
 * comparing `rect` alone left stale padding/margin boxes drawn until the
 * pointer moved to another element.
 */
const sameHover = (a: HoverTarget | null, b: HoverTarget | null): boolean => {
  if (a === null || b === null) return a === b;
  return (
    a.description === b.description &&
    a.size === b.size &&
    a.name === b.name &&
    a.role === b.role &&
    a.pinned === b.pinned &&
    sameRect(a.rect, b.rect) &&
    sameEdges(a.margin, b.margin) &&
    sameEdges(a.padding, b.padding)
  );
};

/**
 * The `equals` the store uses. Load-bearing for cost: without it, every
 * pointer-move frame would re-render the overlay tree even when the pointer
 * stayed inside the same element and nothing drawn changed.
 */
export function sameSnapshot(a: OverlaysSnapshot, b: OverlaysSnapshot): boolean {
  if (a === b) return true;
  if (a.ready !== b.ready || a.active !== b.active) return false;
  if (a.error !== b.error) return false;
  if (a.activeCount !== b.activeCount) return false;
  for (const id of OVERLAY_IDS) {
    if (a.enabled[id] !== b.enabled[id]) return false;
  }
  if (!sameHover(a.hover, b.hover)) return false;
  if (a.focusTruncated !== b.focusTruncated) return false;
  if (a.unnamedCount !== b.unnamedCount) return false;
  if (a.focusItems.length !== b.focusItems.length) return false;
  for (let index = 0; index < a.focusItems.length; index += 1) {
    const left = a.focusItems[index] as FocusItem;
    const right = b.focusItems[index] as FocusItem;
    if (
      left.key !== right.key ||
      left.name !== right.name ||
      left.ariaHidden !== right.ariaHidden
    ) {
      return false;
    }
    if (!sameRect(left.rect, right.rect)) return false;
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Grid                                                                        */
/* -------------------------------------------------------------------------- */

/** The column grid's shape. Consumer-supplied; there is no sensible guess. */
export interface GridSettings {
  /** Number of columns. Default `12`. */
  columns: number;
  /** Gutter between columns, in px. Default `24`. */
  gutter: number;
  /** Grid width, in px, centred in the viewport. Default `1200`. */
  maxWidth: number;
  /** Baseline row height in px. `0` draws no horizontal lines. Default `8`. */
  baseline: number;
}

export const DEFAULT_GRID: GridSettings = {
  columns: 12,
  gutter: 24,
  maxWidth: 1200,
  baseline: 8,
};

/** Clamped so a hand-typed `columns: 0` cannot produce a division by zero. */
export function normalizeGrid(input?: Partial<GridSettings>): GridSettings {
  const grid = { ...DEFAULT_GRID, ...input };
  const columns = Number.isFinite(grid.columns) ? grid.columns : DEFAULT_GRID.columns;
  const gutter = Number.isFinite(grid.gutter) ? grid.gutter : DEFAULT_GRID.gutter;
  const maxWidth = Number.isFinite(grid.maxWidth) ? grid.maxWidth : DEFAULT_GRID.maxWidth;
  const baseline = Number.isFinite(grid.baseline) ? grid.baseline : DEFAULT_GRID.baseline;
  return {
    columns: Math.max(1, Math.min(48, Math.round(columns))),
    gutter: Math.max(0, Math.min(200, gutter)),
    maxWidth: Math.max(120, Math.min(6000, maxWidth)),
    baseline: Math.max(0, Math.min(200, baseline)),
  };
}
