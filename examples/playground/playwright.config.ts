import { defineConfig } from "@playwright/test";

/**
 * Browser tests for the toolbar, driven through this playground.
 *
 * The library has no app of its own; the playground is the one place the real
 * shell and the real first-party extensions meet a real browser, so this is
 * where layout, stacking, keyboard shortcuts, persistence across a reload and
 * the agent bridge get proven. Everything jsdom can see stays in vitest.
 *
 * The server is a second Vite instance on :5274, never the `bun run dev`
 * playground on :5273 — a different origin means a different `localStorage`,
 * so a suite run cannot disturb a toolbar someone is looking at, and the
 * `verify-dev-toolbar` skill's rule about never driving an instance you did
 * not start holds. `dist/` must exist: `bun run test:e2e` at the repo root
 * builds first; CI has already built it by the time this runs.
 */
const PORT = 5274;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e-results/output",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI
    ? [["list"], ["github"], ["html", { outputFolder: "e2e-results/report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "e2e-results/report", open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: `http://localhost:${PORT}/`,
    // The verification map pins every measurement to 1280×800; keep them
    // comparable. At this width part of the bar collapses into `⋮`, which is
    // what the overflow spec relies on.
    viewport: { width: 1280, height: 800 },
    colorScheme: "light",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // No `devices[...]` profile on purpose: those set a Windows user agent,
      // and the toolbar reads the platform to decide whether `Mod` is Ctrl or
      // Cmd. Letting the browser report its own host keeps the shortcut specs
      // honest on both macOS and Linux (see `Toolbar.mod`).
      use: { browserName: "chromium" },
      testIgnore: /bridge-http/,
    },
    {
      // The dev-server bridge holds one snapshot slot, so two open pages make
      // its `connection.ambiguous` flag true and every read suspect. These
      // tests therefore run after everything else, serially, one page at a time.
      name: "bridge-http",
      use: { browserName: "chromium" },
      testMatch: /bridge-http/,
      dependencies: ["chromium"],
      workers: 1,
    },
  ],
  webServer: {
    command: `bunx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    // Vite mirrors the page console here, and the `boom` extension logs a
    // deliberate crash on every load — too loud to be useful.
    stdout: "ignore",
    stderr: "ignore",
  },
});
