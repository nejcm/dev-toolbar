/**
 * `/ext/theme-editor` against the real shell, through the same `/testing`
 * surface a stranger writing an extension would use.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { cleanupToolbar, installClipboard, mountToolbar } from "@nejcm/dev-toolbar/testing";
import type { ClipboardStub } from "@nejcm/dev-toolbar/testing";
import { collectCommands } from "../../../core/commands";
import { CONTRACT_VERSION } from "../../../core/contract";
import { createMemoryStorage } from "../../../core/storage";
import { themeEditor } from "../index";
import type { ThemeEditorOptions } from "../index";
import type { DesignTokenDefinition } from "../types";
import type { ToolbarStorage } from "../../../core/contract";

const TOKENS: DesignTokenDefinition[] = [
  {
    name: "--brand-500",
    label: "Brand",
    type: "color",
    value: "#3355ff",
    group: "Colour",
    description: "The one everybody argues about.",
  },
  { name: "--radius-md", type: "length", value: "8px", defaultValue: "8px" },
  { name: "--font-stack", type: "string", value: "Inter, sans-serif" },
  // Declared and refused: the toolbar's own tokens are never written.
  { name: "--dtb-bg", type: "color", value: "#f6f6f7" },
];

let written: readonly string[] = [];
let clipboard: ClipboardStub;

/**
 * Edits land on a dedicated `#app` element rather than on `:root`, for a reason
 * worth stating: **core writes `--dev-toolbar-height` as an inline style on
 * `document.documentElement`**, so `<html>` carries a `style` attribute for as
 * long as a toolbar is mounted and keeps an empty one afterwards. A
 * byte-equality reversal assertion against `:root` would therefore be measuring
 * core's own residue rather than this extension's, and would fail — or, worse,
 * pass for the wrong reason once somebody "fixed" it by loosening the
 * assertion. The bleed test below is the one case that deliberately uses
 * `:root`, because that is the element the toolbar inherits from.
 */
const mount = (options: ThemeEditorOptions = {}, storage?: ToolbarStorage | null) => {
  const extension = themeEditor({
    tokens: TOKENS,
    surfaces: [{ id: "app", label: "App", selector: "#app" }],
    ...options,
  });
  const result = mountToolbar(null, {
    extensions: [extension],
    instanceId: "test",
    ...(storage === undefined ? {} : { storage }),
    layout: { barWidth: 1200, itemWidth: 120 },
  });
  return { extension, ...result };
};

const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, " ").trim() ?? "";

const row = (panel: HTMLElement | null, name: string) =>
  panel?.querySelector<HTMLElement>(`[data-dtb-part="thm-row"][data-dtb-token="${name}"]`) ?? null;

const root = () => document.documentElement;

/** The surface the tests edit. Recreated per test, so residue cannot carry. */
const app = () => document.getElementById("app") as HTMLElement;

beforeEach(() => {
  clipboard = installClipboard();
  written = clipboard.writes;
  document.getElementById("app")?.remove();
  const host = document.createElement("div");
  host.id = "app";
  document.body.appendChild(host);
  root().removeAttribute("style");
});

afterEach(() => {
  clipboard.restore();
  cleanupToolbar();
  document.getElementById("app")?.remove();
  root().removeAttribute("style");
  document.head
    .querySelectorAll('style[data-dev-toolbar-styles="ext-theme-editor"]')
    .forEach((node) => node.remove());
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */

describe("the compact chip", () => {
  it("counts the tokens and shouts when an edit is live", () => {
    const { toolbar } = mount();
    expect(text(toolbar.item("theme-editor")?.querySelector('[data-dtb-part="thm-count"]'))).toBe(
      "4",
    );

    act(() => {
      toolbar.openPanel("theme-editor");
    });
    const input = row(
      toolbar.panel("theme-editor"),
      "--brand-500",
    )?.querySelector<HTMLInputElement>('input[data-dtb-part="thm-input"]');
    act(() => {
      fireEvent.change(input as HTMLInputElement, {
        target: { value: "#ff0000" },
      });
      fireEvent.keyDown(input as HTMLInputElement, { key: "Enter" });
    });

    const chip = toolbar.item("theme-editor")?.querySelector('[data-dtb-part="thm-chip"]');
    expect(text(chip?.querySelector('[data-dtb-part="thm-count"]'))).toBe("1 edited");
    expect(chip?.getAttribute("data-dtb-edited")).toBe("true");
    // And the page actually changed, which is the whole point.
    expect(app().style.getPropertyValue("--brand-500")).toBe("#ff0000");
  });

  it("says `paused` while the preview is held back", () => {
    const { toolbar } = mount();
    act(() => {
      toolbar.openPanel("theme-editor");
    });
    act(() => {
      toolbar
        .panel("theme-editor")
        ?.querySelector<HTMLButtonElement>('[data-dtb-action="preview"]')
        ?.click();
    });
    expect(text(toolbar.item("theme-editor")?.querySelector('[data-dtb-part="thm-count"]'))).toBe(
      "paused",
    );
  });

  it("says so when the consumer supplied no tokens", () => {
    const { toolbar } = mount({ tokens: [] });
    act(() => {
      toolbar.openPanel("theme-editor");
    });
    expect(text(toolbar.panel("theme-editor"))).toContain("No tokens were supplied");
  });
});

/* -------------------------------------------------------------------------- */

describe("the panel", () => {
  it("shows now, app and default side by side", () => {
    const { toolbar } = mount();
    act(() => {
      toolbar.openPanel("theme-editor");
    });
    const line = row(toolbar.panel("theme-editor"), "--radius-md")?.querySelector(
      '[data-dtb-part="thm-values"]',
    );
    expect(text(line)).toBe("now 8pxapp 8pxdefault 8px");
  });

  it("refuses a reserved token in the row rather than hiding it", () => {
    const { toolbar } = mount();
    act(() => {
      toolbar.openPanel("theme-editor");
    });
    const reserved = row(toolbar.panel("theme-editor"), "--dtb-bg");
    expect(reserved).not.toBeNull();
    expect(text(reserved)).toContain("reserved name");
    expect(reserved?.querySelector('input[data-dtb-part="thm-input"]')).toBeNull();
  });

  it("keeps the draft and says why when a value is refused", () => {
    const { toolbar } = mount();
    act(() => {
      toolbar.openPanel("theme-editor");
    });
    const input = row(
      toolbar.panel("theme-editor"),
      "--radius-md",
    )?.querySelector<HTMLInputElement>('input[data-dtb-part="thm-input"]');
    act(() => {
      fireEvent.change(input as HTMLInputElement, {
        target: { value: "definitely not a length" },
      });
      fireEvent.keyDown(input as HTMLInputElement, { key: "Enter" });
    });
    expect(input?.value).toBe("definitely not a length");
    expect(input?.getAttribute("data-dtb-invalid")).toBe("true");
    expect(text(row(toolbar.panel("theme-editor"), "--radius-md"))).toContain("not a length");
    expect(app().style.getPropertyValue("--radius-md")).toBe("");
  });

  it("never seeds the editor with a masked value", () => {
    // §12.6: the input is the one place a redacted snapshot would leak back
    // onto the screen, and out again through the next copy.
    const { toolbar } = mount({
      tokens: [{ name: "--api-token", type: "string", value: "sk-live-secret" }],
    });
    act(() => {
      toolbar.openPanel("theme-editor");
    });
    const panel = toolbar.panel("theme-editor");
    const input = row(panel, "--api-token")?.querySelector<HTMLInputElement>(
      'input[data-dtb-part="thm-input"]',
    );
    expect(input?.value).toBe("");
    expect(input?.placeholder).toContain("masked");
    expect(panel?.innerHTML).not.toContain("sk-live-secret");
  });

  it("resets everything and leaves the surface as it found it", () => {
    const before = app().outerHTML;
    const { toolbar } = mount();
    act(() => {
      toolbar.openPanel("theme-editor");
    });
    const panel = () => toolbar.panel("theme-editor");
    const commit = (name: string, value: string) => {
      const input = row(panel(), name)?.querySelector<HTMLInputElement>(
        'input[data-dtb-part="thm-input"]',
      );
      act(() => {
        fireEvent.change(input as HTMLInputElement, { target: { value } });
        fireEvent.keyDown(input as HTMLInputElement, { key: "Enter" });
      });
    };
    commit("--brand-500", "#ff0000");
    commit("--radius-md", "20px");
    expect(app().hasAttribute("style")).toBe(true);

    act(() => {
      panel()?.querySelector<HTMLButtonElement>('[data-dtb-action="reset-all"]')?.click();
    });
    expect(app().hasAttribute("style")).toBe(false);
    expect(app().outerHTML).toBe(before);
    expect(text(panel())).toContain("Reset everything (0)");
  });

  it("shows the exact payload the copy button writes", () => {
    // §15.4's property, at a smaller scale: the panel's biggest element is the
    // payload itself, asserted by comparing the clipboard write to the DOM.
    const { toolbar } = mount();
    act(() => {
      toolbar.openPanel("theme-editor");
    });
    const panel = () => toolbar.panel("theme-editor");
    const input = row(panel(), "--brand-500")?.querySelector<HTMLInputElement>(
      'input[data-dtb-part="thm-input"]',
    );
    act(() => {
      fireEvent.change(input as HTMLInputElement, {
        target: { value: "#ff0000" },
      });
      fireEvent.keyDown(input as HTMLInputElement, { key: "Enter" });
    });

    const rendered = panel()?.querySelector('[data-dtb-part="thm-output"]');
    act(() => {
      panel()?.querySelector<HTMLButtonElement>('[data-dtb-action="copy"]')?.click();
    });
    expect(written).toHaveLength(1);
    expect(written[0]).toBe(rendered?.textContent);
    expect(written[0]).toContain("--brand-500: #ff0000;");
  });

  it("copies a share link and reports when share links are disabled", async () => {
    const available = mount();
    act(() => available.toolbar.openPanel("theme-editor"));
    const availablePanel = available.toolbar.panel("theme-editor");

    await act(async () => {
      availablePanel?.querySelector<HTMLButtonElement>('[data-dtb-action="copy-link"]')?.click();
    });

    expect(written).toHaveLength(1);
    expect(new URL(written[0] as string).searchParams.has("dtb-theme")).toBe(true);
    expect(availablePanel?.querySelector('[role="status"]')?.textContent).toBe(
      "Copied — 0 values masked.",
    );
    available.unmount();

    const disabled = mount({ themeParam: null });
    act(() => disabled.toolbar.openPanel("theme-editor"));
    const disabledPanel = disabled.toolbar.panel("theme-editor");

    await act(async () => {
      disabledPanel?.querySelector<HTMLButtonElement>('[data-dtb-action="copy-link"]')?.click();
    });

    expect(written).toHaveLength(1);
    expect(disabledPanel?.querySelector('[role="status"]')?.textContent).toBe(
      "Clipboard unavailable — select the text below instead.",
    );
  });

  it("imports a pasted recipe and drops what this app does not declare", () => {
    const { toolbar } = mount();
    act(() => {
      toolbar.openPanel("theme-editor");
    });
    const panel = () => toolbar.panel("theme-editor");
    const box = panel()?.querySelector<HTMLTextAreaElement>('[data-dtb-part="thm-import"]');
    act(() => {
      fireEvent.change(box as HTMLTextAreaElement, {
        target: {
          value: JSON.stringify({
            schemaVersion: 1,
            name: "Pasted",
            overrides: { "--radius-md": "24px", "--stranger": "red" },
          }),
        },
      });
    });
    act(() => {
      panel()?.querySelector<HTMLButtonElement>('[data-dtb-action="import"]')?.click();
    });
    expect(app().style.getPropertyValue("--radius-md")).toBe("24px");
    expect(app().style.getPropertyValue("--stranger")).toBe("");
    expect(text(panel())).toContain("1 dropped");
  });

  it("renders a consumer's presets and applies one", () => {
    const { toolbar } = mount({
      presets: [
        {
          schemaVersion: 1,
          name: "Punchy",
          mode: "light",
          surface: "root",
          overrides: { "--brand-500": "#ff0088" },
          createdAt: "",
        },
      ],
    });
    act(() => {
      toolbar.openPanel("theme-editor");
    });
    act(() => {
      toolbar
        .panel("theme-editor")
        ?.querySelector<HTMLButtonElement>('[data-dtb-preset="Punchy"]')
        ?.click();
    });
    expect(app().style.getPropertyValue("--brand-500")).toBe("#ff0088");
  });

  it("reports a mode it cannot change, and drives one it can", () => {
    let mode: "light" | "dark" = "light";
    const { toolbar } = mount({
      mode: {
        read: () => mode,
        set: (next) => {
          mode = next;
        },
      },
    });
    act(() => {
      toolbar.openPanel("theme-editor");
    });
    const button = () =>
      toolbar.panel("theme-editor")?.querySelector<HTMLButtonElement>('[data-dtb-action="mode"]');
    expect(text(button())).toBe("mode: light");
    act(() => {
      button()?.click();
    });
    expect(mode).toBe("dark");
    expect(text(button())).toBe("mode: dark");
  });
});

/* -------------------------------------------------------------------------- */

describe("the shell contract", () => {
  it("contains a throwing catalogue itself rather than degrading to a chip", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { toolbar } = mount({
      tokens: () => {
        // Not the tokens getter — that is caught. A throw from inside React.
        throw new Error("catalogue is down");
      },
    });
    // The runtime contains it, so there is no chip at all: the bar renders a
    // token list of zero and a banner in the panel.
    expect(toolbar.errorChip("theme-editor")).toBeNull();
    act(() => {
      toolbar.openPanel("theme-editor");
    });
    expect(text(toolbar.panel("theme-editor"))).toContain("could not be read");
    expect(spy).toHaveBeenCalled();
  });

  it("collapses into the ⋮ menu without losing its capability", () => {
    const { toolbar } = mount();
    act(() => {
      toolbar.resize(60);
    });
    expect(toolbar.isOverflowed("theme-editor")).toBe(true);
    act(() => {
      toolbar.openOverflow();
    });
    expect(
      toolbar.item("theme-editor")?.querySelector('[data-dtb-part="thm-chip"]'),
    ).not.toBeNull();
  });

  it("declares the contract version core implements", () => {
    // §15.7's habit: an extension that *states* a version copies the assertion,
    // not just the constant.
    expect(themeEditor().contractVersion).toBe(CONTRACT_VERSION);
  });

  it("contributes commands that drive it without the panel", async () => {
    const { extension, toolbar } = mount({
      presets: [
        {
          schemaVersion: 1,
          name: "Punchy",
          mode: "light",
          surface: "root",
          overrides: { "--brand-500": "#ff0088" },
          createdAt: "",
        },
      ],
    });
    const ids = collectCommands([extension]).map((command) => command.id);
    expect(ids).toEqual([
      "theme-editor.setToken",
      "theme-editor.preset.Punchy",
      "theme-editor.reset",
      "theme-editor.togglePreview",
      "theme-editor.copyCss",
      "theme-editor.copyRecipe",
      "theme-editor.copyFigma",
      "theme-editor.copyLink",
      "theme-editor.refresh",
    ]);

    await toolbar.runCommand("theme-editor.preset.Punchy");
    expect(app().style.getPropertyValue("--brand-500")).toBe("#ff0088");

    await toolbar.runCommand("theme-editor.copyCss");
    expect(written[0]).toContain("--brand-500: #ff0088;");

    await toolbar.runCommand("theme-editor.reset");
    expect(app().hasAttribute("style")).toBe(false);
  });

  it("relabels the preview command to say what a run will do", async () => {
    // The one thing a static `commands` array could not do (§12.2, §13.1):
    // "Pause the preview" over an already-paused preview is the same class of
    // lie as a badge that says *edited* over a page that never heard about it.
    const { extension, toolbar } = mount();
    const label = () =>
      collectCommands([extension]).find((command) => command.id === "theme-editor.togglePreview")
        ?.label ?? "";
    expect(label()).toContain("Pause");
    await toolbar.runCommand("theme-editor.togglePreview");
    expect(label()).toContain("Resume");
  });

  it("throws out of a copy command when nothing reached the clipboard", async () => {
    // §15.6: a palette closes over a resolve and reports a throw, so a copy
    // that silently did nothing must not resolve.
    clipboard.restore();
    clipboard = installClipboard(null);
    const { extension } = mount();
    const command = collectCommands([extension]).find(
      (entry) => entry.id === "theme-editor.copyCss",
    );
    await expect(Promise.resolve().then(() => command?.run())).rejects.toThrow(
      /clipboard is unavailable/i,
    );
  });

  it("hands `/ext/diagnostics` a redacted contribution", () => {
    const { extension, toolbar } = mount({
      tokens: [{ name: "--api-token", type: "string", value: "public" }],
    });
    act(() => {
      toolbar.openPanel("theme-editor");
    });
    const input = row(
      toolbar.panel("theme-editor"),
      "--api-token",
    )?.querySelector<HTMLInputElement>('input[data-dtb-part="thm-input"]');
    act(() => {
      fireEvent.change(input as HTMLInputElement, {
        target: { value: "sk-live-nope" },
      });
      fireEvent.keyDown(input as HTMLInputElement, { key: "Enter" });
    });
    const payload = JSON.stringify(extension.diagnostics?.());
    expect(payload).not.toContain("sk-live-nope");
    expect(payload).toContain("[redacted]");
  });

  it("leaves the toolbar's own appearance alone while the app's changes", () => {
    // The bleed test. `:root` is an ancestor of the portalled toolbar root, so
    // a `--dtb-*` edit landing there would repaint the bar. It cannot: the name
    // is never written.
    //
    // Asserted against **computed** values, not against style attributes. The
    // first cut compared attributes, which is a weaker claim than §16.2 was
    // making: a token can reach the bar by *inheritance* from `:root` without
    // any attribute on the bar changing at all, which is precisely the bleed
    // path. Reading the custom property back off the toolbar root is the
    // assertion that would actually fail if the guard did.
    const { toolbar } = mount({ surfaces: [{ id: "root", selector: ":root" }] });
    const barShape = () => {
      const bar = toolbar.bar() as HTMLElement;
      const barStyle = getComputedStyle(bar);
      const rootStyle = getComputedStyle(toolbar.root() as HTMLElement);
      return {
        // The tokens the bar's own look is built from, read where the bar reads
        // them — so inheritance from `:root` is in scope.
        bg: rootStyle.getPropertyValue("--dtb-bg").trim(),
        fg: rootStyle.getPropertyValue("--dtb-fg").trim(),
        accent: rootStyle.getPropertyValue("--dtb-accent").trim(),
        barHeight: rootStyle.getPropertyValue("--dtb-bar-height").trim(),
        fontSize: rootStyle.getPropertyValue("--dtb-font-size").trim(),
        // And the resolved properties, in case a token arrived by a route the
        // list above does not enumerate.
        computedBackground: barStyle.backgroundColor,
        computedColor: barStyle.color,
        computedFontSize: barStyle.fontSize,
        attribute: bar.getAttribute("style") ?? null,
      };
    };
    const before = barShape();
    act(() => {
      toolbar.openPanel("theme-editor");
    });
    act(() => {
      const input = row(
        toolbar.panel("theme-editor"),
        "--brand-500",
      )?.querySelector<HTMLInputElement>('input[data-dtb-part="thm-input"]');
      fireEvent.change(input as HTMLInputElement, {
        target: { value: "#ff0000" },
      });
      fireEvent.keyDown(input as HTMLInputElement, { key: "Enter" });
    });

    // The application's token changed...
    expect(root().style.getPropertyValue("--brand-500")).toBe("#ff0000");
    // ...the toolbar's did not, and neither did anything it resolves.
    expect(root().style.getPropertyValue("--dtb-bg")).toBe("");
    expect(root().style.getPropertyValue("--dev-toolbar-height-test")).not.toBe("");
    expect(barShape()).toEqual(before);
    expect(toolbar.root()?.getAttribute("style") ?? null).toBe(null);
  });

  it("unmounting the toolbar restores the page", () => {
    const before = app().outerHTML;
    const { toolbar, unmount } = mount();
    act(() => {
      toolbar.openPanel("theme-editor");
    });
    act(() => {
      const input = row(
        toolbar.panel("theme-editor"),
        "--brand-500",
      )?.querySelector<HTMLInputElement>('input[data-dtb-part="thm-input"]');
      fireEvent.change(input as HTMLInputElement, {
        target: { value: "#ff0000" },
      });
      fireEvent.keyDown(input as HTMLInputElement, { key: "Enter" });
    });
    expect(app().hasAttribute("style")).toBe(true);
    act(() => {
      unmount();
    });
    expect(app().outerHTML).toBe(before);
  });

  it("survives a reload with the edits still applied", () => {
    const storage = createMemoryStorage();
    const first = mount({}, storage);
    act(() => {
      first.toolbar.openPanel("theme-editor");
    });
    act(() => {
      const input = row(
        first.toolbar.panel("theme-editor"),
        "--brand-500",
      )?.querySelector<HTMLInputElement>('input[data-dtb-part="thm-input"]');
      fireEvent.change(input as HTMLInputElement, {
        target: { value: "#ff0000" },
      });
      fireEvent.keyDown(input as HTMLInputElement, { key: "Enter" });
    });
    act(() => {
      first.unmount();
    });
    expect(app().hasAttribute("style")).toBe(false);

    const second = mount({}, storage);
    expect(app().style.getPropertyValue("--brand-500")).toBe("#ff0000");
    expect(
      text(second.toolbar.item("theme-editor")?.querySelector('[data-dtb-part="thm-count"]')),
    ).toBe("1 edited");
  });

  it("is absent everywhere when hidden", () => {
    const { toolbar } = mount({ hidden: true });
    expect(toolbar.item("theme-editor")).toBeNull();
    expect(toolbar.overflowedIds()).not.toContain("theme-editor");
    // A hidden extension is never started, so nothing was ever written.
    expect(app().hasAttribute("style")).toBe(false);
  });
});

describe("the panel, after the surface moves", () => {
  it("holds the colour picker's draft until blur — a drag used to commit every step", () => {
    /* Regression: the native colour input committed on every `change`, and a
       drag fires one per step — a hundred `setOverride` calls, each of them a
       write, a `persistOverrides` and a publish, for one colour choice. */
    const { toolbar } = mount();
    act(() => {
      toolbar.openPanel("theme-editor");
    });
    const picker = row(
      toolbar.panel("theme-editor"),
      "--brand-500",
    )?.querySelector<HTMLInputElement>('input[data-dtb-part="thm-color"]') as HTMLInputElement;

    act(() => {
      fireEvent.change(picker, { target: { value: "#00ff00" } });
    });
    expect(app().style.getPropertyValue("--brand-500")).toBe("");
    expect(picker.value).toBe("#00ff00");

    act(() => {
      fireEvent.focusOut(picker);
    });
    expect(app().style.getPropertyValue("--brand-500")).toBe("#00ff00");
  });

  it("drops a held colour draft when the surface vanishes — a disabling input fires no blur", async () => {
    /* Chrome does not fire `blur` on a focused element that *becomes*
       disabled, so a draft held when `writable` flips would sit there showing
       a colour nothing on the page is wearing until the field was focused and
       left again. */
    const { toolbar } = mount();
    act(() => {
      toolbar.openPanel("theme-editor");
    });
    const picker = () =>
      row(toolbar.panel("theme-editor"), "--brand-500")?.querySelector<HTMLInputElement>(
        'input[data-dtb-part="thm-color"]',
      ) as HTMLInputElement;

    act(() => {
      fireEvent.change(picker(), { target: { value: "#00ff00" } });
    });
    expect(picker().value).toBe("#00ff00");

    document.getElementById("app")?.remove();
    await toolbar.runCommand("theme-editor.refresh");

    expect(picker().disabled).toBe(true);
    // Back to the application's own value — the draft was never committed.
    expect(picker().value).toBe("#3355ff");
  });

  it("says the edits are no longer on the page when the surface disappears", async () => {
    const { toolbar } = mount();
    act(() => {
      toolbar.openPanel("theme-editor");
    });
    const input = row(
      toolbar.panel("theme-editor"),
      "--brand-500",
    )?.querySelector<HTMLInputElement>('input[data-dtb-part="thm-input"]') as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "#ff0000" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(app().style.getPropertyValue("--brand-500")).toBe("#ff0000");

    document.getElementById("app")?.remove();
    await toolbar.runCommand("theme-editor.refresh");

    const banner = toolbar
      .panel("theme-editor")
      ?.querySelector('[data-dtb-part="thm-banner"][data-dtb-detached="true"]');
    expect(text(banner)).toBe(
      "Nothing matches the #app surface any more, so 1 edit is no longer on the page. " +
        "They are kept, and go back on when it returns.",
    );
    // …and no row was marked failed for it. The `edited` count is the control:
    // it proves the row rendered its tags at all in this state, so the zero
    // above is a real absence rather than a selector that matches nothing.
    const tags = (tag: string) =>
      toolbar.panel("theme-editor")?.querySelectorAll(`[data-dtb-tag="${tag}"]`).length ?? 0;
    expect(tags("not-applied")).toBe(0);
    expect(tags("edited")).toBe(1);
  });
});

/*
 * A1 regression: the chip trigger's aria-label omitted the edited count.
 * Pre-fix markup: aria-label={label} — screen readers heard only "Theme".
 */
describe("accessibility", () => {
  it("includes the edited count in the chip trigger's aria-label", () => {
    const { toolbar } = mount();
    const trigger = () =>
      toolbar.item("theme-editor")?.querySelector<HTMLButtonElement>('[data-dtb-part="trigger"]');

    expect(trigger()?.getAttribute("aria-label")).toBe("Theme");

    act(() => {
      toolbar.openPanel("theme-editor");
    });
    const input = row(
      toolbar.panel("theme-editor"),
      "--brand-500",
    )?.querySelector<HTMLInputElement>('input[data-dtb-part="thm-input"]');
    act(() => {
      fireEvent.change(input as HTMLInputElement, {
        target: { value: "#ff0000" },
      });
      fireEvent.keyDown(input as HTMLInputElement, { key: "Enter" });
    });

    expect(trigger()?.getAttribute("aria-label")).toBe("Theme, 1 edited");
  });
});
