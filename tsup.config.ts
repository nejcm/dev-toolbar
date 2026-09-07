import { defineConfig } from "tsup";

/**
 * Entry list mirrors package.json `exports`. Subpaths land here as their
 * phases add them (`./runtime`, `./testing`, `./ext/*`) — never as wildcards.
 */
const entry = {
  index: "src/index.ts",
  runtime: "src/runtime/index.ts",
  kit: "src/kit/index.ts",
  "ext/a11y": "src/ext/a11y/index.tsx",
  "ext/agent": "src/ext/agent/index.tsx",
  "ext/metrics": "src/ext/metrics/index.tsx",
  "ext/environment": "src/ext/environment/index.tsx",
  "ext/flags": "src/ext/flags/index.tsx",
  "ext/command-menu": "src/ext/command-menu/index.tsx",
  "ext/overlays": "src/ext/overlays/index.tsx",
  "ext/diagnostics": "src/ext/diagnostics/index.tsx",
  "ext/theme-editor": "src/ext/theme-editor/index.tsx",
  testing: "src/testing/index.ts",
  styles: "src/styles.css",
} as const;

// The CSS entry has no declarations. Deriving this list keeps JS and DTS
// entrypoints in parity as subpaths change.
const dtsEntry = Object.fromEntries(Object.entries(entry).filter(([name]) => name !== "styles"));

export default defineConfig({
  entry,
  format: ["esm", "cjs"],
  dts: {
    entry: dtsEntry,
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
    // Optional peer for ./ext/a11y — 550 KB, loaded with import() at runtime.
    "axe-core",
  ],
});
