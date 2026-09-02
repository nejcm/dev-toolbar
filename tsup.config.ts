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
    "ext/overlays": "src/ext/overlays/index.tsx",
    "ext/diagnostics": "src/ext/diagnostics/index.tsx",
    "ext/theme-editor": "src/ext/theme-editor/index.tsx",
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
      "ext/overlays": "src/ext/overlays/index.tsx",
      "ext/diagnostics": "src/ext/diagnostics/index.tsx",
      "ext/theme-editor": "src/ext/theme-editor/index.tsx",
      testing: "src/testing/index.ts",
    },
  },
  sourcemap: true,
  clean: true,
  // rollup's treeshake pass drops the "use client" banner; esbuild already tree-shakes.
  treeshake: false,
  target: "es2022",
  banner: { js: '"use client";' },
  external: [
    // So `./testing` reaches core via the consumer's copy, not a bundled second one.
    "@nejcm/dev-toolbar",
    "react",
    "react-dom",
    "react/jsx-runtime",
    // Optional peer for ./testing; must never be bundled.
    "@testing-library/react",
  ],
});
