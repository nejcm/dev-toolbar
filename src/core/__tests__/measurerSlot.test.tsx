/**
 * The seam a test uses to hand core its own {@link Measurer}: the well-known
 * global symbol `Symbol.for("@nejcm/dev-toolbar.measurer")`.
 *
 * Imported relatively on purpose — `resolveMeasurer` and the slot are internal
 * and re-exported from no entry point, so reaching them here adds nothing to
 * the published surface (a colocated core test is not a consumer).
 *
 * The slot lives in the *process-wide* symbol registry — the same shared
 * state `src/testing/layout.ts` installs into, and warns about — so every test
 * below leaves it empty again: a leaked fake would silently answer every later
 * suite's measurements.
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DevToolbar } from "../DevToolbar";
import type { DevToolbarExtension } from "../contract";
import { OverflowBar } from "../Overflow";
import { ITEM_SELECTOR, MEASURER_SLOT, domMeasurer, resolveMeasurer } from "../measurer";
import type { Measurer } from "../measurer";

type Slot = { [MEASURER_SLOT]?: Measurer | undefined };

/** Registers `measurer` in the slot for the duration of one test. */
function registerMeasurer(measurer: Measurer): void {
  (globalThis as Slot)[MEASURER_SLOT] = measurer;
}

afterEach(() => {
  delete (globalThis as Slot)[MEASURER_SLOT];
  // Teardown, not the end of each test: a geometry spy below asserts it was
  // never called, and an assertion that *fails* would otherwise leak the spy
  // into every later test in this file — turning one failure into a cascade.
  vi.restoreAllMocks();
});

/**
 * A hand-written measurer: fixed numbers, no DOM reads at all. `observe`
 * reports no subscription, which is the documented "host without
 * `ResizeObserver`" path — the layout effect still measures every commit, so
 * the collapse below is the fake's numbers and nothing else.
 */
function fakeMeasurer(overrides: Partial<Measurer> = {}): Measurer {
  return {
    barWidth: () => 100,
    itemWidth: () => 60,
    buttonWidth: () => 0,
    regionGap: () => 2,
    padding: () => 0,
    height: () => 42,
    observe: () => undefined,
    ...overrides,
  };
}

/**
 * An `observe` that keeps the callbacks handed to it, plus the `notify` a test
 * uses to deliver again. A fake returning `undefined` can only ever be
 * measured once, at effect setup, which is exactly the blind spot that let a
 * captured measurer through: *when* a callback resolves the slot is only
 * visible across two deliveries.
 */
function recordingObserve(): { observe: Measurer["observe"]; notify: () => void } {
  const callbacks: (() => void)[] = [];
  return {
    observe: (notify) => {
      callbacks.push(notify);
      return { sync: () => {}, disconnect: () => {} };
    },
    notify: () => {
      for (const callback of callbacks) callback();
    },
  };
}

const ext = (id: string, priority: number): DevToolbarExtension => ({
  id,
  label: id,
  priority,
  compact: () => <span>{id}</span>,
});

const renderBar = () =>
  render(
    <OverflowBar
      startItems={[ext("a", 3), ext("b", 1), ext("c", 2)]}
      endItems={[]}
      renderItem={(extension, { isOverflowed }) => (
        <div
          key={extension.id}
          data-dtb-part="item"
          data-dtb-ext-id={extension.id}
          data-dtb-overflowed={isOverflowed ? "true" : undefined}
        >
          {extension.id}
        </div>
      )}
    />,
  );

/**
 * The ids still rendered in a bar region. Collapsed items are not in the DOM
 * at all until the `⋮` popup opens, so this is what the decision looks like
 * from outside.
 */
const visibleIds = () =>
  [...document.querySelectorAll(ITEM_SELECTOR)].map(
    (node) => (node as HTMLElement).dataset["dtbExtId"],
  );

const overflowButton = () => screen.queryByRole("button", { name: /More developer toolbar items/ });

describe("the measurer slot", () => {
  it("is the well-known symbol, and answers with the DOM while empty", () => {
    // The string is the contract between a test and core, so it is pinned
    // here rather than only read back off the constant.
    expect(MEASURER_SLOT).toBe(Symbol.for("@nejcm/dev-toolbar.measurer"));
    expect((globalThis as Slot)[MEASURER_SLOT]).toBeUndefined();
    expect(resolveMeasurer()).toBe(domMeasurer);
  });

  it("resolves per call, so a fake registered after this module loaded is still seen", () => {
    const fake = fakeMeasurer();
    expect(resolveMeasurer()).toBe(domMeasurer);
    registerMeasurer(fake);
    expect(resolveMeasurer()).toBe(fake);
    delete (globalThis as Slot)[MEASURER_SLOT];
    // Nothing cached the override, so removing it hands the DOM back.
    expect(resolveMeasurer()).toBe(domMeasurer);
  });

  it("collapses the bar on the registered measurer's widths, touching no DOM geometry", () => {
    // jsdom reports 0x0, so a run that read the real DOM cannot collapse at
    // all — the `⋮` button below is proof the fake's numbers were used.
    const offsetWidth = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get");
    registerMeasurer(fakeMeasurer());

    renderBar();

    // 100px bar, three 60px items: the two lowest priorities go, leaving the
    // highest beside a `⋮` button.
    expect(visibleIds()).toEqual(["a"]);
    expect(overflowButton()).not.toBeNull();
    expect(offsetWidth).not.toHaveBeenCalled();
  });

  it("leaves the bar uncollapsed once the slot is empty again", () => {
    renderBar();
    expect(visibleIds()).toEqual(["a", "b", "c"]);
    expect(overflowButton()).toBeNull();
  });

  it("publishes the height variable from the registered measurer", () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    registerMeasurer(fakeMeasurer());

    render(
      <DevToolbar extensions={[]}>
        <div />
      </DevToolbar>,
    );

    expect(document.documentElement.style.getPropertyValue("--dev-toolbar-height")).toBe("42px");
    expect(rect).not.toHaveBeenCalled();
  });

  it("re-reads the slot on every height delivery, not once per effect", () => {
    const deliveries = recordingObserve();
    registerMeasurer(fakeMeasurer({ height: () => 42, observe: deliveries.observe }));

    const view = render(
      <DevToolbar extensions={[]}>
        <div />
      </DevToolbar>,
    );
    expect(document.documentElement.style.getPropertyValue("--dev-toolbar-height")).toBe("42px");

    // Only the slot changes: the rerender touches no effect dependency, so the
    // effect does not run again and the observer callback made on mount is the
    // one that answers. It has to resolve now, not remember mount.
    registerMeasurer(fakeMeasurer({ height: () => 99, observe: deliveries.observe }));
    view.rerender(
      <DevToolbar extensions={[]}>
        <div />
      </DevToolbar>,
    );
    act(() => deliveries.notify());

    expect(document.documentElement.style.getPropertyValue("--dev-toolbar-height")).toBe("99px");
  });

  it("re-reads the slot on every bar delivery, so a replacement un-collapses the bar", () => {
    const deliveries = recordingObserve();
    registerMeasurer(fakeMeasurer({ observe: deliveries.observe }));

    renderBar();
    expect(visibleIds()).toEqual(["a"]);

    // Both observer callbacks outlive the commit that created them. Only the
    // bar one takes a full reading, so it is the one a wider measurer reaches:
    // 300px for three sticky 60px items brings b and c back.
    registerMeasurer(fakeMeasurer({ barWidth: () => 300, observe: deliveries.observe }));
    act(() => deliveries.notify());

    expect(visibleIds()).toEqual(["a", "b", "c"]);
    expect(overflowButton()).toBeNull();
  });
});
