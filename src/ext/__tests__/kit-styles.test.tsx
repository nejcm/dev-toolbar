import { afterEach, describe, expect, it } from "vitest";
import { act } from "@testing-library/react";
import { cleanupToolbar, mountToolbar } from "@nejcm/dev-toolbar/testing";
import { KIT_CSS } from "../../kit";
import { STYLE_ATTRIBUTE } from "../../runtime/styles";
import { diagnostics } from "../diagnostics";
import { DIAGNOSTICS_CSS } from "../diagnostics/css";
import { environment } from "../environment";
import { ENVIRONMENT_CSS } from "../environment/css";

const styleCount = (entry: string): number =>
  document.head.querySelectorAll(`style[${STYLE_ATTRIBUTE}="${entry}"]`).length;

/**
 * jsdom's CSSOM drops every rule inside an `@layer` block, so `getComputedStyle`
 * sees nothing of a sheet shipped the way this repo ships all of them. Stripping
 * the wrapper leaves the selectors and declarations byte-identical — the layer
 * only orders KIT_CSS against *unlayered consumer* CSS, never its own rules
 * against each other — so the cascade this installs is the one a browser runs.
 * jsdom also leaves `var(--dtb-…)` unresolved, which is what makes it readable:
 * a colour rule that matched reports the literal `var(--dtb-danger)`.
 */
function installUnlayeredKitCss(): void {
  const style = document.createElement("style");
  style.setAttribute(STYLE_ATTRIBUTE, "kit-unlayered");
  style.textContent = KIT_CSS.replace(/^@layer dev-toolbar \{\n/, "").replace(/\}\n$/, "");
  document.head.append(style);
}

afterEach(() => {
  cleanupToolbar();
  document.head.querySelectorAll(`style[${STYLE_ATTRIBUTE}]`).forEach((node) => node.remove());
});

describe("migrated extension kit styles", () => {
  it("keeps each exported CSS string self-contained for manual delivery", () => {
    expect(ENVIRONMENT_CSS.startsWith(KIT_CSS)).toBe(true);
    expect(ENVIRONMENT_CSS).toContain('[data-dtb-part="env-alert"]');
    expect(DIAGNOSTICS_CSS.startsWith(KIT_CSS)).toBe(true);
    expect(DIAGNOSTICS_CSS).toContain('[data-dtb-part="diag-preview"]');
  });

  it("shares one kit sheet while retaining one local sheet per extension", () => {
    const { toolbar } = mountToolbar(null, {
      extensions: [environment(), diagnostics()],
      layout: { barWidth: 1200, itemWidth: 120 },
    });

    act(() => toolbar.openPanel("environment"));
    act(() => toolbar.openPanel("diagnostics"));

    expect(styleCount("kit")).toBe(1);
    expect(styleCount("ext-environment")).toBe(1);
    expect(styleCount("ext-diagnostics")).toBe(1);
  });

  it("keeps the per-extension option in control of shared injection", () => {
    mountToolbar(null, {
      extensions: [environment({ injectStyles: false }), diagnostics({ injectStyles: false })],
      layout: { barWidth: 1200, itemWidth: 120 },
    });

    expect(styleCount("kit")).toBe(0);
    expect(styleCount("ext-environment")).toBe(0);
    expect(styleCount("ext-diagnostics")).toBe(0);
  });

  it("scopes bad severity to the environment chip instead of panel row values", () => {
    const { toolbar } = mountToolbar(null, {
      extensions: [
        environment({ context: { environment: "production", release: "web-2026.09.05" } }),
      ],
      layout: { barWidth: 1200, itemWidth: 120 },
    });

    const chipValue = toolbar.item("environment")?.querySelector('[data-dtb-part="env-value"]');
    const chipDot = toolbar.item("environment")?.querySelector('[data-dtb-part="env-dot"]');
    act(() => toolbar.openPanel("environment"));
    const panel = toolbar.panel("environment");
    const release = panel?.querySelector('[data-dtb-field="release"]');
    const badValueSelector = '[data-dtb-kind="value"][data-dtb-severity="bad"]';

    expect(
      panel?.querySelector('[data-dtb-part="env-panel"]')?.getAttribute("data-dtb-severity"),
    ).toBe("bad");
    expect(release?.getAttribute("data-dtb-alarming")).toBe("false");
    expect(release?.matches(badValueSelector)).toBe(false);
    expect(Array.from(document.querySelectorAll(badValueSelector))).toEqual([chipValue]);
    expect(chipDot?.matches('[data-dtb-kind="dot"][data-dtb-severity="bad"]')).toBe(true);
    expect(KIT_CSS).not.toContain('[data-dtb-severity="bad"] [data-dtb-kind="value"]');
  });

  it("colours only the chip when the environment panel is bad severity", () => {
    installUnlayeredKitCss();
    const { toolbar } = mountToolbar(null, {
      extensions: [
        environment({ context: { environment: "production", release: "web-2026.09.05" } }),
      ],
      layout: { barWidth: 1200, itemWidth: 120 },
    });
    act(() => toolbar.openPanel("environment"));

    const panel = toolbar.panel("environment");
    const chipValue = toolbar.item("environment")?.querySelector('[data-dtb-part="env-value"]');
    const chipDot = toolbar.item("environment")?.querySelector('[data-dtb-part="env-dot"]');
    const rowValues = Array.from(panel?.querySelectorAll('[data-dtb-part="env-row-value"]') ?? []);
    // The panel root is the element that carries data-dtb-severity="bad" and no
    // data-dtb-kind, so KIT_CSS gives it no colour of its own: it is the default
    // foreground every row value must still be rendering in.
    const uncoloured = getComputedStyle(
      panel?.querySelector('[data-dtb-part="env-panel"]') as HTMLElement,
    ).color;

    expect(rowValues.length).toBeGreaterThan(1);
    expect(getComputedStyle(chipValue as HTMLElement).color).toBe("var(--dtb-danger)");
    expect(getComputedStyle(chipDot as HTMLElement).background).toBe("var(--dtb-danger)");
    expect(rowValues.map((row) => getComputedStyle(row as HTMLElement).color)).toEqual(
      rowValues.map(() => uncoloured),
    );
  });

  it("adds shared kinds without changing local part names", () => {
    const { toolbar } = mountToolbar(null, {
      extensions: [environment(), diagnostics()],
      layout: { barWidth: 1200, itemWidth: 120 },
    });

    expect(
      toolbar
        .item("environment")
        ?.querySelector('[data-dtb-part="env-chip"][data-dtb-kind="chip"]'),
    ).not.toBeNull();
    expect(
      toolbar.item("diagnostics")?.querySelector('[data-dtb-part="diag-dot"][data-dtb-kind="dot"]'),
    ).not.toBeNull();

    act(() => toolbar.openPanel("environment"));
    expect(
      toolbar
        .panel("environment")
        ?.querySelector('[data-dtb-part="env-action"][data-dtb-kind="action"]'),
    ).not.toBeNull();

    act(() => toolbar.openPanel("diagnostics"));
    expect(
      toolbar
        .panel("diagnostics")
        ?.querySelector('[data-dtb-part="diag-note"][data-dtb-kind="note"]'),
    ).not.toBeNull();
  });
});
