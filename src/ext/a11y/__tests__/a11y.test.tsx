/**
 * `/ext/a11y` against the real shell, through the same `/testing` surface a
 * stranger writing an extension would use, plus two conformance checks: every
 * command declares what a reader needs to call it, and `diagnostics()` hands
 * back the very object the panel renders.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { cleanupToolbar, installClipboard, mountToolbar } from "@nejcm/dev-toolbar/testing";
import { CONTRACT_VERSION } from "../../../core/contract";
import { a11y } from "../index";
import { createA11yRuntime } from "../runtime";
import { selectionKey } from "../types";
import type { A11yOptions } from "../index";
import type { A11yReport, AxeLike } from "../types";
import type { CommandInputField } from "../../../core/contract";

const app = (
  <main data-testid="app">
    <button id="one" type="button">
      one
    </button>
  </main>
);

const RESULTS = {
  violations: [
    {
      id: "label",
      impact: "critical",
      help: "Form elements must have labels",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.10/label",
      tags: ["wcag2a"],
      nodes: [
        {
          target: ["#one"],
          html: '<input id="one" value="hunter2" aria-label="">',
          failureSummary: "Fix any of the following: element has no label",
        },
      ],
    },
    {
      id: "region",
      impact: "moderate",
      help: "All content should be contained by landmarks",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.10/region",
      tags: ["best-practice"],
      nodes: [{ target: ["#two"], html: "<p>orphan</p>", failureSummary: null }],
    },
  ],
  passes: [{}, {}],
  incomplete: [],
  testEngine: { version: "4.10.0" },
};

const stub = (results: unknown = RESULTS): AxeLike => ({
  version: "4.10.0",
  run: () => Promise.resolve(results),
});

const mount = (options: A11yOptions = {}) => {
  const extension = a11y({ load: () => Promise.resolve(stub()), ...options });
  const result = mountToolbar(app, {
    extensions: [extension],
    instanceId: "test",
    layout: { barWidth: 1200, itemWidth: 90 },
  });
  return { extension, ...result };
};

const part = (name: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-dtb-part="${name}"]`);

const parts = (name: string): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(`[data-dtb-part="${name}"]`),
];

afterEach(() => {
  cleanupToolbar();
  vi.restoreAllMocks();
  for (const style of document.head.querySelectorAll("style[data-dev-toolbar-styles]")) {
    style.remove();
  }
});

describe("the chip", () => {
  it("mounts without scanning anything", () => {
    const { toolbar } = mount();
    const chip = toolbar.item("a11y");
    expect(toolbar.errorChip("a11y")).toBeNull();
    expect(chip?.textContent).toContain("scan");
    expect(chip?.querySelector('[data-dtb-status="pending"]')).not.toBeNull();
  });

  it("counts the violations once a scan has run", async () => {
    const { toolbar } = mount();
    await act(async () => {
      await toolbar.invokeCommand("a11y.scan");
    });
    const chip = toolbar.item("a11y");
    expect(chip?.textContent).toContain("2");
    expect(chip?.querySelector('[data-dtb-part="trigger"]')?.getAttribute("aria-label")).toBe(
      "Accessibility (a11y), 2 violations",
    );
  });
});

describe("a missing peer", () => {
  const failing = () => Promise.reject(new Error("Cannot find module 'axe-core'"));

  it("renders the unsupported state instead of throwing", async () => {
    const { toolbar } = mount({ load: failing });
    await act(async () => {
      await toolbar.invokeCommand("a11y.scan");
    });
    act(() => toolbar.openPanel("a11y"));

    expect(toolbar.errorChip("a11y")).toBeNull();
    expect(part("a11y-unsupported")?.textContent).toContain("axe-core is not installed");
    expect(part("a11y-scan")).toHaveProperty("disabled", true);
    expect(toolbar.item("a11y")?.textContent).toContain("NA");
  });

  it("still answers an agent, with the reason", async () => {
    const { extension, toolbar } = mount({ load: failing });
    const result = await act(async () => toolbar.invokeCommand<A11yReport>("a11y.scan"));

    expect(result).toMatchObject({ ok: true });
    const report = result.ok ? result.result : null;
    expect(report?.status).toBe("unsupported");
    const contributed = extension.diagnostics as () => A11yReport;
    expect(contributed().status).toBe("unsupported");
  });
});

describe("the panel", () => {
  it("scans from a click and groups what it found, worst impact first", async () => {
    const { toolbar } = mount();
    act(() => toolbar.openPanel("a11y"));

    await act(async () => {
      fireEvent.click(part("a11y-scan") as HTMLElement);
    });

    expect(parts("a11y-group").map((group) => group.getAttribute("data-dtb-impact"))).toEqual([
      "critical",
      "moderate",
    ]);
    expect(parts("a11y-rule-id").map((rule) => rule.textContent)).toEqual(["label", "region"]);
    expect(part("a11y-rule")?.textContent).toContain("Form elements must have labels");
    expect(part("a11y-meta")?.textContent).toContain("4.10.0");
  });

  it("says the page is clean without claiming more than axe checked", async () => {
    const { toolbar } = mount({ load: () => Promise.resolve(stub({ violations: [] })) });
    act(() => toolbar.openPanel("a11y"));
    await act(async () => {
      await toolbar.invokeCommand("a11y.scan");
    });
    expect(part("a11y-empty")?.textContent).toContain("floor, not a verdict");
  });

  it("never puts a masked-away value on the screen", async () => {
    const { toolbar } = mount();
    act(() => toolbar.openPanel("a11y"));
    await act(async () => {
      await toolbar.invokeCommand("a11y.scan");
    });
    expect(part("a11y-panel")?.textContent).not.toContain("hunter2");
    expect(part("a11y-node-html")?.textContent).toContain("[redacted]");
  });

  it("shows a failed scan as an alert rather than an empty page", async () => {
    const { toolbar } = mount({
      load: () => Promise.resolve({ run: () => Promise.reject(new Error("detached frame")) }),
    });
    act(() => toolbar.openPanel("a11y"));
    await act(async () => {
      await toolbar.invokeCommand("a11y.scan");
    });
    expect(part("a11y-error")?.textContent).toContain("detached frame");
    expect(toolbar.item("a11y")?.textContent).toContain("error");
    expect(toolbar.errorChip("a11y")).toBeNull();
  });

  it("does not claim axe was checked when it is not loaded until a scan", async () => {
    const load = vi.fn(() => Promise.resolve(stub()));
    const { toolbar } = mount({ load, loadOn: "scan" });
    act(() => toolbar.openPanel("a11y"));

    expect(load).not.toHaveBeenCalled();
    expect(part("a11y-unchecked")?.textContent).toContain("has not been checked yet");
    expect(part("a11y-unchecked")?.textContent).toContain("Scan this page to load it");
    expect(part("a11y-unsupported")).toBeNull();
    expect(part("a11y-scan")).toHaveProperty("disabled", false);
    expect(toolbar.item("a11y")?.textContent).toContain("scan");

    await act(async () => {
      fireEvent.click(part("a11y-scan") as HTMLElement);
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(part("a11y-unchecked")).toBeNull();
    expect(parts("a11y-rule-id").map((rule) => rule.textContent)).toEqual(["label", "region"]);

    // Cleared is not unchecked: axe stayed loaded.
    act(() => {
      fireEvent.click(part("a11y-clear") as HTMLElement);
    });
    expect(part("a11y-unchecked")).toBeNull();
    expect(toolbar.item("a11y")?.textContent).toContain("scan");
  });

  it("keeps the default panel free of the unchecked note, even while the import is in flight", async () => {
    let resolve: (axe: AxeLike) => void = () => {};
    const load = () =>
      new Promise<AxeLike>((done) => {
        resolve = done;
      });
    const { toolbar } = mount({ load });
    act(() => toolbar.openPanel("a11y"));

    // Pending and not yet loaded, but the check is under way, not deferred.
    expect(part("a11y-unchecked")).toBeNull();

    await act(async () => {
      resolve(stub());
      await Promise.resolve();
    });
    expect(part("a11y-unchecked")).toBeNull();
  });

  it("shows the missing peer only once a scan looked for it, under loadOn: scan", async () => {
    const { toolbar } = mount({
      load: () => Promise.reject(new Error("Cannot find module 'axe-core'")),
      loadOn: "scan",
    });
    act(() => toolbar.openPanel("a11y"));
    expect(part("a11y-unsupported")).toBeNull();
    expect(part("a11y-unchecked")).not.toBeNull();

    await act(async () => {
      await toolbar.invokeCommand("a11y.scan");
    });
    expect(part("a11y-unchecked")).toBeNull();
    expect(part("a11y-unsupported")?.textContent).toContain("axe-core is not installed");
    expect(part("a11y-scan")).toHaveProperty("disabled", true);
  });

  it("clears back to pending", async () => {
    const { toolbar } = mount();
    act(() => toolbar.openPanel("a11y"));
    await act(async () => {
      await toolbar.invokeCommand("a11y.scan");
    });
    act(() => {
      fireEvent.click(part("a11y-clear") as HTMLElement);
    });
    expect(parts("a11y-rule")).toEqual([]);
    expect(toolbar.item("a11y")?.textContent).toContain("scan");
  });
});

describe("click-to-highlight", () => {
  it("draws a box over the element from the overlay slot, and takes it back", async () => {
    const { toolbar } = mount();
    const target = document.getElementById("one") as HTMLElement;
    target.getBoundingClientRect = () =>
      ({ x: 12, y: 34, width: 56, height: 78, top: 34, left: 12 }) as DOMRect;

    act(() => toolbar.openPanel("a11y"));
    await act(async () => {
      await toolbar.invokeCommand("a11y.scan");
    });

    expect(part("a11y-surface")).toBeNull();

    await act(async () => {
      fireEvent.click(part("a11y-highlight") as HTMLElement);
    });

    const box = part("a11y-box");
    expect(part("a11y-surface")).not.toBeNull();
    expect(box?.style.left).toBe("12px");
    expect(box?.style.top).toBe("34px");
    expect(box?.style.width).toBe("56px");
    expect(box?.getAttribute("data-dtb-impact")).toBe("critical");
    expect(part("a11y-badge")?.textContent).toBe("label");
    expect(part("a11y-node")?.getAttribute("data-dtb-selected")).toBe("true");

    await act(async () => {
      fireEvent.click(part("a11y-highlight") as HTMLElement);
    });
    expect(part("a11y-surface")).toBeNull();
  });
});

describe("the agent surface", () => {
  it("declares a description on every command, and an input wherever one takes an argument", () => {
    const { toolbar } = mount();
    const commands = toolbar.getCommands().filter((command) => command.id.startsWith("a11y."));

    expect(commands.map((command) => command.id)).toEqual([
      "a11y.scan",
      "a11y.export",
      "a11y.highlight",
      "a11y.clear",
    ]);
    for (const command of commands) {
      expect(typeof command.description, command.id).toBe("string");
      expect((command.description as string).length, command.id).toBeGreaterThan(20);
      expect(command.group, command.id).toBe("Accessibility");
    }

    // Only the argument-taking commands declare a v2 schema, or a palette
    // would refuse to run the others from a keypress.
    expect(
      commands.filter((command) => command.input !== undefined).map((command) => command.id),
    ).toEqual(["a11y.export", "a11y.highlight"]);

    const fields = commands.flatMap((command) =>
      Object.entries(command.input?.fields ?? {}).map(
        ([name, field]) => [command.id, name, field] as [string, string, CommandInputField],
      ),
    );
    expect(fields.map(([id, name]) => `${id}.${name}`)).toEqual([
      "a11y.export.copy",
      "a11y.highlight.rule",
      "a11y.highlight.node",
    ]);
    for (const [id, name, field] of fields) {
      expect(typeof field.description, `${id}.${name}`).toBe("string");
      expect(["boolean", "string", "number"], `${id}.${name}`).toContain(field.type);
    }
  });

  it("returns the report from scan and export, and refuses bad input by throwing", async () => {
    const { toolbar } = mount();
    const scanned = await act(async () => toolbar.invokeCommand<A11yReport>("a11y.scan"));
    expect(scanned.ok && scanned.result?.total).toBe(2);

    const exported = await act(async () =>
      toolbar.invokeCommand<A11yReport>("a11y.export", { copy: false }),
    );
    expect(exported.ok && exported.result?.total).toBe(2);
    // Reading is not scanning: must not have run axe a second time.
    expect(exported.ok && exported.result?.scans).toBe(1);

    await expect(toolbar.invokeCommand("a11y.export", { copy: "yes" })).rejects.toThrow(
      "`copy` must be a boolean",
    );
    await expect(toolbar.invokeCommand("a11y.highlight", { rule: 7 })).rejects.toThrow(
      "`rule` must be a string",
    );
    await expect(
      toolbar.invokeCommand("a11y.highlight", { rule: "label", node: -1 }),
    ).rejects.toThrow("`node` must be a non-negative integer");
  });

  it("puts the report on the clipboard when asked, and only then", async () => {
    const clipboard = installClipboard();
    const { toolbar } = mount();
    await act(async () => {
      await toolbar.invokeCommand("a11y.scan");
    });

    await act(async () => {
      await toolbar.invokeCommand("a11y.export", { copy: false });
    });
    expect(clipboard.writes).toEqual([]);

    await act(async () => {
      await toolbar.invokeCommand("a11y.export", { copy: true });
    });
    const written = clipboard.writes[0] ?? "";
    expect(JSON.parse(written).total).toBe(2);
    expect(written).not.toContain("hunter2");
    clipboard.restore();
  });

  it("clears through its command too", async () => {
    const { extension, toolbar } = mount();
    await act(async () => {
      await toolbar.invokeCommand("a11y.scan");
    });
    const cleared = await act(async () => toolbar.invokeCommand<A11yReport>("a11y.clear"));
    expect(cleared.ok && cleared.result?.status).toBe("pending");
    expect((extension.diagnostics as () => A11yReport)().scans).toBe(1);
  });

  it("highlights and clears through commands, the way an agent drives it", async () => {
    const { toolbar } = mount();
    const target = document.getElementById("one") as HTMLElement;
    target.getBoundingClientRect = () =>
      ({ x: 1, y: 2, width: 3, height: 4, top: 2, left: 1 }) as DOMRect;
    await act(async () => {
      await toolbar.invokeCommand("a11y.scan");
    });

    const selected = await act(async () =>
      toolbar.invokeCommand<A11yReport>("a11y.highlight", { rule: "label" }),
    );
    expect(selected.ok && selected.result?.selected).toBe(selectionKey("label", 0));
    expect(part("a11y-box")).not.toBeNull();

    const cleared = await act(async () => toolbar.invokeCommand<A11yReport>("a11y.highlight"));
    expect(cleared.ok && cleared.result?.selected).toBeNull();
    expect(part("a11y-box")).toBeNull();
  });
});

describe("diagnostics() and the panel", () => {
  it("hand back the same object, so neither can show what the other cannot", async () => {
    const runtime = createA11yRuntime({ load: () => Promise.resolve(stub()) });
    await runtime.scan();
    runtime.store.flush();

    // The panel's only source is `useExtensionSurface(runtime.store).report`.
    expect(Object.is(runtime.diagnostics(), runtime.store.getSnapshot().report)).toBe(true);
  });

  it("agrees with the rendered panel, fact for fact", async () => {
    const { extension, toolbar } = mount();
    act(() => toolbar.openPanel("a11y"));
    await act(async () => {
      await toolbar.invokeCommand("a11y.scan");
    });

    const report = (extension.diagnostics as () => A11yReport)();
    const rendered = part("a11y-panel")?.textContent ?? "";

    expect(report.status).toBe("ok");
    for (const group of report.groups) {
      for (const entry of group.violations) {
        expect(rendered, entry.rule).toContain(entry.rule);
        expect(rendered, entry.help).toContain(entry.help);
        for (const node of entry.nodes) {
          expect(rendered).toContain(node.html);
          // The summary is in the export, so it must be on screen too.
          if (node.summary !== null) expect(rendered).toContain(node.summary);
        }
      }
    }
    // And the chip's number is the report's, not a second count.
    expect(toolbar.item("a11y")?.textContent).toContain(String(report.total));
    expect(JSON.stringify(report)).not.toContain("hunter2");
  });

  it("shows a failure summary, so nothing is exported that the panel hides", async () => {
    const results = {
      violations: [
        {
          id: "label",
          impact: "critical",
          help: "Form elements must have labels",
          helpUrl: null,
          tags: [],
          nodes: [
            {
              target: ["#one"],
              html: '<input id="one">',
              failureSummary: "Fix any of the following: retry against /cb?token=abc123SECRET",
            },
          ],
        },
      ],
    };
    const { extension, toolbar } = mount({ load: () => Promise.resolve(stub(results)) });
    act(() => toolbar.openPanel("a11y"));
    await act(async () => {
      await toolbar.invokeCommand("a11y.scan");
    });

    const report = (extension.diagnostics as () => A11yReport)();
    const summary = report.groups[0]?.violations[0]?.nodes[0]?.summary ?? "";
    expect(summary).toContain("Fix any of the following");
    expect(part("a11y-node-summary")?.textContent).toBe(summary);
  });

  it("reaches core's roster, which is what /ext/agent and /ext/diagnostics read", async () => {
    // The path `/ext/agent` and `/ext/diagnostics` both take, via `start(api)`.
    let roster: (() => readonly { id: string; status: string; data?: unknown }[]) | null = null;
    const extension = a11y({ load: () => Promise.resolve(stub()) });
    const { toolbar } = mountToolbar(app, {
      extensions: [
        extension,
        {
          id: "reader",
          label: "Reader",
          start: (api) => {
            roster = () => api.getDiagnostics();
          },
        },
      ],
      instanceId: "test",
      layout: { barWidth: 1200, itemWidth: 90 },
    });

    await act(async () => {
      await toolbar.invokeCommand("a11y.scan");
    });

    const read = roster as unknown as () => readonly {
      id: string;
      status: string;
      data?: unknown;
    }[];
    const entry = read().find((contribution) => contribution.id === "a11y");
    expect(entry?.status).toBe("ok");
    const data = entry === undefined ? null : (entry.data as A11yReport);
    expect(data?.total).toBe(2);
  });
});

describe("the extension object", () => {
  it("declares core's contract version and keeps its panel mounted", () => {
    const { extension } = mount();
    expect(extension.contractVersion).toBe(CONTRACT_VERSION);
    expect(extension.keepMounted).toBe(true);
    expect(extension.id).toBe("a11y");
  });

  it("takes an id and label, which every command id follows", () => {
    const { extension } = mount({ id: "axe", label: "Axe" });
    const ids = (extension.commands as unknown as { id: string }[]).map((command) => command.id);
    expect(ids).toEqual(["axe.scan", "axe.export", "axe.highlight", "axe.clear"]);
  });
});
