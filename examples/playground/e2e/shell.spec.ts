import { expect, test } from "./fixtures";

// Recipe: .claude/skills/verify-dev-toolbar/features/shell.md

test("mounts with the bridge, the full roster and an accessible bar", async ({ toolbar }) => {
  const s = await toolbar.read();
  expect(s.instanceId).toBe("playground");
  expect(s.allowRun).toBe(true);
  expect(s.shell.mounted).toBe(true);
  // The roster is the fixed number; `shell.bar` depends on the viewport and is
  // asserted on ids, never on a count.
  const ids = s.diagnostics.map((d) => d.id);
  for (const id of ["agent", "flags", "environment", "command-menu", "overlays", "metrics"]) {
    expect(ids, `roster carries ${id}`).toContain(id);
  }
  expect(s.diagnostics.filter((d) => d.status === "failed")).toEqual([]);
  await expect(toolbar.bar).toBeVisible();
});

test("opens one panel at a time and persists the active one", async ({ toolbar, page }) => {
  await page.getByRole("button", { name: "Flags" }).click();
  await expect.poll(() => toolbar.read().then((s) => s.shell.activePanel)).toBe("flags");
  let s = await toolbar.read();
  expect(s.shell.bar.find((b) => b.id === "flags")?.panelOpen).toBe(true);
  expect((await toolbar.storage()).activePanel).toBe('"flags"');

  // The environment chip has no aria-label (its name is its text), so it is
  // reached by its stable handle.
  await toolbar.trigger("environment").click();
  await expect.poll(() => toolbar.read().then((s) => s.shell.activePanel)).toBe("environment");
  s = await toolbar.read();
  expect(s.shell.bar.filter((b) => b.panelOpen).map((b) => b.id)).toEqual(["environment"]);
});

test("the height variable and the inset follow the panel", async ({ toolbar, page }) => {
  const before = await toolbar.read();
  expect(before.shell.heightVariable.name).toBe("--dev-toolbar-height-playground");
  const restHeight = parseFloat(before.shell.heightVariable.value ?? "0");
  expect(restHeight).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Flags" }).click();
  await expect
    .poll(() => toolbar.read().then((s) => parseFloat(s.shell.heightVariable.value ?? "0")))
    .toBeGreaterThan(restHeight);

  const after = await toolbar.read();
  const insetBottom = await page
    .getByTestId("inset")
    .evaluate((el) => getComputedStyle(el).paddingBottom);
  expect(insetBottom).toBe(after.shell.heightVariable.value);
});

test("a lone instance publishes the unsuffixed height variable too", async ({ toolbar, page }) => {
  // The header pill reads `--dev-toolbar-height`, not the instance-scoped name
  // the bridge reports, and this app's toolbar is `"playground"`, not
  // `"default"`. Under `<StrictMode>` its mount effects run twice — the one
  // place a double-counted registration would show up as `(unset)`.
  const readout = page.getByTestId("height-readout").locator("strong");
  const at = async () => (await toolbar.read()).shell.heightVariable.value;
  const atPx = () => toolbar.read().then((s) => parseFloat(s.shell.heightVariable.value ?? "0"));
  const restHeight = await atPx();
  expect(restHeight).toBeGreaterThan(0);
  await expect(readout).toHaveText((await at()) ?? "");

  // The baseline is read before the click, so equality below cannot be met by
  // a readout that never moved.
  await page.getByRole("button", { name: "Flags" }).click();
  await expect.poll(atPx).toBeGreaterThan(restHeight);
  const expanded = await at();
  expect(parseFloat(expanded ?? "0")).toBeGreaterThan(restHeight);
  await expect(readout).toHaveText(expanded ?? "");

  // `enabled={false}` unmounts the shell: nothing is left to own the name.
  await page.getByTestId("toggle-enabled").click();
  await expect(readout).toHaveText("(unset)");
  await page.getByTestId("toggle-enabled").click();
  await toolbar.ready();
  await expect(readout).not.toHaveText("(unset)");
  await expect(readout).toHaveText((await at()) ?? "");
});

test("moves to the top and survives a reload", async ({ toolbar, page }) => {
  await page.getByTestId("toggle-position").click();
  await expect.poll(() => toolbar.read().then((s) => s.shell.position)).toBe("top");
  expect((await toolbar.storage()).position).toBe('"top"');
  await expect(page.getByTestId("inset")).toHaveCSS("padding-bottom", "0px");

  await toolbar.goto();
  expect((await toolbar.read()).shell.position).toBe("top");
  await expect(page.getByTestId("toggle-position")).toHaveText(/position: top/);
});

test("Mod+Shift+. hides the bar, removes it from the DOM, and the hidden state persists", async ({
  toolbar,
  page,
}) => {
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(`${await toolbar.mod()}+Shift+.`);
  await expect.poll(() => toolbar.read().then((s) => s.visible)).toBe(false);
  const hidden = await toolbar.read();
  expect(hidden.shell.mounted).toBe(false);
  await expect(page.locator('[data-dtb-part="root"]')).toHaveCount(0);
  expect((await toolbar.storage()).visible).toBe("false");

  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).__DEV_TOOLBAR__?.instances?.playground);
  expect((await toolbar.read()).visible).toBe(false);
  await expect(page.getByTestId("toggle-visible")).toHaveText(/visible: false/);

  // Bring it back through the same key so the toggle is proven both ways.
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(`${await toolbar.mod()}+Shift+.`);
  await expect.poll(() => toolbar.read().then((s) => s.shell.mounted)).toBe(true);
});

test("an extension that throws costs one error chip and nothing else", async ({
  toolbar,
  page,
}) => {
  // `boom` is collapsed at 1280×800, so its chip only exists inside the open menu.
  await toolbar.overflowButton.click();
  const chip = page.locator('[data-dtb-part="error-chip"]');
  await expect(chip).toHaveCount(1);
  await expect(chip.locator("..")).toHaveAttribute("data-dtb-ext-id", "boom");
  const s = await toolbar.read();
  const placed = new Set([...s.shell.bar.map((b) => b.id), ...s.shell.overflow.items]);
  for (const d of s.diagnostics) expect(placed, `${d.id} is still placed`).toContain(d.id);
});
