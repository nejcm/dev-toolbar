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
import { KIT_CSS } from "@nejcm/dev-toolbar/kit";
import { cleanupToolbar, mountToolbar } from "@nejcm/dev-toolbar/testing";
import { createMemoryStorage } from "../../../core/storage";
import { overlays } from "../index";
import { BOXES_REFS_ATTRIBUTE, BOXES_STYLE_ENTRY, ENABLED_KEY, setHostOutlines } from "../runtime";
import { OVERLAYS_CSS } from "../css";
import type { OverlaysOptions } from "../index";
import type { ToolbarStorage } from "../../../core/contract";

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

const mount = (options: OverlaysOptions = {}, storage?: ToolbarStorage, styleNonce?: string) => {
  const extension = overlays(options);
  const result = mountToolbar(app, {
    extensions: [extension],
    instanceId: "test",
    ...(storage === undefined ? {} : { storage }),
    ...(styleNonce === undefined ? {} : { styleNonce }),
  });
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
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-dtb-part="ovl-row"]')];
const toggleRow = (id: string) => {
  const row = document.querySelector<HTMLElement>(
    `[data-dtb-part="ovl-row"][data-dtb-overlay="${id}"]`,
  );
  const button = row?.querySelector<HTMLButtonElement>('[data-dtb-part="ovl-toggle"]');
  if (!button) throw new Error(`no toggle for ${id}`);
  act(() => button.click());
};
const boxesSheets = () =>
  document.head.querySelectorAll(`style[data-dev-toolbar-styles="${BOXES_STYLE_ENTRY}"]`);
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
  cleanupToolbar();
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
    const ids = (extension.commands as () => readonly { id: string }[])().map(
      (command) => command.id,
    );
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
    expect(document.querySelector('[data-dtb-part="ovl-grid"]')).not.toBeNull();
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
    await toolbar.runCommand("overlays.toggle.grid");
    expect(labelOf("overlays.toggle.grid")).toBe("Hide overlay: Column grid");
    expect(document.querySelector('[data-dtb-part="ovl-grid"]')).not.toBeNull();

    await toolbar.runCommand("overlays.toggle.boxes");
    expect(boxesSheets()).toHaveLength(1);

    await toolbar.runCommand("overlays.disableAll");
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
    expect(boxesSheets()).toHaveLength(0);

    mount({}, storage);
    expect(document.querySelector('[data-dtb-part="ovl-grid"]')).not.toBeNull();
    expect(boxesSheets()).toHaveLength(1);
  });

  it("keeps the stored map when every toggle is back at the configured default", () => {
    const storage = createMemoryStorage();
    const { toolbar } = mount({}, storage);
    act(() => toolbar.openPanel("overlays"));
    toggleRow("grid");
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
    toggleRow("grid");
    // All off *is* the default here, and the entry stays anyway: the map
    // records what the developer chose, not merely what it equals.
    expect(JSON.parse(storage.getItem(STORAGE_KEY) as string)).toEqual({
      boxes: false,
      grid: false,
      inspect: false,
      focus: false,
    });
  });

  it("persists disableAll with no defaults configured, and no later default revives a layer", async () => {
    const storage = createMemoryStorage();
    const first = mount({}, storage);
    await first.toolbar.runCommand("overlays.toggle.grid");
    await first.toolbar.runCommand("overlays.toggle.focus");
    await first.toolbar.runCommand("overlays.disableAll");
    const stored = storage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).toEqual({
      boxes: false,
      grid: false,
      inspect: false,
      focus: false,
    });
    first.unmount();

    mount({ defaults: { grid: true } }, storage);
    expect(document.querySelector('[data-dtb-part="ovl-grid"]')).toBeNull();
    expect(surface()).toBeNull();
  });

  it("stores all-off when the consumer's defaults turn something on", () => {
    const storage = createMemoryStorage();
    const first = mount({ defaults: { boxes: true } }, storage);
    expect(boxesSheets()).toHaveLength(1);
    act(() => first.toolbar.openPanel("overlays"));
    toggleRow("boxes");
    expect(JSON.parse(storage.getItem(STORAGE_KEY) as string)).toEqual({
      boxes: false,
      grid: false,
      inspect: false,
      focus: false,
    });
    first.unmount();

    mount({ defaults: { boxes: true } }, storage);
    expect(boxesSheets()).toHaveLength(0);

    // Turning boxes back on equals the default again, yet the entry stays.
    cleanupToolbar();
    const third = mount({ defaults: { boxes: true } }, storage);
    act(() => third.toolbar.openPanel("overlays"));
    toggleRow("boxes");
    expect(JSON.parse(storage.getItem(STORAGE_KEY) as string)).toEqual({
      boxes: true,
      grid: false,
      inspect: false,
      focus: false,
    });
  });

  it("lets a corrupted stored map turn nothing on", () => {
    const storage = createMemoryStorage();
    storage.setItem(STORAGE_KEY, "{not json");
    mount({ defaults: { grid: true } }, storage);
    // Fail-closed, and it beats `defaults` too — an unreadable stored map must not be guessed at.
    expect(surface()).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe("what it refuses to touch", () => {
  it("leaves the host DOM byte-for-byte as it found it", async () => {
    // Outside Testing Library's container, so it survives the unmount — the container itself gets emptied by `cleanup`.
    const host = document.createElement("section");
    host.innerHTML = `<h2 class="title">Host</h2><a href="#x">link</a>`;
    document.body.appendChild(host);
    const hostBefore = host.outerHTML;

    const { toolbar, getByTestId } = mount();
    const appBefore = getByTestId("app").outerHTML;

    act(() => toolbar.openPanel("overlays"));
    for (const id of ["boxes", "grid", "inspect", "focus"]) toggleRow(id);
    await frame();

    // Every overlay is on; the application's own markup is untouched.
    expect(getByTestId("app").outerHTML).toBe(appBefore);
    expect(host.outerHTML).toBe(hostBefore);

    cleanupToolbar();

    expect(host.outerHTML).toBe(hostBefore);
    // Nothing of this package is left anywhere in the document.
    expect(document.querySelector("[data-dev-toolbar]")).toBeNull();
    expect(document.querySelector("[data-dtb-part]")).toBeNull();
    expect(surface()).toBeNull();
    expect(boxesSheets()).toHaveLength(0);
    expect(document.head.innerHTML).not.toContain(BOXES_STYLE_ENTRY);
    // The extension's own stylesheet stays, like core's: it matches only
    // `[data-dev-toolbar]` descendants, so with the toolbar gone it matches nothing.
    expect(
      document.head.querySelector('style[data-dev-toolbar-styles="ext-overlays"]'),
    ).not.toBeNull();
    // Outside Testing Library's container, so `cleanup` won't remove it — and a stray tabbable node would affect later tests.
    host.remove();
  });

  it("takes no pointer events: nothing it draws is interactive", async () => {
    const { toolbar } = mount({ defaults: { grid: true, focus: true } });
    await frame();
    const layer = surface() as HTMLElement;

    // The structural half of the guarantee: there is nothing in here to
    // interact with in the first place.
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(layer.querySelectorAll("button, a, input, select, textarea, [tabindex]")).toHaveLength(
      0,
    );
    expect(layer.querySelectorAll("[onclick]")).toHaveLength(0);
    expect(toolbar.bar()).not.toBeNull();
  });

  /**
   * A prior version of this test was a regex over the stylesheet's own text,
   * which stayed green while the guarantee it described was defeated: the
   * declarations sat inside `@layer dev-toolbar`, designed by §4.1 to *lose*
   * to unlayered author rules, so `div { pointer-events: auto }` turned a
   * viewport-sized overlay into a click trap.
   *
   * jsdom's cascade is last-declaration-wins and ignores specificity and
   * `!important`, so a `getComputedStyle` assertion here would test jsdom, not
   * us. Instead this reads the parsed declarations back out of the CSSOM and
   * asserts the priority the cascade will act on — the cascade itself is
   * verified in a browser and recorded in §14.7.
   */
  it("marks its safety declarations !important, so app CSS cannot undo them", () => {
    // jsdom rejects a sheet containing `@layer` outright, so the self-contained
    // kit prefix and extension wrapper come off before the parser sees it.
    const sheet = document.createElement("style");
    const extensionCss = OVERLAYS_CSS.replace(KIT_CSS, "").trimStart();
    sheet.textContent = extensionCss.replace(/^@layer dev-toolbar \{/, "").replace(/\}\s*$/, "");
    document.head.appendChild(sheet);
    const rules = [...(sheet.sheet?.cssRules ?? [])] as CSSStyleRule[];
    expect(rules.length).toBeGreaterThan(10);

    const ruleFor = (selector: string) => {
      const found = rules.find((rule) => rule.selectorText === selector);
      if (!found) throw new Error(`no rule for ${selector}`);
      return found.style;
    };

    const surfaceRule = ruleFor('[data-dev-toolbar] [data-dtb-part="ovl-surface"]');
    for (const property of ["pointer-events", "z-index", "position", "inset"]) {
      expect(surfaceRule.getPropertyPriority(property), `${property} on the surface`).toBe(
        "important",
      );
    }
    // Descendants are covered by their own rule, not inheritance, so a hostile rule matching them must be beaten separately.
    expect(
      ruleFor('[data-dev-toolbar] [data-dtb-part="ovl-surface"] *').getPropertyPriority(
        "pointer-events",
      ),
    ).toBe("important");

    // And the guard stays narrow: everything else is ordinary layered CSS a consumer can override.
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
    expect(document.querySelector('[data-dtb-part="ovl-label-target"]')?.textContent).toBe(
      "button",
    );

    // The pointer moves over the bar; elementFromPoint returns the toolbar.
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
    // A real, tabbable button with a real rect — excluded only by the scan.
    const trigger = toolbar.item("overlays")?.querySelector("button") as HTMLElement;
    withRect(trigger, { x: 0, y: 700, width: 60, height: 20 });

    await frame();
    expect(badges().map((badge) => badge.dataset["dtbFocusIndex"])).toEqual(["1", "2"]);
    expect(badges().map((badge) => badge.dataset["dtbNamed"])).toEqual(["true", "false"]);
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
    expect(boxesSheets()).toHaveLength(0);
    expect(surface()).toBeNull();

    act(() => toolbar.setVisible(true));
    await frame();
    expect(boxesSheets()).toHaveLength(1);
    // Toggles survived being hidden, rather than being reset.
    expect(
      toolbar
        .context()
        .getCommands()
        .find((command) => command.id === "overlays.toggle.boxes")?.label,
    ).toBe("Hide overlay: Layout boxes");
  });

  it("is never started, and draws nothing, while it is hidden from the actor", () => {
    const extension = overlays({ hidden: true, defaults: { boxes: true } });
    const result = mountToolbar(app, {
      extensions: [extension],
      instanceId: "test",
    });
    expect(boxesSheets()).toHaveLength(0);
    expect(surface()).toBeNull();
    expect(result.toolbar.getCommands()).toEqual([]);
  });

  it("removes every listener it added, so nothing survives as a ghost", async () => {
    // Core binds none of these outside a panel drag, so an outstanding one belongs to the overlays.
    const watched = new Set(["pointermove", "pointerdown", "pointerleave", "scroll", "resize"]);
    const outstanding = new Map<string, number>();
    const key = (type: string, options: unknown) =>
      `${type}|${typeof options === "object" && options !== null && (options as AddEventListenerOptions).capture === true}`;
    const patch = (target: EventTarget) => {
      const add = target.addEventListener.bind(target);
      const remove = target.removeEventListener.bind(target);
      vi.spyOn(target, "addEventListener").mockImplementation((type, listener, options) => {
        if (watched.has(type)) {
          const id = key(type, options);
          outstanding.set(id, (outstanding.get(id) ?? 0) + 1);
        }
        add(type, listener, options);
      });
      vi.spyOn(target, "removeEventListener").mockImplementation((type, listener, options) => {
        if (watched.has(type)) {
          const id = key(type, options);
          outstanding.set(id, (outstanding.get(id) ?? 0) - 1);
        }
        remove(type, listener, options);
      });
    };
    patch(window);
    patch(document);

    mount({ defaults: { inspect: true, focus: true } });
    await frame();
    expect([...outstanding.values()].some((count) => count > 0)).toBe(true);

    cleanupToolbar();
    expect([...outstanding.entries()].filter(([, count]) => count !== 0)).toEqual([]);
  });

  it("detaches its listeners on teardown, so a later event measures nothing", async () => {
    const { toolbar } = mount({ defaults: { inspect: true } });
    const target = document.querySelector('[data-testid="named"]') as Element;
    withRect(target, { x: 10, y: 40, width: 80, height: 24 });
    let hits = 0;
    pointAt(target);
    (document as Document & { elementFromPoint: () => Element | null }).elementFromPoint = () => {
      hits += 1;
      return target;
    };
    fireEvent.pointerMove(window, { clientX: 20, clientY: 50 });
    await frame();
    expect(hits).toBeGreaterThan(0);
    expect(toolbar.overlay("overlays")).not.toBeNull();

    cleanupToolbar();
    const after = hits;
    fireEvent.pointerMove(window, { clientX: 30, clientY: 60 });
    await frame();
    expect(hits).toBe(after);
  });
});

/* -------------------------------------------------------------------------- */

describe("what it costs, asserted rather than claimed", () => {
  it("resolves accessible names once per scan, not once per element per frame", async () => {
    // aria-labelledby reaches outside the element, so counting getElementById counts name resolutions.
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
    // Drain the mutation debounce from setting the attribute above, so the count below measures scroll frames only.
    await settle();

    const lookups = vi.spyOn(document, "getElementById");
    // Ten scroll frames, no mutations — nothing here should resolve a name.
    for (let index = 0; index < 10; index += 1) {
      fireEvent.scroll(window);
      await frame();
    }
    expect(badges()).toHaveLength(1);
    expect(lookups).not.toHaveBeenCalled();

    // A mutation, though, must re-resolve.
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

    // React writes nodeValue on the existing Text node for `<button>{label}</button>` —
    // a characterData record, no childList/attribute, so an observer not
    // watching for it would leave the cached name lying.
    const text = target.firstChild as Text;
    expect(text.nodeType).toBe(3);
    await act(async () => {
      text.nodeValue = "";
    });
    await settle();

    expect(badges()[0]?.dataset["dtbNamed"]).toBe("false");
    expect(badges()[0]?.textContent).toContain("unnamed");

    // And back again — a live cache, not a one-way latch.
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
        ([selector]) => typeof selector === "string" && selector.includes("audio[controls]"),
      ).length;

    // A mutation whose every record is inside the toolbar — what drawing/removing badges looks like since the surface is portaled into `body`.
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
    document.head.querySelector(`style[data-dev-toolbar-styles="${BOXES_STYLE_ENTRY}"]`);

  it("does not take one instance's outlines away when another unmounts", async () => {
    const first = mountToolbar(app, {
      extensions: [overlays({ defaults: { boxes: true } })],
      instanceId: "one",
      storage: createMemoryStorage(),
    });
    const second = mountToolbar(<p>second</p>, {
      extensions: [overlays({ defaults: { boxes: true } })],
      instanceId: "two",
      storage: createMemoryStorage(),
    });
    expect(sheet()).not.toBeNull();
    expect(sheet()?.getAttribute(BOXES_REFS_ATTRIBUTE)).toBe("2");

    second.unmount();
    // The first instance's chip/panel still say boxes is on; unconditional removal used to disagree with that.
    expect(sheet(), "the surviving instance still has boxes on").not.toBeNull();
    expect(sheet()?.getAttribute(BOXES_REFS_ATTRIBUTE)).toBe("1");

    first.unmount();
    expect(sheet()).toBeNull();
  });

  it("treats a sheet with no count as held, rather than as free to remove", () => {
    const stray = document.createElement("style");
    stray.setAttribute("data-dev-toolbar-styles", BOXES_STYLE_ENTRY);
    document.head.appendChild(stray);
    setHostOutlines(true);
    // An older or foreign sheet counts as one holder, so the release balances rather than deleting somebody else's.
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

    // aria-disabled is a promise to assistive tech, not a focus-behaviour change; `disabled` genuinely removes the stop.
    expect(badges().map((badge) => badge.textContent)).toEqual(["1Save the document"]);
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
    const legendButton = form.querySelector('[data-testid="legend-button"]') as Element;
    const inside = form.querySelector('[data-testid="inside"]') as Element;
    const named = document.querySelector('[data-testid="named"]') as Element;
    withRect(legendButton, { x: 0, y: 10, width: 40, height: 20 });
    withRect(inside, { x: 50, y: 10, width: 40, height: 20 });
    withRect(named, { x: 10, y: 40, width: 80, height: 24 });
    await frame();

    // A disabled fieldset disables everything it contains except controls in its first legend.
    expect(badges().map((badge) => badge.textContent)).toEqual([
      "1Enable section",
      "2Save the document",
    ]);
    form.remove();
  });

  it("skips a focusable inside an inert ancestor", async () => {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("inert", "");
    wrapper.innerHTML = `<button data-testid="in-inert" aria-label="Inside inert"></button>`;
    document.body.appendChild(wrapper);

    mount({ defaults: { focus: true } });
    const inside = wrapper.querySelector('[data-testid="in-inert"]') as Element;
    withRect(inside, { x: 0, y: 10, width: 80, height: 24 });
    await frame();

    expect(badges().some((badge) => badge.textContent?.includes("Inside inert"))).toBe(false);
    wrapper.remove();
  });

  it("flags aria-hidden focusables that remain Tab stops", async () => {
    const hidden = document.createElement("button");
    hidden.setAttribute("aria-hidden", "true");
    hidden.setAttribute("aria-label", "Hidden but focusable");
    document.body.appendChild(hidden);

    mount({ defaults: { focus: true } });
    withRect(hidden, { x: 0, y: 10, width: 80, height: 24 });
    await frame();

    const flagged = badges().find((badge) => badge.textContent?.includes("Hidden but focusable"));
    expect(flagged).toBeDefined();
    expect(flagged?.querySelector('[data-dtb-part="ovl-tag"]')?.textContent).toBe("aria-hidden");
    hidden.remove();
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

    // Both hidden inputs used to fill the limit and then be dropped at measure time.
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

    expect(error).toHaveBeenCalled();
    expect(surface()).toBeNull();
    expect(toolbar.bar()).not.toBeNull();
    expect(toolbar.errorChip()).toBeNull();

    act(() => toolbar.openPanel("overlays"));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "layout is not available",
    );
    expect(rows().map((row) => row.dataset["dtbOn"])).toEqual(["false", "false", "false", "false"]);
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
    // Off in memory, unchanged on disk — a transient throw must not cost the developer their toggles.
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

describe("styleNonce", () => {
  const sheet = () =>
    document.head.querySelector<HTMLStyleElement>(
      `style[data-dev-toolbar-styles="${BOXES_STYLE_ENTRY}"]`,
    );

  it("stamps the factory option on the boxes sheet", () => {
    mount({ styleNonce: "from-option", defaults: { boxes: true } });
    expect(sheet()?.nonce).toBe("from-option");
  });

  it("stamps the slot prop on the boxes sheet", () => {
    mount({ defaults: { boxes: true } }, undefined, "from-slot");
    expect(sheet()?.nonce).toBe("from-slot");
  });

  it("stamps the slot prop when boxes are switched on after mount", async () => {
    const { toolbar } = mount({}, undefined, "abc");
    expect(boxesSheets()).toHaveLength(0);
    act(() => toolbar.openPanel("overlays"));
    toggleRow("boxes");
    expect(sheet()?.nonce).toBe("abc");
    // Same through a command, which is the path with no panel in the DOM.
    toggleRow("boxes");
    expect(boxesSheets()).toHaveLength(0);
    await act(async () => {
      await toolbar.runCommand("overlays.toggle.boxes");
    });
    expect(sheet()?.nonce).toBe("abc");
  });

  it("inserts no un-nonced sheet before the overlay surface has mounted", () => {
    // A hidden bar renders no overlay surface, so nothing has told the runtime the nonce yet.
    const extension = overlays({ defaults: { boxes: true } });
    const { toolbar } = mountToolbar(app, {
      extensions: [extension],
      instanceId: "test",
      styleNonce: "abc",
      defaultVisible: false,
    });
    expect(boxesSheets()).toHaveLength(0);
    act(() => toolbar.setVisible(true));
    expect(boxesSheets()).toHaveLength(1);
    expect(sheet()?.nonce).toBe("abc");
  });
});

/* -------------------------------------------------------------------------- */

describe("a failed measurement's error text is outbound", () => {
  /**
   * `diagnostics().error` leaves the page through the agent bridge, so the
   * thrown message is masked *before* `fail()` writes its sentence — a URL
   * carrying a credential must not survive into the snapshot, or the alert.
   */
  const failWith = async (thrown: unknown) => {
    const { toolbar, extension } = mount({ defaults: { inspect: true } });
    const target = document.querySelector('[data-testid="named"]') as Element;
    target.getBoundingClientRect = () => {
      throw thrown;
    };
    pointAt(target);
    vi.spyOn(console, "error").mockImplementation(() => {});
    fireEvent.pointerMove(window, { clientX: 20, clientY: 50 });
    await frame();
    act(() => toolbar.openPanel("overlays"));
    return {
      snapshot: extension.diagnostics?.() as { error: unknown; on: string[] },
      alert: document.querySelector('[role="alert"]')?.textContent ?? null,
    };
  };

  it("masks a credential-carrying URL before it reaches the snapshot", async () => {
    const { snapshot, alert } = await failWith(new Error("failed for https://x/?token=abc"));
    expect(snapshot.error).toContain("failed for https://x/?token=[redacted]");
    expect(snapshot.error).not.toContain("abc");
    expect(alert).not.toContain("abc");
  });

  it("still fails closed when the message getter throws", async () => {
    const hostile = Object.defineProperty(new Error("x"), "message", {
      get() {
        throw new Error("no");
      },
    });
    const { snapshot } = await failWith(hostile);
    expect(snapshot.error).toContain("[unreadable]");
    expect(snapshot.on).toEqual([]);
  });

  it("describes a non-string message by its tag, as a string", async () => {
    const { snapshot } = await failWith(Object.assign(new Error("x"), { message: 42 }));
    expect(snapshot.error).toContain("[object Error]");
    expect(snapshot.on).toEqual([]);
  });
});
