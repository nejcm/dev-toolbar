/**
 * Every stylesheet-bearing extension wires `useExtensionSurface` to its own
 * `ensureXStyles`. The third argument is typed `() => unknown`, so a swapped
 * injector typechecks — this file checks each extension's own sheet plus the
 * foreign-sheet half that catches a wrong `ensureXStyles` argument.
 *
 * Mounting the toolbar renders only the `compact` and overlay slots —
 * `PanelHost` never mounts a panel that hasn't been opened — so each case
 * names its `panel` id and the test opens it before asserting.
 *
 * `mountEverySurface` is a floor, not a proof: it catches the host slot
 * failing to render and an extension whose surface threw, but cannot prove
 * the extension's own component ran. Core renders the `item` wrapper for
 * every extension and the `panel` wrapper sits outside `ExtensionBoundary`
 * (`src/core/Bar.tsx`, `src/core/PanelHost.tsx`), so a slot deleted from an
 * extension's factory still leaves both wrappers in the DOM — the error-chip
 * assertion catches the crash half of that; the deleted-slot half has no
 * cheap generic check and isn't covered here.
 *
 * command-menu is the one extension with no panel — it lives in the overlay
 * slot on purpose (`src/ext/command-menu/index.tsx`).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupToolbar, mountToolbar } from "@nejcm/dev-toolbar/testing";
import { STYLE_ATTRIBUTE } from "../../runtime/styles";
import { a11y } from "../a11y";
import { commandMenu } from "../command-menu";
import { diagnostics } from "../diagnostics";
import { environment } from "../environment";
import { flags } from "../flags";
import { metrics } from "../metrics";
import { overlays } from "../overlays";
import { themeEditor } from "../theme-editor";
import { extensionRoster } from "../../test-utils/extension-roster";
import type { ToolbarHandle } from "@nejcm/dev-toolbar/testing";
import type { DevToolbarExtension } from "../../core/contract";

const extensionNames = extensionRoster().withStyles;
const EXTENSION_STYLE_ENTRIES = extensionNames.map((name) => `ext-${name}`);
const KIT_STYLE_ENTRY = "kit";
const STYLE_ENTRIES = [KIT_STYLE_ENTRY, ...EXTENSION_STYLE_ENTRIES];

type ExtensionName = string;

interface ExtensionCase {
  name: ExtensionName;
  entry: string;
  /**
   * Extension id whose panel holds a second `useExtensionSurface` call site,
   * or `null` for command-menu, which has no panel slot at all.
   */
  panel: ExtensionName | null;
  /** Extension ids whose overlay slot holds a call site. */
  overlays: readonly ExtensionName[];
  usesKitStyles: boolean;
  mount(injectStyles: boolean): ToolbarHandle;
}

const memoryRead = () => ({
  usedJSHeapSize: 48 * 1024 * 1024,
  totalJSHeapSize: 64 * 1024 * 1024,
  jsHeapSizeLimit: 128 * 1024 * 1024,
});

const mountExtension = (
  extension: DevToolbarExtension,
  ui: Parameters<typeof mountToolbar>[0] = null,
): ToolbarHandle =>
  mountToolbar(ui, {
    extensions: [extension],
    instanceId: "test",
    layout: { barWidth: 1200, itemWidth: 120 },
  }).toolbar;

type ExtensionCaseDefinition = Omit<ExtensionCase, "name" | "entry">;

const EXTENSION_CASE_DEFINITIONS: Record<string, ExtensionCaseDefinition> = {
  a11y: {
    panel: "a11y",
    overlays: [],
    usesKitStyles: true,
    mount(injectStyles) {
      // A stub loader: the real peer's import would be a 550 KB parse in
      // every one of these mounts, and this suite is about stylesheets.
      return mountExtension(
        a11y({ injectStyles, load: () => Promise.reject(new Error("no axe")) }),
      );
    },
  },
  "command-menu": {
    panel: null,
    overlays: ["command-menu"],
    usesKitStyles: true,
    mount(injectStyles) {
      return mountExtension(commandMenu({ apple: false, injectStyles }));
    },
  },
  diagnostics: {
    panel: "diagnostics",
    overlays: [],
    usesKitStyles: true,
    mount(injectStyles) {
      return mountExtension(diagnostics({ injectStyles }));
    },
  },
  environment: {
    panel: "environment",
    overlays: [],
    usesKitStyles: true,
    mount(injectStyles) {
      return mountExtension(environment({ injectStyles }));
    },
  },
  flags: {
    panel: "flags",
    overlays: [],
    usesKitStyles: true,
    mount(injectStyles) {
      return mountExtension(
        flags({
          injectStyles,
          flags: [{ key: "test", type: "boolean", defaultValue: false, value: false }],
        }),
      );
    },
  },
  metrics: {
    panel: "metrics",
    overlays: [],
    usesKitStyles: true,
    mount(injectStyles) {
      return mountExtension(
        metrics({
          injectStyles,
          only: ["memory"],
          memory: { read: memoryRead, sampleMs: 50 },
        }),
      );
    },
  },
  overlays: {
    panel: "overlays",
    overlays: ["overlays"],
    usesKitStyles: true,
    mount(injectStyles) {
      return mountExtension(overlays({ injectStyles }));
    },
  },
  "theme-editor": {
    panel: "theme-editor",
    overlays: [],
    usesKitStyles: true,
    mount(injectStyles) {
      return mountExtension(
        themeEditor({
          injectStyles,
          tokens: [{ name: "--brand", type: "color", value: "#000000" }],
          surfaces: [{ id: "app", label: "App", selector: "#app" }],
        }),
      );
    },
  },
};

const EXTENSIONS: ExtensionCase[] = extensionNames.map((name) => {
  const definition = EXTENSION_CASE_DEFINITIONS[name];
  if (!definition) {
    throw new Error(`Missing inject-styles test entry for extension "${name}"`);
  }
  return { name, entry: `ext-${name}`, ...definition };
});

describe("inject-styles test roster", () => {
  it("has exactly one definition per styled extension", () => {
    expect(
      Object.keys(EXTENSION_CASE_DEFINITIONS).sort(),
      "inject-styles test definitions must match the styled extension roster",
    ).toEqual(extensionNames);
  });
});

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

/**
 * Mounts, then opens the panel so every `useExtensionSurface` call site the
 * extension owns gets a chance to run. Proves the host slot rendered and
 * nothing degraded to an error chip — see the file header for what this does
 * and does not catch.
 */
function mountEverySurface(target: ExtensionCase, injectStyles: boolean): void {
  const toolbar = target.mount(injectStyles);

  expect(toolbar.item(target.name), `${target.name} must render a bar item`).not.toBeNull();

  // A surface that throws is caught by `ExtensionBoundary` and replaced with an
  // error chip, leaving the item/panel wrapper in place — without this check
  // the swap check would pass on only half the call sites.
  expect(
    toolbar.errorChip(target.name),
    `${target.name} must not degrade to an error chip — a thrown surface never reaches its ensureXStyles`,
  ).toBeNull();

  for (const id of target.overlays) {
    expect(toolbar.overlay(id), `${target.name} must render the ${id} overlay slot`).not.toBeNull();
  }

  if (target.panel === null) return;
  toolbar.openPanel(target.panel);
  expect(
    toolbar.panel(target.panel),
    `${target.name} must render its panel once opened — the panel call sites are the point of this test`,
  ).not.toBeNull();
  expect(
    toolbar.errorChip(target.name),
    `${target.name}'s panel must not degrade to an error chip once opened`,
  ).toBeNull();
}

/**
 * Both halves in one assertion: asserting the own-sheet count first would
 * short-circuit a pure swap and fail with "expected 1, got 0" without naming
 * the foreign sheet that actually landed.
 */
function expectOnlyOwnSheet(target: ExtensionCase): void {
  const own = document.head.querySelectorAll(`style[${STYLE_ATTRIBUTE}="${target.entry}"]`).length;
  const kit = document.head.querySelectorAll(
    `style[${STYLE_ATTRIBUTE}="${KIT_STYLE_ENTRY}"]`,
  ).length;
  const foreign = STYLE_ENTRIES.filter(
    (other) =>
      other !== target.entry &&
      !(target.usesKitStyles && other === KIT_STYLE_ENTRY) &&
      styleForEntry(other) !== null,
  );

  expect(
    { own, kit, foreign },
    `${target.name} must inject its expected sheets and no foreign sheet`,
  ).toEqual({ own: 1, kit: target.usesKitStyles ? 1 : 0, foreign: [] });
}

describe.each(EXTENSIONS)("$name extension surface", (target) => {
  it("injects no stylesheet when injectStyles is false", () => {
    mountEverySurface(target, false);
    expect(
      styleForEntry(target.entry),
      `${target.name} must not inject ${target.entry} when injectStyles is false`,
    ).toBeNull();
    expect(
      styleForEntry(KIT_STYLE_ENTRY),
      `${target.name} must not inject ${KIT_STYLE_ENTRY} when injectStyles is false`,
    ).toBeNull();
  });

  it("injects only its expected stylesheets when injectStyles is true", () => {
    mountEverySurface(target, true);
    expectOnlyOwnSheet(target);
  });
});
