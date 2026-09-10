import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Deliberately a default Vite config: no `optimizeDeps.exclude`, no
 * `resolve.dedupe`, no `server.fs.allow`. The playground needs all three
 * because it consumes a `file:../..` link; a real npm consumer has none of
 * them, and this fixture exists to stand where that consumer stands, with the
 * dependency optimizer scanning and pre-bundling the package like any other.
 */
export default defineConfig({
  plugins: [react()],
});
