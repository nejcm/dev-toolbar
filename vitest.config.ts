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
        find: /^@nejcm\/dev-toolbar\/ext\/metrics$/,
        replacement: resolve("./src/ext/metrics/index.tsx"),
      },
      {
        find: /^@nejcm\/dev-toolbar\/runtime$/,
        replacement: resolve("./src/runtime/index.ts"),
      },
      {
        find: /^@nejcm\/dev-toolbar\/kit$/,
        replacement: resolve("./src/kit/index.ts"),
      },
      {
        find: /^@nejcm\/dev-toolbar\/testing$/,
        replacement: resolve("./src/testing/index.ts"),
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
      // index.tsx/types.ts/barrels look like "just re-exports" but carry real
      // logic and are genuinely tested — don't exclude them without measuring
      // coverage both ways first (it previously put ~1,700 lines out of reach).
      exclude: ["src/**/*.test.{ts,tsx}", "src/test-utils/**"],
      // Floors, not targets. Measured: statements 93.84, branches 86.40,
      // functions 95.08, lines 96.09 — up from 93.06 / 85.26 / 93.57 / 95.38
      // because the kit is small, densely tested code that the extensions now
      // delegate branches to instead of carrying them individually. The floors
      // keep roughly two to three points of room for ordinary movement while a
      // real regression still fails the build; `branches` and `functions` are
      // raised here to hold the gain rather than let it drain away unnoticed.
      // `statements` already sat at that margin, so it stays. `functions` is
      // tightest in practice — if it fires on ordinary work, add tests rather
      // than lowering the number.
      thresholds: {
        statements: 91,
        branches: 84,
        functions: 92,
        lines: 94,
      },
    },
  },
});
