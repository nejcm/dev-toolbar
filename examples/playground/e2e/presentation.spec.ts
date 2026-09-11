import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import type { Toolbar } from "./fixtures";

// Recipe: .claude/skills/verify-dev-toolbar/features/presentation.md

/**
 * The playground builds `metrics`, `flags` and `a11y` with a `presentation`
 * preset chosen by its own header toggle, and `agent` with the icon half of the
 * narrowed pair, and supplies the icons itself as inline `<svg>` —
 * `examples/playground/src/barIcons.tsx`. Nothing here asserts that a library
 * shipped an icon, because none did; what is worth a browser is what jsdom
 * measures as zero: an icon-only control is several times narrower than the chip
 * it replaced, that swing arrives with no change to the bar's own box, the
 * collapse decision has to land somewhere stable anyway — and `role="img"` is a
 * claim about a browser's accessibility tree.
 */

/**
 * Clicks the playground's own toggle until it reports `mode`.
 *
 * The comparison is exact, and has to be: `"Bar icons: icon"` is a prefix of
 * `"Bar icons: icon-value"`, so a `includes`/`toContainText` test stops one
 * mode early and quietly asserts the rest of the case against the wrong bar.
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
 *
 * A preset flip remounts four extensions, and their new widths reach the
 * machine as a stream of `ResizeObserver` deliveries rather than in one go —
 * so "it settled" is the assertion, and the set it settled on is read after.
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

/**
 * The three ids the playground hands a **preset**; the rest of the roster is
 * untouched. `agent` is presented too but takes only an icon — no preset, no
 * value — so it is not held to the preset claims below and has its own case.
 */
const PRESENTED = ["metrics", "flags", "a11y"] as const;

/**
 * A viewport that fits the whole roster in the bar, `default` included — the
 * widest of the three modes. At the suite's own 1280 the low-priority half of
 * the roster is in the `⋮`, and `metrics` and `a11y` are two of them; a control
 * read there is a menu row with full text, which is a different question.
 * Measured, not guessed: 2200 seats `a11y` and 1920 `metrics`, so 2600 has room
 * to spare for a roster that grows by one.
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
 * Per *trigger*, not per extension host: `/ext/metrics` paints one control per
 * metric, so the id maps to a list. The text is read from a clone with the
 * glyphs removed, which is what separates "the value was dropped" from "the
 * value is sitting beside the icon" — a text glyph such as the promoted flag's
 * `◈` is a character inside a glyph element and so is correctly not text here.
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
 * The ids `/ext/metrics` currently has a number for, sorted — its runtime's pulse.
 *
 * `react-profiler` and `web-vitals` are excluded on purpose: the playground
 * builds those two collectors at module scope, so they keep their numbers
 * across anything that happens to `metrics()` itself and would report a pulse
 * for a runtime with none. What is left — `delay`, `jank`, `memory`,
 * `network` — is built inside the factory call and only ticks while *that*
 * object's `start()` is the one running.
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
  // The ResizeObserver loop error is an `ErrorEvent` with no `Error` object and
  // never reaches the console, so the listener goes in before the flip.
  await page.evaluate(() => {
    (window as any).__dtbErrors = [];
    addEventListener("error", (e) => (window as any).__dtbErrors.push(e.message));
  });

  // The failure this guards is silent in the bar and loud here. `presentation`
  // is a factory option, so a flip hands core a new object for a running id —
  // and core never restarts one: it keeps the first object's `start()` and
  // warns. The chips would then render a store nothing drives, while
  // `diagnostics()` reads the new, never-started object. `<App>` gives
  // `<DevToolbar>` a `key` of the mode so the flip is a remount instead.
  const rebuilt: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("was rebuilt")) rebuilt.push(message.text());
  });

  const before = await settledBar(toolbar);
  const rosterBefore = await reachable(toolbar);

  // What "live" looks like before the flip, read from the extensions
  // themselves rather than hardcoded: which metrics have a number, and that
  // axe loaded. Both are read back after, and a dead runtime reports neither.
  await expect
    .poll(() => toolbar.ext<A11yState>("a11y").then((a) => a?.axeVersion))
    .toMatch(/^\d+\.\d+\.\d+/);
  await expect.poll(() => liveMetrics(toolbar)).not.toEqual([]);

  await setMode(page, "icon");
  const after = await settledBar(toolbar);

  // The warning first: it is the direct reading of the defect, and it arrives
  // during the flip's render rather than on a poll.
  expect(rebuilt, "core warned that an extension was rebuilt after it started").toEqual([]);

  // Then the consequence, which is what a user would actually notice. The
  // remount restarts every collector, so a value takes a moment to come back —
  // but it does come back. Leave the extensions running against a dead runtime
  // and every id here stays `status: "pending", value: null` forever, while
  // `axeVersion` stays `null` because axe never loads for the new object.
  await expect.poll(() => liveMetrics(toolbar), { timeout: 15_000 }).not.toEqual([]);
  await expect
    .poll(() => toolbar.ext<A11yState>("a11y").then((a) => a?.axeVersion), {
      timeout: 15_000,
    })
    .toMatch(/^\d+\.\d+\.\d+/);

  // Settling is the assertion. Which set it settles on is not pinned: the flip
  // changes no box of the bar's own, so the machine takes it as items reacting
  // rather than the world changing, and its cycle guard may hold an item that
  // would now fit (src/core/collapse.ts, and the exogenous-flip case in
  // collapse.test.ts).
  expect(after).toEqual(await settledBar(toolbar));
  expect(await page.evaluate(() => (window as any).__dtbErrors)).toEqual([]);

  // Nothing is lost by presenting differently: the same roster is reachable,
  // whichever side of the collapse line each id landed on.
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

  // Genuinely pixels: the icon is a node this app handed the library, so the
  // only proof it arrived is the element. `Glyph` clamps its direct child, so
  // an <svg> with a viewBox is scaled into the bar rather than setting its height.
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

  // The text glyph beside them: `◈` is a character, not an element, so the kit
  // clamp's `> *` does not match it. It is in the bar on purpose, so the two
  // kinds can be compared where a person can see them.
  const promoted = page.locator('[data-dtb-part="bar"] [data-dtb-kind="glyph"]');
  await expect
    .poll(() => promoted.evaluateAll((nodes) => nodes.some((node) => node.textContent === "◈")))
    .toBe(true);

  // Icon-only controls stay named: the name is the control's, never the icon's.
  // Every control in the bar, including the fourteen extensions the playground
  // never passes `presentation` — a name is a name whatever painted it.
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

  // And the three the option actually reaches, held to the stronger claim: an
  // `icon` control paints a glyph and *nothing else*, so its name can only be
  // the `aria-label`. `label` alone would pass the loop above on its text.
  // Wide enough that all three are in the bar rather than the `⋮`, where the
  // preset deliberately paints full text instead (kit `resolveCompactParts`,
  // guarantee 2) — see ALL_IN_BAR.
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

/**
 * `/ext/agent` is the fourth control the toggle reaches, and the only one whose
 * *role* the option changes: with an icon the chip is `role="img"` with an
 * `aria-label`, without one it is the role-less `<span>` it has always been,
 * named by its `title` (`src/ext/agent/index.tsx`, and ADR-004's Group C
 * subsection). A bare `<span aria-label>` names nothing at all, so the role is
 * what makes that label count — and a role is a claim about what a browser's
 * accessibility tree says, which is why it belongs here rather than only in
 * `src/ext/agent/__tests__/presentation.test.tsx`.
 *
 * Agent takes the narrowed two-knob option, so it reads `"icon-value"` and
 * `"icon"` identically: there is no preset, only an icon. `"default"` is the
 * mode that passes none.
 */
test("an icon gives /ext/agent a role, and no icon leaves it without one", async ({
  toolbar,
  page,
}) => {
  // Agent's `priority` is -1 — below every other item, so it is the first the
  // collapse machine takes out and the last to be seated. ALL_IN_BAR is the
  // width that fits the whole roster; the bridge read below is what proves the
  // chip is in the bar rather than in the `⋮`, where an icon chip also carries
  // the role and "exactly one in the bar" would be measuring the wrong node.
  await page.setViewportSize(ALL_IN_BAR);

  /** Genuinely pixels: a role is an attribute on an element this app's icon created. */
  const roleImg = page.locator('[data-dtb-part="bar"] [role="img"]');

  await setMode(page, "default");
  expect(await settledBar(toolbar), "agent is not in the bar to be read").toContain("agent");
  await expect(roleImg, "a role-less chip must not gain a role").toHaveCount(0);

  await setMode(page, "icon");
  expect(await settledBar(toolbar), "agent is not in the bar to be read").toContain("agent");
  // Exactly one: agent is the only control in the package that takes this role,
  // and the count is what would catch it spreading to the eight that name
  // themselves with text.
  await expect(roleImg).toHaveCount(1);
  const chip = await roleImg.evaluate((node) => ({
    label: node.getAttribute("aria-label"),
    extId: node.closest("[data-dtb-ext-id]")?.getAttribute("data-dtb-ext-id") ?? null,
    part: node.getAttribute("data-dtb-part"),
    // A preset changes text, not state (ADR-004): the chip's own attribute
    // survives the icon path, which is a different component from the span.
    agentMode: node.getAttribute("data-dtb-agent-mode"),
    glyphs: node.querySelectorAll('[data-dtb-kind="glyph"] > svg').length,
    textOutsideGlyph: (() => {
      const clone = node.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[data-dtb-kind="glyph"]').forEach((glyph) => glyph.remove());
      return (clone.textContent ?? "").trim();
    })(),
  }));
  expect(chip.extId, `the role landed on ${JSON.stringify(chip)}`).toBe("agent");
  expect(chip.part).toBe("trigger");
  expect(chip.agentMode).toBe("run-enabled");
  // The whole point of the role: an `aria-label` on a role-less span is ignored,
  // so this chip would be announced by its `title` or by nothing.
  expect((chip.label ?? "").trim(), "a role=img chip with no accessible name").not.toBe("");
  // And the icon is the only thing it paints, which is why the label is the
  // only thing that can name it — the bar drops the word, the `⋮` row keeps it.
  expect(chip.glyphs).toBe(1);
  expect(chip.textOutsideGlyph).toBe("");

  await setMode(page, "default");
  await settledBar(toolbar);
  await expect(roleImg).toHaveCount(0);
});

test("an icon preset narrows the very controls it reaches", async ({ toolbar, page }) => {
  // The measurement the option exists for, and the one an inert option cannot
  // fake: the same three ids, the same viewport, the same page — one mode's
  // controls against the other's. Relative, never a pixel count, so it survives
  // a font or a density change (see e2e/README.md).
  //
  // Wide enough that all three are in the bar in both modes: a control measured
  // in the `⋮` is a menu row, not a chip.
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
  // The same viewport in both modes, each read after a resize — an *honest*
  // reading, which is what forgets the decisions held since the last one and
  // recomputes minimally from the cached widths. Without it the comparison
  // would be measuring the latch rather than the icons.
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
