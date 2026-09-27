import { afterEach, describe, expect, it } from "vitest";
import { createMemoryStorage } from "@nejcm/dev-toolbar";
import { cleanupToolbar, mountToolbar } from "@nejcm/dev-toolbar/testing";
import { ALL_PRESETS } from "@nejcm/dev-toolbar/kit";
import type { CompactRenderContext } from "@nejcm/dev-toolbar/kit";
import type { DevToolbarExtension } from "../../core/contract";
import { extensionRoster } from "../../test-utils/extension-roster";
import { a11y } from "../a11y";
import { agentBridge } from "../agent";
import { commandMenu } from "../command-menu";
import { diagnostics } from "../diagnostics";
import { environment } from "../environment";
import { flags } from "../flags";
import { metrics } from "../metrics";
import { overlays } from "../overlays";
import { themeEditor } from "../theme-editor";

interface PresetCase {
  name: string;
  id: string;
  make(): DevToolbarExtension;
  selectors: readonly string[];
  factoryOutput: readonly string[];
  viewerOutput: readonly string[];
}

const memoryRead = () => ({
  usedJSHeapSize: 48 * 1024 * 1024,
  totalJSHeapSize: 64 * 1024 * 1024,
  jsHeapSizeLimit: 128 * 1024 * 1024,
});

const CASES: readonly PresetCase[] = [
  {
    name: "a11y",
    id: "a11y",
    make: () => a11y({ loadOn: "scan", injectStyles: false, presentation: "value" }),
    selectors: ['[data-dtb-part="a11y-chip"]'],
    factoryOutput: ["scan"],
    viewerOutput: ["a11y"],
  },
  {
    name: "diagnostics",
    id: "diagnostics",
    make: () => diagnostics({ injectStyles: false, presentation: "value" }),
    selectors: ['[data-dtb-part="diag-chip"]'],
    factoryOutput: ["capture"],
    viewerOutput: ["diagnostics"],
  },
  {
    name: "environment",
    id: "environment",
    make: () =>
      environment({
        context: { environment: "staging" },
        injectStyles: false,
        presentation: "value",
      }),
    selectors: ['[data-dtb-part="env-chip"]'],
    factoryOutput: ["staging"],
    viewerOutput: ["env"],
  },
  {
    name: "flags",
    id: "flags",
    make: () =>
      flags({
        flags: [{ key: "checkout.tier", type: "string", defaultValue: "gold" }],
        promoted: [{ flagKey: "checkout.tier", presentation: "value" }],
        injectStyles: false,
        presentation: "value",
      }),
    selectors: [
      '[data-dtb-part="flag-chip"]',
      '[data-dtb-part="flag-promoted"][data-dtb-flag="checkout.tier"]',
    ],
    factoryOutput: ["1", "gold"],
    viewerOutput: ["flags", "checkout.tier"],
  },
  {
    name: "metrics",
    id: "metrics",
    make: () =>
      metrics({
        only: ["memory"],
        memory: { read: memoryRead },
        injectStyles: false,
        presentation: "value",
      }),
    selectors: ['[data-dtb-part="metrics-chip"][data-dtb-metric="memory"]'],
    factoryOutput: ["48 MB"],
    viewerOutput: ["mem"],
  },
  {
    name: "overlays",
    id: "overlays",
    make: () => overlays({ injectStyles: false, presentation: "value" }),
    selectors: ['[data-dtb-part="ovl-chip"]'],
    factoryOutput: ["off"],
    viewerOutput: ["overlays"],
  },
  {
    name: "theme-editor",
    id: "theme-editor",
    make: () =>
      themeEditor({
        tokens: [{ name: "--brand", type: "color", value: "#000000" }],
        injectStyles: false,
        presentation: "value",
      }),
    selectors: ['[data-dtb-part="thm-chip"]'],
    factoryOutput: ["1"],
    viewerOutput: ["theme"],
  },
];

function compactOutput(testCase: PresetCase, preset?: "label"): string[] {
  cleanupToolbar();
  const storage = createMemoryStorage(
    preset
      ? {
          "dtb:v1:test:extensionSettings": JSON.stringify({
            [testCase.id]: { preset },
          }),
        }
      : {},
  );
  const { toolbar } = mountToolbar(null, {
    extensions: [testCase.make()],
    storage,
    layout: { barWidth: 4000, itemWidth: 200 },
  });
  const item = toolbar.item(testCase.id);
  expect(item).not.toBeNull();
  return testCase.selectors.map((selector) => {
    const control = item?.querySelector<HTMLElement>(selector);
    expect(control, `${testCase.name} is missing ${selector}`).not.toBeNull();
    return control?.textContent ?? "";
  });
}

afterEach(cleanupToolbar);

describe.each(CASES)("$name viewer preset", (testCase) => {
  it("keeps the factory output when unset and replaces it when set", () => {
    expect(compactOutput(testCase)).toEqual(testCase.factoryOutput);
    expect(compactOutput(testCase, "label")).toEqual(testCase.viewerOutput);
  });
});

describe("first-party preset support", () => {
  const factories: Record<string, () => DevToolbarExtension> = {
    a11y: () => a11y(),
    agent: () => agentBridge({ instanceId: "preset-roster" }),
    "command-menu": () => commandMenu(),
    diagnostics: () => diagnostics(),
    environment: () => environment(),
    flags: () => flags(),
    metrics: () => metrics(),
    overlays: () => overlays(),
    "theme-editor": () => themeEditor(),
  };

  it("declares every preset on exactly the seven presentation-capable extensions", () => {
    expect(Object.keys(factories).sort()).toEqual(extensionRoster().onDisk);

    const optedIn = Object.entries(factories)
      .filter(([, make]) => make().presets !== undefined)
      .map(([name]) => name);
    expect(optedIn).toEqual([
      "a11y",
      "diagnostics",
      "environment",
      "flags",
      "metrics",
      "overlays",
      "theme-editor",
    ]);
    for (const name of optedIn) expect(factories[name]!().presets).toBe(ALL_PRESETS);
    expect(factories.agent!().presets).toBeUndefined();
    expect(factories["command-menu"]!().presets).toBeUndefined();
  });

  it("runs a consumer render callback with the viewer-selected fallback", () => {
    const contexts: CompactRenderContext[] = [];
    const testCase: PresetCase = {
      ...CASES[0]!,
      make: () =>
        a11y({
          loadOn: "scan",
          injectStyles: false,
          presentation: {
            preset: "value",
            render: (_report, context) => {
              contexts.push(context);
              return context.fallback;
            },
          },
        }),
    };

    expect(compactOutput(testCase, "label")).toEqual(["a11y"]);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.preset).toBe("label");
  });
});
