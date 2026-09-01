/**
 * Everything `/ext/overlays` owns that is not React. [dev-toolbar/ext/overlays]
 *
 * Built by `overlays()`, not by `start(api)` — slot functions run during the
 * toolbar's first render, which is before any effect fires, so the store the
 * chip reads has to exist by the time the factory returns. Fourth extension,
 * fourth time this is the first thing to know.
 *
 * This is the first extension that **draws over the host application**, and
 * every rule below exists because of that.
 *
 * **It never takes a pointer event it does not own.** The drawing surface is
 * `pointer-events: none` in its entirety, so a click always reaches the page
 * underneath. The inspector follows the pointer through a passive, capturing
 * `pointermove` listener and `document.elementFromPoint` — it observes the
 * pointer, it never intercepts it.
 *
 * **It leaves nothing behind.** Everything drawn is React inside the `overlay`
 * slot, so unmounting the toolbar removes it by construction. The one exception
 * is `boxes`, which needs a stylesheet in `document.head` (see
 * `setHostOutlines`), and that stylesheet is removed by the same teardown that
 * detaches the listeners — on `api.signal`, on the returned cleanup, and when
 * the overlay is switched off.
 *
 * **It observes nothing while the bar is hidden.** Core reports visibility and
 * never pauses anybody (§2), so this decides for itself what hidden means: the
 * overlay slot is not rendered then, so scanning would be measuring for a
 * surface that does not exist. Listeners detach, the host stylesheet comes off,
 * and everything comes back exactly as it was when the bar returns. This is the
 * §13.2 lesson applied to a non-modal overlay.
 *
 * **Nothing here may throw.** A measurement runs inside a `requestAnimationFrame`
 * and a `MutationObserver`, where nobody can catch it, and it runs again next
 * frame. So a throw turns every overlay *off* and says so, rather than logging
 * sixty times a second.
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
 * Deliberately **not** inside `@layer dev-toolbar`. Every other stylesheet in
 * this package is layered so that consumer CSS wins without `!important`
 * (§4.1); this one has the opposite job — it is a debugging instrument that has
 * to be visible over the app's own styles, and it is only ever present while a
 * developer has explicitly switched it on. It is still not `!important`, so an
 * app rule with higher specificity can beat it; that is a limitation, and the
 * panel says so rather than hiding it.
 *
 * `outline` rather than `border` or `box-shadow`, because an outline is painted
 * outside the box and **never reflows the page**. An overlay that changed the
 * layout it is describing would be worse than useless.
 *
 * The `:not()` pair keeps it off every dev toolbar on the page — ours and
 * anybody else's — so the bar, the panel and the palette never get outlined.
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
 * Acquires or releases the host-outline stylesheet. **Reference-counted.**
 *
 * Insertion goes through `/runtime`'s `ensureStyleSheet`, so two copies of this
 * package still insert one element. Everything else about it is deliberately
 * DOM-state rather than module-state, for the same reason: two toolbars on one
 * page — or two bundled copies of this extension — are separate closures that
 * cannot see each other's bookkeeping, but they share one `document.head`.
 *
 * The count lives on the element as `data-dtb-refs`, and the sheet is removed
 * when the last holder releases it. Without the count, one instance unmounting
 * removed the outlines belonging to another instance that still had the overlay
 * switched on — its flag, its chip and its panel all still saying so. Failing in
 * the safe direction is not the same as being right, and a state that disagrees
 * with the DOM is the class of bug this codebase's rules exist to prevent.
 *
 * Release still queries the document for the attribute rather than holding the
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
 * `aria-disabled` is deliberately **not** here. It is a promise to assistive
 * technology, not a change to focus behaviour: an `aria-disabled` button is
 * still a real `Tab` stop, and leaving it out would describe a sequence with
 * missing stops — the inverse of the error §14.5 is about.
 *
 * A disabled **fieldset** is, though. It disables every control it contains,
 * which is how a whole form section is switched off in practice — and the one
 * exception is real: controls inside the fieldset's *first* `<legend>` stay
 * enabled, so a "turn this section on" checkbox in the legend is still a stop.
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
   * The elements the focus overlay is drawing over.
   *
   * These are strong references to host nodes, which is a retention risk worth
   * naming: a node removed from the document stays reachable until the next
   * measurement. Every measurement drops anything whose `isConnected` is false
   * and teardown clears the list, so the window is one frame wide and the steady
   * state holds nothing the document does not hold itself.
   *
   * Each entry carries the accessible name and `tabindex` resolved at scan
   * time, so a scroll frame costs one rect per element and nothing else.
   *
   * The inspector deliberately retains *nothing*: it re-hit-tests the pointer's
   * coordinates every frame instead of holding the element it found. That is
   * also the correct behaviour — scrolling changes what is under a stationary
   * pointer — so the cheap thing and the right thing agree.
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
    // The pointer moves every frame; coalescing on a timer would make the
    // inspector lag the cursor, which is the one thing it must not do. The
    // saving comes from `equals` instead: a frame in which nothing drawn
    // changed publishes nothing at all.
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
   * Every measurement is wrapped in this. A throw inside a frame callback or a
   * `MutationObserver` cannot be caught by anybody upstream, and it will happen
   * again on the next frame, so the only honest response is to stop drawing.
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
    // Deliberately **not** persisted. Turning everything off is the right
    // response to a throw that would otherwise recur every frame; erasing what
    // the developer chose is not, and one transient failure should not cost
    // them their toggles on every future load. So memory says off, storage
    // still says what they picked, and a reload puts it back.
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
      // Absent in jsdom, and in any other environment without layout. Reading
      // no element is the correct answer there; throwing would switch every
      // overlay off on a platform difference rather than on a fault.
      typeof document.elementFromPoint !== "function"
    ) {
      hover = null;
      return;
    }
    const found = document.elementFromPoint(pointerX, pointerY);
    // `elementFromPoint` hit-tests the real page, so it returns the toolbar
    // when the pointer is over the bar, the panel or the palette. Inspecting
    // the tool rather than the application is never what was asked for.
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
      // `type="hidden"` passes every selector above and has no box at all, so
      // without this it consumed a slot toward the badge limit and was then
      // dropped at measure time — a scan that stopped early over elements it
      // was never going to draw.
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
    // The accessible name is resolved **here**, once per scan, not per frame.
    // Resolving it is a subtree text walk plus, for `aria-labelledby`, a
    // `getElementById` — cheap once, and up to 200 of them on every scroll
    // frame is precisely the kind of cost the panel's cost line exists to stop
    // anybody paying unknowingly.
    //
    // What makes the cache safe is not that a name cannot change without a DOM
    // mutation — it is that **every mutation that can change one is observed**.
    // Those are not the same claim, and the difference is a real defect this
    // comment used to paper over: text written straight into an existing Text
    // node is a `characterData` record, which the observer did not ask for, so
    // an emptied button label left a badge saying "named" indefinitely. The
    // observer now watches `characterData`, the attributes that carry or change
    // a name, and `childList` for text nodes appearing and leaving. If you add
    // a branch to `accessibleName` that reads something else, add its mutation
    // type there in the same commit.
    focusElements = inTabOrder(found).map((element) => ({
      element,
      name: accessibleName(element),
      tabIndex: tabIndexOf(element),
    }));
  };

  /**
   * Re-measures the retained elements. Runs every frame the page scrolled or
   * resized, which is why it re-queries nothing.
   *
   * Numbering counts every element that has a box, whether or not it is on
   * screen, and only the on-screen ones are drawn — so scrolling moves badges
   * without renumbering them.
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
      // 0 × 0 is `display: none` in every practical case, and it is the one
      // "is this painted" test that costs no style resolution.
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
      // No rAF (jsdom without one, SSR): measure synchronously rather than
      // silently drawing nothing. `guard` still contains anything it throws.
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
    // Records we caused. The surface is portaled into `body`, so the badges this
    // overlay draws and removes as the page scrolls are themselves mutations of
    // the observed subtree — and a rescan triggered by our own drawing is pure
    // self-inflicted work. Filtered here rather than by narrowing the observer,
    // because the thing worth watching is the application's whole body.
    if (records.length > 0 && records.every((record) => isInToolbar(record.target))) {
      return;
    }
    // Debounced, not per-record: a React commit produces a burst of records and
    // re-querying the document on each one is how an overlay becomes the
    // performance problem it was installed to find.
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
    // Capturing and passive: capture so a host that stops propagation cannot
    // blind the inspector, passive so it can never delay a scroll or be
    // mistaken for something that wants to cancel the event.
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
    // Capturing scroll: scroll does not bubble, so a listener on window only
    // hears the document. Overlays sit over app content that scrolls in its own
    // containers far more often than the page does.
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
        // A control's accessible name usually *is* its text, and React updates
        // a sole text child by writing `nodeValue` rather than replacing the
        // node — which is a characterData record and nothing else. Without
        // this, `<button>{label}</button>` going from "Save" to "" fired no
        // observed record at all, so the cached name was never re-resolved and
        // the badge went on claiming the button was named. Records target the
        // Text node; `isInToolbar` resolves those through `parentElement`, so
        // the self-mutation filter still applies and the debounce still bounds
        // the extra callbacks.
        characterData: true,
        // Everything the scan filters on, plus everything `accessibleName`
        // reads. Kept as one list on purpose: these two sets are the whole
        // definition of "a record that could change what is drawn", and
        // splitting them is how one of them silently falls behind the code.
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
   * here, so there is exactly one place that owns what is attached — which is
   * what makes "off leaves nothing behind" checkable rather than hopeful.
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
      // A custom adapter is consumer code. Losing persistence is survivable;
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
        // A stored map wins over `defaults` only where it is present, and
        // `parseFlags` fails closed — an unreadable blob means every overlay
        // off, never a page mysteriously covered in outlines.
        if (raw !== null) flags = parseFlags(raw);
      }

      ready = true;
      active = api.isVisible();

      const stopWatchingVisibility = api.subscribeVisibility((visible) => {
        // The overlay slot is not rendered while the bar is hidden, so anything
        // measured then is measured for a surface that does not exist — and the
        // host outlines would be left on a page with no toolbar to remove them
        // from. Everything comes back on its own when the bar does.
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
        // Idempotent: this is both the abort handler and the returned cleanup,
        // and core runs the second after the first.
        if (disposed) return;
        disposed = true;
        active = false;
        ready = false;
        error = null;
        cancelFrame();
        setPointerListeners(false);
        setGeometryListeners(false);
        setFocusObserver(false);
        // Releases *our* reference, and only if we hold one. It used to remove
        // the sheet unconditionally, on the theory that teardown is the moment
        // to be sure — which, with a second toolbar on the page holding the same
        // sheet, meant tearing this one down silently un-outlined that one while
        // its chip and panel still said the overlay was on. The count is the
        // reason it is safe not to be heavy-handed here.
        setOutlines(false);
        stopWatchingVisibility();
        storage = null;
        hover = null;
        focusElements = [];
        focusItems = [];
        // The store outlives one start/stop cycle — StrictMode runs
        // mount → cleanup → mount, and destroying it here would drop React's
        // subscription and freeze the panel.
        publish();
        store.flush();
      };

      api.signal.addEventListener("abort", dispose, { once: true });
      return dispose;
    },
  };
}
