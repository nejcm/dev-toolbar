/**
 * `/ext/agent`'s `presentation` option, against the real shell.
 *
 * Agent is group C (`plans/bar-presentation-icons-v1.md`): no value, no
 * store, nothing to preset against — so the option is two knobs, `icon` and
 * `name`, and the facts are a fork rather than a truth table:
 *
 * 1. With no icon the chip is the span it has always been, down to the byte
 *    (captured from the commit before this option existed) — `title` is
 *    still the only thing naming it.
 * 2. With an icon the chip becomes a named node: `role="img"` plus
 *    `aria-label`, since a bare `<span aria-label>` names nothing. The icon
 *    replaces the label in the bar and joins it in the `⋮` menu.
 *
 * Regenerate the pinned strings only against a deliberate, documented change
 * to the bar DOM — every consumer's CSS and Playwright selector reads these
 * attributes, and `examples/playground/e2e/overflow.spec.ts` measures this
 * chip to the pixel.
 *
 * [dev-toolbar/plans/bar-presentation-icons-v1 §5 group C]
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupToolbar, mountToolbar } from "@nejcm/dev-toolbar/testing";
import { STYLE_ATTRIBUTE } from "../../../runtime/styles";
import { agentBridge } from "../index";
import type { AgentBridgeOptions, AgentChipView } from "../index";
import { accessibleName } from "../../overlays";

/** A consumer's own inline `<svg>` — the proof that nothing was bundled. */
const ICON = (
  <svg viewBox="0 0 16 16" data-icon="robot">
    <rect x="2" y="4" width="12" height="9" />
  </svg>
);

const mount = (options: AgentBridgeOptions = {}, styleNonce?: string) => {
  cleanupToolbar();
  return mountToolbar(null, {
    extensions: [agentBridge(options)],
    ...(styleNonce === undefined ? {} : { styleNonce }),
    layout: { barWidth: 900, itemWidth: 200 },
  });
};

const barChip = (options: AgentBridgeOptions = {}): HTMLElement => {
  const { toolbar } = mount(options);
  const chip = toolbar.item("agent")?.querySelector<HTMLElement>('[data-dtb-part="trigger"]');
  expect(chip).not.toBeNull();
  return chip as HTMLElement;
};

/** The `⋮` row, with the bar collapsed to nothing. */
const overflowChip = (options: AgentBridgeOptions = {}): HTMLElement => {
  const { toolbar } = mount(options);
  toolbar.resize(60);
  expect(toolbar.isOverflowed("agent")).toBe(true);
  toolbar.openOverflow();
  const chip = toolbar.overflowMenu()?.querySelector<HTMLElement>('[data-dtb-part="trigger"]');
  expect(chip).not.toBeNull();
  return chip as HTMLElement;
};

const kitSheets = (): number =>
  document.head.querySelectorAll(`style[${STYLE_ATTRIBUTE}="kit"]`).length;

const kitSheet = (): HTMLStyleElement | null =>
  document.head.querySelector<HTMLStyleElement>(`style[${STYLE_ATTRIBUTE}="kit"]`);

/** Captured from the commit before `presentation` existed, in both places. */
const DEFAULT_CHIP =
  '<span data-dtb-part="trigger" data-dtb-agent-mode="read-only"' +
  ' title="Agent bridge on __DEV_TOOLBAR__.instances[&quot;default&quot;] —' +
  ' reads state only (allowRun is off)">Agent</span>';

afterEach(cleanupToolbar);

describe("the default presentation", () => {
  it("is byte-identical in the bar", () => {
    expect(barChip().outerHTML).toBe(DEFAULT_CHIP);
  });

  it("is byte-identical in the ⋮ menu", () => {
    expect(overflowChip().outerHTML).toBe(DEFAULT_CHIP);
  });

  it("is byte-identical with allowRun on", () => {
    expect(barChip({ allowRun: true }).outerHTML).toBe(
      '<span data-dtb-part="trigger" data-dtb-agent-mode="run-enabled"' +
        ' title="Agent bridge on __DEV_TOOLBAR__.instances[&quot;default&quot;] —' +
        ' reads state and can run commands (allowRun)">Agent</span>',
    );
  });

  /**
   * The name `src/ext/__tests__/presentation.test.tsx` used to pin, before
   * agent was exempt from its "named by an attribute" rule. That file now
   * mounts this extension *with* an icon, so the role-less case is pinned
   * here instead, via the same `accessibleName()`.
   */
  it("is named by its title, and only by its title", () => {
    expect(accessibleName(barChip())).toBe(
      'Agent bridge on __DEV_TOOLBAR__.instances["default"] — reads state only (allowRun is off)',
    );
  });

  it("carries no role, so no aria-label is invented for it", () => {
    const chip = barChip();
    expect(chip.getAttribute("role")).toBeNull();
    expect(chip.getAttribute("aria-label")).toBeNull();
  });

  it("injects no stylesheet, because it paints nothing that needs one", () => {
    mount();
    expect(kitSheets()).toBe(0);
  });
});

describe("an icon", () => {
  const ICON_HTML =
    '<span data-dtb-part="agent-icon" aria-hidden="true" data-dtb-kind="glyph">' +
    '<svg viewBox="0 0 16 16" data-icon="robot">' +
    '<rect x="2" y="4" width="12" height="9"></rect></svg></span>';
  const OPEN =
    '<span data-dtb-part="trigger" data-dtb-agent-mode="read-only" role="img"' +
    ' aria-label="Agent" title="Agent bridge on __DEV_TOOLBAR__.instances[&quot;default&quot;] —' +
    ' reads state only (allowRun is off)">';

  it("replaces the label in the bar, as a named node", () => {
    expect(barChip({ presentation: { icon: ICON } }).outerHTML).toBe(`${OPEN}${ICON_HTML}</span>`);
  });

  it("joins the label in the ⋮ menu rather than replacing it", () => {
    expect(overflowChip({ presentation: { icon: ICON } }).outerHTML).toBe(
      `${OPEN}${ICON_HTML}<span data-dtb-part="agent-label">Agent</span></span>`,
    );
  });

  it("keeps the state attribute and the title the extension's own", () => {
    const chip = barChip({ allowRun: true, presentation: { icon: ICON } });
    expect(chip.getAttribute("data-dtb-agent-mode")).toBe("run-enabled");
    expect(chip.getAttribute("title")).toContain("reads state and can run commands");
  });

  /** Assertion (3) of the roster test, applied here to the icon-only chip. */
  it("is named by its aria-label, not by its text or its title", () => {
    const chip = barChip({ presentation: { icon: ICON } });
    const bare = chip.cloneNode(false) as Element;
    bare.removeAttribute("title");
    expect(accessibleName(bare)).toBe("Agent");
    expect(accessibleName(chip)).toBe("Agent");
  });

  it("ensures the kit sheet, which is where the glyph clamp lives", () => {
    mount({ presentation: { icon: ICON } });
    expect(kitSheets()).toBe(1);
  });

  it("ensures nothing when injectStyles is off", () => {
    mount({ injectStyles: false, presentation: { icon: ICON } });
    expect(kitSheets()).toBe(0);
  });
});

/**
 * The same facts `/ext/flags` and `/ext/overlays` pin for their own sheets,
 * on the one path that injects here (the icon chip). The no-icon chip
 * injects nothing to stamp — the last case below.
 */
describe("styleNonce", () => {
  it("stamps the factory option on the kit sheet", () => {
    mount({ styleNonce: "from-option", presentation: { icon: ICON } });
    expect(kitSheet()?.nonce).toBe("from-option");
  });

  it("stamps the slot prop when the option is omitted", () => {
    mount({ presentation: { icon: ICON } }, "from-slot");
    expect(kitSheet()?.nonce).toBe("from-slot");
  });

  it("lets the factory option win over the slot prop", () => {
    mount({ styleNonce: "from-option", presentation: { icon: ICON } }, "from-slot");
    expect(kitSheet()?.nonce).toBe("from-option");
  });

  it("an empty factory option defers to the slot prop", () => {
    mount({ styleNonce: "", presentation: { icon: ICON } }, "from-slot");
    expect(kitSheet()?.nonce).toBe("from-slot");
  });

  it("does not inject when injectStyles is false, even with a nonce", () => {
    mount(
      { injectStyles: false, styleNonce: "from-option", presentation: { icon: ICON } },
      "from-slot",
    );
    expect(kitSheet()).toBeNull();
  });

  it("has nothing to stamp without an icon, nonce or no nonce", () => {
    mount({ styleNonce: "from-option" }, "from-slot");
    expect(kitSheet()).toBeNull();
  });
});

describe("a function icon", () => {
  it("is handed the four facts the chip is built from", () => {
    const icon = vi.fn<(view: AgentChipView) => typeof ICON>(() => ICON);
    barChip({
      allowRun: true,
      globalName: "__MY_TOOLBAR__",
      instanceId: "admin",
      label: "Bridge",
      presentation: { icon },
    });
    expect(icon).toHaveBeenCalledWith({
      label: "Bridge",
      allowRun: true,
      globalName: "__MY_TOOLBAR__",
      instanceId: "admin",
    });
  });

  it("returning nothing leaves the chip exactly as it was", () => {
    expect(barChip({ presentation: { icon: () => undefined } }).outerHTML).toBe(DEFAULT_CHIP);
  });

  it("returning null leaves the chip exactly as it was", () => {
    expect(barChip({ presentation: { icon: () => null } }).outerHTML).toBe(DEFAULT_CHIP);
  });

  // Kit's emptiness rule, not a presence test — accepting `false` would give
  // this chip `role="img"` and an `aria-label` around an empty glyph: an
  // image named "Agent" that isn't there.
  it.each([
    ["false, from a && guard", false],
    ["true", true],
    ["an empty string", ""],
  ])("returning %s leaves the chip exactly as it was", (_name, value) => {
    expect(barChip({ presentation: { icon: () => value as never } }).outerHTML).toBe(DEFAULT_CHIP);
  });
});

describe("a name override", () => {
  it("replaces the aria-label, and is handed the same view", () => {
    const chip = barChip({
      presentation: {
        icon: ICON,
        name: (view) => `${view.label} bridge, ${view.allowRun ? "armed" : "read-only"}`,
      },
    });
    expect(chip.getAttribute("aria-label")).toBe("Agent bridge, read-only");
    expect(accessibleName(chip)).toBe("Agent bridge, read-only");
  });

  it("is ignored when it is whitespace, so the chip cannot end up unnamed", () => {
    expect(
      barChip({ presentation: { icon: ICON, name: () => "   " } }).getAttribute("aria-label"),
    ).toBe("Agent");
  });

  /**
   * `name` is the accessible name, not the visible text: with no icon there's
   * no `aria-label` for it to land on, and inventing one would change what
   * the chip announces today.
   */
  it("does nothing without an icon, because there is no named node to name", () => {
    expect(barChip({ presentation: { name: () => "Whatever" } }).outerHTML).toBe(DEFAULT_CHIP);
  });
});
