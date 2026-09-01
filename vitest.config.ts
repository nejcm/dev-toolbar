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
      // Only the tests themselves. An earlier draft of this config also
      // excluded `**/index.tsx`, `**/types.ts`, `**/css.ts` and the barrels, on
      // the theory that they were re-exports, type-only or branchless constants.
      // Three of those four were wrong: `src/ext/*/index.tsx` are the extension
      // *factories* (1,667 lines of real logic — AGENTS.md calls them that), and
      // every `types.ts` carries runtime exports, 19 of them in
      // `src/ext/overlays/types.ts` including DOM traversal. Excluding them made
      // the numbers no better — measured both ways, they differ by fractions of
      // a percent, because those files are in fact tested — but it did put ~1,700
      // lines permanently out of reach of the floors below, so a new untested
      // branch in a factory could never trip them. Do not reintroduce an exclude
      // list without measuring both ways first.
      exclude: ["src/**/*.test.{ts,tsx}"],
      // Floors, not targets: set just under the current measured numbers so a
      // regression fails the build while ordinary movement does not. Raise
      // them when they start reading as generous, not on every green run.
      // Measured over the whole of `src/` at the time these were set:
      // statements 90.53, branches 81.82, functions 89.80, lines 92.97.
      thresholds: {
        statements: 89,
        branches: 80,
        functions: 88,
        lines: 92,
      },
    },
  },
});
