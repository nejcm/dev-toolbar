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

test("geometry: a gap-only override waits for a bar reading; padding triggers one", async ({ toolbar, page }, info) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await toolbar.goto("/?geometry");
  await expect.poll(() => toolbar.read().then((s) => s.shell.overflow.present)).toBe(false);
  // Drain initial observer deliveries before changing only the gap.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.locator('[data-dtb-part="root"]').evaluate((root) => {
    root.style.setProperty("--dtb-item-gap", "40px");
  });
  // A bounded negative observation: no box resize should refresh the decision.
  await page.waitForTimeout(500);
  expect((await toolbar.read()).shell.bar.map((b) => b.id)).toEqual(["growing", "low", "agent"]);
  expect((await toolbar.read()).shell.overflow.present).toBe(false);
  await capture(page, info, "gap-only-stale");

  await page.setViewportSize({ width: 319, height: 800 });
  await expect.poll(() => toolbar.read().then((s) => s.shell.bar.map((b) => b.id)))
    .toEqual(["growing", "agent"]);
  await capture(page, info, "gap-after-bar-resize");

  await page.locator('[data-dtb-part="root"]').evaluate((root) => {
    root.style.setProperty("--dtb-item-gap", "0px");
    root.style.setProperty("--dtb-padding-x", "11px");
  });
  await expect.poll(() => toolbar.read().then((s) => s.shell.overflow.present)).toBe(false);
  expect((await toolbar.read()).shell.bar.map((b) => b.id)).toEqual(["growing", "low", "agent"]);
});
