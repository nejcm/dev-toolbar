import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
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
