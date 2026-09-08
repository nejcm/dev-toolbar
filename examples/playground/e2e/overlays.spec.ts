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

  // Stacking: with `pointer-events: none` the layer is skipped by hit-testing
  // whatever its paint order, so switch it on for one probe. The surface sets
  // its own properties `!important`, so the override has to be too — a plain
  // inline style is ignored and the probe proves nothing. A point inside the
  // bar must then still resolve to the bar, which shows the bar paints above
  // (forcing the layer's z-index up the same way flips this to `isLayer`).
  const bar = (await toolbar.bar.boundingBox())!;
  const hit = await layer.evaluate(
    (el, [x, y]) => {
      const style = (el as HTMLElement).style;
      style.setProperty("pointer-events", "auto", "important");
      try {
        if (getComputedStyle(el).pointerEvents !== "auto") return "override-ignored";
        const target = document.elementFromPoint(x, y);
        return {
          inBar: target?.closest('[data-dtb-part="bar"]') !== null,
          isLayer: target === el || el.contains(target),
        };
      } finally {
        style.removeProperty("pointer-events");
      }
    },
    [bar.x + 20, bar.y + bar.height / 2] as const,
  );
  expect(hit).toEqual({ inBar: true, isLayer: false });

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
  // The preference outlives the layers: every overlay stored as off, and none
  // comes back after a reload.
  const stored = JSON.parse((await toolbar.storage())["ext:overlays:enabled"]!);
  expect(Object.keys(stored)).toEqual(expect.arrayContaining(["grid", "focus"]));
  expect(Object.values(stored).every((v) => v === false)).toBe(true);
  await toolbar.goto();
  expect((await overlays(toolbar))?.on).toEqual([]);
  await expect(page.locator(LAYER)).toHaveCount(0);
});
