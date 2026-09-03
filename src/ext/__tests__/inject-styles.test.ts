/**
 * Every first-party extension wires `useExtensionSurface` to its own
 * `ensureXStyles` at fifteen call sites across the seven ui.tsx files. The
 * third argument is typed `() => unknown`, so a swapped injector typechecks
 * and — for four of the seven (command-menu, diagnostics, flags, theme-editor)
 * — had no injectStyles test until this file. Environment, metrics and overlays
 * already asserted own-sheet presence; this file generalises the pattern and
 * adds the foreign-sheet half that catches a wrong ensureXStyles argument.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupToolbar, mountToolbar } from "@nejcm/dev-toolbar/testing";
import { STYLE_ATTRIBUTE } from "../../runtime/styles";
import { commandMenu } from "../command-menu";
import { diagnostics } from "../diagnostics";
import { environment } from "../environment";
import { flags } from "../flags";
import { metrics } from "../metrics";
import { overlays } from "../overlays";
import { themeEditor } from "../theme-editor";
import type { DevToolbarExtension } from "../../core/contract";

const EXTENSION_STYLE_ENTRIES = [
  "ext-command-menu",
  "ext-diagnostics",
  "ext-environment",
  "ext-flags",
  "ext-metrics",
  "ext-overlays",
  "ext-theme-editor",
] as const;

type ExtensionName =
  | "command-menu"
  | "diagnostics"
  | "environment"
  | "flags"
  | "metrics"
  | "overlays"
  | "theme-editor";

interface ExtensionCase {
  name: ExtensionName;
  entry: (typeof EXTENSION_STYLE_ENTRIES)[number];
  mount(injectStyles: boolean): void;
}

const memoryRead = () => ({
  usedJSHeapSize: 48 * 1024 * 1024,
  totalJSHeapSize: 64 * 1024 * 1024,
  jsHeapSizeLimit: 128 * 1024 * 1024,
});

const mountExtension = (
  extension: DevToolbarExtension,
  ui: Parameters<typeof mountToolbar>[0] = null,
) => {
  mountToolbar(ui, {
    extensions: [extension],
    instanceId: "test",
    layout: { barWidth: 1200, itemWidth: 120 },
  });
};

const EXTENSIONS: ExtensionCase[] = [
  {
    name: "command-menu",
    entry: "ext-command-menu",
    mount(injectStyles) {
      mountExtension(commandMenu({ apple: false, injectStyles }));
    },
  },
  {
    name: "diagnostics",
    entry: "ext-diagnostics",
    mount(injectStyles) {
      mountExtension(diagnostics({ injectStyles }));
    },
  },
  {
    name: "environment",
    entry: "ext-environment",
    mount(injectStyles) {
      mountExtension(environment({ injectStyles }));
    },
  },
  {
    name: "flags",
    entry: "ext-flags",
    mount(injectStyles) {
      mountExtension(
        flags({
          injectStyles,
          flags: [{ key: "test", type: "boolean", defaultValue: false, value: false }],
        }),
      );
    },
  },
  {
    name: "metrics",
    entry: "ext-metrics",
    mount(injectStyles) {
      mountExtension(
        metrics({
          injectStyles,
          only: ["memory"],
          memory: { read: memoryRead, sampleMs: 50 },
        }),
      );
    },
  },
  {
    name: "overlays",
    entry: "ext-overlays",
    mount(injectStyles) {
      mountExtension(overlays({ injectStyles }));
    },
  },
  {
    name: "theme-editor",
    entry: "ext-theme-editor",
    mount(injectStyles) {
      mountExtension(
        themeEditor({
          injectStyles,
          tokens: [{ name: "--brand", type: "color", value: "#000000" }],
          surfaces: [{ id: "app", label: "App", selector: "#app" }],
        }),
      );
    },
  },
];

function removeExtensionStyles(): void {
  for (const style of document.head.querySelectorAll(`style[${STYLE_ATTRIBUTE}]`)) {
    style.remove();
  }
}

function styleForEntry(entry: string): HTMLStyleElement | null {
  return document.head.querySelector<HTMLStyleElement>(`style[${STYLE_ATTRIBUTE}="${entry}"]`);
}

beforeEach(() => {
  removeExtensionStyles();
});

afterEach(() => {
  cleanupToolbar();
  removeExtensionStyles();
});

describe.each(EXTENSIONS)("$name extension surface", ({ name, entry, mount }) => {
  it("injects no stylesheet when injectStyles is false", () => {
    mount(false);
    expect(
      styleForEntry(entry),
      `${name} must not inject ${entry} when injectStyles is false`,
    ).toBeNull();
  });

  it("injects only its own stylesheet when injectStyles is true", () => {
    mount(true);
    expect(
      document.head.querySelectorAll(`style[${STYLE_ATTRIBUTE}="${entry}"]`).length,
      `${name} must inject exactly one ${entry} sheet`,
    ).toBe(1);

    for (const other of EXTENSION_STYLE_ENTRIES) {
      if (other === entry) continue;
      expect(styleForEntry(other), `${name} must not inject ${other}`).toBeNull();
    }
  });
});
