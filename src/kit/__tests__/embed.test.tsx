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

const mount = (
  extension = embed({
    id: "vendor",
    label: "Vendor",
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
    expect(extension).toMatchObject({
      id: "vendor",
      label: "Vendor",
      contractVersion: 2,
      align: "end",
      order: 7,
      priority: 3,
      hidden: false,
      keepMounted: true,
    });
    expect(typeof extension.compact).toBe("function");
    expect(typeof extension.panel).toBe("function");
    // Defaults: `hidden` is absent (not `false`), `keepMounted` is off.
    const bare = embed({ id: "bare", label: "Bare", render: () => null });
    expect("hidden" in bare).toBe(false);
    expect(bare.keepMounted).toBe(false);
    expect(bare.align).toBe("start");
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

  it("renders a default chip that reads the label and toggles the panel", () => {
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

    // The frame is a bare div: no kind, no class, no wrapper between it and the tool.
    const node = frame();
    expect(node?.hasAttribute("data-dtb-kind")).toBe(false);
    expect(node?.className).toBe("");
    expect(node?.children).toHaveLength(1);
    expect(node?.firstElementChild?.className).toBe("vendor-devtools");
    expect(node?.querySelector("[data-dtb-kind], [data-dtb-part]")).toBeNull();
  });

  it("injectStyles: false skips the kit sheet; a styleNonce option wins over the slot's", () => {
    const { unmount } = mountToolbar(null, {
      instanceId: "embed",
      extensions: [embed({ id: "quiet", label: "Quiet", injectStyles: false, render: () => null })],
    });
    expect(injectedSheets()).toEqual(["core"]);
    unmount();
    document.head.querySelectorAll(`style[${STYLE_ATTRIBUTE}]`).forEach((node) => node.remove());

    mountToolbar(null, {
      instanceId: "embed",
      styleNonce: "from-core",
      extensions: [
        embed({ id: "nonced", label: "Nonced", styleNonce: "mine", render: () => null }),
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
        makeExtension({ id: "other", compact: "other" }),
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

    // The bar is still usable: the other item is there, the chip is there, and
    // the panel can be closed and reopened.
    expect(toolbar.item("other")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Vendor" })).toBeTruthy();
    toolbar.closePanel();
    expect(toolbar.activePanelId()).toBeNull();
    toolbar.openPanel("vendor");

    // Retry — core's button — re-renders the slot once the tool stops throwing.
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Vendor: error. Retry" }));
    expect(document.querySelector('[data-dtb-part="error-chip"]')).toBeNull();
    expect(screen.getByRole("button", { name: "vendor count 0" })).toBeTruthy();

    consoleError.mockRestore();
  });
});
