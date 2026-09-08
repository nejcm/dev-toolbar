import { expect, test } from "./fixtures";

// Recipe: .claude/skills/verify-dev-toolbar/features/overlays.md

interface OverlaysState {
  on: string[];
  activeCount: number;
  error: string | null;
  focusCount: number;
  focusTruncated: boolean;
  unnamedCount: number;
}

const overlays = (t: { ext<T>(id: string): Promise<T | null> }) => t.ext<OverlaysState>("overlays");
const LAYER = '[data-dtb-part="overlay"][data-dtb-ext-id="overlays"] > *';

test("draws over the whole page, under the bar, and lets clicks through", async ({
  toolbar,
  page,
}) => {
  expect((await overlays(toolbar))?.on).toEqual([]);
  expect(await toolbar.run("overlays.toggle.grid")).toEqual({ ok: true });
  await expect.poll(() => overlays(toolbar).then((o) => o?.on)).toEqual(["grid"]);
  expect((await overlays(toolbar))?.activeCount).toBe(1);

  const layer = page.locator(LAYER).first();
  await expect(layer).toHaveCount(1);
  const box = (await layer.boundingBox())!;
  expect(box.y).toBe(0);
  expect(box.height).toBe(800);
  expect(box.width).toBe(1280);
  await expect(layer).toHaveCSS("pointer-events", "none");

  // Stacking: a point inside the bar hits the bar, never the overlay.
  const bar = (await toolbar.bar.boundingBox())!;
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-dtb-part="root"]') !== null,
    [bar.x + 20, bar.y + bar.height / 2] as const,
  );
  expect(hit).toBe(true);

  const button = page.getByTestId("overlay-click-through");
  await button.scrollIntoViewIfNeeded();
  await expect(button).toHaveText(/Click-through test: 0/);
  await button.click();
  await expect(button).toHaveText(/Click-through test: 1/);
});

test("the focus-order overlay counts the unnamed controls the playground plants", async ({
  toolbar,
}) => {
  expect(await toolbar.run("overlays.toggle.focus")).toEqual({ ok: true });
  await expect.poll(() => overlays(toolbar).then((o) => o?.on)).toContain("focus");
  // The scan runs after enable, not inside it.
  await expect.poll(() => overlays(toolbar).then((o) => o?.focusCount)).toBeGreaterThan(0);
  const o = (await overlays(toolbar))!;
  expect(o.focusTruncated).toBe(false);
  expect(o.unnamedCount).toBeGreaterThan(0);
});

test("disableAll removes every layer and keeps the preference", async ({ toolbar, page }) => {
  await toolbar.run("overlays.toggle.grid");
  await toolbar.run("overlays.toggle.focus");
  await expect.poll(() => overlays(toolbar).then((o) => o?.activeCount)).toBe(2);

  expect(await toolbar.run("overlays.disableAll")).toEqual({ ok: true });
  await expect.poll(() => overlays(toolbar).then((o) => o?.on)).toEqual([]);
  await expect(page.locator(LAYER)).toHaveCount(0);
  expect((await toolbar.storage())["ext:overlays:enabled"]).toBeDefined();
});
