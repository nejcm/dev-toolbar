import { expect, test } from "./fixtures";

// Recipe: .claude/skills/verify-dev-toolbar/features/flags.md

interface FlagRow {
  key: string;
  type: string;
  source: string;
  overridden: boolean;
  masked: boolean;
  effective: unknown;
  base: unknown;
  default: unknown;
  tags: string[];
}
interface FlagsState {
  flags: FlagRow[];
  overriddenCount: number;
  maskedCount: number;
  bulkError: string | null;
}

const flag = (state: FlagsState | null, key: string) => state?.flags.find((f) => f.key === key);
const readout = (key: string) =>
  `[data-testid="flag-readout"] li:has(code:text-is("${key}"))`;

test("overrides a boolean with the panel shut, and the app sees it", async ({ toolbar, page }) => {
  expect((await toolbar.ext<FlagsState>("flags"))?.overriddenCount).toBe(0);
  await expect(page.locator(readout("new-header"))).toHaveText(/new-header = true$/);

  expect(await toolbar.run("flags.toggle.new-header")).toEqual({ ok: true });

  await expect.poll(() => toolbar.ext<FlagsState>("flags").then((f) => f?.overriddenCount)).toBe(1);
  const row = flag(await toolbar.ext<FlagsState>("flags"), "new-header");
  expect(row).toMatchObject({
    effective: false,
    base: true,
    default: false,
    source: "local-override",
    overridden: true,
  });
  expect(row?.tags).toContain("override");
  await expect(page.locator(readout("new-header"))).toContainText(
    "new-header = false (overridden — the app resolves true)",
  );
  expect((await toolbar.storage())["ext:flags:overrides"]).toBe('{"new-header":false}');
  expect((await toolbar.read()).shell.activePanel).toBeNull();
});

test("flags.set sets a typed value, clears it, and refuses the wrong type", async ({
  toolbar,
  page,
}) => {
  expect(await toolbar.run("flags.set", { key: "search.rank", value: 9 })).toEqual({ ok: true });
  await expect
    .poll(() => toolbar.ext<FlagsState>("flags").then((f) => flag(f, "search.rank")?.effective))
    .toBe(9);
  expect(flag(await toolbar.ext<FlagsState>("flags"), "search.rank")).toMatchObject({
    overridden: true,
    source: "local-override",
  });
  await expect(page.locator(readout("search.rank"))).toContainText("search.rank = 9");

  // Omitting `value` clears.
  expect(await toolbar.run("flags.set", { key: "search.rank" })).toEqual({ ok: true });
  await expect
    .poll(() => toolbar.ext<FlagsState>("flags").then((f) => flag(f, "search.rank")?.overridden))
    .toBe(false);

  // Refusals are values, not rejections, and leave the row alone.
  const refused = await toolbar.run("flags.set", { key: "new-header", value: "yes" });
  expect(refused).toMatchObject({ ok: false, reason: "threw" });
  expect((refused as { error: string }).error).toMatch(/"new-header" is a boolean flag/);
  const nulled = await toolbar.run("flags.set", { key: "new-header", value: null });
  expect(nulled).toMatchObject({ ok: false, reason: "threw" });
  const unknown = await toolbar.run("flags.set", { key: "nope", value: true });
  expect(unknown).toMatchObject({ ok: false, reason: "threw" });
  expect(flag(await toolbar.ext<FlagsState>("flags"), "new-header")?.overridden).toBe(false);
  expect((await toolbar.storage())["ext:flags:overrides"]).toBeUndefined();
});

test("the switch in the panel overrides, and the override survives a reload", async ({
  toolbar,
  page,
}) => {
  await page.getByRole("button", { name: "Flags" }).click();
  await expect.poll(() => toolbar.read().then((s) => s.shell.activePanel)).toBe("flags");
  await page.getByRole("switch", { name: "Toggle new-header" }).click();
  await expect
    .poll(() => toolbar.ext<FlagsState>("flags").then((f) => flag(f, "new-header")?.overridden))
    .toBe(true);

  await toolbar.goto();
  const f = await toolbar.ext<FlagsState>("flags");
  expect(flag(f, "new-header")).toMatchObject({ effective: false, overridden: true });
  expect(f?.overriddenCount).toBe(1);
  expect((await toolbar.read()).shell.activePanel).toBe("flags");

  await page.getByRole("button", { name: /Clear all overrides/ }).click();
  await expect.poll(() => toolbar.ext<FlagsState>("flags").then((f) => f?.overriddenCount)).toBe(0);
  expect((await toolbar.storage())["ext:flags:overrides"]).toBeUndefined();
});

test("a masked flag publishes only redacted strings, everywhere", async ({ toolbar }) => {
  const f = await toolbar.ext<FlagsState>("flags");
  const row = flag(f, "checkout.apiToken");
  expect(row?.masked).toBe(true);
  expect(row?.tags).toContain("masked");
  expect(row?.effective).toBe("[redacted]");
  expect(row?.base).toBe("[redacted]");
  expect(f?.maskedCount).toBeGreaterThanOrEqual(1);
  expect(flag(f, "ui-facelift")?.tags).toContain("promoted");
  expect(JSON.stringify(await toolbar.read())).not.toContain("tok-live-");
});

test("?dtb-flags=reset clears overrides without the panel ever opening", async ({
  toolbar,
  page,
}) => {
  expect(await toolbar.run("flags.toggle.new-header")).toEqual({ ok: true });
  await expect.poll(() => toolbar.storage().then((s) => s["ext:flags:overrides"])).toBeDefined();

  await toolbar.goto("/?dtb-flags=reset");
  const f = await toolbar.ext<FlagsState>("flags");
  expect(f?.overriddenCount).toBe(0);
  expect((await toolbar.storage())["ext:flags:overrides"]).toBeUndefined();
  await expect(page.locator(readout("new-header"))).toHaveText(/new-header = true$/);
  expect((await toolbar.read()).shell.activePanel).toBeNull();
});

test("a throwing whole-map adapter is one bulkError, not a marked row, and recovers", async ({
  toolbar,
  page,
}) => {
  expect((await toolbar.ext<FlagsState>("flags"))?.bulkError).toBeNull();
  await page.getByTestId("flag-break-mirror").click();
  expect(await toolbar.run("flags.toggle.new-header")).toEqual({ ok: true });
  await expect
    .poll(() => toolbar.ext<FlagsState>("flags").then((f) => f?.bulkError))
    .toMatch(/override mirror is offline/);
  const row = flag(await toolbar.ext<FlagsState>("flags"), "new-header");
  expect(row?.overridden).toBe(true);
  expect(row?.tags).not.toContain("not-applied");

  await page.getByTestId("flag-break-mirror").click();
  expect(await toolbar.run("flags.toggle.new-header")).toEqual({ ok: true });
  await expect.poll(() => toolbar.ext<FlagsState>("flags").then((f) => f?.bulkError)).toBeNull();
});
