import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Selectors, not the agent bridge: the bridge is one more `ext/*` entry, and a
// second React is exactly the failure that makes a bridge read untrustworthy.
// The parts used are documented styling hooks. Rationale in ../README.md.

// `node_modules/.vite/deps/`, the mangled `@nejcm_dev-toolbar_kit.js` and `react.js`
// filenames and the `?v=` hash are Vite optimizer internals, not an API: a Vite
// upgrade that renames them fails this spec by design, not as a regression. Why the
// identity proof is taken from the network at all is in ../README.md.

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

  const env = page.getByRole("button", { name: /^Environment, / });
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

  // `aria-expanded`, not the panel's absence: flags keeps its panel mounted while
  // closed. Opening one is what runs that entry's panel-side hooks.
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

  // A re-optimize mid-page serves the same file under a second `?v=` hash, which
  // is how a second React reaches the page without any import changing.
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
