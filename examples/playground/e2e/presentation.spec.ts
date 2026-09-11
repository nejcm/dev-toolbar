import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import type { Toolbar } from "./fixtures";

// Recipe: .claude/skills/verify-dev-toolbar/features/presentation.md

/**
 * The playground builds `metrics`, `flags` and `a11y` with a `presentation`
 * preset chosen by its own header toggle, and supplies icons itself as inline
 * `<svg>` (`examples/playground/src/barIcons.tsx`). What's worth a browser is
 * what jsdom measures as zero: real width changes, no change to the bar's own
 * box, and a collapse decision that has to land somewhere stable.
 */

/**
 * Clicks the playground's own toggle until it reports `mode`.
 *
 * Exact match required: `"Bar icons: icon"` is a prefix of
 * `"Bar icons: icon-value"`, so `includes`/`toContainText` would stop one
 * mode early.
 */
async function setMode(page: Page, mode: "default" | "icon-value" | "icon") {
  const toggle = page.getByTestId("toggle-bar-icons");
  const reads = async () => (await toggle.textContent())?.trim() === `Bar icons: ${mode}`;
  for (let click = 0; click < 3; click += 1) {
    if (await reads()) return;
    await toggle.click();
  }
  await expect(toggle).toHaveText(`Bar icons: ${mode}`);
}

/**
 * Polls until the bar reports the same ids twice running, then returns them.
 * A preset flip remounts three extensions, and their widths arrive as a
 * stream of `ResizeObserver` deliveries, not in one go.
 */
async function settledBar(toolbar: Toolbar): Promise<string[]> {
  let previous = "";
  await expect
    .poll(async () => {
      const now = JSON.stringify((await toolbar.read()).shell.bar.map((item) => item.id));
      const stable = now === previous && now !== "";
      previous = now;
      return stable;
    })
    .toBe(true);
  return (await toolbar.read()).shell.bar.map((item) => item.id);
}

/** Every roster id, wherever it currently is: in the bar, or in the `⋮`. */
async function reachable(toolbar: Toolbar): Promise<string[]> {
  const before = await toolbar.read();
  if (!before.shell.overflow.present) return before.shell.bar.map((item) => item.id).sort();
  // `overflow.items` is only published while the menu is open.
  await toolbar.overflowButton.click();
  await expect.poll(() => toolbar.read().then((s) => s.shell.overflow.open)).toBe(true);
  const open = await toolbar.read();
  await toolbar.page.keyboard.press("Escape");
  await expect.poll(() => toolbar.read().then((s) => s.shell.overflow.open)).toBe(false);
  return [...open.shell.bar.map((item) => item.id), ...open.shell.overflow.items].sort();
}

/** The shape `/ext/a11y` publishes, cut to the field this file is about. */
interface A11yState {
  axeVersion: string | null;
}

/** The three ids the playground hands a `presentation`; the other fourteen are untouched. */
const PRESENTED = ["metrics", "flags", "a11y"] as const;

/**
 * A viewport that fits the whole roster in the bar, `default` included — the
 * widest of the three modes. At the suite's own 1280, `metrics` and `a11y`
 * fall into the `⋮` and read as menu rows, not chips. Measured, not guessed:
 * 2200 seats `a11y` and 1920 `metrics`; 2600 leaves room to grow.
 */
const ALL_IN_BAR = { width: 2600, height: 800 };

interface TriggerFacts {
  label: string | null;
  /** Everything the control paints that is not inside a `[data-dtb-kind="glyph"]`. */
  textOutsideGlyph: string;
  width: number;
}

/**
 * Each named extension's bar triggers, as name + non-glyph text + width.
 *
 * Per *trigger*, not per extension host: `/ext/metrics` paints one control
 * per metric, so the id maps to a list. Text is read from a clone with glyphs
 * removed, so "value dropped" and "value beside the icon" don't get
 * conflated — a text glyph like the promoted flag's `◈` lives inside a
 * glyph element and is correctly excluded.
 */
async function triggerFacts(
  page: Page,
  ids: readonly string[],
): Promise<Map<string, TriggerFacts[]>> {
  const out = new Map<string, TriggerFacts[]>();
  for (const id of ids) {
    const facts = await page
      .locator(`[data-dtb-part="bar"] [data-dtb-ext-id="${id}"] [data-dtb-part="trigger"]`)
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const clone = node.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('[data-dtb-kind="glyph"]').forEach((glyph) => glyph.remove());
          return {
            label: node.getAttribute("aria-label"),
            textOutsideGlyph: (clone.textContent ?? "").trim(),
            width: node.getBoundingClientRect().width,
          };
        }),
      );
    out.set(id, facts);
  }
  return out;
}

/**
 * The ids `/ext/metrics` currently has a number for, sorted — its runtime's
 * pulse. `react-profiler` and `web-vitals` are excluded: the playground
 * builds those two at module scope, so they'd keep reporting a pulse even
 * for a dead `metrics()`. The rest are built inside the factory call and
 * only tick while that object's `start()` is running.
 */
const MODULE_SCOPE_COLLECTORS = ["react-profiler", "web-vitals"];
async function liveMetrics(toolbar: Toolbar): Promise<string[]> {
  const data = await toolbar.ext<{
    metrics?: { id: string; value: number | null }[];
  }>("metrics");
  return (data?.metrics ?? [])
    .filter((metric) => metric.value !== null && !MODULE_SCOPE_COLLECTORS.includes(metric.id))
    .map((metric) => metric.id)
    .sort();
}

test("flipping the preset at runtime settles on a stable set, with nothing lost and nothing dead", async ({
  toolbar,
  page,
}) => {
  // The ResizeObserver loop error is an `ErrorEvent` with no `Error` object
  // and never reaches the console, so the listener goes in before the flip.
  await page.evaluate(() => {
    (window as any).__dtbErrors = [];
    addEventListener("error", (e) => (window as any).__dtbErrors.push(e.message));
  });

  // Guards a silent failure: `presentation` is a factory option, and core
  // never restarts a running id — it keeps the first object's `start()` and
  // warns, leaving chips rendering a store nothing drives. `<App>` gives
  // `<DevToolbar>` a `key` of the mode so the flip is a remount instead.
  const rebuilt: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("was rebuilt")) rebuilt.push(message.text());
  });

  const before = await settledBar(toolbar);
  const rosterBefore = await reachable(toolbar);

  // What "live" looks like before the flip: which metrics have a number, and
  // that axe loaded. Read back after — a dead runtime reports neither.
  await expect
    .poll(() => toolbar.ext<A11yState>("a11y").then((a) => a?.axeVersion))
    .toMatch(/^\d+\.\d+\.\d+/);
  await expect.poll(() => liveMetrics(toolbar)).not.toEqual([]);

  await setMode(page, "icon");
  const after = await settledBar(toolbar);

  // The warning first: a direct reading of the defect, arriving during the
  // flip's render rather than on a poll.
  expect(rebuilt, "core warned that an extension was rebuilt after it started").toEqual([]);

  // Then the user-visible consequence: the remount restarts every collector,
  // so values take a moment but do come back. Against a dead runtime they'd
  // stay pending/null forever.
  await expect.poll(() => liveMetrics(toolbar), { timeout: 15_000 }).not.toEqual([]);
  await expect
    .poll(() => toolbar.ext<A11yState>("a11y").then((a) => a?.axeVersion), {
      timeout: 15_000,
    })
    .toMatch(/^\d+\.\d+\.\d+/);

  // Which set it settles on is not pinned — the flip changes no box of the
  // bar's own, so the cycle guard may hold an item that would now fit
  // (src/core/collapse.ts, exogenous-flip case in collapse.test.ts).
  expect(after).toEqual(await settledBar(toolbar));
  expect(await page.evaluate(() => (window as any).__dtbErrors)).toEqual([]);

  // The same roster is reachable regardless of which side of the collapse
  // line each id landed on.
  expect(await reachable(toolbar)).toEqual(rosterBefore);
  expect(rosterBefore).toEqual(expect.arrayContaining(["metrics", "flags", "a11y"]));
  expect(before.length).toBeGreaterThan(0);

  await setMode(page, "default");
  await settledBar(toolbar);
  expect(await reachable(toolbar)).toEqual(rosterBefore);
});

test("an icon preset paints the playground's own <svg> and keeps every control named", async ({
  toolbar,
  page,
}) => {
  await setMode(page, "icon-value");
  await settledBar(toolbar);

  // `Glyph` clamps its direct child, so an <svg> with a viewBox is scaled
  // into the bar rather than setting its height.
  const glyphs = page.locator('[data-dtb-part="bar"] [data-dtb-kind="glyph"] > svg');
  await expect.poll(() => glyphs.count()).toBeGreaterThan(0);
  const sizes = await glyphs.evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { width: Math.round(box.width), height: Math.round(box.height) };
    }),
  );
  // 1.15em of an 11px bar, and every icon the same: the clamp, not the asset.
  for (const size of sizes) {
    expect(size.width, "clamped to --dtb-glyph-size").toBeLessThanOrEqual(20);
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBe(size.width);
  }

  // `◈` is a character, not an element, so the kit clamp's `> *` doesn't
  // match it — kept in the bar so both kinds are visible for comparison.
  const promoted = page.locator('[data-dtb-part="bar"] [data-dtb-kind="glyph"]');
  await expect
    .poll(() => promoted.evaluateAll((nodes) => nodes.some((node) => node.textContent === "◈")))
    .toBe(true);

  // Icon-only controls stay named. Checked across every control in the bar,
  // including the extensions the playground never passes `presentation` to.
  await setMode(page, "icon");
  await settledBar(toolbar);
  const named = await page
    .locator('[data-dtb-part="bar"] [data-dtb-part="trigger"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        label: node.getAttribute("aria-label"),
        text: node.textContent?.trim() ?? "",
      })),
    );
  expect(named.length).toBeGreaterThan(0);
  for (const control of named) {
    expect(
      (control.label ?? "").trim().length > 0 || control.text.length > 0,
      `a bar control with neither an aria-label nor text: ${JSON.stringify(control)}`,
    ).toBe(true);
  }

  // The three the option actually reaches, held to a stronger claim: an
  // `icon` control paints a glyph and *nothing else*, so its name can only
  // be the `aria-label`. Wide enough that all three stay in the bar rather
  // than the `⋮`, where the preset paints full text instead (kit
  // `resolveCompactParts`, guarantee 2).
  await page.setViewportSize(ALL_IN_BAR);
  await settledBar(toolbar);
  const iconOnly = await triggerFacts(page, PRESENTED);
  for (const id of PRESENTED) {
    const controls = iconOnly.get(id) ?? [];
    expect(controls.length, `no ${id} trigger in the bar`).toBeGreaterThan(0);
    for (const control of controls) {
      expect(
        (control.label ?? "").trim(),
        `an icon-only ${id} control with no accessible name`,
      ).not.toBe("");
      expect(
        control.textOutsideGlyph,
        `${id} still paints text under the "icon" preset: ${JSON.stringify(control)}`,
      ).toBe("");
    }
  }
});

test("an icon preset narrows the very controls it reaches", async ({ toolbar, page }) => {
  // Relative comparison, never a pixel count, so it survives a font or
  // density change (see e2e/README.md). Wide enough that all three stay in
  // the bar in both modes — a control measured in the `⋮` is a menu row,
  // not a chip.
  await page.setViewportSize(ALL_IN_BAR);

  const widthsFor = async (mode: "default" | "icon") => {
    await setMode(page, mode);
    const bar = await settledBar(toolbar);
    for (const id of PRESENTED) expect(bar, `${id} collapsed in ${mode}`).toContain(id);
    const facts = await triggerFacts(page, PRESENTED);
    return new Map(
      PRESENTED.map((id) => [
        id,
        (facts.get(id) ?? []).reduce((sum, control) => sum + control.width, 0),
      ]),
    );
  };

  const wide = await widthsFor("default");
  const narrow = await widthsFor("icon");
  for (const id of PRESENTED) {
    const before = wide.get(id) ?? 0;
    const after = narrow.get(id) ?? 0;
    expect(before, `${id} measured as nothing under "default"`).toBeGreaterThan(0);
    expect(after, `${id}: "icon" ${after}px vs "default" ${before}px`).toBeLessThan(before);
  }

  await setMode(page, "default");
  await settledBar(toolbar);
});

test("icons buy bar room once an honest reading clears the cycle history", async ({
  toolbar,
  page,
}) => {
  // An *honest* reading forgets decisions held since the last resize and
  // recomputes minimally from cached widths — without it this would measure
  // the latch, not the icons.
  const measure = async (mode: "default" | "icon") => {
    await setMode(page, mode);
    await settledBar(toolbar);
    await page.setViewportSize({ width: 900, height: 800 });
    await settledBar(toolbar);
    await page.setViewportSize({ width: 901, height: 800 });
    return settledBar(toolbar);
  };

  const wide = await measure("default");
  const narrow = await measure("icon");
  expect(narrow.length, `icon: ${narrow.join()} vs default: ${wide.join()}`).toBeGreaterThanOrEqual(
    wide.length,
  );
  expect(narrow).toEqual(expect.arrayContaining(wide));
});
