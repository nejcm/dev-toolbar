/**
 * Everything `/ext/overlays` owns that is not React. [dev-toolbar/ext/overlays]
 *
 * Built by `overlays()`, not by `start(api)`: slot functions run during the
 * toolbar's first render (before any effect fires), so the store the chip
 * reads must exist by the time the factory returns.
 *
 * This is the first extension that draws over the host application:
 * - **Never takes a pointer event it doesn't own** — the surface is
 *   `pointer-events: none` throughout; the inspector only observes the
 *   pointer via a passive, capturing `pointermove` listener + `elementFromPoint`.
 * - **Leaves nothing behind** — everything drawn is React inside `overlay`,
 *   removed on unmount by construction. Sole exception: `boxes`' stylesheet
 *   in `document.head` (`setHostOutlines`), torn down alongside the listeners.
 * - **Observes nothing while the bar is hidden** — core reports visibility
 *   but never pauses anybody (§2), so this decides "hidden" for itself: the
 *   overlay slot isn't rendered then, listeners detach, the host stylesheet
 *   comes off, and everything resumes when the bar returns (§13.2).
 * - **Nothing here may throw** — measurement runs inside a
 *   `requestAnimationFrame`/`MutationObserver` where nobody upstream could
 *   catch it, so a throw switches every overlay off instead of recurring
 *   every frame.
 */
import { STYLE_ATTRIBUTE, createThrottledStore, ensureStyleSheet } from "../../runtime";
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
 * Deliberately not inside `@layer dev-toolbar`: every other stylesheet here is
 * layered so consumer CSS wins without `!important` (§4.1), but this one must
 * be visible over the app's own styles while a developer has it switched on.
 * Still not `!important`, so a higher-specificity app rule can beat it — the
 * panel says so rather than hiding the limitation.
 *
 * `outline`, not `border`/`box-shadow`, because it paints outside the box and
 * never reflows the page.
 *
 * The `:not()` pair keeps it off every dev toolbar on the page — ours and
 * anybody else's.
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
  start(api: ExtensionRuntimeApi): () => void;
}

/** Attribute holding the number of live holders of the host-outline sheet. */
export const BOXES_REFS_ATTRIBUTE = "data-dtb-refs";

/**
 * Acquires or releases the host-outline stylesheet. Reference-counted via
 * `data-dtb-refs` on the element (DOM-state, not module-state, since two
 * toolbars — or two bundled copies of this extension — are separate closures
 * sharing one `document.head`). Without the count, one instance unmounting
 * would remove outlines belonging to another instance that still has the
 * overlay on, leaving its chip/panel out of sync with the DOM.
 *
 * Release queries the document for the attribute rather than holding the
 * node, so a runtime that lost its reference cannot leave a sheet behind.
 */
export function setHostOutlines(on: boolean, doc?: Document): void {
  const target = doc ?? (typeof document === "undefined" ? null : document);
  if (!target?.head) return;

  const sheets = [
    ...target.head.querySelectorAll<HTMLElement>(
      `style[${STYLE_ATTRIBUTE}="${BOXES_STYLE_ENTRY}"]`,
    ),
  ];
  const readRefs = (node: HTMLElement): number => {
    const parsed = Number.parseInt(node.getAttribute(BOXES_REFS_ATTRIBUTE) ?? "", 10);
    // A sheet with no count is one somebody else inserted, or one from an
    // older version. Treat it as held once rather than as free to remove.
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  };

  if (on) {
    const sheet = ensureStyleSheet(BOXES_STYLE_ENTRY, BOXES_CSS, target);
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
 * not a change to focus behaviour, so an `aria-disabled` button is still a
 * real `Tab` stop. A disabled `fieldset` does disable its contained controls,
 * except those inside its first `<legend>` (e.g. a "turn this section on"
 * checkbox), which stay enabled.
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
  } = options;

  const grid = normalizeGrid(gridInput);
  const limit = Math.max(1, Math.min(1000, Math.round(focusLimit)));

  let flags: OverlayFlags = { ...NO_OVERLAYS, ...defaults };
  let storage: ToolbarStorage | null = null;
  let ready = false;
  let active = false;
  let error: string | null = null;

  /* ------------------------------------------------------------------ */
  /* Measured state                                                       */
  /* ------------------------------------------------------------------ */

  let hover: HoverTarget | null = null;
  let focusItems: readonly FocusItem[] = [];
  let focusTruncated = false;
  let unnamedCount = 0;

  /**
   * The elements the focus overlay is drawing over. Strong references to host
   * nodes — a retention risk worth naming: a removed node stays reachable
   * until the next measurement drops anything with `isConnected === false`
   * (teardown clears the list too), so the window is one frame wide.
   *
   * Each entry carries the accessible name and `tabindex` resolved at scan
   * time, so a scroll frame costs one rect per element and nothing else.
   *
   * The inspector, by contrast, retains nothing — it re-hit-tests the
   * pointer's coordinates every frame, which is also correct since scrolling
   * changes what's under a stationary pointer.
   */
  let focusElements: Scanned[] = [];

  let pointerX = 0;
  let pointerY = 0;
  let pointerSeen = false;
  let rescanQueued = false;

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
    // intervalMs: 0 because coalescing on a timer would lag the cursor; the
    // saving instead comes from `equals` — an unchanged frame publishes nothing.
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
   * Every measurement is wrapped in this: a throw inside a frame callback or
   * `MutationObserver` can't be caught upstream and would recur every frame,
   * so the only honest response is to stop drawing.
   */
  const fail = (where: string, thrown: unknown): void => {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    error = `${where} failed: ${message} — every overlay was switched off.`;
    // eslint-disable-next-line no-console
    console.error(
      `[dev-toolbar/ext/overlays] ${where} threw. Switching every overlay off ` +
        "rather than retrying it every frame.",
      thrown,
    );
    // Not persisted: a transient failure shouldn't cost the developer their
    // saved toggles. Memory says off; storage still has their picks, restored
    // on reload.
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
      name: accessibleName(element),
      role: element.getAttribute("role"),
      pinned: position === "fixed" || position === "sticky",
    };
  };

  /** Resolves what the pointer is over. Never returns anything in a toolbar. */
  const readPointer = (): void => {
    if (
      !pointerSeen ||
      typeof document === "undefined" ||
      // Absent in jsdom and other layout-less environments; no element is the
      // correct answer there, not a thrown error.
      typeof document.elementFromPoint !== "function"
    ) {
      hover = null;
      return;
    }
    const found = document.elementFromPoint(pointerX, pointerY);
    // elementFromPoint hit-tests the real page, so it can return the toolbar
    // itself when the pointer is over the bar/panel/palette — never wanted.
    if (!found || isInToolbar(found)) {
      hover = null;
      return;
    }
    hover = buildHover(found);
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
      if (element.getAttribute("aria-hidden") === "true") continue;
      if (element.getAttribute("contenteditable") === "false") continue;
      if (element.hasAttribute("inert")) continue;
      // type="hidden" passes every selector above and has no box, so without
      // this it consumed a badge-limit slot only to be dropped at measure time.
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
    // Accessible name is resolved here, once per scan, not per frame — a
    // subtree walk plus a possible getElementById, too costly to repeat for
    // up to 200 elements every scroll frame.
    //
    // Cache safety depends on every mutation that can change a name being
    // observed by the MutationObserver below — not on names being otherwise
    // stable. In particular, text written into an existing Text node is a
    // `characterData` record, not `childList`; missing that once left an
    // emptied button badge saying "named" indefinitely. If `accessibleName`
    // grows a branch reading something new, add its mutation type below too.
    focusElements = inTabOrder(found).map((element) => ({
      element,
      name: accessibleName(element),
      tabIndex: tabIndexOf(element),
    }));
  };

  /**
   * Re-measures the retained elements on every scroll/resize frame — no
   * re-query. Numbering counts every element with a box regardless of
   * on-screen visibility, so scrolling moves badges without renumbering them.
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
      });
    }
    focusElements = alive;
    focusItems = items;
    unnamedCount = unnamed;
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
      // No rAF (jsdom without one, SSR): measure synchronously instead of
      // silently drawing nothing; `guard` still contains anything it throws.
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

  const onMutation = (records: MutationRecord[]) => {
    // Skip records we caused ourselves: the surface is portaled into `body`,
    // so badges drawn/removed as the page scrolls are themselves mutations of
    // the observed subtree, and rescanning for them would be self-inflicted work.
    if (records.length > 0 && records.every((record) => isInToolbar(record.target))) {
      return;
    }
    // Debounced, not per-record: a React commit is a burst of records, and
    // re-querying on each one would make this overlay the perf problem it
    // was installed to find.
    if (mutationTimer !== null) return;
    mutationTimer = setTimeout(() => {
      mutationTimer = null;
      rescanQueued = true;
      schedule();
    }, mutationDebounceMs);
  };

  let pointerAttached = false;
  let geometryAttached = false;
  let outlinesOn = false;

  const setPointerListeners = (on: boolean) => {
    if (on === pointerAttached || typeof window === "undefined") return;
    pointerAttached = on;
    const method = on ? "addEventListener" : "removeEventListener";
    // Capture so a host stopping propagation can't blind the inspector;
    // passive so it can never delay a scroll.
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
    }
  };

  const setGeometryListeners = (on: boolean) => {
    if (on === geometryAttached || typeof window === "undefined") return;
    geometryAttached = on;
    const method = on ? "addEventListener" : "removeEventListener";
    // Capture: scroll doesn't bubble, so a window listener alone would only
    // hear the document, missing app content scrolling in its own containers.
    window[method]("scroll", onGeometry, { capture: true, passive: true });
    window[method]("resize", onGeometry, { passive: true });
  };

  const setFocusObserver = (on: boolean) => {
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
        // React updates a sole text child by writing nodeValue rather than
        // replacing the node — a characterData record. Without watching it,
        // `<button>{label}</button>` going "Save" -> "" left the cached name
        // stale and the badge claiming the button was named.
        characterData: true,
        // Everything the scan filters on, plus everything accessibleName
        // reads — kept as one list so neither set can silently drift from the code.
        attributeFilter: [
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
      rescanQueued = true;
      return;
    }
    observer?.disconnect();
    observer = null;
    if (mutationTimer !== null) {
      clearTimeout(mutationTimer);
      mutationTimer = null;
    }
    focusElements = [];
    focusItems = [];
    focusTruncated = false;
    unnamedCount = 0;
  };

  const setOutlines = (on: boolean) => {
    if (on === outlinesOn) return;
    outlinesOn = on;
    setHostOutlines(on);
  };

  /**
   * Brings the world into line with `flags` and `active`. Every mutator ends
   * here, so exactly one place owns what is attached.
   */
  function sync(): void {
    const on = active;
    setOutlines(on && flags.boxes);
    setPointerListeners(on && flags.inspect);
    setFocusObserver(on && flags.focus);
    setGeometryListeners(on && (flags.inspect || flags.focus));
    if (on && (flags.inspect || flags.focus)) schedule();
    else cancelFrame();
  }

  /* ------------------------------------------------------------------ */
  /* Persistence                                                          */
  /* ------------------------------------------------------------------ */

  function persistFlags(): void {
    if (!persist || storage === null) return;
    try {
      storage.setItem(ENABLED_KEY, serializeFlags(flags));
    } catch {
      // A custom adapter is consumer code; losing persistence is survivable,
      // throwing out of a click handler is not.
    }
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

    start(api: ExtensionRuntimeApi) {
      storage = persist ? api.storage : null;
      if (persist) {
        let raw: string | null = null;
        try {
          raw = api.storage.getItem(ENABLED_KEY);
        } catch {
          raw = null;
        }
        // Stored map wins over `defaults` where present; parseFlags fails
        // closed, so an unreadable blob means every overlay off.
        if (raw !== null) flags = parseFlags(raw);
      }

      ready = true;
      active = api.isVisible();

      const stopWatchingVisibility = api.subscribeVisibility((visible) => {
        // The overlay slot isn't rendered while the bar is hidden; everything
        // resumes on its own when it comes back.
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
        // Idempotent: both the abort handler and the returned cleanup; core
        // runs the second after the first.
        if (disposed) return;
        disposed = true;
        active = false;
        ready = false;
        error = null;
        cancelFrame();
        setPointerListeners(false);
        setGeometryListeners(false);
        setFocusObserver(false);
        // Releases only our reference (ref-counted, see setHostOutlines) — an
        // unconditional removal would un-outline a second toolbar's sheet
        // while its chip/panel still said the overlay was on.
        setOutlines(false);
        stopWatchingVisibility();
        storage = null;
        hover = null;
        focusElements = [];
        focusItems = [];
        // The store outlives one start/stop cycle — StrictMode runs
        // mount -> cleanup -> mount; destroying it here would freeze the panel.
        publish();
        store.flush();
      };

      api.signal.addEventListener("abort", dispose, { once: true });
      return dispose;
    },
  };
}
