import { defineConfig } from "@playwright/test";

/**
 * One spec, one browser, one cold Vite dev server.
 *
 * Its own port, like the playground's suite on :5274 (`DTB_E2E_PORT=5275` is
 * that suite's documented alternate, so this one starts higher). Override with
 * DTB_VITE_CONSUMER_PORT when two runs share a machine.
 *
 * The server is started cold on purpose: `sync-package.mjs` has just cleared
 * `node_modules/.vite`, so the run always includes the optimizer's first scan
 * and pre-bundle of the package — the path a fresh `npm install` consumer hits.
 */
const PORT = Number(process.env.DTB_VITE_CONSUMER_PORT ?? 5276);
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e-results/output",
  forbidOnly: isCI,
  // Never: the server outlives a retry, so a second attempt would run against
  // the settled optimizer and pass for a reason the first attempt did not have.
  retries: 0,
  reporter: isCI
    ? [["list"], ["github"], ["html", { outputFolder: "e2e-results/report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "e2e-results/report", open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: `http://localhost:${PORT}/`,
    viewport: { width: 1280, height: 800 },
    colorScheme: "light",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `bunx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
