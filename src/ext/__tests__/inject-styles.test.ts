/**
 * Every first-party extension wires `useExtensionSurface` to its own
 * `ensureXStyles` at fifteen call sites across the seven ui.tsx files. The
 * third argument is typed `() => unknown`, so a swapped injector typechecks
 * and — for four of the seven (command-menu, diagnostics, flags, theme-editor)
 * — had no injectStyles test until this file. Environment, metrics and overlays
 * already asserted own-sheet presence; this file generalises the pattern and
 * adds the foreign-sheet half that catches a wrong ensureXStyles argument.
 *
 * Mounting the toolbar renders only the `compact` slot and the overlay slots —
 * `PanelHost` never mounts a panel that has not been opened — so six of the
 * fifteen call sites live in a panel component that a bare `mount()` would
 * never run. Each case therefore names its `panel` id and the test opens it
 * before asserting.
 *
 * What `mountEverySurface` checks is a floor, not a proof: it catches the host
 * slot failing to render, and an extension whose surface threw. It cannot
 * prove the extension's own component ran. Core renders the
 * `data-dtb-part="item"` wrapper for every extension and substitutes a default
 * trigger when `compact` is absent (`src/core/Bar.tsx`), and the
 * `data-dtb-part="panel"` wrapper sits outside `ExtensionBoundary`
 * (`src/core/PanelHost.tsx`) — so a slot deleted from an extension's factory
 * still leaves both wrappers in the DOM and this file drops to half coverage
 * without failing. The error-chip assertion closes the crash half of that;
 * the deleted-slot half has no cheap generic check and is not covered here.
 *
 * command-menu is the one extension with no panel: it lives in the overlay
 * slot on purpose (see `src/ext/command-menu/index.tsx`), and both of its call
 * sites — trigger and overlay — mount from the bare mount.
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
import type { ToolbarHandle } from "@nejcm/dev-toolbar/testing";
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
const KIT_STYLE_ENTRY = "kit";
const STYLE_ENTRIES = [KIT_STYLE_ENTRY, ...EXTENSION_STYLE_ENTRIES] as const;

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

const EXTENSIONS: ExtensionCase[] = [
  {
    name: "command-menu",
    entry: "ext-command-menu",
    panel: null,
    overlays: ["command-menu"],
    usesKitStyles: true,
    mount(injectStyles) {
      return mountExtension(commandMenu({ apple: false, injectStyles }));
    },
  },
  {
    name: "diagnostics",
    entry: "ext-diagnostics",
    panel: "diagnostics",
    overlays: [],
    usesKitStyles: true,
    mount(injectStyles) {
      return mountExtension(diagnostics({ injectStyles }));
    },
  },
  {
    name: "environment",
    entry: "ext-environment",
    panel: "environment",
    overlays: [],
    usesKitStyles: true,
    mount(injectStyles) {
      return mountExtension(environment({ injectStyles }));
    },
  },
  {
    name: "flags",
    entry: "ext-flags",
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
  {
    name: "metrics",
    entry: "ext-metrics",
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
  {
    name: "overlays",
    entry: "ext-overlays",
    panel: "overlays",
    overlays: ["overlays"],
    usesKitStyles: true,
    mount(injectStyles) {
      return mountExtension(overlays({ injectStyles }));
    },
  },
  {
    name: "theme-editor",
    entry: "ext-theme-editor",
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

/**
 * Mounts, then opens the panel so every `useExtensionSurface` call site the
 * extension owns is given the chance to run.
 *
 * The presence assertions prove the *host slot* rendered and that nothing
 * degraded to an error chip — not that the extension's own component ran; see
 * the file header for what this does and does not catch.
 */
function mountEverySurface(target: ExtensionCase, injectStyles: boolean): void {
  const toolbar = target.mount(injectStyles);

  expect(toolbar.item(target.name), `${target.name} must render a bar item`).not.toBeNull();

  // A surface that throws is caught by `ExtensionBoundary` and replaced with an
  // error chip, leaving the item/panel wrapper in place — so without this the
  // remaining surface injects the own sheet and the swap check passes on half
  // the call sites.
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
 * Both halves in one assertion. Asserting the own-sheet count first would
 * short-circuit a pure swap — `expect` throws before the foreign-sheet loop
 * runs — and the failure would say "expected 1, got 0" without naming the
 * foreign sheet that actually landed.
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
