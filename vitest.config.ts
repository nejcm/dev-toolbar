import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // Lets a test import the package by its published specifiers, the way a
    // downstream extension author does. The built output is exercised
    // separately, through Node's own resolver, in testing/__tests__/exports.
    alias: [
      {
        find: /^@nejcm\/dev-toolbar\/testing$/,
        replacement: resolve("./src/testing/index.ts"),
      },
      {
        find: /^@nejcm\/dev-toolbar\/runtime$/,
        replacement: resolve("./src/runtime/index.ts"),
      },
      {
        find: /^@nejcm\/dev-toolbar\/ext\/metrics$/,
        replacement: resolve("./src/ext/metrics/index.tsx"),
      },
      {
        find: /^@nejcm\/dev-toolbar\/ext\/environment$/,
        replacement: resolve("./src/ext/environment/index.tsx"),
      },
      {
        find: /^@nejcm\/dev-toolbar\/ext\/overlays$/,
        replacement: resolve("./src/ext/overlays/index.tsx"),
      },
      {
        find: /^@nejcm\/dev-toolbar$/,
        replacement: resolve("./src/index.ts"),
      },
    ],
  },
  test: {
    globals: true,
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost:3000/" } },
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      // `text` for the CI log, `json-summary` for the job-summary table, `lcov`
      // for downstream consumers (Codecov, IDE gutters). `html` is omitted:
      // nothing reads it in CI and it's thousands of files to upload.
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "./coverage",
      // Vitest 4 always counts every file matching `include`, whether or not a
      // test imports it, and dropped the old `all` flag — don't reintroduce
      // `all: true`, it's now a type error, not a no-op.
      include: ["src/**/*.{ts,tsx}"],
      // Only the tests themselves are excluded. An earlier draft also excluded
      // index.tsx/types.ts/barrels as "just re-exports", but those files carry
      // real logic (extension factories, runtime exports) and are genuinely
      // tested — excluding them didn't change the numbers, it just put ~1,700
      // lines out of reach of the floors below. Don't reintroduce an exclude
      // list without measuring coverage both ways first.
      exclude: ["src/**/*.test.{ts,tsx}"],
      // Floors, not targets: set ~1.5-2 points under the measured baseline
      // (statements 90.53, branches 81.82, functions 89.80, lines 92.97) so a
      // real regression fails the build without gating on ordinary movement.
      // `functions` is tightest in practice (~19 functions of slack) — if it
      // fires on ordinary work, add tests rather than lowering the number.
      thresholds: {
        statements: 89,
        branches: 80,
        functions: 88,
        lines: 91,
      },
    },
  },
});
