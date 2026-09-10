import { Toolbar, expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

// Recipe: .claude/skills/verify-dev-toolbar/features/a11y.md — "Deferred loading".

interface A11yState {
  status: string;
  scans: number;
  axeVersion: string | null;
  groups: { impact: string; violations: { rule: string }[] }[];
}

const a11y = (t: Toolbar) => t.ext<A11yState>("a11y");

/**
 * Every request whose URL names the peer, from before navigation on. Request
 * timing is the one claim the bridge cannot make — the extension does not know
 * what the network did — so this is the one place a network observation is the
 * assertion; state still goes through the bridge below.
 */
const watchAxeRequests = (page: Page): string[] => {
  const seen: string[] = [];
  page.on("request", (request) => {
    if (/axe-core/i.test(request.url())) seen.push(request.url());
  });
  return seen;
};

test("the default page fetches axe-core at mount, before any scan", async ({ page }) => {
  const requests = watchAxeRequests(page);
  const toolbar = new Toolbar(page);
  await toolbar.goto("/");

  await expect.poll(() => a11y(toolbar).then((a) => a?.axeVersion)).toMatch(/^\d+\.\d+\.\d+/);
  expect(await a11y(toolbar)).toMatchObject({ status: "pending", scans: 0 });
  expect(requests.length).toBeGreaterThan(0);
});

test("loadOn: scan fetches nothing until the first scan, then reports normally", async ({
  page,
}) => {
  const requests = watchAxeRequests(page);
  const toolbar = new Toolbar(page);
  await toolbar.goto("/?a11y-load-on=scan");

  expect(requests).toEqual([]);
  expect(await a11y(toolbar)).toMatchObject({ status: "pending", scans: 0, axeVersion: null });

  // At 1280×800 the chip has collapsed into `⋮`, where it is only in the DOM while the menu is open.
  if (!(await toolbar.read()).shell.bar.some((item) => item.id === "a11y")) {
    await toolbar.overflowButton.click();
  }
  await toolbar.trigger("a11y").click();
  await expect.poll(() => toolbar.read().then((s) => s.shell.activePanel)).toBe("a11y");
  await expect(page.locator('[data-dtb-part="a11y-unchecked"]')).toHaveCount(1);
  await expect(page.locator('[data-dtb-part="a11y-unsupported"]')).toHaveCount(0);
  await expect(page.locator('[data-dtb-part="a11y-scan"]')).toBeEnabled();
  expect(requests).toEqual([]);

  expect(await toolbar.run("a11y.scan")).toMatchObject({ ok: true });
  await expect.poll(() => a11y(toolbar).then((a) => a?.status)).toBe("ok");
  const report = (await a11y(toolbar))!;
  expect(report.scans).toBe(1);
  expect(report.axeVersion).toMatch(/^\d+\.\d+\.\d+/);
  // The same rules the eager recipe lists from the top of the page.
  expect(report.groups.flatMap((g) => g.violations.map((v) => v.rule)).sort()).toEqual([
    "button-name",
    "image-alt",
    "label",
    "tabindex",
  ]);
  expect(requests.length).toBeGreaterThan(0);
  await expect(page.locator('[data-dtb-part="a11y-unchecked"]')).toHaveCount(0);

  // Cleared is not unchecked: axe stayed loaded, so the invitation must not return.
  expect(await toolbar.run("a11y.clear")).toMatchObject({ ok: true });
  await expect.poll(() => a11y(toolbar).then((a) => a?.status)).toBe("pending");
  expect((await a11y(toolbar))?.scans).toBe(1);
  await expect(page.locator('[data-dtb-part="a11y-unchecked"]')).toHaveCount(0);
});
