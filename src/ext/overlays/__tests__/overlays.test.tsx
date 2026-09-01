/**
 * `/ext/overlays` against the real shell, through the same `/testing` surface a
 * stranger writing an extension would use.
 *
 * The assertions that matter most here are not about what it draws. They are
 * about what it leaves behind, what it refuses to cover, and what happens when
 * a measurement goes wrong — this is the first extension that paints over
 * somebody else's application.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { renderWithToolbar } from "@nejcm/dev-toolbar/testing";
import { createMemoryStorage } from "../../../core/storage";
import { overlays } from "../index";
import {
  BOXES_REFS_ATTRIBUTE,
  BOXES_STYLE_ENTRY,
  ENABLED_KEY,
  setHostOutlines,
} from "../runtime";
import { OVERLAYS_CSS } from "../css";
import type { OverlaysOptions } from "../index";
import type { ToolbarStorage } from "../../../core/contract";

let unmountAll: (() => void)[] = [];

const STORAGE_KEY = `dtb:v1:test:ext:overlays:${ENABLED_KEY}`;

/** The application under the toolbar. Deliberately has focusable content. */
const app = (
  <main data-testid="app">
    <h1>Page</h1>
    <button data-testid="named" type="button" aria-label="Save the document">
      <span>💾</span>
    </button>
    <button data-testid="unnamed" type="button">
      <span aria-hidden="true">×</span>
    </button>
    <span data-testid="plain">not focusable</span>
  </main>
);

const mount = (options: OverlaysOptions = {}, storage?: ToolbarStorage) => {
  const extension = overlays(options);
  const result = renderWithToolbar(app, {
    extensions: [extension],
    instanceId: "test",
    ...(storage === undefined ? {} : { storage }),
  });
  unmountAll.push(result.unmount);
  return { extension, ...result };
};

/** Drains a pending mutation debounce and the frame that follows it. */
const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
};

/** jsdom drives `requestAnimationFrame` off a real timer. */
const frame = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 32));
  });
};

const surface = () => document.querySelector('[data-dtb-part="ovl-surface"]');
const rows = () => [
  ...document.querySelectorAll<HTMLElement>('[data-dtb-part="ovl-row"]'),
];
const toggleRow = (id: string) => {
  const row = document.querySelector<HTMLElement>(
    `[data-dtb-part="ovl-row"][data-dtb-overlay="${id}"]`,
  );
  const button = row?.querySelector<HTMLButtonElement>(
    '[data-dtb-part="ovl-toggle"]',
  );
  if (!button) throw new Error(`no toggle for ${id}`);
  act(() => button.click());
};
const boxesSheets = () =>
  document.head.querySelectorAll(
    `style[data-dev-toolbar-styles="${BOXES_STYLE_ENTRY}"]`,
  );
const badges = () => [
  ...document.querySelectorAll<HTMLElement>('[data-dtb-part="ovl-focus-badge"]'),
];

/** Gives an element a real rect, which jsdom otherwise reports as 0 × 0. */
const withRect = (
  element: Element,
  rect: { x: number; y: number; width: number; height: number },
) => {
  element.getBoundingClientRect = () =>
    ({
      x: rect.x,
      y: rect.y,
      left: rect.x,
      top: rect.y,
      width: rect.width,
      height: rect.height,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON: () => rect,
    }) as DOMRect;
};

const pointAt = (element: Element | null) => {
  (
    document as Document & { elementFromPoint: (x: number, y: number) => Element | null }
  ).elementFromPoint = () => element;
};

beforeEach(() => {
  // Absent in jsdom entirely; the runtime tolerates that, so a test that wants
  // the inspector has to supply it.
  (document as Partial<Document>).elementFromPoint = undefined;
});

afterEach(() => {
  for (const unmount of unmountAll.splice(0)) unmount();
  delete (document as Partial<Document>).elementFromPoint;
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */

describe("the extension object", () => {
  it("is a compact + panel + overlay extension that contributes toggles", () => {
    const extension = overlays();
    expect(extension.id).toBe("overlays");
    expect(typeof extension.overlay).toBe("function");
    expect(typeof extension.commands).toBe("function");
    const ids = (
      extension.commands as () => readonly { id: string }[]
    )().map((command) => command.id);
    expect(ids).toEqual([
      "overlays.toggle.boxes",
      "overlays.toggle.grid",
      "overlays.toggle.inspect",
      "overlays.toggle.focus",
      "overlays.disableAll",
    ]);
  });

  it("draws nothing at all until an overlay is switched on", () => {
    mount();
    expect(surface()).toBeNull();
    expect(boxesSheets()).toHaveLength(0);
  });
});

describe("toggling, off and on, from every surface", () => {
  it("turns each overlay on and off from the panel", async () => {
    const { toolbar } = mount();
    act(() => toolbar.openPanel("overlays"));
    expect(rows()).toHaveLength(4);

    toggleRow("grid");
    expect(
      document.querySelector('[data-dtb-part="ovl-grid"]'),
    ).not.toBeNull();
    expect(
      document
        .querySelector('[data-dtb-part="ovl-row"][data-dtb-overlay="grid"] [role="switch"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");

    toggleRow("grid");
    expect(document.querySelector('[data-dtb-part="ovl-grid"]')).toBeNull();
    expect(surface()).toBeNull();
  });

  it("turns them on and off through the aggregated commands, with live labels", async () => {
    const { toolbar } = mount();
    const labelOf = (id: string) =>
      toolbar.getCommands().find((command) => command.id === id)?.label;

    expect(labelOf("overlays.toggle.grid")).toBe("Show overlay: Column grid");
    await act(async () => {
      await toolbar.runCommand("overlays.toggle.grid");
    });
    expect(labelOf("overlays.toggle.grid")).toBe("Hide overlay: Column grid");
    expect(document.querySelector('[data-dtb-part="ovl-grid"]')).not.toBeNull();

    await act(async () => {
      await toolbar.runCommand("overlays.toggle.boxes");
    });
    expect(boxesSheets()).toHaveLength(1);

    await act(async () => {
      await toolbar.runCommand("overlays.disableAll");
    });
    expect(surface()).toBeNull();
    expect(boxesSheets()).toHaveLength(0);
  });

  it("persists each toggle and restores it on the next mount", () => {
    const storage = createMemoryStorage();
    const first = mount({}, storage);
    act(() => first.toolbar.openPanel("overlays"));
    toggleRow("grid");
    toggleRow("boxes");
    expect(JSON.parse(storage.getItem(STORAGE_KEY) as string)).toEqual({
      boxes: true,
      grid: true,
      inspect: false,
      focus: false,
    });

    first.unmount();
    unmountAll.splice(unmountAll.indexOf(first.unmount), 1);
    expect(boxesSheets()).toHaveLength(0);

    mount({}, storage);
    expect(document.querySelector('[data-dtb-part="ovl-grid"]')).not.toBeNull();
    expect(boxesSheets()).toHaveLength(1);
  });

  it("lets a corrupted stored map turn nothing on", () => {
    const storage = createMemoryStorage();
    storage.setItem(STORAGE_KEY, "{not json");
    mount({ defaults: { grid: true } }, storage);
    // Fail-closed, and it beats `defaults` too: a stored map that exists but
    // cannot be read means "the developer chose something we cannot recover",
    // and covering their page in overlays is the wrong guess.
    expect(surface()).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe("what it refuses to touch", () => {
  it("leaves the host DOM byte-for-byte as it found it", async () => {
    // Outside Testing Library's container, so it is host markup that survives
    // the unmount — the container itself is emptied by `cleanup`, which would
    // make an assertion about it prove nothing.
    const host = document.createElement("section");
    host.innerHTML = `<h2 class="title">Host</h2><a href="#x">link</a>`;
    document.body.appendChild(host);
    const hostBefore = host.outerHTML;

    const { toolbar, getByTestId } = mount();
    const appBefore = getByTestId("app").outerHTML;

    act(() => toolbar.openPanel("overlays"));
    for (const id of ["boxes", "grid", "inspect", "focus"]) toggleRow(id);
    await frame();

    // Every overlay is on. The application's own markup has not been touched:
    // no injected classes, no inline styles, no wrapper elements.
    expect(getByTestId("app").outerHTML).toBe(appBefore);
    expect(host.outerHTML).toBe(hostBefore);

    for (const unmount of unmountAll.splice(0)) unmount();

    // Exactly as it was found: same host markup, no toolbar root left in the
    // body, and the one stylesheet it adds to a document it does not own gone.
    expect(host.outerHTML).toBe(hostBefore);
    // Nothing of this package is left anywhere in the document: no toolbar
    // root, no part, no attribute. (Testing Library's own now-empty container
    // stays, which is the runner's, not ours.)
    expect(document.querySelector("[data-dev-toolbar]")).toBeNull();
    expect(document.querySelector("[data-dtb-part]")).toBeNull();
    expect(surface()).toBeNull();
    expect(boxesSheets()).toHaveLength(0);
    expect(document.head.innerHTML).not.toContain(BOXES_STYLE_ENTRY);
    // The extension's *own* stylesheet stays, like core's and every other
    // extension's: it styles only `[data-dev-toolbar]` descendants, so with the
    // toolbar gone it matches nothing, and re-injecting it on every mount would
    // be the more surprising behaviour.
    expect(
      document.head.querySelector(
        'style[data-dev-toolbar-styles="ext-overlays"]',
      ),
    ).not.toBeNull();
    // Appended outside Testing Library's container, so `cleanup` will not take
    // it away — and a stray tabbable node would change what later tests scan.
    host.remove();
  });

  it("takes no pointer events: nothing it draws is interactive", async () => {
    const { toolbar } = mount({ defaults: { grid: true, focus: true } });
    await frame();
    const layer = surface() as HTMLElement;

    // The structural half of the guarantee: there is nothing in here to
    // interact with in the first place.
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(
      layer.querySelectorAll("button, a, input, select, textarea, [tabindex]"),
    ).toHaveLength(0);
    expect(layer.querySelectorAll("[onclick]")).toHaveLength(0);
    expect(toolbar.bar()).not.toBeNull();
  });

  /**
   * The half that matters, and the one the original test got wrong.
   *
   * That test was a regular expression over the stylesheet's own text. It
   * passed happily while the guarantee it described was defeated by one line of
   * app CSS: the declarations sat inside `@layer dev-toolbar`, which §4.1
   * designed to *lose* to unlayered author rules, so `div { pointer-events:
   * auto }` — the weakest rule CSS can express — turned a viewport-sized
   * overlay into a click trap. A rule only ever compared to itself is not
   * tested.
   *
   * The honest test here would read `getComputedStyle` off the surface with a
   * hostile rule installed. **jsdom cannot answer that question**: its cascade
   * is last-declaration-wins and ignores both specificity and `!important`
   * (verified — an `!important` rule loses to a later normal one), so a
   * computed-style assertion in this environment would be asserting jsdom's
   * behaviour rather than ours, in whichever direction jsdom happened to fall.
   *
   * So this asks the **CSS parser** instead of the text: it reads the parsed
   * declarations back out of the CSSOM and asserts the priority the cascade
   * will act on. That fails against the pre-fix stylesheet, which is the point.
   * The cascade itself — a hostile unlayered rule losing to these declarations
   * in a real engine — is verified in a browser, and recorded in §14.7.
   */
  it("marks its safety declarations !important, so app CSS cannot undo them", () => {
    // jsdom rejects a sheet containing `@layer` outright, so the wrapper comes
    // off before the parser sees it. The declarations are untouched.
    const sheet = document.createElement("style");
    sheet.textContent = OVERLAYS_CSS.replace(
      /^@layer dev-toolbar \{/,
      "",
    ).replace(/\}\s*$/, "");
    document.head.appendChild(sheet);
    const rules = [...(sheet.sheet?.cssRules ?? [])] as CSSStyleRule[];
    expect(rules.length).toBeGreaterThan(10);

    const ruleFor = (selector: string) => {
      const found = rules.find((rule) => rule.selectorText === selector);
      if (!found) throw new Error(`no rule for ${selector}`);
      return found.style;
    };

    const surfaceRule = ruleFor(
      '[data-dev-toolbar] [data-dtb-part="ovl-surface"]',
    );
    // A click must always reach the page; the surface must stay below the bar
    // and the palette; and it must stay out of the toolbar's own layout.
    for (const property of ["pointer-events", "z-index", "position", "inset"]) {
      expect(
        surfaceRule.getPropertyPriority(property),
        `${property} on the surface`,
      ).toBe("important");
    }
    // Descendants are covered by their own rule rather than by inheritance, so
    // a hostile rule matching them has to be beaten separately.
    expect(
      ruleFor(
        '[data-dev-toolbar] [data-dtb-part="ovl-surface"] *',
      ).getPropertyPriority("pointer-events"),
    ).toBe("important");

    // And the guard stays narrow: everything else is ordinary layered CSS a
    // consumer can override, which is what makes the five above legible as
    // deliberate rather than as a habit.
    const important = rules.filter((rule) => {
      const declarations = rule.style as unknown as Record<number, string>;
      for (let index = 0; index < rule.style.length; index += 1) {
        const property = declarations[index] as string;
        if (rule.style.getPropertyPriority(property) === "important") return true;
      }
      return false;
    });
    expect(important.map((rule) => rule.selectorText)).toEqual([
      '[data-dev-toolbar] [data-dtb-part="ovl-surface"]',
      '[data-dev-toolbar] [data-dtb-part="ovl-surface"] *',
    ]);
    sheet.remove();
  });

  it("never inspects the toolbar itself", async () => {
    const { toolbar } = mount({ defaults: { inspect: true } });
    const target = document.querySelector('[data-testid="named"]') as Element;
    withRect(target, { x: 10, y: 40, width: 80, height: 24 });

    pointAt(target);
    fireEvent.pointerMove(window, { clientX: 20, clientY: 50 });
    await frame();
    expect(
      document.querySelector('[data-dtb-part="ovl-label-target"]')?.textContent,
    ).toBe("button");

    // The pointer moves over the bar. `elementFromPoint` hit-tests the real
    // page, so it returns the toolbar — and inspecting the tool instead of the
    // application is never what was asked for.
    pointAt(toolbar.bar());
    fireEvent.pointerMove(window, { clientX: 5, clientY: 760 });
    await frame();
    expect(document.querySelector('[data-dtb-part="ovl-label"]')).toBeNull();
  });

  it("numbers the application's focus order, never the toolbar's", async () => {
    const { toolbar } = mount({ defaults: { focus: true } });
    const named = document.querySelector('[data-testid="named"]') as Element;
    const unnamed = document.querySelector('[data-testid="unnamed"]') as Element;
    withRect(named, { x: 10, y: 40, width: 80, height: 24 });
    withRect(unnamed, { x: 100, y: 40, width: 24, height: 24 });
    // The toolbar's own trigger is a real, tabbable button with a real rect.
    // The only reason it is not numbered is that the scan excludes it.
    const trigger = toolbar
      .item("overlays")
      ?.querySelector("button") as HTMLElement;
    withRect(trigger, { x: 0, y: 700, width: 60, height: 20 });

    await frame();
    expect(badges().map((badge) => badge.dataset["dtbFocusIndex"])).toEqual([
      "1",
      "2",
    ]);
    expect(badges().map((badge) => badge.dataset["dtbNamed"])).toEqual([
      "true",
      "false",
    ]);
    expect(badges()[1]?.textContent).toContain("button — unnamed");
  });
});

/* -------------------------------------------------------------------------- */

describe("visibility and teardown", () => {
  it("stops drawing and takes its stylesheet off while the bar is hidden", async () => {
    const { toolbar } = mount({ defaults: { boxes: true, focus: true } });
    await frame();
    expect(boxesSheets()).toHaveLength(1);

    act(() => toolbar.setVisible(false));
    // Core does not render the overlay slot while the bar is hidden, so a
    // stylesheet left on would be an overlay with no toolbar to remove it from.
    expect(boxesSheets()).toHaveLength(0);
    expect(surface()).toBeNull();

    act(() => toolbar.setVisible(true));
    await frame();
    expect(boxesSheets()).toHaveLength(1);
    // ...and the toggles survived being hidden, rather than being reset.
    expect(toolbar.context().getCommands().find(
      (command) => command.id === "overlays.toggle.boxes",
    )?.label).toBe("Hide overlay: Layout boxes");
  });

  it("is never started, and draws nothing, while it is hidden from the actor", () => {
    const extension = overlays({ hidden: true, defaults: { boxes: true } });
    const result = renderWithToolbar(app, {
      extensions: [extension],
      instanceId: "test",
    });
    unmountAll.push(result.unmount);
    expect(boxesSheets()).toHaveLength(0);
    expect(surface()).toBeNull();
    expect(result.toolbar.getCommands()).toEqual([]);
  });

  it("removes every listener it added, so nothing survives as a ghost", async () => {
    // The types this extension binds. Core binds none of them outside a panel
    // drag, so an outstanding one here belongs to the overlays.
    const watched = new Set([
      "pointermove",
      "pointerdown",
      "pointerleave",
      "scroll",
      "resize",
    ]);
    const outstanding = new Map<string, number>();
    const key = (type: string, options: unknown) =>
      `${type}|${typeof options === "object" && options !== null && (options as AddEventListenerOptions).capture === true}`;
    const patch = (target: EventTarget) => {
      const add = target.addEventListener.bind(target);
      const remove = target.removeEventListener.bind(target);
      vi.spyOn(target, "addEventListener").mockImplementation(
        (type, listener, options) => {
          if (watched.has(type)) {
            const id = key(type, options);
            outstanding.set(id, (outstanding.get(id) ?? 0) + 1);
          }
          add(type, listener, options);
        },
      );
      vi.spyOn(target, "removeEventListener").mockImplementation(
        (type, listener, options) => {
          if (watched.has(type)) {
            const id = key(type, options);
            outstanding.set(id, (outstanding.get(id) ?? 0) - 1);
          }
          remove(type, listener, options);
        },
      );
    };
    patch(window);
    patch(document);

    mount({ defaults: { inspect: true, focus: true } });
    await frame();
    expect([...outstanding.values()].some((count) => count > 0)).toBe(true);

    for (const unmount of unmountAll.splice(0)) unmount();
    expect(
      [...outstanding.entries()].filter(([, count]) => count !== 0),
    ).toEqual([]);
  });

  it("detaches its listeners on teardown, so a later event measures nothing", async () => {
    const { toolbar } = mount({ defaults: { inspect: true } });
    const target = document.querySelector('[data-testid="named"]') as Element;
    withRect(target, { x: 10, y: 40, width: 80, height: 24 });
    let hits = 0;
    pointAt(target);
    (
      document as Document & { elementFromPoint: () => Element | null }
    ).elementFromPoint = () => {
      hits += 1;
      return target;
    };
    fireEvent.pointerMove(window, { clientX: 20, clientY: 50 });
    await frame();
    expect(hits).toBeGreaterThan(0);
    expect(toolbar.overlay("overlays")).not.toBeNull();

    for (const unmount of unmountAll.splice(0)) unmount();
    const after = hits;
    fireEvent.pointerMove(window, { clientX: 30, clientY: 60 });
    await frame();
    expect(hits).toBe(after);
  });
});

/* -------------------------------------------------------------------------- */

describe("what it costs, asserted rather than claimed", () => {
  it("resolves accessible names once per scan, not once per element per frame", async () => {
    // `aria-labelledby` is the branch that reaches outside the element, so
    // counting `getElementById` counts name resolutions.
    const named = document.createElement("div");
    named.innerHTML = `<span id="lbl">Save</span>`;
    document.body.appendChild(named);

    const { toolbar } = mount({ defaults: { focus: true } });
    const target = document.querySelector('[data-testid="named"]') as Element;
    target.setAttribute("aria-labelledby", "lbl");
    target.removeAttribute("aria-label");
    withRect(target, { x: 10, y: 40, width: 80, height: 24 });
    await frame();
    expect(badges()).toHaveLength(1);
    // Let the mutation debounce from setting the attribute above drain, so the
    // count below measures scroll frames and nothing else.
    await settle();

    const lookups = vi.spyOn(document, "getElementById");
    // Ten scroll frames. Nothing here is a mutation, so nothing may resolve a
    // name: the cost line promises one rect per element per scroll frame and
    // nothing else. (What makes the cache *correct* rather than merely cheap is
    // the observer covering every mutation that can change a name — the test
    // below is the one that pins that, and it is the half this comment used to
    // assert instead of check.)
    for (let index = 0; index < 10; index += 1) {
      fireEvent.scroll(window);
      await frame();
    }
    expect(badges()).toHaveLength(1);
    expect(lookups).not.toHaveBeenCalled();

    // A mutation, though, must re-resolve — or the cache would be a bug rather
    // than an optimisation.
    await act(async () => {
      target.setAttribute("aria-label", "Renamed");
    });
    await settle();
    expect(badges()[0]?.textContent).toContain("Renamed");
    named.remove();
    expect(toolbar.bar()).not.toBeNull();
  });

  it("re-resolves a name written straight into an existing text node", async () => {
    mount({ defaults: { focus: true } });
    const target = document.querySelector('[data-testid="named"]') as Element;
    target.removeAttribute("aria-label");
    target.textContent = "Save";
    withRect(target, { x: 10, y: 40, width: 80, height: 24 });
    await settle();
    expect(badges()[0]?.dataset["dtbNamed"]).toBe("true");

    // How React updates `<button>{label}</button>` when only the label changed:
    // it writes `nodeValue` on the existing Text node. That is a characterData
    // record and nothing else — no childList, no attribute — so an observer
    // that did not ask for it saw nothing at all, and the cached name went on
    // saying "named" over a button with no text. Before names were cached this
    // self-healed on the next scroll frame, which is why caching them is what
    // turned a blind spot into a lasting lie.
    const text = target.firstChild as Text;
    expect(text.nodeType).toBe(3);
    await act(async () => {
      text.nodeValue = "";
    });
    await settle();

    expect(badges()[0]?.dataset["dtbNamed"]).toBe("false");
    expect(badges()[0]?.textContent).toContain("unnamed");

    // ...and back again, so this is a live cache and not a one-way latch.
    await act(async () => {
      text.nodeValue = "Save again";
    });
    await settle();
    expect(badges()[0]?.dataset["dtbNamed"]).toBe("true");
    expect(badges()[0]?.textContent).toContain("Save again");
  });

  it("does not rescan because of the badges it drew itself", async () => {
    mount({ defaults: { focus: true } });
    const target = document.querySelector('[data-testid="named"]') as Element;
    withRect(target, { x: 10, y: 40, width: 80, height: 24 });
    await frame();
    await settle();

    const scans = vi.spyOn(document, "querySelectorAll");
    const scanCount = () =>
      scans.mock.calls.filter(
        ([selector]) =>
          typeof selector === "string" && selector.includes("audio[controls]"),
      ).length;

    // A mutation whose every record is inside the toolbar — which is exactly
    // what drawing and removing badges looks like to the observer, since the
    // surface is portaled into `body`.
    const chip = document.querySelector('[data-dtb-part="ovl-chip"]') as Element;
    await act(async () => {
      chip.appendChild(document.createElement("span"));
    });
    await settle();
    expect(scanCount()).toBe(0);

    // An application mutation still does, or the overlay would go stale.
    const appNode = document.createElement("button");
    await act(async () => {
      document.body.appendChild(appNode);
    });
    await settle();
    expect(scanCount()).toBeGreaterThan(0);
    appNode.remove();
  });
});

describe("two toolbars on one page", () => {
  const sheet = () =>
    document.head.querySelector(
      `style[data-dev-toolbar-styles="${BOXES_STYLE_ENTRY}"]`,
    );

  it("does not take one instance's outlines away when another unmounts", async () => {
    const first = renderWithToolbar(app, {
      extensions: [overlays({ defaults: { boxes: true } })],
      instanceId: "one",
      storage: createMemoryStorage(),
    });
    const second = renderWithToolbar(<p>second</p>, {
      extensions: [overlays({ defaults: { boxes: true } })],
      instanceId: "two",
      storage: createMemoryStorage(),
    });
    unmountAll.push(first.unmount, second.unmount);
    expect(sheet()).not.toBeNull();
    expect(sheet()?.getAttribute(BOXES_REFS_ATTRIBUTE)).toBe("2");

    second.unmount();
    unmountAll.splice(unmountAll.indexOf(second.unmount), 1);
    // The first instance's chip and panel still say boxes is on, so the
    // outlines have to still be there. Unconditional removal used to make those
    // two disagree.
    expect(sheet(), "the surviving instance still has boxes on").not.toBeNull();
    expect(sheet()?.getAttribute(BOXES_REFS_ATTRIBUTE)).toBe("1");

    first.unmount();
    unmountAll.splice(unmountAll.indexOf(first.unmount), 1);
    expect(sheet()).toBeNull();
  });

  it("treats a sheet with no count as held, rather than as free to remove", () => {
    const stray = document.createElement("style");
    stray.setAttribute("data-dev-toolbar-styles", BOXES_STYLE_ENTRY);
    document.head.appendChild(stray);
    setHostOutlines(true);
    // One insert, one release: an older or foreign sheet counts as one holder,
    // so the release balances rather than deleting somebody else's.
    expect(sheet()?.getAttribute(BOXES_REFS_ATTRIBUTE)).toBe("2");
    setHostOutlines(false);
    expect(sheet()).not.toBeNull();
    setHostOutlines(false);
    expect(sheet()).toBeNull();
  });
});

describe("the focus scan describes the real tab sequence", () => {
  it("keeps aria-disabled elements, which are still Tab stops", async () => {
    mount({ defaults: { focus: true } });
    const named = document.querySelector('[data-testid="named"]') as Element;
    const unnamed = document.querySelector('[data-testid="unnamed"]') as Element;
    named.setAttribute("aria-disabled", "true");
    unnamed.setAttribute("disabled", "");
    withRect(named, { x: 10, y: 40, width: 80, height: 24 });
    withRect(unnamed, { x: 100, y: 40, width: 24, height: 24 });
    await frame();

    // aria-disabled is a promise to assistive technology, not a change to focus
    // behaviour: leaving it out described a sequence with a missing stop. The
    // `disabled` attribute on a button genuinely does remove it.
    expect(badges().map((badge) => badge.textContent)).toEqual([
      "1Save the document",
    ]);
  });

  it("skips controls inside a disabled fieldset, but not its legend", async () => {
    const form = document.createElement("div");
    form.innerHTML =
      `<fieldset disabled>` +
      `<legend><button data-testid="legend-button" aria-label="Enable section"></button></legend>` +
      `<button data-testid="inside" aria-label="Inside"></button>` +
      `</fieldset>`;
    document.body.prepend(form);

    mount({ defaults: { focus: true } });
    const legendButton = form.querySelector(
      '[data-testid="legend-button"]',
    ) as Element;
    const inside = form.querySelector('[data-testid="inside"]') as Element;
    const named = document.querySelector('[data-testid="named"]') as Element;
    withRect(legendButton, { x: 0, y: 10, width: 40, height: 20 });
    withRect(inside, { x: 50, y: 10, width: 40, height: 20 });
    withRect(named, { x: 10, y: 40, width: 80, height: 24 });
    await frame();

    // A disabled fieldset disables everything it contains — except controls in
    // its first legend, which stay tabbable so a section can be switched back
    // on. Numbering the disabled ones would describe stops that do not exist.
    expect(badges().map((badge) => badge.textContent)).toEqual([
      "1Enable section",
      "2Save the document",
    ]);
    form.remove();
  });

  it("does not let hidden inputs consume the badge limit", async () => {
    const hidden = document.createElement("div");
    hidden.innerHTML = `<input type="hidden" name="a"><input type="hidden" name="b">`;
    document.body.prepend(hidden);

    mount({ defaults: { focus: true }, focusLimit: 2 });
    const named = document.querySelector('[data-testid="named"]') as Element;
    const unnamed = document.querySelector('[data-testid="unnamed"]') as Element;
    withRect(named, { x: 10, y: 40, width: 80, height: 24 });
    withRect(unnamed, { x: 100, y: 40, width: 24, height: 24 });
    await frame();

    // Both hidden inputs used to fill the limit and then be dropped at measure
    // time: a scan that stopped early over elements it was never going to draw.
    expect(badges()).toHaveLength(2);
    hidden.remove();
  });
});

/* -------------------------------------------------------------------------- */

describe("failing closed", () => {
  it("switches every overlay off when a measurement throws, and says so", async () => {
    const { toolbar } = mount({ defaults: { inspect: true, grid: true } });
    const target = document.querySelector('[data-testid="named"]') as Element;
    target.getBoundingClientRect = () => {
      throw new Error("layout is not available");
    };
    pointAt(target);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    fireEvent.pointerMove(window, { clientX: 20, clientY: 50 });
    await frame();

    // A measurement runs inside an animation frame, where nobody upstream can
    // catch it and where it would recur every frame. Off is the only honest
    // response, and the toolbar is still standing.
    expect(error).toHaveBeenCalled();
    expect(surface()).toBeNull();
    expect(toolbar.bar()).not.toBeNull();
    expect(toolbar.errorChip()).toBeNull();

    act(() => toolbar.openPanel("overlays"));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "layout is not available",
    );
    expect(
      rows().map((row) => row.dataset["dtbOn"]),
    ).toEqual(["false", "false", "false", "false"]);
  });

  it("leaves the stored toggles alone when a measurement throws", async () => {
    const storage = createMemoryStorage();
    const { toolbar } = mount({ defaults: { inspect: true } }, storage);
    act(() => toolbar.openPanel("overlays"));
    toggleRow("grid");
    const chosen = storage.getItem(STORAGE_KEY);
    expect(JSON.parse(chosen as string)).toMatchObject({
      grid: true,
      inspect: true,
    });

    const target = document.querySelector('[data-testid="named"]') as Element;
    target.getBoundingClientRect = () => {
      throw new Error("layout is not available");
    };
    pointAt(target);
    vi.spyOn(console, "error").mockImplementation(() => {});
    fireEvent.pointerMove(window, { clientX: 20, clientY: 50 });
    await frame();

    expect(surface()).toBeNull();
    // Off in memory, unchanged on disk: one transient throw must not cost the
    // developer the toggles they chose on every future load.
    expect(storage.getItem(STORAGE_KEY)).toBe(chosen);
  });

  it("survives a storage adapter that throws on both ends", () => {
    const broken: ToolbarStorage = {
      getItem: () => {
        throw new Error("no");
      },
      setItem: () => {
        throw new Error("no");
      },
      removeItem: () => {
        throw new Error("no");
      },
    };
    const { toolbar } = mount({}, broken);
    act(() => toolbar.openPanel("overlays"));
    toggleRow("grid");
    expect(document.querySelector('[data-dtb-part="ovl-grid"]')).not.toBeNull();
  });

  it("persists nothing when asked not to", () => {
    const storage = createMemoryStorage();
    const { toolbar } = mount({ persist: false }, storage);
    act(() => toolbar.openPanel("overlays"));
    toggleRow("grid");
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(document.querySelector('[data-dtb-part="ovl-grid"]')).not.toBeNull();
  });
});
