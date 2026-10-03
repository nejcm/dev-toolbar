import { expect, test } from "./fixtures";
import type { Toolbar } from "./fixtures";

// Recipe: .claude/skills/verify-dev-toolbar/features/metrics.md

interface NetworkDiagnostics {
  totals: { started: number; completed: number; failed: number; aborted: number; slow: number };
  recent: { url: string; status: number | undefined; state: string }[];
}

const network = (toolbar: Toolbar) =>
  toolbar
    .ext<{ network?: NetworkDiagnostics }>("metrics")
    .then((data) => data?.network ?? null);

/**
 * Opens the metrics panel from wherever it lives; at 1280 that is the `⋮` menu,
 * where `/ext/metrics` spells out one row per metric instead of its bar
 * trigger. Every row toggles the panel; none picks its own tab.
 */
async function openPanel(toolbar: Toolbar) {
  await toolbar.settled();
  if ((await toolbar.read()).shell.bar.some((item) => item.id === "metrics")) {
    await toolbar.trigger("metrics").click();
  } else {
    await toolbar.overflowButton.click();
    await expect.poll(() => toolbar.read().then((r) => r.shell.overflow.open)).toBe(true);
    await toolbar.page
      .locator(
        '[data-dtb-part="overflow-menu-item"][data-dtb-ext-id="metrics"] [data-dtb-part="metrics-overflow-row"]',
      )
      .first()
      .click();
  }
  await expect.poll(() => toolbar.read().then((r) => r.shell.activePanel)).toBe("metrics");
}

test("the 404 fixture lands in the network collector as failed requests", async ({
  toolbar,
  page,
}) => {
  await expect.poll(() => network(toolbar).then((n) => n !== null)).toBe(true);
  const before = (await network(toolbar))!.totals;

  await page.getByTestId("load-fetch-fail").click();

  await expect
    .poll(() => network(toolbar).then((n) => n?.totals.failed))
    .toBeGreaterThanOrEqual(before.failed + 3);
  const after = (await network(toolbar))!;
  expect(after.totals.completed).toBeGreaterThanOrEqual(before.completed + 3);
  const fixture = after.recent.filter((entry) => entry.url.includes("/__status/404"));
  expect(fixture).toHaveLength(3);
  for (const entry of fixture) {
    expect(entry).toMatchObject({ status: 404, state: "failed" });
    expect(entry.url, "the query-string credential is masked").not.toContain("super-secret");
  }
});

test("tabs rove with Arrow/Home/End and the selected tab survives a reload", async ({
  toolbar,
  page,
}) => {
  await openPanel(toolbar);
  const tablist = page.getByRole("tablist", { name: "Metrics" });
  const tabs = tablist.getByRole("tab");
  const selected = tablist.locator('[role="tab"][aria-selected="true"]');
  const focusable = tablist.locator('[role="tab"][tabindex="0"]');
  const ids = await tabs.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-dtb-metric")),
  );
  expect(ids.slice(0, 5)).toEqual(["memory", "fps", "delay", "jank", "network"]);

  const expectActive = async (id: string) => {
    await expect(selected).toHaveAttribute("data-dtb-metric", id);
    await expect(selected).toBeFocused();
    await expect(focusable).toHaveCount(1);
    await expect(focusable).toHaveAttribute("data-dtb-metric", id);
    await expect
      .poll(() => toolbar.storage().then((s) => s["ext:metrics:tab"]))
      .toBe(id);
  };

  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expectActive("fps");
  await page.keyboard.press("End");
  await expectActive(ids.at(-1)!);
  await page.keyboard.press("ArrowRight");
  await expectActive("memory");
  await page.keyboard.press("ArrowLeft");
  await expectActive(ids.at(-1)!);
  await page.keyboard.press("Home");
  await expectActive("memory");

  await tablist.getByRole("tab", { name: "Network" }).click();
  await expect(selected).toHaveAttribute("data-dtb-metric", "network");
  await expect.poll(() => toolbar.storage().then((s) => s["ext:metrics:tab"])).toBe("network");

  await toolbar.goto();
  await expect.poll(() => toolbar.read().then((s) => s.shell.activePanel)).toBe("metrics");
  await expect(selected).toHaveAttribute("data-dtb-metric", "network");
  await expect(focusable).toHaveAttribute("data-dtb-metric", "network");
  await expect(page.getByRole("tabpanel")).toHaveAttribute(
    "aria-labelledby",
    (await selected.getAttribute("id"))!,
  );
});
