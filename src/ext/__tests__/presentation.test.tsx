import { afterEach, describe, expect, it } from "vitest";
import { cleanupToolbar, mountToolbar } from "@nejcm/dev-toolbar/testing";
import type { ToolbarHandle } from "@nejcm/dev-toolbar/testing";
import type { DevToolbarExtension } from "../../core/contract";
import { describedBy, describedByIds, description } from "../../test-utils/generated-ids";
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
  // `Accessibility (a11y)`, not `Accessibility`: the bar paints `a11y`, so
  // WCAG 2.5.3 needs that word in the name. `label` leads because a screen
  // reader reads "a11y" as "a eleven y"; the parens still contain the `⋮`
  // row's full text.
  a11y: { id: "a11y", make: () => a11y(), names: ["Accessibility (a11y), pending"] },
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
    // `Metrics: mem`, not `Metrics`: the bar paints `mem`, so WCAG 2.5.3 needs
    // that word in the name. It's the collector's hardcoded short word, so
    // the name doesn't churn with the readout.
    names: ["Metrics: mem"],
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

/**
 * WCAG 2.5.3 Label in Name, and where the readout is announced from.
 *
 * `NAME_CASES` checks two things per chip: the bar word is a substring of the
 * accessible name (case-insensitive, the way speech input matches — `Metrics`
 * and `Accessibility` didn't used to contain `mem`/`a11y`), and the readout
 * reaches a screen reader from somewhere, since `aria-label` replaces an
 * element's content rather than adding to it. Six chips already say it: with
 * no `aria-describedby`, a browser reads `title` as the description, and each
 * one's `title` states the readout with more context than its span does.
 * Only `/ext/metrics` doesn't — its title (`Runtime performance — click for
 * details`) carries no readout at all — which is why it alone gets an
 * `aria-describedby`.
 *
 * `/ext/agent` and `/ext/command-menu` are absent: neither control has a
 * value (ADR-004, "Group C takes two knobs").
 */
interface NameCase {
  /** The word this chip paints in the bar. The accessible name must contain it. */
  barWord: string;
  /** What `aria-describedby` must announce, or `null` for a chip that gets none. */
  description: string | null;
  /** For a chip with no description: where its readout is announced instead. */
  readoutFrom?: "name" | "title";
  /** The visible readout, which must appear wherever `readoutFrom` says. */
  readout?: string;
  /**
   * The same extension under `preset: "label"`, which paints no value — so
   * there is nothing for an `aria-describedby` to point at. Only the one chip
   * that gets a description needs it.
   */
  bare?(): DevToolbarExtension;
}

const LABEL_ONLY = { presentation: "label" } as const;

const NAME_CASES: Record<string, NameCase> = {
  // `Accessibility: click to scan this page` against a span reading `scan` —
  // and the *status* the span stands for is in the name already (`, pending`).
  a11y: { barWord: "a11y", description: null, readoutFrom: "title", readout: "scan" },
  diagnostics: {
    barWord: "diagnostics",
    description: null,
    readoutFrom: "title",
    readout: "capture",
  },
  environment: {
    barWord: "env",
    description: null,
    readoutFrom: "name",
    readout: "staging",
  },
  // The span paints `2`; the title paints `Feature flags: 2 · 0 locally
  // overridden`, which is the same number with the context the span drops.
  flags: { barWord: "flags", description: null, readoutFrom: "title", readout: "2" },
  metrics: {
    barWord: "mem",
    // Metrics paints N readouts in one control, so its `aria-describedby`
    // names each metric's label span and then its value span — a bare run of
    // numbers can't be attributed to anything. See `src/ext/metrics/ui.tsx`.
    description: "mem 48 MB",
    bare: () =>
      metrics({
        ...LABEL_ONLY,
        only: ["memory"],
        memory: {
          read: () => ({
            usedJSHeapSize: 48 * 1024 * 1024,
            totalJSHeapSize: 64 * 1024 * 1024,
            jsHeapSizeLimit: 128 * 1024 * 1024,
          }),
        },
      }),
  },
  overlays: {
    barWord: "overlays",
    description: null,
    readoutFrom: "name",
    readout: "off",
  },
  // The span paints `1`; the title paints `Design tokens: 1 · 0 edited
  // locally`.
  "theme-editor": { barWord: "theme", description: null, readoutFrom: "title", readout: "1" },
};

/** The extension's own bar trigger — not a promoted sibling. */
function trigger(toolbar: ToolbarHandle, id: string): HTMLElement {
  const element = toolbar.item(id)?.querySelector<HTMLElement>('[data-dtb-part="trigger"]');
  expect(element, `${id} rendered no bar trigger`).not.toBeNull();
  return element as HTMLElement;
}

describe("label in name, and where the readout is announced", () => {
  const mount = (id: string, extension: DevToolbarExtension) =>
    mountToolbar(null, { extensions: [extension], layout: { barWidth: 4000, itemWidth: 120 } })
      .toolbar;

  describe.each(Object.entries(NAME_CASES))("%s", (id, nameCase) => {
    const make = () => BAR_CASES[id]!.make();

    it("contains the word the bar paints in its accessible name", () => {
      const control = trigger(mount(id, make()), id);
      // Case-insensitively, which is how speech input matches: `overlays`
      // inside `Overlays, off` is a match, and five of the seven rely on it.
      const name = (accessibleName(control) ?? "").toLowerCase();
      expect(control.textContent, `${id} stopped painting "${nameCase.barWord}"`).toContain(
        nameCase.barWord,
      );
      expect(name, `${id}: the bar word is not in the accessible name`).toContain(
        nameCase.barWord.toLowerCase(),
      );
    });

    if (nameCase.description === null) {
      it(`announces its readout from ${nameCase.readoutFrom} rather than a description`, () => {
        const control = trigger(mount(id, make()), id);
        const readout = nameCase.readout as string;
        expect(control.textContent, `${id} stopped painting "${readout}"`).toContain(readout);
        // The evidence for the exclusion. `title` is the accessible description
        // when nothing else supplies one, so a chip whose `title` states the
        // readout needs no `aria-describedby` — and adding one would *displace*
        // the richer wording rather than add to it.
        const source =
          nameCase.readoutFrom === "name"
            ? (accessibleName(control) ?? "")
            : (control.getAttribute("title") ?? "");
        expect(source, `${id}: the readout is not in the ${nameCase.readoutFrom}`).toContain(
          readout,
        );
        expect(describedByIds(control), `${id} would displace its own title`).toEqual([]);
      });
    } else {
      it("describes the visible readout neither its name nor its title carries", () => {
        const control = trigger(mount(id, make()), id);
        const readout = nameCase.description as string;
        expect(
          accessibleName(control) ?? "",
          `${id}: the readout is in the name too`,
        ).not.toContain(readout);
        // The reason this chip is the exception: its `title` would otherwise be
        // the description, and it says nothing about the numbers.
        expect(
          control.getAttribute("title") ?? "",
          `${id}: the title carries the readout, so it needs no description`,
        ).not.toContain(readout);
        // The assertion with the teeth: a canonicalised DOM literal pins that
        // the attribute exists, never that it resolves to anything.
        expect(describedBy(control), `${id}: a dangling aria-describedby`).not.toContain(null);
        expect(description(control), `${id}: the description is not the readout`).toBe(readout);
      });

      it("writes no aria-describedby under a preset that paints no value", () => {
        // `"label"` paints the text alone, so there is no value span to point
        // at — and a dangling IDREF announces nothing at all.
        const control = trigger(mount(id, nameCase.bare!()), id);
        expect(control.querySelector('[data-dtb-kind="value"]')).toBeNull();
        expect(
          describedByIds(control),
          `${id}: an aria-describedby with nothing to point at`,
        ).toEqual([]);
      });
    }
  });
});
