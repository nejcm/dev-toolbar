import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  esbuild: { jsx: "automatic" },
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
  },
});
