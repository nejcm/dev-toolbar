import { expect, test } from "./fixtures";
import type { Toolbar } from "./fixtures";

// Recipe: .claude/skills/verify-dev-toolbar/features/settings.md

const metricsItem = (toolbar: Toolbar) =>
  toolbar.page.locator('[data-dtb-part="item"][data-dtb-ext-id="metrics"]');

async function metricsWidth(toolbar: Toolbar): Promise<number> {
  await expect.poll(() => toolbar.read().then((s) => s.shell.bar.some((b) => b.id === "metrics")))
    .toBe(true);
  return (await metricsItem(toolbar).boundingBox())?.width ?? 0;
}

async function openSettings(toolbar: Toolbar) {
  await toolbar.settingsButton.click();
  await expect.poll(() => toolbar.read().then((s) => s.shell.settings.open)).toBe(true);
}

/** Every id the viewer can still reach; opens the `⋮` to list it, then closes it again. */
async function openOverflowAndListReachable(toolbar: Toolbar): Promise<string[]> {
  const s = await toolbar.read();
  if (!s.shell.overflow.present) return s.shell.bar.map((b) => b.id);
  await toolbar.overflowButton.click();
  await expect.poll(() => toolbar.read().then((r) => r.shell.overflow.open)).toBe(true);
  const open = await toolbar.read();
  await toolbar.page.keyboard.press("Escape");
  await expect.poll(() => toolbar.read().then((r) => r.shell.overflow.open)).toBe(false);
  return [...open.shell.bar.map((b) => b.id), ...open.shell.overflow.items];
}

async function expectChanged(toolbar: Toolbar, defaultMetricsWidth: number) {
  await expect.poll(() => toolbar.read().then((s) => s.shell.density)).toBe("comfortable");
  const s = await toolbar.read();
  expect(s.shell.colorScheme).toBe("dark");
  expect(await openOverflowAndListReachable(toolbar)).not.toContain("overlays");
  expect(s.diagnostics.map((d) => d.id), "hiding is not tearing down").toContain("overlays");
  expect(await metricsWidth(toolbar)).toBeLessThan(defaultMetricsWidth);

  const stored = await toolbar.storage();
  expect(stored.density).toBe('"comfortable"');
  expect(stored.colorScheme).toBe('"dark"');
  expect(JSON.parse(stored.extensionSettings ?? "{}")).toEqual({
    metrics: { preset: "label" },
    overlays: { shown: false },
  });
}

test("changes persist across a reload and Reset returns every default", async ({
  toolbar,
  page,
}) => {
  // Wide enough to seat metrics, so its preset shows up as a narrower item.
  await page.setViewportSize({ width: 2600, height: 800 });
  const defaultMetricsWidth = await metricsWidth(toolbar);
  expect((await toolbar.read()).shell.settings).toEqual({ present: true, open: false });

  await openSettings(toolbar);
  const menu = page.getByRole("group", { name: "Toolbar settings" });
  await menu.getByRole("radio", { name: "Comfortable" }).check();
  await menu.getByRole("radio", { name: "Dark" }).check();
  await menu.getByRole("combobox", { name: "Metrics presentation preset" }).selectOption("label");
  await menu.getByRole("checkbox", { name: "Overlays shown in bar" }).uncheck();
  await expectChanged(toolbar, defaultMetricsWidth);

  await toolbar.goto();
  expect((await toolbar.read()).shell.settings).toEqual({ present: true, open: false });
  await expectChanged(toolbar, defaultMetricsWidth);

  await openSettings(toolbar);
  await page.getByRole("button", { name: "Reset toolbar settings" }).click();
  await expect.poll(() => toolbar.read().then((s) => s.shell.density)).toBe("compact");
  expect((await toolbar.read()).shell.colorScheme).toBe("system");
  await page.keyboard.press("Escape");
  await expect.poll(() => toolbar.read().then((s) => s.shell.settings.open)).toBe(false);
  expect(await openOverflowAndListReachable(toolbar)).toContain("overlays");
  await expect.poll(() => metricsWidth(toolbar)).toBeGreaterThan(defaultMetricsWidth - 1);
  const stored = await toolbar.storage();
  for (const key of ["density", "colorScheme", "extensionSettings"]) {
    expect(stored[key], key).toBeUndefined();
  }
});

test("the Settings button is charged to the bar, so nothing overruns it", async ({
  toolbar,
  page,
}) => {
  for (const width of [1280, 700, 520, 400]) {
    await page.setViewportSize({ width, height: 800 });
    await expect.poll(() => toolbar.read().then((s) => s.shell.overflow.present)).toBe(true);
    const fit = await toolbar.bar.evaluate((bar) => {
      const box = bar.getBoundingClientRect();
      const cog = bar.querySelector('[data-dtb-part="settings-button"]')!.getBoundingClientRect();
      return {
        clipped: bar.scrollWidth > bar.clientWidth,
        cogInside: cog.left >= box.left && cog.right <= box.right,
      };
    });
    expect(fit, `at ${width}px`).toEqual({ clipped: false, cogInside: true });
  }
});

test("the Settings button is the tab stop after the ⋮", async ({ toolbar }) => {
  await expect.poll(() => toolbar.read().then((s) => s.shell.overflow.present)).toBe(true);
  await toolbar.overflowButton.focus();
  await toolbar.page.keyboard.press("Tab");
  expect(
    await toolbar.page.evaluate(() => document.activeElement?.getAttribute("data-dtb-part")),
  ).toBe("settings-button");
});
