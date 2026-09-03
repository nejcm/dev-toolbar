/**
 * `/ext/diagnostics` against the real shell, through the same `/testing` surface
 * a stranger writing an extension would use.
 *
 * The assertions worth having here are the cross-extension ones: that the P3
 * aggregation actually reaches this extension through `api.getDiagnostics()`,
 * that a *real* neighbouring extension's contribution lands in the snapshot,
 * and that a neighbour which breaks is named in the output rather than dropped
 * from it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { cleanupToolbar, mountToolbar } from "@nejcm/dev-toolbar/testing";
import { createMemoryStorage } from "../../../core/storage";
import { CONTRACT_VERSION } from "../../../core/contract";
import { diagnostics } from "../index";
import { FORMAT_KEY, TARGET_CONTRACT_VERSION } from "../runtime";
import type { DiagnosticsOptions } from "../index";
import type { DevToolbarExtension, ToolbarStorage } from "../../../core/contract";

const app = (
  <main data-testid="app">
    <h1>Page</h1>
  </main>
);

const mount = (
  options: DiagnosticsOptions = {},
  neighbours: DevToolbarExtension[] = [],
  storage?: ToolbarStorage,
) => {
  const extension = diagnostics(options);
  const result = mountToolbar(app, {
    extensions: [...neighbours, extension],
    instanceId: "test",
    layout: { barWidth: 1200, itemWidth: 90 },
    ...(storage === undefined ? {} : { storage }),
  });
  return { extension, ...result };
};

const preview = (): HTMLElement | null => document.querySelector('[data-dtb-part="diag-preview"]');

const button = (action: string): HTMLButtonElement => {
  const found = document.querySelector<HTMLButtonElement>(
    `[data-dtb-part="diag-action"][data-dtb-action="${action}"]`,
  );
  if (found === null) throw new Error(`no ${action} button`);
  return found;
};

afterEach(() => {
  cleanupToolbar();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const style of document.head.querySelectorAll("style[data-dev-toolbar-styles]")) {
    style.remove();
  }
});

describe("the chip", () => {
  it("renders without capturing anything", () => {
    const { toolbar } = mount();
    const chip = toolbar.item("diagnostics");
    expect(chip?.textContent).toContain("capture");
    // Nothing is built until the panel opens: walking every extension to keep a
    // number in the bar fresh would charge every consumer for this feature.
    expect(preview()).toBeNull();
  });

  it("says how many things were missing once a snapshot exists", () => {
    const { toolbar } = mount({}, [
      { id: "quiet", label: "Quiet" },
      { id: "loud", label: "Loud", diagnostics: () => ({ ok: true }) },
    ]);
    act(() => toolbar.openPanel("diagnostics"));
    const chip = toolbar.item("diagnostics");
    expect(chip?.textContent).toContain("1 missing");
    expect(chip?.querySelector('[data-dtb-incomplete="true"]')).not.toBeNull();
  });
});

describe("the panel", () => {
  it("captures on open and shows the text before anything is sent", () => {
    const { toolbar } = mount();
    act(() => toolbar.openPanel("diagnostics"));
    const text = preview()?.textContent ?? "";
    expect(text).toContain("# Diagnostic snapshot");
    expect(text).toContain("## Page");
    expect(text).toContain("## Responsiveness");
    // The promise, spelled out on screen.
    expect(document.body.textContent).toContain("Nothing has been sent anywhere");
  });

  it("includes a real neighbouring extension's contribution", () => {
    mountWithNeighbour();
    expect(preview()?.textContent).toContain("Flags — `flags`");
    expect(preview()?.textContent).toContain('"overrides"');
  });

  it("names a neighbour whose diagnostics() throws, in the banner and the text", () => {
    const { toolbar } = mount({}, [
      {
        id: "boom",
        label: "Boom",
        diagnostics: () => {
          throw new Error("deliberately broken");
        },
      },
    ]);
    act(() => toolbar.openPanel("diagnostics"));

    const banner = document.querySelector('[data-dtb-part="diag-omissions"]');
    expect(banner?.textContent).toContain("Incomplete");
    expect(banner?.textContent).toContain("deliberately broken");
    // And in the text that actually leaves the machine, which is the point.
    expect(preview()?.textContent).toContain("deliberately broken");
    expect(preview()?.textContent).toContain("Incomplete — 1 thing could not be included");
  });

  it("switches format, persists the choice, and keeps both views honest", () => {
    const storage = createMemoryStorage();
    const { toolbar } = mount({}, [], storage);
    act(() => toolbar.openPanel("diagnostics"));
    expect(preview()?.getAttribute("data-dtb-format")).toBe("markdown");

    const json = document.querySelector<HTMLButtonElement>(
      '[data-dtb-part="diag-format"][data-dtb-format="json"]',
    );
    act(() => fireEvent.click(json as HTMLButtonElement));

    expect(preview()?.getAttribute("data-dtb-format")).toBe("json");
    expect(preview()?.textContent).toContain('"generatedAt"');
    expect(storage.getItem(`dtb:v1:test:ext:diagnostics:${FORMAT_KEY}`)).toBe("json");
  });

  it("copies exactly what it displays", async () => {
    const writes: string[] = [];
    vi.stubGlobal("navigator", {
      clipboard: { writeText: async (text: string) => void writes.push(text) },
    });
    const { toolbar } = mount({}, [{ id: "n", label: "N", diagnostics: () => ({ n: 1 }) }]);
    act(() => toolbar.openPanel("diagnostics"));
    const displayed = preview()?.textContent ?? "";

    await act(async () => {
      fireEvent.click(button("copy"));
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toBe(displayed);
    expect(document.body.textContent).toContain("Copied Markdown");
  });

  it("says so rather than lying when the clipboard is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("URL", { ...URL, createObjectURL: undefined, revokeObjectURL: undefined });
    const { toolbar } = mount();
    act(() => toolbar.openPanel("diagnostics"));
    await act(async () => {
      fireEvent.click(button("copy"));
    });
    expect(document.body.textContent).toContain("Clipboard unavailable");
  });

  it("reports a download by its predictable filename", () => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:x",
      revokeObjectURL: () => {},
    });
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = () => {};
    const { toolbar } = mount();
    act(() => toolbar.openPanel("diagnostics"));
    act(() => fireEvent.click(button("download")));
    HTMLAnchorElement.prototype.click = realClick;

    expect(document.body.textContent).toMatch(/Downloading dev-toolbar-diagnostics-.*\.md\./);
  });

  it("says downloads are unavailable where they are", () => {
    // jsdom implements `URL.createObjectURL` as of 30; stage its absence.
    vi.stubGlobal("URL", { ...URL, createObjectURL: undefined, revokeObjectURL: undefined });
    const { toolbar } = mount();
    act(() => toolbar.openPanel("diagnostics"));
    act(() => fireEvent.click(button("download")));
    expect(document.body.textContent).toContain("Downloads are unavailable");
  });

  it("re-captures on demand and moves generatedAt", () => {
    const { toolbar } = mount();
    act(() => toolbar.openPanel("diagnostics"));
    const first = preview()?.textContent ?? "";
    vi.setSystemTime(new Date(Date.now() + 5_000));
    act(() => fireEvent.click(button("capture")));
    vi.useRealTimers();
    expect(preview()?.textContent).not.toBe(first);
  });
});

describe("the contract it uses", () => {
  it("declares the defaults the README documents", () => {
    // The factory's defaults are public API — they decide where the chip sits
    // and when it collapses — and they are documented in three places. Pinning
    // them is how the documentation and the code stay the same thing.
    const extension = diagnostics();
    expect(extension.align).toBe("end");
    expect(extension.order).toBe(10);
    expect(extension.priority).toBe(10);
    expect(extension.keepMounted).toBe(false);
    expect(extension.hidden).toBeUndefined();
    // The one that is not cosmetic: core warns, once per id, on a mismatch, so
    // a stale literal here means a warning in every consumer's console.
    expect(extension.contractVersion).toBe(CONTRACT_VERSION);
  });

  it("targets the contract version core actually implements", () => {
    // §7 stops the extension importing a *value* from core, so this number is
    // a hand-maintained copy — and it is printed into every outbound bug
    // report, where a stale one is a wrong fact in somebody's ticket. Tests are
    // not subject to that rule, so the drift is caught here instead.
    expect(TARGET_CONTRACT_VERSION).toBe(CONTRACT_VERSION);
  });

  it("does not contribute to the aggregation it reads", () => {
    const { toolbar } = mount();
    act(() => toolbar.openPanel("diagnostics"));
    const text = preview()?.textContent ?? "";
    expect(text).toContain("# Diagnostic snapshot");
    expect(text).not.toContain("Diagnostics — `diagnostics`");
  });

  it("excludes a hidden neighbour entirely — not even as an omission", () => {
    const { toolbar } = mount({}, [
      {
        id: "secret",
        label: "Secret",
        hidden: true,
        diagnostics: () => ({ classified: true }),
      },
    ]);
    act(() => toolbar.openPanel("diagnostics"));
    const text = preview()?.textContent ?? "";
    expect(text).not.toContain("secret");
    expect(text).not.toContain("classified");
  });

  it("contributes four commands and captures without opening the panel", () => {
    const { toolbar } = mount();
    const ids = toolbar.getCommands().map((command) => command.id);
    expect(ids).toEqual([
      "diagnostics.capture",
      "diagnostics.copy",
      "diagnostics.copyJson",
      "diagnostics.download",
    ]);
    // The chip reflects a capture driven entirely from the palette.
    expect(toolbar.item("diagnostics")?.textContent).toContain("capture");
  });

  it("makes its copy and download commands fail loudly, not silently", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("URL", { ...URL, createObjectURL: undefined, revokeObjectURL: undefined });
    const { toolbar } = mount();
    const commands = toolbar.getCommands();
    const copy = commands.find((c) => c.id === "diagnostics.copy");
    const download = commands.find((c) => c.id === "diagnostics.download");

    // A command that resolves is a command the palette closes over. These
    // could not do what they say, so they say so.
    await expect(copy?.run()).rejects.toThrow("clipboard is unavailable");
    // The stubbed `URL` above has no `createObjectURL`: the fail-closed path.
    expect(() => download?.run()).toThrow("Downloads are unavailable");

    // And the capture survives the failed copy, which is the property §15.4
    // claims: a copy you could not complete — or did not read — is still one
    // you can go and read, because every command captures into the same store.
    expect(toolbar.item("diagnostics")?.textContent).toContain("ready");
    act(() => toolbar.openPanel("diagnostics"));
    expect(preview()?.textContent).toContain("# Diagnostic snapshot");

    // `capture` itself needs neither a clipboard nor a download, so it works.
    const capture = commands.find((c) => c.id === "diagnostics.capture");
    expect(() => capture?.run()).not.toThrow();
  });

  it("leaves the bar rendered when a neighbour's slot throws", () => {
    const { toolbar } = mount({}, [
      {
        id: "boom",
        label: "Boom",
        compact: () => {
          throw new Error("chip is broken");
        },
        diagnostics: () => ({ still: "readable" }),
      },
    ]);
    act(() => toolbar.openPanel("diagnostics"));
    // A broken *slot* is core's problem and it degrades to an error chip; the
    // extension's `diagnostics()` is a different function and still contributes.
    expect(preview()?.textContent).toContain("readable");
  });

  it("keeps observing while the bar is hidden", () => {
    const { toolbar } = mount();
    act(() => toolbar.setVisible(false));
    act(() => toolbar.setVisible(true));
    act(() => toolbar.openPanel("diagnostics"));
    // Core reports visibility and never pauses anybody; the long task worth
    // reporting happened while the developer was using the application.
    expect(preview()?.textContent).toContain("## Responsiveness");
  });
});

/*
 * A1/D10 regression: the chip aria-label omitted the omission count. The
 * omissions banner keeps role="alert" on purpose — only the chip label changed.
 * Pre-fix chip markup: aria-label={label}.
 */
describe("accessibility", () => {
  it("includes the missing count in the chip aria-label and keeps omissions as role=alert", () => {
    const { toolbar } = mount({}, [
      { id: "quiet", label: "Quiet" },
      { id: "loud", label: "Loud", diagnostics: () => ({ ok: true }) },
    ]);
    const trigger = () =>
      toolbar.item("diagnostics")?.querySelector<HTMLButtonElement>('[data-dtb-part="trigger"]');
    expect(trigger()?.getAttribute("aria-label")).toBe("Diagnostics");

    act(() => toolbar.openPanel("diagnostics"));
    expect(trigger()?.getAttribute("aria-label")).toBe("Diagnostics, 1 missing");

    const banner = document.querySelector('[data-dtb-part="diag-omissions"]');
    expect(banner?.getAttribute("role")).toBe("alert");
  });
});

/** A stand-in for a neighbouring extension that owns real state. */
function mountWithNeighbour() {
  const { toolbar } = mount({}, [
    {
      id: "flags",
      label: "Flags",
      diagnostics: () => ({
        overrides: [{ key: "ui-facelift", value: "true" }],
      }),
    },
  ]);
  act(() => toolbar.openPanel("diagnostics"));
  return toolbar;
}
