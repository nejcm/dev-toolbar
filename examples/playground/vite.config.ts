import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { devToolbarAgent } from "./plugins/devToolbarAgent.ts";

export default defineConfig({
  // `devToolbarAgent` is the playground's own plugin, not part of the package:
  // it holds the snapshot the agent bridge reports and serves it at
  // `/__dev-toolbar/*`, so an agent that never loads the app can curl the
  // toolbar's state. Dev-server-only and localhost-only; the threat model is in
  // the plugin's own header and in the README recipe.
  plugins: [react(), devToolbarAgent()],
  resolve: {
    // `@nejcm/dev-toolbar` is a `file:..` link, so without deduping the linked
    // package would resolve React from the repo root's node_modules and the app
    // would run two copies (invalid-hook-call).
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    // The linked package's dist changes whenever the root build runs.
    exclude: ["@nejcm/dev-toolbar"],
  },
  server: {
    port: 5273,
    // Serving files through the `file:..` symlink means reaching outside root.
    fs: { allow: ["..", "../.."] },
  },
});
