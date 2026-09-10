/**
 * `embed()` against the real shell, through the `/testing` surface a stranger
 * embedding a third-party panel would use.
 *
 * Two of the guarantees below are core's, not the helper's — the error chip
 * with a working retry, and a closed panel unmounting unless `keepMounted`.
 * They are asserted here on purpose (plans/ecosystem-extensions.md §0C): the
 * recipe in `docs/embedding.md` leans on them, so a regression in core would
 * break an embedded tool, and this is the file that says so.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_VERSION } from "@nejcm/dev-toolbar";
import { cleanupToolbar, makeExtension, mountToolbar } from "@nejcm/dev-toolbar/testing";
import { STYLE_ATTRIBUTE } from "../../runtime/styles";
import { embed } from "../embed";
import type { PanelSlotProps } from "../../core/contract";

afterEach(() => {
  cleanupToolbar();
  document.head.querySelectorAll(`style[${STYLE_ATTRIBUTE}]`).forEach((node) => node.remove());
});

/** Stands in for a third-party devtool: its own DOM, its own state, no kit attributes. */
function ThirdParty({ height }: { height: number }): ReactNode {
  const [count, setCount] = useState(0);
  return (
    <section className="vendor-devtools" data-height={height}>
      <button type="button" onClick={() => setCount((n) => n + 1)}>
        vendor count {count}
      </button>
    </section>
  );
}

// With a `value`, so the kit's chip — and the kit sheet the stylesheet tests
// below walk — are on the page; the no-`value` path has its own test.
const mount = (
  extension = embed({
    id: "vendor",
    label: "Vendor",
    value: "3 queries",
    render: (p) => <ThirdParty height={p.height} />,
  }),
) =>
  mountToolbar(null, {
    instanceId: "embed",
    extensions: [makeExtension({ id: "other", compact: "other" }), extension],
  });

const frame = () => document.querySelector<HTMLElement>('[data-dtb-part="embed-frame"]');
const injectedSheets = () =>
  Array.from(document.head.querySelectorAll(`style[${STYLE_ATTRIBUTE}]`), (node) =>
    node.getAttribute(STYLE_ATTRIBUTE),
  );

/**
 * Every style rule's selector across the injected sheets, descending through
 * `@layer` / `@media` / `@supports` blocks. Pseudo-elements are stripped: an
 * `::after` rule still *selects* the element it decorates, and `matches()`
 * rejects them.
 */
function injectedSelectors(): string[] {
  const selectors: string[] = [];
  const walk = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        selectors.push(rule.selectorText.replace(/::[a-z-]+(\([^)]*\))?/g, ""));
      } else if ("cssRules" in rule) {
        walk((rule as CSSGroupingRule).cssRules);
      }
    }
  };
  for (const sheet of Array.from(document.head.querySelectorAll<HTMLStyleElement>("style"))) {
    if (sheet.sheet) walk(sheet.sheet.cssRules);
  }
  return selectors;
}

/** The selectors in `selectors` that match at least one of `elements`. */
const reaching = (selectors: string[], elements: Element[]): string[] =>
  selectors.filter((selector) => elements.some((element) => element.matches(selector)));

/**
 * One of everything core states an element-level default for: box-sizing on
 * `*`, margins on headings/paragraphs/lists, the button face, field geometry,
 * the focus ring on anything focusable.
 */
function VendorKitchenSink(): ReactNode {
  return (
    <section className="vendor-devtools">
      <h1>Vendor</h1>
      <p>
        <a href="#vendor">docs</a>
      </p>
      <ul>
        <li>one</li>
      </ul>
      <button type="button">vendor button</button>
      <div role="button" tabIndex={0}>
        vendor role button
      </div>
      <input aria-label="vendor text" />
      <input type="checkbox" aria-label="vendor checkbox" />
      <select aria-label="vendor select">
        <option>a</option>
      </select>
      <textarea aria-label="vendor textarea" />
    </section>
  );
}

describe("embed()", () => {
  it("is a plain extension object at contract v2 with the options passed through", () => {
    const extension = embed({
      id: "vendor",
      label: "Vendor",
      render: () => null,
      align: "end",
      order: 7,
      priority: 3,
      hidden: false,
      keepMounted: true,
    });
    // Against the constant, not a literal: the kit cannot value-import core, so
    // this equality is what fails when core bumps and the helper does not.
    expect(extension.contractVersion).toBe(CONTRACT_VERSION);
    expect(extension).toMatchObject({
      id: "vendor",
      label: "Vendor",
      align: "end",
      order: 7,
      priority: 3,
      hidden: false,
      keepMounted: true,
    });
    expect(typeof extension.panel).toBe("function");
    // No `value`, no `compact` option: no compact slot — absent, not `undefined`.
    expect("compact" in extension).toBe(false);
    // Defaults: `hidden` is absent (not `false`), `keepMounted` is off.
    const bare = embed({ id: "bare", label: "Bare", render: () => null });
    expect("hidden" in bare).toBe(false);
    expect(bare.keepMounted).toBe(false);
    expect(bare.align).toBe("start");
  });

  it("without a value it has no compact slot: core's trigger, no kit chip, no kit sheet", () => {
    const { toolbar } = mount(embed({ id: "vendor", label: "Vendor", render: () => null }));

    // Core's own labelled button, exactly what the four-line recipe gets.
    const trigger = screen.getByRole("button", { name: "Vendor" });
    expect(trigger.getAttribute("data-dtb-part")).toBe("trigger");
    expect(trigger.textContent).toBe("Vendor");
    expect(document.querySelector('[data-dtb-part="embed-chip"]')).toBeNull();
    // Nothing from the kit ran on the bar, so nothing asked for its sheet.
    expect(injectedSheets()).toEqual(["core"]);

    fireEvent.click(trigger);
    expect(toolbar.activePanelId()).toBe("vendor");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    // Opening the panel does not add the sheet either: the frame is a bare div.
    expect(injectedSheets()).toEqual(["core"]);
  });

  it("does not call render() until the panel first opens", () => {
    const render = vi.fn((props: PanelSlotProps) => <ThirdParty height={props.height} />);
    const { toolbar } = mount(embed({ id: "vendor", label: "Vendor", render }));

    expect(toolbar.item("vendor")).not.toBeNull();
    expect(render).not.toHaveBeenCalled();
    expect(frame()).toBeNull();

    toolbar.openPanel("vendor");

    expect(render).toHaveBeenCalled();
    expect(frame()).not.toBeNull();
    expect(screen.getByRole("button", { name: "vendor count 0" })).toBeTruthy();
  });

  it("hands the live PanelSlotProps through, height included", () => {
    const render = vi.fn((props: PanelSlotProps) => <ThirdParty height={props.height} />);
    const { toolbar } = mount(embed({ id: "vendor", label: "Vendor", render }));
    toolbar.openPanel("vendor");

    const props = render.mock.calls.at(-1)?.[0];
    expect(props).toMatchObject({ isActive: true, density: "compact", height: 320 });
    expect(typeof props?.close).toBe("function");
    expect(document.querySelector(".vendor-devtools")?.getAttribute("data-height")).toBe("320");

    // `close()` is core's: it closes this panel and, without keepMounted, unmounts the tool.
    fireEvent.click(screen.getByRole("button", { name: "vendor count 0" }));
    expect(screen.getByRole("button", { name: "vendor count 1" })).toBeTruthy();
    toolbar.closePanel("vendor");
    expect(toolbar.activePanelId()).toBeNull();
    expect(toolbar.panel("vendor")).toBeNull();
    expect(frame()).toBeNull();

    // Reopening mounts a fresh tool: the count is back to zero.
    toolbar.openPanel("vendor");
    expect(screen.getByRole("button", { name: "vendor count 0" })).toBeTruthy();
  });

  it("fills the panel body and floors the frame at 240px, or the minHeight given", () => {
    const { toolbar, unmount } = mount();
    toolbar.openPanel("vendor");
    expect(frame()?.style.height).toBe("100%");
    expect(frame()?.style.minHeight).toBe("240px");
    unmount();

    const { toolbar: custom } = mount(
      embed({
        id: "vendor",
        label: "Vendor",
        minHeight: 400,
        render: () => <ThirdParty height={0} />,
      }),
    );
    custom.openPanel("vendor");
    expect(frame()?.style.minHeight).toBe("400px");
  });

  it("keepMounted keeps the embedded tool, and its state, alive across a close", () => {
    const render = vi.fn((props: PanelSlotProps) => <ThirdParty height={props.height} />);
    const { toolbar } = mount(embed({ id: "vendor", label: "Vendor", keepMounted: true, render }));

    // Lazy even when kept: nothing is mounted until the first open.
    expect(render).not.toHaveBeenCalled();
    expect(toolbar.panel("vendor")).toBeNull();

    toolbar.openPanel("vendor");
    fireEvent.click(screen.getByRole("button", { name: "vendor count 0" }));
    fireEvent.click(screen.getByRole("button", { name: "vendor count 1" }));

    toolbar.closePanel("vendor");
    expect(toolbar.activePanelId()).toBeNull();
    // Still in the DOM, hidden, state intact.
    const panel = toolbar.panel("vendor");
    expect(panel).not.toBeNull();
    expect(panel?.hidden).toBe(true);
    expect(screen.getByRole("button", { name: "vendor count 2", hidden: true })).toBeTruthy();

    toolbar.openPanel("vendor");
    expect(toolbar.panel("vendor")?.hidden).toBe(false);
    expect(screen.getByRole("button", { name: "vendor count 2" })).toBeTruthy();
    expect(render.mock.calls.at(-1)?.[0].isActive).toBe(true);
  });

  it("given a value, renders the kit's chip, which reads the label and toggles the panel", () => {
    const { toolbar } = mount(
      embed({ id: "vendor", label: "Vendor", value: "3 queries", render: () => null }),
    );

    // The accessible name is label then value, with no separator between the spans.
    const trigger = screen.getByRole("button", { name: /^Vendor/ });
    expect(trigger.textContent).toBe("Vendor3 queries");
    expect(trigger.getAttribute("data-dtb-part")).toBe("trigger");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    const chip = trigger.querySelector('[data-dtb-part="embed-chip"]');
    expect(chip?.getAttribute("data-dtb-kind")).toBe("chip");
    expect(
      Array.from(chip?.children ?? [], (child) => child.getAttribute("data-dtb-part")),
    ).toEqual(["embed-dot", "embed-label", "embed-value"]);

    fireEvent.click(trigger);
    expect(toolbar.activePanelId()).toBe("vendor");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(trigger);
    expect(toolbar.activePanelId()).toBeNull();
  });

  it("lets a custom compact slot replace the chip", () => {
    const { toolbar } = mount(
      embed({
        id: "vendor",
        label: "Vendor",
        render: () => null,
        compact: ({ openPanel }) => (
          <button type="button" onClick={openPanel}>
            custom trigger
          </button>
        ),
      }),
    );
    expect(document.querySelector('[data-dtb-part="embed-chip"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "custom trigger" }));
    expect(toolbar.activePanelId()).toBe("vendor");
  });

  it("injects the kit sheet for its chip and nothing for the embedded subtree", () => {
    const { toolbar } = mount();
    // Core's sheet plus the kit's — the kit's rules are keyed on data-dtb-kind,
    // which the vendor DOM never carries, so it cannot reach into the tool.
    expect(injectedSheets()).toEqual(["core", "kit"]);

    toolbar.openPanel("vendor");
    expect(injectedSheets()).toEqual(["core", "kit"]);

    // The frame is a bare div: no kind, no class, no wrapper between it and the
    // tool. It carries core's opt-out attribute, and nothing inside it does.
    const node = frame();
    expect(node?.hasAttribute("data-dtb-kind")).toBe(false);
    expect(node?.hasAttribute("data-dtb-embed")).toBe(true);
    expect(node?.className).toBe("");
    expect(node?.children).toHaveLength(1);
    expect(node?.firstElementChild?.className).toBe("vendor-devtools");
    // Not a list of the three attribute names that exist today: *no* data-dtb-*
    // attribute appears below the frame. Core's structural invariant
    // (src/core/__tests__/css.test.ts) exempts a rule whose *selected* element
    // must carry one; this checks the helper writes none below its frame for
    // this fixture, which is what keeps that exemption honest here. It says
    // nothing about arbitrary vendor markup — a tool that sets a data-dtb-*
    // attribute on its own elements would be outside the promise.
    const inside = Array.from(node?.querySelectorAll("*") ?? []);
    expect(inside.length).toBeGreaterThan(0);
    expect(
      inside.flatMap((element) =>
        element.getAttributeNames().filter((name) => name.startsWith("data-dtb-")),
      ),
    ).toEqual([]);
  });

  describe("the stylesheet rule: no core or kit selector reaches the embedded subtree", () => {
    /*
     * docs/embedding.md promises that the toolbar does not scope, reset or
     * restyle an embedded tool. Core states element-level defaults for every
     * descendant of the root — `[data-dev-toolbar] :where(button)`, the
     * box-sizing `*`, field geometry — so that promise holds only because each
     * of those rules is guarded with `:where(:not([data-dtb-embed] *))`. This
     * walks every rule in every injected sheet against a vendor DOM containing
     * one of each element those rules name, and fails on the first that
     * matches.
     *
     * What this proves is that the guard *works*. The two `:focus-visible`
     * rules select nothing until something is focused, so they get their own
     * test below. What none of it proves is that core applies the guard
     * everywhere:
     * these are the elements this fixture happens to contain, and a new
     * unguarded rule naming one it does not have would sail through. That is
     * the job of the structural invariant over core's selectors in
     * `src/core/__tests__/css.test.ts`, which needs no fixture at all.
     */
    const vendorElements = (): Element[] => {
      const root = frame()?.querySelector(".vendor-devtools");
      expect(root).not.toBeNull();
      return [root as Element, ...Array.from((root as Element).querySelectorAll("*"))];
    };

    const openKitchenSink = () => {
      const mounted = mount(
        embed({
          id: "vendor",
          label: "Vendor",
          value: "3 queries",
          render: () => <VendorKitchenSink />,
        }),
      );
      mounted.toolbar.openPanel("vendor");
      return mounted;
    };

    // Core's `:focus-visible` rules select nothing until something is
    // focused, so this focuses one vendor element and checks which rules
    // reach it. Rewritten to `:focus` first — jsdom answers `:focus-visible`
    // inconsistently, while `:focus` is exact and preserves what's under test.
    const focusRings = (): string[] =>
      injectedSelectors()
        .filter((selector) => selector.includes(":focus-visible"))
        .map((selector) => selector.replaceAll(":focus-visible", ":focus"));

    const ringsReaching = (which: "link" | "field", unguard: boolean): string[] => {
      const { unmount } = openKitchenSink();
      // The link falls under `:where(a, button, summary, [role="button"],
      // [tabindex])`, the text field under `input, select, textarea`.
      const element = frame()?.querySelector(
        which === "link" ? "a[href]" : "input:not([type])",
      ) as HTMLElement;
      expect(element).toBeTruthy();
      if (unguard) frame()?.removeAttribute("data-dtb-embed");
      element.focus();
      expect(document.activeElement).toBe(element);
      expect(element.matches(":focus")).toBe(true);

      const rings = focusRings();
      // Both guarded rules are in there, alongside the part-keyed ones.
      expect(rings).toContainEqual(
        expect.stringContaining(':where(a, button, summary, [role="button"], [tabindex])'),
      );
      expect(rings).toContainEqual(expect.stringContaining(":where(input, select, textarea)"));
      const hits = reaching(rings, [element]);
      unmount();
      return hits;
    };

    it("through embed(): the frame's subtree matches no injected rule", () => {
      openKitchenSink();

      const selectors = injectedSelectors();
      // The sheets parsed and the walk found the rules it is guarding against.
      expect(selectors.length).toBeGreaterThan(50);
      expect(selectors).toContainEqual(expect.stringContaining(":where(button)"));
      expect(selectors).toContainEqual(expect.stringContaining(":where(select)"));

      expect(reaching(selectors, vendorElements())).toEqual([]);

      // Negative control, so a guard that stopped guarding cannot pass by
      // accident: with the frame's attribute gone, the same vendor elements
      // are matched by core's box-sizing rule, its button reset and its field
      // geometry. It says nothing about the two focus rings, which select
      // nothing here because nothing is focused — that is the next test.
      frame()?.removeAttribute("data-dtb-embed");
      const unguarded = reaching(selectors, vendorElements());
      expect(unguarded).toContainEqual(expect.stringContaining(":where(button)"));
      expect(unguarded).toContainEqual(expect.stringContaining("[data-dev-toolbar] :where(:not("));
      expect(unguarded).toContainEqual(expect.stringContaining(":where(select)"));
      expect(unguarded).toContainEqual(expect.stringContaining(":where(textarea)"));
    });

    it("and neither focus ring reaches a focused vendor link or field", () => {
      expect(ringsReaching("link", false)).toEqual([]);
      expect(ringsReaching("field", false)).toEqual([]);

      // Negative control: the same two elements, focused the same way, on a
      // frame whose opt-out has been removed. Each ring is then the one rule
      // that reaches its element — so a guard dropped from either of them
      // fails the two assertions above rather than passing unnoticed.
      expect(ringsReaching("link", true)).toEqual([
        expect.stringContaining(':where(a, button, summary, [role="button"], [tabindex])'),
      ]);
      expect(ringsReaching("field", true)).toEqual([
        expect.stringContaining(":where(input, select, textarea)"),
      ]);
    });

    it("through the four-line recipe: any element marked data-dtb-embed gets the same exemption", () => {
      // No kit involved: a hand-rolled extension whose panel root opts out,
      // the way docs/embedding.md tells an embedder without embed() to.
      const { toolbar } = mountToolbar(null, {
        instanceId: "embed",
        extensions: [
          {
            id: "vendor",
            label: "Vendor",
            panel: () => (
              <div data-dtb-embed="" data-dtb-part="embed-frame">
                <VendorKitchenSink />
              </div>
            ),
          },
        ],
      });
      toolbar.openPanel("vendor");
      expect(injectedSheets()).toEqual(["core"]);
      expect(reaching(injectedSelectors(), vendorElements())).toEqual([]);
    });

    it("and the toolbar's own controls, outside the frame, still get every default", () => {
      // The guard exempts the embedded subtree and nothing else: the embed
      // chip's trigger and the retry button on a first-party panel are core's
      // to style, and the same rules that skip the vendor still match them.
      openKitchenSink();
      const trigger = screen.getByRole("button", { name: /^Vendor/ });
      const selectors = injectedSelectors();
      const onTrigger = reaching(selectors, [trigger]);
      expect(onTrigger).toContainEqual(expect.stringContaining(":where(button)"));
      expect(onTrigger).toContainEqual(expect.stringContaining("[data-dev-toolbar] :where(:not("));
      // And the frame itself — ours, not theirs — keeps border-box.
      expect(reaching(selectors, [frame() as Element])).toContainEqual(
        expect.stringContaining("[data-dev-toolbar] :where(:not("),
      );
    });
  });

  it("injectStyles: false skips the kit sheet; a styleNonce option wins over the slot's", () => {
    const { unmount } = mountToolbar(null, {
      instanceId: "embed",
      extensions: [
        embed({ id: "quiet", label: "Quiet", value: "1", injectStyles: false, render: () => null }),
      ],
    });
    expect(injectedSheets()).toEqual(["core"]);
    unmount();
    document.head.querySelectorAll(`style[${STYLE_ATTRIBUTE}]`).forEach((node) => node.remove());

    mountToolbar(null, {
      instanceId: "embed",
      styleNonce: "from-core",
      extensions: [
        embed({
          id: "nonced",
          label: "Nonced",
          value: "1",
          styleNonce: "mine",
          render: () => null,
        }),
      ],
    });
    const kit = document.head.querySelector(`style[${STYLE_ATTRIBUTE}="kit"]`);
    expect(kit?.getAttribute("nonce") ?? (kit as HTMLStyleElement | null)?.nonce).toBe("mine");
  });

  it("a panel that throws on first render gets core's error chip, and its retry works", () => {
    let broken = true;
    const onExtensionError = vi.fn();
    const { toolbar } = mountToolbar(null, {
      instanceId: "embed",
      onExtensionError,
      extensions: [
        makeExtension({ id: "other", compact: "other", panel: "other panel" }),
        embed({
          id: "vendor",
          label: "Vendor",
          render: ({ height }) => {
            if (broken) throw new Error("vendor devtools exploded");
            return <ThirdParty height={height} />;
          },
        }),
      ],
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    toolbar.openPanel("vendor");

    // Core contained it: an error chip in the panel slot, with the message as its title.
    const chip = document.querySelector(
      '[data-dtb-part="error-chip"][data-dtb-slot="panel"][data-dtb-ext-id="vendor"]',
    );
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute("title")).toBe("vendor devtools exploded");
    expect(onExtensionError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "vendor devtools exploded" }),
      expect.objectContaining({ extensionId: "vendor", slot: "panel" }),
    );

    // The bar is still usable — driven through its own controls, not the
    // context: clicking the other item's trigger opens *its* panel (which
    // closes the broken one and unmounts the chip), and clicking the vendor
    // trigger brings the broken panel, still broken, back.
    fireEvent.click(screen.getByRole("button", { name: "other" }));
    expect(toolbar.activePanelId()).toBe("other");
    expect(screen.getByTestId("dtb-panel-other").textContent).toBe("other panel");
    expect(document.querySelector('[data-dtb-part="error-chip"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Vendor" }));
    expect(toolbar.activePanelId()).toBe("vendor");
    expect(screen.queryByTestId("dtb-panel-other")).toBeNull();
    expect(document.querySelector('[data-dtb-part="error-chip"]')).not.toBeNull();

    // Retry — core's button — re-renders the slot once the tool stops throwing.
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Vendor: error. Retry" }));
    expect(document.querySelector('[data-dtb-part="error-chip"]')).toBeNull();
    expect(screen.getByRole("button", { name: "vendor count 0" })).toBeTruthy();

    consoleError.mockRestore();
  });
});
