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

test("closes a panel with its button and with Escape", async ({ toolbar, page }) => {
  await page.getByRole("button", { name: "Flags" }).click();
  await expect.poll(() => toolbar.read().then((s) => s.shell.activePanel)).toBe("flags");

  await page.getByRole("button", { name: "Close Flags panel" }).click();
  await expect.poll(() => toolbar.read().then((s) => s.shell.activePanel)).toBeNull();

  await page.getByRole("button", { name: "Flags" }).click();
  await expect.poll(() => toolbar.read().then((s) => s.shell.activePanel)).toBe("flags");
  await page.getByRole("button", { name: "Close Flags panel" }).focus();
  await page.keyboard.press("Escape");
  await expect.poll(() => toolbar.read().then((s) => s.shell.activePanel)).toBeNull();
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
  // Read `--dev-toolbar-height` off `<html>`, not the instance-scoped name the
  // bridge reports: this app's toolbar is `"playground"`, not `"default"`.
  // Under `<StrictMode>` its mount effects run twice — the one place a
  // double-counted registration would leave the name unset.
  const unsuffixed = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--dev-toolbar-height").trim(),
    );
  const at = async () => (await toolbar.read()).shell.heightVariable.value;
  const atPx = () => toolbar.read().then((s) => parseFloat(s.shell.heightVariable.value ?? "0"));
  const restHeight = await atPx();
  expect(restHeight).toBeGreaterThan(0);
  await expect.poll(unsuffixed).toBe((await at()) ?? "");

  // The baseline is read before the click, so equality below cannot be met by
  // a value that never moved.
  await page.getByRole("button", { name: "Flags" }).click();
  await expect.poll(atPx).toBeGreaterThan(restHeight);
  const expanded = await at();
  expect(parseFloat(expanded ?? "0")).toBeGreaterThan(restHeight);
  await expect.poll(unsuffixed).toBe(expanded ?? "");

  // `enabled={false}` unmounts the shell: nothing is left to own the name.
  await page.getByTestId("toggle-enabled").click();
  await expect.poll(unsuffixed).toBe("");
  await page.getByTestId("toggle-enabled").click();
  await toolbar.ready();
  await expect.poll(unsuffixed).not.toBe("");
  await expect.poll(unsuffixed).toBe((await at()) ?? "");
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

/**
 * Genuinely pixels, and genuinely a browser's job: jsdom resolves neither
 * `var()` nor this cascade.
 *
 * The kit's `Action` stamps `data-dtb-kind="action"`, the *panel* control
 * reset. On an element that is also a bar `trigger` it used to tie with core's
 * bar rule on specificity and win on source order — the kit sheet is injected
 * after core's — so the chip took a 1px frame and `--dtb-control-padding-x`,
 * and measured 8px wider. `cmds` hit exactly that, and the 8px collapsed it
 * into `⋮` on Linux CI only (c9542a9).
 *
 * Stamping the kind onto a trigger that is already on the bar is the whole
 * defect with nothing else moving, so it needs no fixture of its own: if the
 * guard in `KIT_CSS` were gone, the same element would report different
 * numbers before and after.
 */
test("the kit's kind resets cannot reach a bar trigger", async ({ page }) => {
  await page.goto("/");
  // Without the kit sheet on the page there is no rule to guard and every
  // assertion below passes for the wrong reason, so prove it is there first.
  await expect(page.locator('style[data-dev-toolbar-styles="kit"]')).toHaveCount(1);
  const trigger = page.locator('[data-dev-toolbar] [data-dtb-part="trigger"]').first();
  await expect(trigger).toBeVisible();

  const measure = await trigger.evaluate((el) => {
    const read = () => {
      const cs = getComputedStyle(el);
      return {
        padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
        borderWidth: cs.borderTopWidth,
        fontSize: cs.fontSize,
        width: el.getBoundingClientRect().width,
      };
    };
    const before = read();
    const stamped: Record<string, ReturnType<typeof read>> = {};
    for (const kind of ["action", "tag"]) {
      el.setAttribute("data-dtb-kind", kind);
      stamped[kind] = read();
      el.removeAttribute("data-dtb-kind");
    }
    return { before, stamped };
  });

  // `action` is the panel button (1px frame, --dtb-control-padding-x) and `tag`
  // the smaller marker (--dtb-space-1, a font step down); neither may move a chip.
  expect(measure.stamped["action"]).toEqual(measure.before);
  expect(measure.stamped["tag"]).toEqual(measure.before);
  // Named, so a failure says which reset won rather than only that one did.
  expect(measure.before.borderWidth).toBe("0px");
});

/**
 * The hover half of the `action` guard, which the unit tests can only pin as
 * selector text. Unguarded, the kit's `:hover:not(:disabled)` rule is (0,4,0)
 * and outranks core's `[aria-expanded="true"]` and `:active` at (0,3,0), so an
 * open `Action`-trigger under the cursor would paint hover-bg instead of
 * active-bg. Only a browser resolves that.
 */
test("the kit's action hover cannot repaint an open bar trigger", async ({ page }) => {
  // Core drops the chip's 120ms background transition under reduced motion, so
  // `getComputedStyle` reports the settled colour rather than a frame mid-blend
  // — two reads in one frame would otherwise agree no matter what the cascade
  // said, which is how this test first passed against a removed guard.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator('style[data-dev-toolbar-styles="kit"]')).toHaveCount(1);
  const trigger = page
    .locator('[data-dev-toolbar] button[data-dtb-part="trigger"][aria-expanded]')
    .first();
  await expect(trigger).toBeVisible();

  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await trigger.hover();

  const read = await trigger.evaluate((el) => {
    const root = el.closest("[data-dev-toolbar]") as HTMLElement;
    const token = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();
    const open = getComputedStyle(el).backgroundColor;
    el.setAttribute("data-dtb-kind", "action");
    const stamped = getComputedStyle(el).backgroundColor;
    el.removeAttribute("data-dtb-kind");
    return { open, stamped, hover: token("--dtb-item-hover-bg"), active: token("--dtb-item-active-bg") };
  });

  // Named both ways, so a failure says which rule won rather than only that one
  // did — and the last line keeps the first two from being a tautology.
  expect(read.open).toBe(read.active);
  expect(read.stamped).toBe(read.active);
  expect(read.hover).not.toBe(read.active);
});
