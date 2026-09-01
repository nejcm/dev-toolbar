import { defineConfig } from "tsup";

/**
 * Entry list mirrors package.json `exports`. Subpaths land here as their
 * phases add them (`./runtime`, `./testing`, `./ext/*`) — never as wildcards.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    runtime: "src/runtime/index.ts",
    "ext/metrics": "src/ext/metrics/index.tsx",
    "ext/environment": "src/ext/environment/index.tsx",
    "ext/flags": "src/ext/flags/index.tsx",
    "ext/command-menu": "src/ext/command-menu/index.tsx",
    testing: "src/testing/index.ts",
    styles: "src/styles.css",
  },
  format: ["esm", "cjs"],
  dts: {
    entry: {
      index: "src/index.ts",
      runtime: "src/runtime/index.ts",
      "ext/metrics": "src/ext/metrics/index.tsx",
      "ext/environment": "src/ext/environment/index.tsx",
      "ext/flags": "src/ext/flags/index.tsx",
      "ext/command-menu": "src/ext/command-menu/index.tsx",
      testing: "src/testing/index.ts",
    },
  },
  sourcemap: true,
  clean: true,
  // rollup's treeshake pass hoists imports above the banner and drops the
  // "use client" directive; esbuild already tree-shakes this bundle.
  treeshake: false,
  target: "es2022",
  banner: { js: '"use client";' },
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    // ./testing only. An optional peer, so it must never be bundled.
    "@testing-library/react",
  ],
});
