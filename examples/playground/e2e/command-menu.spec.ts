import { expect, test } from "./fixtures";

// Recipe: .claude/skills/verify-dev-toolbar/features/command-menu.md

interface MenuState {
  open: boolean;
  query: string;
  activeIndex: number;
  activeId: string | null;
  commandCount: number;
  resultCount: number;
  error: string | null;
}

const menu = (toolbar: { ext<T>(id: string): Promise<T | null> }) =>
  toolbar.ext<MenuState>("command-menu");

test.beforeEach(async ({ page }) => {
  // The shortcut listens on the document; give it focus without hitting a control.
  await page.locator("body").click({ position: { x: 5, y: 5 } });
});

test("Mod+K opens the palette and enumerates every command it can run", async ({
  toolbar,
  page,
}) => {
  await page.keyboard.press(`${await toolbar.mod()}+K`);
  await expect.poll(() => menu(toolbar).then((m) => m?.open)).toBe(true);
  const s = await toolbar.read();
  const m = s.diagnostics.find((d) => d.id === "command-menu")!.data as MenuState;
  expect(m.query).toBe("");
  expect(m.activeIndex).toBe(0);
  expect(m.activeId).toBeTruthy();
  expect(m.resultCount).toBe(m.commandCount);
  // Commands that declare an input schema are live but never offered here —
  // the palette has no form to collect the input with.
  const withInput = s.commands.filter((c) => c.input !== undefined);
  expect(withInput.length).toBeGreaterThan(0);
  expect(m.commandCount).toBe(s.commands.length - withInput.length);
  await expect(page.locator('[data-dtb-part="cmd-section"]').first()).toBeVisible();
});

test("filters, runs the leader on Enter, and dismisses on Escape", async ({ toolbar, page }) => {
  await page.keyboard.press(`${await toolbar.mod()}+K`);
  await expect.poll(() => menu(toolbar).then((m) => m?.open)).toBe(true);
  await page.keyboard.type("Column grid");
  await expect.poll(() => menu(toolbar).then((m) => m?.query)).toBe("Column grid");
  await expect.poll(() => menu(toolbar).then((m) => m?.activeId)).toBe("overlays.toggle.grid");

  await page.keyboard.press("Enter");
  await expect.poll(() => menu(toolbar).then((m) => m?.open)).toBe(false);
  expect((await menu(toolbar))?.error).toBeNull();
  await expect.poll(() => toolbar.ext<{ on: string[] }>("overlays").then((o) => o?.on)).toEqual([
    "grid",
  ]);

  await page.keyboard.press(`${await toolbar.mod()}+K`);
  await expect.poll(() => menu(toolbar).then((m) => m?.open)).toBe(true);
  await page.keyboard.type("zzzz");
  await expect.poll(() => menu(toolbar).then((m) => m?.resultCount)).toBe(0);
  await expect(page.locator('[data-dtb-part="cmd-empty"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => menu(toolbar).then((m) => m?.open)).toBe(false);
  await expect(page.locator('[data-dtb-part="cmd-scrim"]')).toHaveCount(0);
});

test("never offers a command that needs input", async ({ toolbar, page }) => {
  await page.keyboard.press(`${await toolbar.mod()}+K`);
  await expect.poll(() => menu(toolbar).then((m) => m?.open)).toBe(true);
  await page.keyboard.type("set");
  await expect.poll(() => menu(toolbar).then((m) => m?.query)).toBe("set");
  const labels = await page.locator('[data-dtb-part="cmd-option-label"]').allTextContents();
  expect(labels).not.toContain("Set a feature flag override");
  expect(labels).not.toContain("Set a design token");
  expect((await menu(toolbar))?.resultCount).toBe(labels.length);
});

test("re-enumerates: a flag added after mount gets a palette entry", async ({ toolbar, page }) => {
  await page.getByTestId("flag-add").click();
  // The flags extension picks the new catalogue entry up on its next poll.
  await expect
    .poll(() => toolbar.read().then((s) => s.commands.some((c) => c.id.startsWith("flags.toggle.runtime-"))))
    .toBe(true);
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(`${await toolbar.mod()}+K`);
  await expect.poll(() => menu(toolbar).then((m) => m?.open)).toBe(true);
  await page.keyboard.type("runtime-");
  await expect.poll(() => menu(toolbar).then((m) => m?.resultCount)).toBeGreaterThan(0);
});
