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
      // `text` for the CI log, `json-summary` for the job-summary table,
      // `lcov` for anything that later wants to ingest it (Codecov, an IDE
      // gutter). `html` is deliberately absent: nothing reads it in CI and it
      // is thousands of files to upload.
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "./coverage",
      // Vitest 4 always counts every file matching `include`, whether or not a
      // test imports it, and dropped the `all` flag that used to opt into that.
      // Do not reintroduce `all: true` — it is a type error, not a no-op.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        // Barrel files: re-exports only, so they report as covered or not
        // depending on which tests happened to import through them, and
        // either way the number says nothing about tested behaviour.
        "src/index.ts",
        "src/**/index.ts",
        "src/**/index.tsx",
        // Type-only modules compile to nothing; v8 still lists them at 0%.
        "src/**/types.ts",
        // Style constants — long template literals with no branches. They
        // would inflate the line count without adding any tested logic.
        "src/**/css.ts",
        "src/core/styles.ts",
      ],
      // Floors, not targets: set just under the current measured numbers so a
      // regression fails the build while ordinary movement does not. Raise
      // them when they start reading as generous, not on every green run.
      // Measured on the 41 test files at the time these were set: statements
      // 90.78, branches 81.31, functions 89.78, lines 93.19.
      thresholds: {
        statements: 89,
        branches: 79,
        functions: 87,
        lines: 92,
      },
    },
  },
});
