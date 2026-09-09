import { expect, test } from "./fixtures";
import type { Page, TestInfo } from "@playwright/test";

// Recipe: .claude/skills/verify-dev-toolbar/features/overflow.md

test("collapses in priority order as the window narrows", async ({ toolbar, page }) => {
  // Priorities live in examples/playground/src/extensions.tsx; the assertion is
  // on the *order*, so a new extension in the middle does not break it.
  await page.setViewportSize({ width: 520, height: 800 });
  await expect.poll(() => toolbar.read().then((s) => s.shell.overflow.present)).toBe(true);
  // The exact bar at 520px moves whenever the playground gains a chip, so the
  // assertion is on the ends of the priority scale: the highest-priority ids
  // stay, the lowest-priority ones go, and `agent` (-1) is always first out.
  await expect
    .poll(() => toolbar.read().then((s) => s.shell.bar.map((b) => b.id)))
    .toEqual(expect.arrayContaining(["environment", "cmds", "command-menu", "user"]));
  const narrow = await toolbar.read();
  const inBar = new Set(narrow.shell.bar.map((b) => b.id));
  for (const id of ["agent", "boom", "diagnostics", "hydr", "a11y", "metrics"]) {
    expect(inBar.has(id), `${id} collapsed`).toBe(false);
  }
  // `overflow.items` is only published while the menu is open.
  await toolbar.overflowButton.click();
  await expect.poll(() => toolbar.read().then((s) => s.shell.overflow.open)).toBe(true);
  const items = (await toolbar.read()).shell.overflow.items;
  // Items come in bar order (ascending `order`, not priority); `agent` keeps
  // the default `order: 90`, so it renders last wherever it lands.
  expect(items.at(-1)).toBe("agent");
  for (const id of ["boom", "diagnostics", "hydr", "a11y", "metrics"]) expect(items).toContain(id);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect
    .poll(() => toolbar.read().then((s) => s.shell.bar.length))
    .toBeGreaterThan(narrow.shell.bar.length);
});

test("the ⋮ menu lists exactly what collapsed and closes on Escape", async ({ toolbar, page }) => {
  await page.setViewportSize({ width: 520, height: 800 });
  await expect.poll(() => toolbar.read().then((s) => s.shell.overflow.present)).toBe(true);
  await toolbar.overflowButton.click();
  await expect.poll(() => toolbar.read().then((s) => s.shell.overflow.open)).toBe(true);
  const s = await toolbar.read();
  expect(s.shell.overflow.items).toContain("overlays");
  expect(s.shell.overflow.items.some((id) => s.shell.bar.some((b) => b.id === id))).toBe(false);
  await expect(page.locator('[data-dtb-part="overflow-menu-item"]')).toHaveCount(
    s.shell.overflow.items.length,
  );

  await page.keyboard.press("Escape");
  await expect.poll(() => toolbar.read().then((s) => s.shell.overflow.open)).toBe(false);
  await expect(toolbar.overflowButton).toBeFocused();
});

test("menu rows never paint over each other, so a collapsed extension can be reached", async ({
  toolbar,
  page,
}) => {
  // Regression guard: the menu is a flex column capped at 50vh, and rows once
  // kept the default `flex-shrink`, so a list taller than the cap squashed
  // every row to `min-height` and the metrics list painted over the overlays
  // trigger. Rows are `flex-shrink: 0` now and the menu scrolls instead.
  await page.setViewportSize({ width: 520, height: 800 });
  await expect.poll(() => toolbar.read().then((s) => s.shell.overflow.present)).toBe(true);
  await toolbar.overflowButton.click();
  await expect.poll(() => toolbar.read().then((s) => s.shell.overflow.open)).toBe(true);

  const rows = page.locator('[data-dtb-part="overflow-menu-item"]');
  const overlapping = await rows.evaluateAll((els) =>
    els.filter((el) => {
      const inner = el.firstElementChild?.getBoundingClientRect();
      return inner !== undefined && inner.height > el.getBoundingClientRect().height + 1;
    }).length,
  );
  expect(overlapping, "rows whose content is taller than the row").toBe(0);

  await page
    .locator('[data-dtb-part="overflow-menu-item"][data-dtb-ext-id="overlays"] [data-dtb-part="trigger"]')
    .click({ timeout: 3_000 });
  await expect.poll(() => toolbar.read().then((s) => s.shell.activePanel)).toBe("overlays");
});

test("stepping the viewport never trips a ResizeObserver loop", async ({ toolbar, page }) => {
  // The failure is an `ErrorEvent` with no `Error` object, invisible to the
  // console; only a listener installed before the stress can see it.
  await page.evaluate(() => {
    (window as any).__dtbErrors = [];
    addEventListener("error", (e) => (window as any).__dtbErrors.push(e.message));
  });
  const settled = async () => {
    // Two frames for the ResizeObserver to deliver, then the bar has to read
    // the same twice in a row before the next step.
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    let last = "";
    await expect
      .poll(async () => {
        const now = JSON.stringify((await toolbar.read()).shell.bar.map((b) => b.id));
        const stable = now === last;
        last = now;
        return stable;
      })
      .toBe(true);
  };
  for (const width of [1280, 900, 700, 520, 400, 700, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await settled();
  }
  expect(await page.evaluate(() => (window as any).__dtbErrors)).toEqual([]);
});

async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: "image/png" });
}

test("geometry: crosses the collapse threshold in both directions", async ({ toolbar, page }, info) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await toolbar.goto("/?geometry");
  await expect.poll(() => toolbar.read().then((s) => s.shell.overflow.present)).toBe(false);

  await page.setViewportSize({ width: 299, height: 800 });
  await expect.poll(() => toolbar.read().then((s) => s.shell.bar.map((b) => b.id)))
    .toEqual(["growing", "agent"]);
  await toolbar.overflowButton.click();
  await expect.poll(() => toolbar.read().then((s) => s.shell.overflow.items)).toEqual(["low"]);
  await capture(page, info, "threshold-collapsed");

  await page.setViewportSize({ width: 320, height: 800 });
  await expect.poll(() => toolbar.read().then((s) => s.shell.overflow.present)).toBe(false);
  expect((await toolbar.read()).shell.bar.map((b) => b.id)).toEqual(["growing", "low", "agent"]);
  await capture(page, info, "threshold-expanded");
});

test("geometry: a chip resizes itself without resizing the bar", async ({ toolbar, page }, info) => {
  await page.setViewportSize({ width: 500, height: 800 });
  await toolbar.goto("/?geometry");
  await expect.poll(() => toolbar.read().then((s) => s.shell.overflow.present)).toBe(false);
  const barBefore = await toolbar.bar.boundingBox();
  await page.getByRole("button", { name: "Grow chip", exact: true }).click();
  await expect.poll(() => toolbar.read().then((s) => s.shell.bar.map((b) => b.id)))
    .toEqual(["growing", "agent"]);
  expect(await toolbar.bar.boundingBox()).toEqual(barBefore);
  await capture(page, info, "self-resized-chip");

  await page.getByRole("button", { name: "Shrink chip", exact: true }).click();
  await expect.poll(async () => (await page.getByRole("button", { name: "Grow chip", exact: true }).boundingBox())?.width).toBe(100);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  // Phase 3A's latch rejects this return to a seen decision until the bar changes.
  expect((await toolbar.read()).shell.bar.map((b) => b.id)).toEqual(["growing", "agent"]);
  expect(await toolbar.bar.boundingBox()).toEqual(barBefore);
  await capture(page, info, "self-shrunk-latched");
  await page.setViewportSize({ width: 501, height: 800 });
  await expect.poll(() => toolbar.read().then((s) => s.shell.overflow.present)).toBe(false);
  expect((await toolbar.read()).shell.bar.map((b) => b.id)).toEqual(["growing", "low", "agent"]);
});

async function recordResizes(page: Page) {
  await page.addInitScript(() => {
    (window as any).__dtbResizes = [];
    const NativeResizeObserver = window.ResizeObserver;
    window.ResizeObserver = class extends NativeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          (window as any).__dtbResizes.push({
            time: performance.now(),
            entries: entries.map(({ target, contentRect }) => ({
              part: target.getAttribute("data-dtb-part"),
              id: target.getAttribute("data-dtb-ext-id"),
              width: contentRect.width,
            })),
          });
          callback(entries, observer);
        });
      }
    };
  });
}

async function geometry(page: Page) {
  return page.getByRole("toolbar", { name: "Developer toolbar" }).evaluate((bar) => {
    const style = getComputedStyle(bar);
    return {
      box: bar.getBoundingClientRect().toJSON(),
      clientWidth: bar.clientWidth,
      scrollWidth: bar.scrollWidth,
      gap: style.columnGap,
      padding: style.padding,
      overflow: style.overflow,
      items: [...bar.querySelectorAll<HTMLElement>('[data-dtb-part="item"]')].map((item) => ({
        id: item.dataset.dtbExtId,
        box: item.getBoundingClientRect().toJSON(),
      })),
    };
  });
}

async function resizeEntries(page: Page) {
  return page.evaluate(() =>
    (window as any).__dtbResizes.flatMap((delivery: any) => delivery.entries),
  );
}

async function changeSpacing(page: Page, property: string, value: string) {
  return page.locator('[data-dtb-part="root"]').evaluate(
    async (root, { property, value }) => {
      (window as any).__dtbResizes = [];
      const start = performance.now();
      root.style.setProperty(property, value);
      let frames = 0;
      await new Promise<void>((resolve) => {
        const tick = () => {
          frames++;
          if (performance.now() - start >= 1_000) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return {
        frames,
        elapsedMs: performance.now() - start,
        callbacks: (window as any).__dtbResizes,
      };
    },
    { property, value },
  );
}

/**
 * A gap-only change resizes no box of the bar's own, so the bar's observer
 * never fires for it. What does fire depends on the roster, which is why both
 * are here: an item host is `max-width: 100%` of its *region*, so the split
 * roster's lone end item narrows with the gap and delivers an `item` callback,
 * while three hosts sharing one region each keep their own width and deliver
 * nothing. The region is the box that moves either way — the gap is taken out
 * of it — and it is observed alongside the hosts, which is what makes the
 * all-start roster reach the machine at all. Every delivery takes a full bar
 * reading, gap included, not widths alone.
 */
const ROSTERS = {
  split: {
    path: "/?geometry",
    // A gap-only change narrows this roster's end item, so `item` fires too.
    itemDeliveries: true,
    40: { bar: ["growing", "agent"], overflow: ["low"] },
    140: { bar: ["growing"], overflow: ["low", "agent"] },
  },
  "all-start": {
    path: "/?geometry&roster=all-start",
    // Three hosts capped against one region: at gap 140 the region goes
    // 280 → 160px while all three stay 100/80/80, their sum overruns the
    // 320px bar, and no item host resizes. Before the region was observed
    // this delivered nothing at all and the bar clipped with no `⋮`.
    itemDeliveries: false,
    40: { bar: ["growing"], overflow: ["low", "agent"] },
    140: { bar: [], overflow: ["growing", "low", "agent"] },
  },
} as const;

for (const [name, roster] of Object.entries(ROSTERS)) {
  for (const gap of [40, 140] as const) {
    test(`geometry: a ${gap}px gap-only override reaches the collapse decision (${name} roster)`, async ({
      toolbar,
      page,
    }, info) => {
      await recordResizes(page);
      await page.setViewportSize({ width: 320, height: 800 });
      await toolbar.goto(roster.path);
      await expect
        .poll(() => resizeEntries(page))
        .toEqual(expect.arrayContaining([expect.objectContaining({ part: "bar", width: 300 })]));
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const before = { shell: (await toolbar.read()).shell, geometry: await geometry(page) };
      expect(before.shell.bar.map((item) => item.id)).toEqual(["growing", "low", "agent"]);
      expect(before.shell.overflow.present).toBe(false);
      expect(before.geometry.gap).toBe("10px");
      await capture(page, info, `gap-before-${name}`);

      const observation = await changeSpacing(page, "--dtb-item-gap", `${gap}px`);
      expect(observation.frames).toBeGreaterThan(2);
      const entries = await resizeEntries(page);
      const parts = (part: string) => entries.filter((entry: any) => entry.part === part);
      expect(parts("bar"), "the bar's own box never resizes").toEqual([]);
      expect(parts("region").length, "region deliveries").toBeGreaterThan(0);
      expect(parts("item").length > 0, "item deliveries").toBe(roster.itemDeliveries);
      const after = { shell: (await toolbar.read()).shell, geometry: await geometry(page) };
      expect(after.geometry.box).toEqual(before.geometry.box);
      expect(after.geometry.padding).toBe(before.geometry.padding);
      expect(after.geometry.gap).toBe(`${gap}px`);
      // The decision moved without a bar resize, which is the whole fix.
      expect(after.shell.bar.map((item) => item.id)).toEqual(roster[gap].bar);
      expect(after.shell.overflow.present).toBe(true);
      // Inverted from the limitation this used to pin: `low` used to overrun
      // the bar and clip under `overflow: hidden` with no `⋮` to reach it.
      // Nothing overruns now, and every collapsed chip is in the `⋮`.
      expect(after.geometry.overflow).toBe("hidden");
      expect(after.geometry.scrollWidth).toBe(after.geometry.clientWidth);
      for (const item of after.geometry.items) {
        expect(item.box.right, `${item.id} within the bar`).toBeLessThanOrEqual(
          after.geometry.box.right,
        );
      }
      await capture(page, info, `gap-only-collapsed-${name}`);
      await toolbar.overflowButton.click();
      await expect
        .poll(() => toolbar.read().then((s) => s.shell.overflow.items))
        .toEqual(roster[gap].overflow);
      await toolbar.overflowButton.click();
      await info.attach(`gap-observation-${name}`, {
        body: JSON.stringify({ before, observation, after }, null, 2),
        contentType: "application/json",
      });
    });
  }
}

/**
 * The caveat, asserted rather than described. Lowering the gap from an
 * already-collapsed state resizes nothing when the surviving layout has no box
 * the gap sizes: the collapsed hosts are gone, and the one that is left is
 * narrower than its region. So no observer fires, the machine keeps deciding
 * from the wider gap, and the bar stays more collapsed than it needs to be —
 * safely, with nothing clipped and every chip in the `⋮`. It is the next
 * commit that repairs it, which is what the last third of this test pins.
 * No `--dtb-padding-x` change anywhere in here: padding is the bar's own
 * content box, so it reaches the machine through the bar's observer and would
 * hide the whole effect.
 */
test("geometry: a gap-only decrease leaves the bar over-collapsed until the next commit", async ({
  toolbar,
  page,
}, info) => {
  await recordResizes(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await toolbar.goto(ROSTERS["all-start"].path);
  await changeSpacing(page, "--dtb-item-gap", "40px");
  await expect.poll(() => toolbar.read().then((s) => s.shell.overflow.present)).toBe(true);
  const collapsed = (await toolbar.read()).shell;
  expect(collapsed.bar.map((item) => item.id)).toEqual(["growing"]);

  const observation = await changeSpacing(page, "--dtb-item-gap", "0px");
  expect(observation.frames).toBeGreaterThan(2);
  expect(await resizeEntries(page), "a gap decrease resizes no observed box").toEqual([]);

  const after = { shell: (await toolbar.read()).shell, geometry: await geometry(page) };
  // Over-collapsed: at gap 0 all three fit, and the decision has not moved.
  expect(after.shell.bar.map((item) => item.id)).toEqual(["growing"]);
  expect(after.shell.overflow.present).toBe(true);
  expect(after.geometry.gap).toBe("0px");
  // Safe, not broken: nothing clipped, and the `⋮` is there to reach the rest.
  expect(after.geometry.scrollWidth).toBe(after.geometry.clientWidth);
  for (const item of after.geometry.items) {
    expect(item.box.right, `${item.id} within the bar`).toBeLessThanOrEqual(
      after.geometry.box.right,
    );
  }
  await expect(toolbar.overflowButton).toBeVisible();
  await capture(page, info, "gap-decrease-over-collapsed");

  // Opening the `⋮` is a commit, and every commit re-reads the bar — so the
  // click that goes looking for the collapsed chips is also what brings them
  // back, and the menu closes itself because nothing is collapsed any more.
  await toolbar.overflowButton.click();
  await expect.poll(() => toolbar.read().then((s) => s.shell.overflow.present)).toBe(false);
  expect((await toolbar.read()).shell.bar.map((item) => item.id)).toEqual([
    "growing",
    "low",
    "agent",
  ]);
  await capture(page, info, "gap-decrease-repaired-by-commit");
  await info.attach("gap-decrease-observation", {
    body: JSON.stringify({ collapsed, observation, after }, null, 2),
    contentType: "application/json",
  });
});

test("geometry: padding alone delivers a bar resize and updates collapse", async ({
  toolbar,
  page,
}, info) => {
  await recordResizes(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await toolbar.goto("/?geometry");
  await expect
    .poll(() => resizeEntries(page))
    .toEqual(expect.arrayContaining([expect.objectContaining({ part: "bar", width: 300 })]));
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const before = { shell: (await toolbar.read()).shell, geometry: await geometry(page) };
  expect(before.shell.bar.map((item) => item.id)).toEqual(["growing", "low", "agent"]);
  expect(before.shell.overflow.present).toBe(false);
  await capture(page, info, "padding-before");

  const observation = await changeSpacing(page, "--dtb-padding-x", "30px");
  expect(observation.frames).toBeGreaterThan(2);
  expect(await resizeEntries(page)).toEqual(
    expect.arrayContaining([expect.objectContaining({ part: "bar", width: 260 })]),
  );
  const after = { shell: (await toolbar.read()).shell, geometry: await geometry(page) };
  expect(after.shell.bar.map((item) => item.id)).toEqual(["growing", "agent"]);
  expect(after.shell.overflow.present).toBe(true);
  expect(after.geometry.box).toEqual(before.geometry.box);
  expect(after.geometry.gap).toBe(before.geometry.gap);
  expect(after.geometry.padding).toBe("0px 30px");
  expect(after.geometry.scrollWidth).toBe(after.geometry.clientWidth);
  await capture(page, info, "padding-only-collapsed");
  await toolbar.overflowButton.click();
  await expect.poll(() => toolbar.read().then((s) => s.shell.overflow.items)).toEqual(["low"]);
  await info.attach("padding-observation", {
    body: JSON.stringify({ before, observation, after }, null, 2),
    contentType: "application/json",
  });
});
