import { afterEach, describe, expect, it } from "vitest";
import { cleanupToolbar, mountToolbar } from "@nejcm/dev-toolbar/testing";
import type { ToolbarHandle } from "@nejcm/dev-toolbar/testing";
import type { DevToolbarExtension } from "../../core/contract";
import { extensionRoster } from "../../test-utils/extension-roster";
import { a11y } from "../a11y";
import { agentBridge } from "../agent";
import { commandMenu } from "../command-menu";
import { diagnostics } from "../diagnostics";
import { environment } from "../environment";
import { flags } from "../flags";
import { metrics } from "../metrics";
import { accessibleName, overlays } from "../overlays";
import { themeEditor } from "../theme-editor";

/**
 * Bar presentation must hold before any of it is configurable: every control
 * the nine first-party extensions put in the bar has an accessible name.
 * Checked via `/ext/overlays`'s own `accessibleName()` — the toolbar is held
 * to the standard it reports on, not the weaker "has an `aria-label`".
 *
 * Per control: (1) has a non-empty accessible name; (2) that name matches the
 * string pinned in `BAR_CASES` exactly — phases 3-5 must keep default output
 * byte-identical, and a non-empty check alone wouldn't catch a changed name;
 * (3) for anything that's a *control* (`<button>` or has a `role`), the name
 * comes from `aria-label`, not chip text or `title` — chip text is about to
 * become configurable, and `title` is the fallback that would otherwise hide
 * an unnamed icon-only button.
 *
 * All three run twice: a wide bar, and a bar too narrow for anything, read out
 * of the `⋮` menu. The collapsed pass matters because three extensions render
 * a different element when overflowed (environment's `env-overflow`, flags'
 * `flag-overflow-trigger`, metrics' `metrics-overflow-row` list).
 *
 * Exemption: metrics' `⋮` rows are content-named by design — the overflow menu
 * always paints `"full"` text, so no preset can leave a row icon-only, and
 * naming it would just repeat text a screen reader already reads.
 *
 * `/ext/agent` is no longer exempt. Its trigger used to be a role-less `<span>`
 * named by `title` — the weak fallback (3) rules out — with no *control* for
 * (3) to check. Phase 5 gave it `role="img"` + `aria-label` on the icon path,
 * so its case here mounts **with an icon**. The role-less case is still
 * covered, in `src/ext/agent/__tests__/presentation.test.tsx`.
 *
 * [dev-toolbar/plans/bar-presentation-icons-v1 §Accessible names]
 */

interface BarCase {
  /** The extension id, i.e. what `toolbar.item()` takes. */
  id: string;
  make(): DevToolbarExtension;
  /** Every bar control's accessible name, sorted, in a bar with room. */
  names: readonly string[];
  /** The same, read out of the `⋮` menu. Defaults to `names`. */
  overflowNames?: readonly string[];
}

/**
 * One entry per `src/ext` directory, enforced against the roster below so a
 * new extension can't ship a bar control this never checks. Options are the
 * minimum needed to paint the interesting state: a promoted flag, an
 * environment kind, an edited token.
 */
const BAR_CASES: Record<string, BarCase> = {
  a11y: { id: "a11y", make: () => a11y(), names: ["Accessibility, pending"] },
  agent: {
    id: "agent",
    // With an icon: the only configuration where this puts a *named node* in
    // the bar. Without one, the trigger is a role-less <span> named by
    // `title` — pinned in the extension's own suite.
    make: () => agentBridge({ presentation: { icon: <svg viewBox="0 0 16 16" /> } }),
    names: ["Agent"],
  },
  "command-menu": {
    id: "command-menu",
    make: () => commandMenu({ apple: false }),
    names: ["Commands (Ctrl+K)"],
  },
  diagnostics: { id: "diagnostics", make: () => diagnostics(), names: ["Diagnostics"] },
  environment: {
    id: "environment",
    make: () => environment({ context: { environment: "staging", impersonating: true } }),
    names: ["Environment, staging, impersonating"],
  },
  flags: {
    id: "flags",
    make: () =>
      flags({
        flags: [
          { key: "new-header", type: "boolean", defaultValue: true },
          { key: "checkout.tier", type: "string", defaultValue: "gold" },
        ],
        promoted: [{ flagKey: "new-header" }, { flagKey: "checkout.tier" }],
      }),
    // Three names: the chip plus both promoted siblings — why `barControls()`
    // walks every `<button>` instead of just the `trigger` part.
    names: ["Flags", "checkout.tier, gold", "new-header"],
  },
  metrics: {
    id: "metrics",
    make: () =>
      metrics({
        only: ["memory"],
        memory: {
          read: () => ({
            usedJSHeapSize: 48 * 1024 * 1024,
            totalJSHeapSize: 64 * 1024 * 1024,
            jsHeapSizeLimit: 128 * 1024 * 1024,
          }),
        },
      }),
    names: ["Metrics"],
    // The `⋮` rows replace the trigger and are named by their own text, run
    // together since `accessibleName()` concatenates the chip's spans.
    overflowNames: ["Memory48 MB"],
  },
  overlays: { id: "overlays", make: () => overlays(), names: ["Overlays, off"] },
  "theme-editor": {
    id: "theme-editor",
    make: () => themeEditor({ tokens: [{ name: "--brand", type: "color", value: "#000000" }] }),
    names: ["Theme"],
  },
};

/**
 * Everything clickable this extension put in the bar: the `trigger` part plus
 * every `<button>` inside its item, which is how the flags chip's promoted
 * siblings get covered without naming them here.
 */
function barControls(item: HTMLElement): Element[] {
  const controls = new Set<Element>();
  const trigger = item.querySelector('[data-dtb-part="trigger"]');
  if (trigger !== null) controls.add(trigger);
  item.querySelectorAll("button").forEach((button) => controls.add(button));
  return [...controls];
}

const isControl = (element: Element): boolean =>
  element.tagName.toLowerCase() === "button" || element.getAttribute("role") !== null;

/** The `⋮` row is content-named by design; see the exemptions above. */
const isMetricsOverflowRow = (element: Element): boolean =>
  element.getAttribute("data-dtb-part") === "metrics-overflow-row";

/**
 * The `⋮` entry for one extension. `data-dtb-ext-id` is a discriminator, not
 * a unique id (AGENTS.md), so it's paired with `data-dtb-part` on the same
 * element — an extension can have a bar item and a menu entry at once
 * mid-collapse.
 */
function overflowEntry(toolbar: ToolbarHandle, id: string): HTMLElement {
  const entry = toolbar
    .overflowMenu()
    ?.querySelector<HTMLElement>(`[data-dtb-part="overflow-menu-item"][data-dtb-ext-id="${id}"]`);
  expect(entry, `${id} has no ⋮ entry`).not.toBeNull();
  return entry as HTMLElement;
}

function expectNames(controls: Element[], id: string, expected: readonly string[]): void {
  expect(controls.length, `${id} rendered no bar control`).toBeGreaterThan(0);

  for (const control of controls) {
    const name = accessibleName(control);
    expect(name, `${id}: an unnamed bar control`).not.toBeNull();
    expect((name ?? "").trim(), `${id}: a blank bar control name`).not.toBe("");
  }

  expect(
    controls.map((control) => accessibleName(control)).sort(),
    `${id}: the computed bar names moved`,
  ).toEqual([...expected].sort());
}

function expectNamedIndependently(controls: Element[], id: string): void {
  for (const control of controls) {
    const bare = control.cloneNode(false) as Element;
    bare.removeAttribute("title");
    expect(accessibleName(bare), `${id}: named only by its text or its title`).toBe(
      accessibleName(control),
    );
  }
}

afterEach(() => {
  cleanupToolbar();
});

describe("first-party bar presentation", () => {
  it("has exactly one bar case per extension on disk", () => {
    expect(
      Object.keys(BAR_CASES).sort(),
      "bar presentation cases must match the extension roster",
    ).toEqual(extensionRoster().onDisk);
  });

  describe.each(Object.entries(BAR_CASES))("%s", (_name, barCase) => {
    const { id, make, names } = barCase;
    const overflowNames = barCase.overflowNames ?? names;

    describe("in a bar with room", () => {
      const mount = () =>
        mountToolbar(null, {
          extensions: [make()],
          layout: { barWidth: 4000, itemWidth: 120 },
        });

      it("names every bar control, exactly", () => {
        const { toolbar } = mount();
        const item = toolbar.item(id);
        expect(item, `${id} rendered no bar item`).not.toBeNull();

        expectNames(barControls(item as HTMLElement), id, names);
      });

      it("names every bar control independently of its text and its title", () => {
        const { toolbar } = mount();
        const controls = barControls(toolbar.item(id) as HTMLElement).filter(isControl);

        expect(controls.length, `${id} rendered no bar control`).toBeGreaterThan(0);
        expectNamedIndependently(controls, id);
      });
    });

    describe("collapsed into the ⋮ menu", () => {
      const mount = () => {
        const mounted = mountToolbar(null, {
          extensions: [make()],
          // Narrower than one 120px item, so the only extension mounted has
          // nowhere to go but the menu.
          layout: { barWidth: 40, itemWidth: 120 },
        });
        expect(mounted.toolbar.overflowedIds(), `${id} did not collapse`).toContain(id);
        mounted.toolbar.openOverflow();
        return mounted;
      };

      it("names every overflowed control, exactly", () => {
        const { toolbar } = mount();

        expectNames(barControls(overflowEntry(toolbar, id)), id, overflowNames);
      });

      it("names every overflowed control independently of its text and its title", () => {
        const { toolbar } = mount();
        const controls = barControls(overflowEntry(toolbar, id))
          .filter(isControl)
          .filter((control) => !isMetricsOverflowRow(control));

        // Metrics' `⋮` rows are content-named by design (see docblock) — they're
        // all it renders here.
        if (id === "metrics") {
          expect(controls).toEqual([]);
          return;
        }
        expect(controls.length, `${id} rendered no overflowed control`).toBeGreaterThan(0);
        expectNamedIndependently(controls, id);
      });
    });
  });
});
