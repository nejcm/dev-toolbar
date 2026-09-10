import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Selectors, not the agent bridge: the bridge is one more `ext/*` entry, and a
// second React is exactly the failure that makes a bridge read untrustworthy.
// The parts used are documented styling hooks. Rationale in ../README.md.

/** Optimized-dep URLs the page loaded, `path` without the query and its `?v=` hash. */
function collectOptimizedDeps(page: Page): { path: string; hash: string | null }[] {
  const deps: { path: string; hash: string | null }[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.includes("/node_modules/.vite/deps/")) {
      deps.push({ path: url.pathname, hash: url.searchParams.get("v") });
    }
  });
  return deps;
}

test("one React across core, /kit and ext/* under the optimizer", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const deps = collectOptimizedDeps(page);
  const expectNoErrors = () => {
    const hookErrors = [...pageErrors, ...consoleErrors].filter((text) =>
      /Invalid hook call|more than one copy of React/i.test(text),
    );
    expect(hookErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  };

  await page.goto("/");
  const root = page.locator("[data-dev-toolbar]");
  await expect(root).toBeVisible();
  const errorChips = root.locator('[data-dtb-part="error-chip"]');
  const panel = root.locator('[data-dtb-part="panel"][data-dtb-active="true"]');

  // All four triggers: the two first-party chips, the kit's chip for the embed
  // with a `value`, core's own trigger for the one without.
  const env = page.getByRole("button", { name: /^env/ });
  const flags = page.getByRole("button", { name: /^Flags/ });
  const vendorLive = page.getByRole("button", { name: /^vendor-live/ });
  const vendor = page.getByRole("button", { name: "vendor", exact: true });
  await expect(env).toBeVisible();
  await expect(env.locator('[data-dtb-part="env-chip"]')).toHaveCount(1);
  await expect(flags).toBeVisible();
  await expect(flags.locator('[data-dtb-part="flag-chip"]')).toHaveCount(1);
  await expect(vendorLive).toBeVisible();
  await expect(vendorLive.locator('[data-dtb-part="embed-chip"]')).toHaveCount(1);
  await expect(vendor).toBeVisible();
  await expect(vendor).toHaveAttribute("data-dtb-part", "trigger");
  await expect(errorChips).toHaveCount(0);
  expectNoErrors();

  // Each panel runs that entry's panel-side hooks inside core's boundary; the
  // embeds also run `render()` and the vendor's own state. `aria-expanded`, not
  // the panel's absence: flags keeps its panel mounted while closed.
  for (const trigger of [vendorLive, vendor]) {
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(panel.locator('[data-vendor="devtools"]')).toBeVisible();
    await panel.getByRole("button", { name: "vendor count 0" }).click();
    await expect(panel.getByRole("button", { name: "vendor count 1" })).toBeVisible();
    await expect(errorChips).toHaveCount(0);
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  }
  for (const trigger of [flags, env]) {
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toBeVisible();
    await expect(errorChips).toHaveCount(0);
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  }

  // Identity on the wire: the package's entries came from the pre-bundle (the
  // optimizer, not a bypass), React was served once, and every optimized file
  // under one `?v=` hash — a re-optimize mid-page is the same file twice.
  await page.waitForLoadState("networkidle");
  expectNoErrors();
  await expect(errorChips).toHaveCount(0);
  const paths = deps.map((dep) => dep.path.split("/node_modules/.vite/deps/")[1]);
  expect(paths).toEqual(
    expect.arrayContaining([
      "@nejcm_dev-toolbar.js",
      "@nejcm_dev-toolbar_kit.js",
      "@nejcm_dev-toolbar_ext_flags.js",
      "@nejcm_dev-toolbar_ext_environment.js",
      "react.js",
    ]),
  );
  expect(paths.filter((path) => path === "react.js")).toHaveLength(1);
  const hashesByFile = new Map<string, Set<string | null>>();
  for (const dep of deps) {
    const file = dep.path.split("/node_modules/.vite/deps/")[1]!;
    hashesByFile.set(file, (hashesByFile.get(file) ?? new Set()).add(dep.hash));
  }
  for (const [file, hashes] of hashesByFile) {
    expect(hashes, `${file} was served under more than one hash`).toHaveProperty("size", 1);
  }
});
