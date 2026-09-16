/**
 * Everything `/ext/overlays` owns that is not React. [dev-toolbar/ext/overlays]
 *
 * Built by `overlays()`, not by `start(api)`: slot functions run during the
 * toolbar's first render (before any effect fires), so the store the chip
 * reads must exist by the time the factory returns.
 *
 * First extension that draws over the host application:
 * - Never takes a pointer event it doesn't own — the surface is
 *   `pointer-events: none` throughout; the inspector only observes via a
 *   passive, capturing `pointermove` listener + `elementFromPoint`.
 * - Leaves nothing behind — everything drawn is React inside `overlay`.
 *   Sole exception: `boxes`' stylesheet in `document.head`
 *   (`setHostOutlines`), torn down alongside the listeners.
 * - Observes nothing while the bar is hidden — core never pauses anybody
 *   (§2), so this decides "hidden" for itself (§13.2).
 * - Nothing here may throw — measurement runs inside a
 *   `requestAnimationFrame`/`MutationObserver` where nobody upstream could
 *   catch it, so a throw switches every overlay off instead of recurring.
 */
import {
  STYLE_ATTRIBUTE,
  createThrottledStore,
  describeError,
  ensureStyleSheet,
} from "../../runtime";
import { readPreferenceIfReadable, writePreference } from "@nejcm/dev-toolbar/kit";
import type { Preference } from "@nejcm/dev-toolbar/kit";
import type { ThrottledStore } from "../../runtime";
import type { ExtensionRuntimeApi, ToolbarStorage } from "../../core/contract";
import {
  NO_OVERLAYS,
  OVERLAY_IDS,
  TABBABLE_SELECTOR,
  accessibleName,
  countEnabled,
  describeElement,
  edgesOf,
  isInToolbar,
  isPaintedRect,
  normalizeGrid,
  parseFlags,
  sameSnapshot,
  serializeFlags,
  tabIndexOf,
  toRect,
} from "./types";
import type {
  FocusItem,
  GridSettings,
  HoverTarget,
  OverlayFlags,
  OverlayId,
  OverlaysSnapshot,
} from "./types";

/** Storage key, inside the extension's own scope, holding the flag map. */
export const ENABLED_KEY = "enabled";

/** `data-dev-toolbar-styles` entry for the host-outline sheet. */
export const BOXES_STYLE_ENTRY = "ext-overlays-boxes";

/** Most badges the focus overlay will draw before it stops and says so. */
export const DEFAULT_FOCUS_LIMIT = 200;

/**
 * The one stylesheet this extension puts in front of the application.
 *
 * Deliberately not inside `@layer dev-toolbar` — unlike every other
 * stylesheet here, this one must be visible over the app's own styles while
 * switched on. Still not `!important`, so a higher-specificity app rule can
 * beat it; the panel says so rather than hiding the limitation.
 *
 * `outline`, not `border`/`box-shadow`, since it paints outside the box and
 * never reflows the page. The `:not()` pair keeps it off every dev toolbar on
 * the page — ours and anybody else's.
 */
export const BOXES_CSS = String.raw`html body :not([data-dev-toolbar]):not([data-dev-toolbar] *) {
  outline: 1px solid rgba(88, 166, 255, 0.42);
  outline-offset: -1px;
}
`;

export interface OverlaysRuntimeOptions {
  /** Overlays on at first mount, before anything is persisted. Default: none. */
  defaults?: Partial<OverlayFlags>;
  /** Column-grid shape. See `GridSettings`. */
  grid?: Partial<GridSettings>;
  /** Cap on focus-order badges. Default `200`. */
  focusLimit?: number;
  /** Coalescing window for DOM mutations, in ms. Default `250`. */
  mutationDebounceMs?: number;
  /** Persist the toggles through `api.storage`. Default `true`. */
  persist?: boolean;
  /**
   * Hold the layout-boxes insert until `setStyleNonce()` has been called once,
   * so first-writer-wins cannot make an un-nonced sheet permanent. Default
   * `false`: a headless runtime with no React surface to learn a nonce from
   * wants boxes to insert immediately. `overlays()` sets it, since the
   * overlay surface is what learns the slot nonce.
   */
  deferOutlinesUntilStyleNonce?: boolean;
}

export interface OverlaysRuntime {
  readonly store: ThrottledStore<OverlaysSnapshot>;
  readonly grid: GridSettings;
  /** The flag map, as a copy. */
  enabled(): OverlayFlags;
  isOn(id: OverlayId): boolean;
  set(id: OverlayId, on: boolean): void;
  toggle(id: OverlayId): void;
  /** Turns everything off. The escape hatch the panel and a command both use. */
  disableAll(): void;
  /**
   * CSP nonce for the layout-boxes sheet. Only matters ahead of the first
   * insert: the sheet is first-writer-wins. `undefined` means "no nonce,
   * insert un-nonced". Under `deferOutlinesUntilStyleNonce` the insert waits
   * for the first call.
   */
  setStyleNonce(nonce?: string): void;
  start(api: ExtensionRuntimeApi): () => void;
  /** Which layers are on, plus the scan's own health. Measures nothing. */
  diagnostics(): unknown;
}

/** Attribute holding the number of live holders of the host-outline sheet. */
export const BOXES_REFS_ATTRIBUTE = "data-dtb-refs";

/**
 * Acquires or releases the host-outline stylesheet. Reference-counted via
 * `data-dtb-refs` on the element (DOM-state, not module-state — two toolbars,
 * or two bundled copies of this extension, are separate closures sharing one
 * `document.head`). Without the count, one instance unmounting would remove
 * outlines still owned by another instance.
 */
export function setHostOutlines(on: boolean, doc?: Document, nonce?: string): void {
  const target = doc ?? (typeof document === "undefined" ? null : document);
  if (!target?.head) return;

  const sheets = [
    ...target.head.querySelectorAll<HTMLElement>(
      `style[${STYLE_ATTRIBUTE}="${BOXES_STYLE_ENTRY}"]`,
    ),
  ];
  const readRefs = (node: HTMLElement): number => {
    const parsed = Number.parseInt(node.getAttribute(BOXES_REFS_ATTRIBUTE) ?? "", 10);
    // No count = somebody else's sheet (or an older version) — held once, not free to remove.
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  };

  if (on) {
    const sheet = ensureStyleSheet(BOXES_STYLE_ENTRY, BOXES_CSS, target, nonce);
    if (!sheet) return;
    const existed = sheets.includes(sheet as unknown as HTMLElement);
    sheet.setAttribute(
      BOXES_REFS_ATTRIBUTE,
      String(existed ? readRefs(sheet as unknown as HTMLElement) + 1 : 1),
    );
    return;
  }

  for (const node of sheets) {
    const next = readRefs(node) - 1;
    if (next <= 0) node.remove();
    else node.setAttribute(BOXES_REFS_ATTRIBUTE, String(next));
  }
}

/** Elements for which the `disabled` *attribute* actually removes tabbability. */
const DISABLEABLE = new Set([
  "BUTTON",
  "INPUT",
  "SELECT",
  "TEXTAREA",
  "FIELDSET",
  "OPTGROUP",
  "OPTION",
]);

/**
 * True when the browser will skip this element in the tab sequence.
 *
 * `aria-disabled` is deliberately not here — it's a promise to assistive tech,
 * not a change to focus behaviour. A disabled `fieldset` disables its
 * contained controls except those inside its first `<legend>`.
 */
const isDisabled = (element: Element): boolean => {
  if (DISABLEABLE.has(element.tagName) && element.hasAttribute("disabled")) {
    return true;
  }
  const fieldset = element.closest("fieldset[disabled]");
  if (fieldset === null) return false;
  const legend = fieldset.querySelector(":scope > legend");
  return legend === null || !legend.contains(element);
};

/** One tabbable element, with everything about it that a frame must not re-derive. */
interface Scanned {
  element: Element;
  name: string | null;
  tabIndex: number | null;
}

/** Positive `tabindex` jumps the queue; everything else keeps document order. */
function inTabOrder(elements: Element[]): Element[] {
  const positive: { element: Element; tabIndex: number; at: number }[] = [];
  const natural: Element[] = [];
  elements.forEach((element, at) => {
    const tabIndex = tabIndexOf(element);
    if (tabIndex !== null && tabIndex > 0) {
      positive.push({ element, tabIndex, at });
    } else {
      natural.push(element);
    }
  });
  positive.sort((a, b) => a.tabIndex - b.tabIndex || a.at - b.at);
  return [...positive.map((entry) => entry.element), ...natural];
}

export function createOverlaysRuntime(options: OverlaysRuntimeOptions = {}): OverlaysRuntime {
  const {
    defaults,
    grid: gridInput,
    focusLimit = DEFAULT_FOCUS_LIMIT,
    mutationDebounceMs = 250,
    persist = true,
    deferOutlinesUntilStyleNonce = false,
  } = options;

  const grid = normalizeGrid(gridInput);
  const rawLimit = Number.isFinite(focusLimit) ? focusLimit : DEFAULT_FOCUS_LIMIT;
  const limit = Math.max(1, Math.min(1000, Math.round(rawLimit)));

  /** What a mount starts from when nothing is stored: the consumer's `defaults`. */
  const initialFlags: OverlayFlags = { ...NO_OVERLAYS, ...defaults };
  let flags: OverlayFlags = { ...initialFlags };
  let storage: ToolbarStorage | null = null;
  /**
   * The toggle map as this extension serialises it, stored byte-for-byte.
   *
   * `fallback: null` is the kit's "nothing chosen yet" (the shape metrics' `tab`
   * uses), and it is deliberate: the fallback is *not* the serialised
   * `defaults`. `writePreference` removes the key when a value equals the
   * fallback, and `serializeFlags` never yields `null`, so every write here
   * persists — all-off included. The map records that the developer chose,
   * not merely what they chose: with no `defaults` configured, all-off *is*
   * the default, and had that removed the key, a consumer later adding
   * `defaults: { grid: true }` would revive the grid for someone who had
   * explicitly turned everything off. Nothing stored reads back as `null`,
   * and `start()` maps that to `initialFlags`.
   */
  const enabledPreference: Preference<string | null> = {
    key: ENABLED_KEY,
    encoding: "string",
    fallback: null,
    isValue: (value): value is string => typeof value === "string",
  };
  let ready = false;
  let active = false;
  let error: string | null = null;

  /* ------------------------------------------------------------------ */
  /* Measured state                                                       */
  /* ------------------------------------------------------------------ */

  let hover: HoverTarget | null = null;
  /** Retained for geometry observation, not just as a description of `hover`. */
  let hoverElement: Element | null = null;
  let hoverNameElement: Element | null = null;
  let hoverName: string | null = null;
  let hoverNameStale = true;
  let focusItems: readonly FocusItem[] = [];
  let focusTruncated = false;
  let unnamedCount = 0;

  /**
   * The elements the focus overlay is drawing over. Strong references to host
   * nodes, so a removed node stays reachable until the next measurement drops
   * anything with `isConnected === false` — a one-frame-wide retention window.
   * Name and tabindex are resolved at scan time, so a scroll frame costs one
   * rect per element and nothing else.
   */
  let focusElements: Scanned[] = [];

  let pointerX = 0;
  let pointerY = 0;
  let pointerSeen = false;
  let rescanQueued = false;
  /**
   * Whether the focus overlay was drawing after the previous `sync()`. Scan
   * is queued on the false -> true edge here, not on MutationObserver
   * creation, since that observer is shared with `inspect` — enabling focus
   * while inspect is already on creates no observer of its own.
   */
  let focusDrawing = false;

  const snapshot = (): OverlaysSnapshot => ({
    enabled: { ...flags },
    activeCount: countEnabled(flags),
    hover,
    focusItems,
    focusTruncated,
    unnamedCount,
    ready,
    active,
    error,
  });

  const store = createThrottledStore<OverlaysSnapshot>(snapshot(), {
    // 0 because coalescing on a timer would lag the cursor; `equals` below is
    // what saves the re-renders instead.
    intervalMs: 0,
    equals: sameSnapshot,
  });

  const publish = () => {
    store.set(snapshot());
  };

  /* ------------------------------------------------------------------ */
  /* Failure                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * A throw inside a frame callback or `MutationObserver` can't be caught
   * upstream and would recur every frame, so the only honest response is to
   * stop drawing.
   */
  const fail = (where: string, thrown: unknown): void => {
    // `error` reaches `diagnostics()`, which leaves the page: mask before building this sentence, never after.
    const { message } = describeError(thrown);
    error = `${where} failed: ${message} — every overlay was switched off.`;
    // eslint-disable-next-line no-console
    console.error(
      `[dev-toolbar/ext/overlays] ${where} threw. Switching every overlay off ` +
        "rather than retrying it every frame.",
      thrown,
    );
    // Not persisted: a transient failure shouldn't cost the developer their
    // saved toggles — storage still has their picks, restored on reload.
    flags = { ...NO_OVERLAYS };
    hover = null;
    focusItems = [];
    focusElements = [];
    sync();
    publish();
    store.flush();
  };

  const guard = (where: string, work: () => void): void => {
    try {
      work();
    } catch (thrown) {
      try {
        fail(where, thrown);
      } catch {
        /* the failure path itself must not throw out of a frame callback */
      }
    }
  };

  /* ------------------------------------------------------------------ */
  /* Measuring                                                            */
  /* ------------------------------------------------------------------ */

  const viewport = () => ({
    width: typeof window === "undefined" ? 0 : window.innerWidth,
    height: typeof window === "undefined" ? 0 : window.innerHeight,
  });

  const resolveHoverName = (element: Element): string | null => {
    // Cache is only sound while a MutationObserver is attached; without one, re-walk every frame.
    if (observer === null) return accessibleName(element);
    if (hoverNameElement !== element || hoverNameStale) {
      hoverNameElement = element;
      hoverName = accessibleName(element);
      hoverNameStale = false;
    }
    return hoverName;
  };

  const buildHover = (element: Element): HoverTarget => {
    const rect = toRect(element.getBoundingClientRect());
    const style =
      typeof window === "undefined" || !window.getComputedStyle
        ? null
        : window.getComputedStyle(element);
    const position = style?.getPropertyValue("position") ?? "";
    return {
      rect,
      margin: edgesOf(style, "margin"),
      padding: edgesOf(style, "padding"),
      description: describeElement(element),
      size: `${Math.round(rect.width)} × ${Math.round(rect.height)}`,
      name: resolveHoverName(element),
      role: element.getAttribute("role"),
      pinned: position === "fixed" || position === "sticky",
    };
  };

  /** Resolves what the pointer is over. Never returns anything in a toolbar. */
  const readPointer = (): void => {
    const previous = hoverElement;
    if (
      !pointerSeen ||
      typeof document === "undefined" ||
      // Absent in jsdom and other layout-less environments — not a thrown error.
      typeof document.elementFromPoint !== "function"
    ) {
      hover = null;
      hoverElement = null;
      if (previous !== null) syncObservedGeometry();
      return;
    }
    const found = document.elementFromPoint(pointerX, pointerY);
    // Can return the toolbar itself when the pointer is over the bar/panel/palette.
    if (!found || isInToolbar(found)) {
      hover = null;
      hoverElement = null;
      if (previous !== null) syncObservedGeometry();
      return;
    }
    hoverElement = found;
    hover = buildHover(found);
    if (hoverElement !== previous) syncObservedGeometry();
  };

  /** Full re-query. Only ever runs on enable and on a debounced mutation burst. */
  const scanFocusables = (): void => {
    if (typeof document === "undefined") {
      focusElements = [];
      return;
    }
    const found: Element[] = [];
    focusTruncated = false;
    for (const element of document.querySelectorAll(TABBABLE_SELECTOR)) {
      if (isInToolbar(element)) continue;
      const tabIndex = tabIndexOf(element);
      if (tabIndex !== null && tabIndex < 0) continue;
      if (isDisabled(element)) continue;
      if (element.closest("[inert]") !== null) continue;
      if (element.getAttribute("contenteditable") === "false") continue;
      // type="hidden" passes every selector above but has no box; without this
      // it consumed a badge-limit slot only to be dropped at measure time.
      if (
        element.tagName === "INPUT" &&
        (element.getAttribute("type") ?? "").toLowerCase() === "hidden"
      ) {
        continue;
      }
      found.push(element);
      if (found.length >= limit) {
        focusTruncated = true;
        break;
      }
    }
    // Resolved here, once per scan, not per frame — too costly to repeat for
    // up to 200 elements every scroll frame. Cache safety depends on every
    // mutation that can change a name being observed below: a name written
    // into an existing Text node is a `characterData` record, not `childList`
    // — missing that once left an emptied button badge saying "named"
    // indefinitely. If `accessibleName` grows a branch reading something new,
    // add its mutation type below too.
    focusElements = inTabOrder(found).map((element) => ({
      element,
      name: accessibleName(element),
      tabIndex: tabIndexOf(element),
    }));
    syncObservedGeometry();
  };

  /**
   * Re-measures retained elements on every scroll/resize frame — no re-query.
   * Numbering counts every element with a box regardless of on-screen
   * visibility, so scrolling moves badges without renumbering them.
   */
  const measureFocus = (): void => {
    const bounds = viewport();
    const items: FocusItem[] = [];
    const alive: Scanned[] = [];
    let unnamed = 0;
    let index = 0;
    for (const scanned of focusElements) {
      const element = scanned.element;
      if (!element.isConnected) continue;
      alive.push(scanned);
      const rect = toRect(element.getBoundingClientRect());
      // 0×0 is display:none in every practical case, at no style-resolution cost.
      if (rect.width <= 0 && rect.height <= 0) continue;
      index += 1;
      if (scanned.name === null) unnamed += 1;
      if (!isPaintedRect(rect, bounds)) continue;
      items.push({
        key: `${index}:${element.tagName}`,
        index,
        rect,
        tag: element.tagName.toLowerCase(),
        name: scanned.name,
        tabIndex: scanned.tabIndex,
        ariaHidden: element.getAttribute("aria-hidden") === "true",
      });
    }
    focusElements = alive;
    focusItems = items;
    unnamedCount = unnamed;
    syncObservedGeometry();
  };

  /* ------------------------------------------------------------------ */
  /* Frame loop                                                           */
  /* ------------------------------------------------------------------ */

  let frame: number | null = null;

  const runFrame = () => {
    frame = null;
    guard("a measurement", () => {
      if (!active) return;
      if (flags.inspect) readPointer();
      if (flags.focus) {
        if (rescanQueued) {
          rescanQueued = false;
          scanFocusables();
        }
        measureFocus();
      }
      publish();
    });
  };

  const schedule = () => {
    if (frame !== null || typeof requestAnimationFrame !== "function") {
      // No rAF (jsdom without one, SSR): measure synchronously rather than silently drawing nothing.
      if (frame === null) runFrame();
      return;
    }
    frame = requestAnimationFrame(runFrame);
  };

  const cancelFrame = () => {
    if (frame !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(frame);
    }
    frame = null;
  };

  /* ------------------------------------------------------------------ */
  /* Listeners — attached only for the overlays that need them            */
  /* ------------------------------------------------------------------ */

  const onPointerMove = (event: PointerEvent | MouseEvent) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    pointerSeen = true;
    schedule();
  };

  const onPointerLeave = () => {
    pointerSeen = false;
    schedule();
  };

  const onGeometry = () => {
    schedule();
  };

  let observer: MutationObserver | null = null;
  let mutationTimer: ReturnType<typeof setTimeout> | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let geometryObserverOn = false;
  const observedTargets = new Set<Element>();

  const GEOMETRY_ATTRS = new Set(["class", "style"]);

  const onMutation = (records: MutationRecord[]) => {
    // Skip records we caused ourselves — the surface is portaled into `body`,
    // so drawing/removing badges as the page scrolls is itself a mutation.
    if (records.length > 0 && records.every((record) => isInToolbar(record.target))) {
      return;
    }
    let scheduleGeometry = false;
    let needsRescan = false;
    for (const record of records) {
      if (record.type === "attributes") {
        const attr = record.attributeName;
        if (attr !== null && GEOMETRY_ATTRS.has(attr)) {
          scheduleGeometry = true;
        } else {
          needsRescan = true;
          hoverNameStale = true;
        }
      } else {
        needsRescan = true;
        hoverNameStale = true;
      }
    }
    if (scheduleGeometry) schedule();
    if (!needsRescan) return;
    // Debounced, not per-record: a React commit is a burst of records, and
    // re-querying on each one would make this overlay the perf problem it was
    // installed to find.
    if (mutationTimer !== null) return;
    mutationTimer = setTimeout(() => {
      mutationTimer = null;
      rescanQueued = true;
      schedule();
    }, mutationDebounceMs);
  };

  const syncObservedGeometry = (): void => {
    if (resizeObserver === null) return;
    const wanted = new Set<Element>();
    if (flags.focus) {
      for (const { element } of focusElements) {
        if (element.isConnected) wanted.add(element);
      }
    }
    if (flags.inspect && hoverElement?.isConnected) {
      wanted.add(hoverElement);
    }
    for (const element of observedTargets) {
      if (!wanted.has(element)) {
        resizeObserver.unobserve(element);
        observedTargets.delete(element);
      }
    }
    for (const element of wanted) {
      if (!observedTargets.has(element)) {
        resizeObserver.observe(element, { box: "border-box" });
        observedTargets.add(element);
      }
    }
  };

  const onObservedResize = () => {
    schedule();
  };

  let pointerAttached = false;
  let geometryAttached = false;
  let outlinesOn = false;

  const setPointerListeners = (on: boolean) => {
    if (on === pointerAttached || typeof window === "undefined") return;
    pointerAttached = on;
    const method = on ? "addEventListener" : "removeEventListener";
    // Capture so a host stopping propagation can't blind the inspector; passive so it can't delay a scroll.
    window[method]("pointermove", onPointerMove as EventListener, {
      capture: true,
      passive: true,
    });
    window[method]("pointerdown", onPointerMove as EventListener, {
      capture: true,
      passive: true,
    });
    if (typeof document !== "undefined") {
      document[method]("pointerleave", onPointerLeave as EventListener, {
        capture: true,
        passive: true,
      });
    }
    if (!on) {
      pointerSeen = false;
      hover = null;
      hoverElement = null;
    }
  };

  const setGeometryListeners = (on: boolean) => {
    if (on === geometryAttached || typeof window === "undefined") return;
    geometryAttached = on;
    const method = on ? "addEventListener" : "removeEventListener";
    // Capture: scroll doesn't bubble, so a window listener alone would miss app content scrolling in its own containers.
    window[method]("scroll", onGeometry, { capture: true, passive: true });
    window[method]("resize", onGeometry, { passive: true });
  };

  const setDomObserver = (on: boolean) => {
    if (on === (observer !== null)) return;
    if (on) {
      if (typeof MutationObserver !== "function" || typeof document === "undefined") {
        return;
      }
      observer = new MutationObserver(onMutation);
      observer.observe(document.body ?? document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        // React writes nodeValue on a sole text child rather than replacing
        // the node — a characterData record, not childList. Without watching
        // it, `<button>{label}</button>` going "Save" -> "" left the cached
        // name stale.
        characterData: true,
        // Everything the scan filters on, everything accessibleName reads,
        // plus geometry attrs — kept as one list so neither set can drift.
        attributeFilter: [
          // geometry — routed to `schedule()`, never `rescanQueued`
          "class",
          "style",
          // tabbability
          "tabindex",
          "disabled",
          "aria-disabled",
          "hidden",
          "inert",
          "aria-hidden",
          "contenteditable",
          "type",
          "href",
          // the name
          "aria-label",
          "aria-labelledby",
          "alt",
          "title",
          "role",
          "value",
          "for",
        ],
      });
      hoverNameStale = true;
      if (flags.focus) rescanQueued = true;
      return;
    }
    observer?.disconnect();
    observer = null;
    if (mutationTimer !== null) {
      clearTimeout(mutationTimer);
      mutationTimer = null;
    }
    hoverNameStale = true;
    hoverNameElement = null;
  };

  const setGeometryObserver = (on: boolean) => {
    if (on === geometryObserverOn) return;
    geometryObserverOn = on;
    if (on) {
      if (typeof ResizeObserver !== "function") return;
      resizeObserver = new ResizeObserver(onObservedResize);
      syncObservedGeometry();
      return;
    }
    resizeObserver?.disconnect();
    resizeObserver = null;
    observedTargets.clear();
  };

  let styleNonce: string | undefined;
  let nonceKnown = !deferOutlinesUntilStyleNonce;
  let outlinesWanted = false;

  const flushOutlines = () => {
    // Insert waits for a nonce source; teardown never waits — a sheet must not outlive us.
    if (outlinesWanted && !nonceKnown) return;
    if (outlinesWanted === outlinesOn) return;
    outlinesOn = outlinesWanted;
    setHostOutlines(outlinesOn, undefined, styleNonce);
  };

  const setOutlines = (on: boolean) => {
    outlinesWanted = on;
    flushOutlines();
  };

  const setStyleNonce = (nonce?: string) => {
    // Unconditional, including `undefined`: the sheet is recreated whenever
    // the bar comes back, so a remembered nonce would outlive the host's own
    // rotation and stamp a stale one on the new sheet.
    styleNonce = nonce;
    nonceKnown = true;
    flushOutlines();
  };

  /** Brings the world into line with `flags` and `active`; every mutator ends here. */
  function sync(): void {
    const on = active;
    setOutlines(on && flags.boxes);
    setPointerListeners(on && flags.inspect);
    setDomObserver(on && (flags.inspect || flags.focus));
    setGeometryListeners(on && (flags.inspect || flags.focus));
    setGeometryObserver(on && (flags.inspect || flags.focus));
    const focusNow = on && flags.focus;
    if (focusNow && !focusDrawing) rescanQueued = true;
    focusDrawing = focusNow;
    if (!focusNow) {
      focusElements = [];
      focusItems = [];
      focusTruncated = false;
      unnamedCount = 0;
    }
    // Retained sets just changed shape; without this the ResizeObserver keeps stale targets.
    syncObservedGeometry();
    if (on && (flags.inspect || flags.focus)) schedule();
    else cancelFrame();
  }

  /* ------------------------------------------------------------------ */
  /* Persistence                                                          */
  /* ------------------------------------------------------------------ */

  function persistFlags(): void {
    if (!persist) return;
    writePreference(storage, enabledPreference, serializeFlags(flags));
  }

  const write = (next: OverlayFlags) => {
    flags = next;
    error = null;
    persistFlags();
    sync();
    publish();
    store.flush();
  };

  /* ------------------------------------------------------------------ */

  return {
    store,
    grid,

    enabled: () => ({ ...flags }),
    isOn: (id) => flags[id] === true,

    set(id, on) {
      if (!OVERLAY_IDS.includes(id)) return;
      if (flags[id] === on) return;
      write({ ...flags, [id]: on });
    },

    toggle(id) {
      if (!OVERLAY_IDS.includes(id)) return;
      write({ ...flags, [id]: flags[id] !== true });
    },

    disableAll() {
      if (countEnabled(flags) === 0) return;
      write({ ...NO_OVERLAYS });
    },

    setStyleNonce,

    // No geometry: focusItems/hover change every pointer move, and a bug
    // report needs which layers are on and whether the scan is honest, not a
    // rectangle per tabbable element.
    diagnostics() {
      const latest = store.peek();
      return {
        enabled: { ...flags },
        on: OVERLAY_IDS.filter((id) => flags[id] === true),
        activeCount: countEnabled(flags),
        ready: latest.ready,
        active: latest.active,
        focusCount: latest.focusItems.length,
        focusTruncated: latest.focusTruncated,
        unnamedCount: latest.unnamedCount,
        error: latest.error,
      };
    },

    start(api: ExtensionRuntimeApi) {
      storage = persist ? api.storage : null;
      if (persist) {
        const stored = readPreferenceIfReadable(storage, enabledPreference);
        // A failed read preserves session choices; a missing key restores defaults.
        if (stored.readable) {
          flags = stored.value === null ? { ...initialFlags } : parseFlags(stored.value);
        }
      }

      ready = true;
      active = api.isVisible();

      const stopWatchingVisibility = api.subscribeVisibility((visible) => {
        active = visible;
        sync();
        publish();
        store.flush();
      });

      sync();
      publish();
      store.flush();

      let disposed = false;
      const dispose = () => {
        // Idempotent: this is both the abort handler and the returned cleanup.
        if (disposed) return;
        disposed = true;
        active = false;
        ready = false;
        error = null;
        cancelFrame();
        setPointerListeners(false);
        setGeometryListeners(false);
        setGeometryObserver(false);
        setDomObserver(false);
        // Releases only our reference (ref-counted, see setHostOutlines).
        setOutlines(false);
        stopWatchingVisibility();
        storage = null;
        hover = null;
        hoverElement = null;
        hoverNameElement = null;
        hoverNameStale = true;
        focusElements = [];
        focusItems = [];
        focusTruncated = false;
        unnamedCount = 0;
        // So a StrictMode remount sees the enable edge again and rescans.
        focusDrawing = false;
        // Store outlives one start/stop cycle — destroying it here would freeze the panel across StrictMode's remount.
        publish();
        store.flush();
      };

      api.signal.addEventListener("abort", dispose, { once: true });
      return dispose;
    },
  };
}
