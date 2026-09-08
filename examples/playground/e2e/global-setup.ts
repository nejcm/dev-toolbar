import { readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Stale-dist guard, run once before the suite.
 *
 * The playground consumes the library through `file:../..`, so this suite
 * exercises whatever `dist/` holds, not `src/`. Root `bun run test:e2e`
 * builds first; `bunx playwright test` in here does not, and an agent that
 * edits `src/` and runs the suite from this directory would get a green run
 * over the old build. Mirror of the `src/ is newer than dist/` check in
 * `.claude/skills/verify-dev-toolbar/doctor.sh`, promoted from a warning to a
 * failure because nobody reads a warning above 29 passing tests.
 *
 * `DTB_E2E_SKIP_DIST_CHECK=1` bypasses it for a deliberate run against an
 * older build.
 */
const ROOT = resolve(import.meta.dirname, "../../..");
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");
const HINT =
  "run `bun run build` at the repo root, or use root `bun run test:e2e`, which builds first. " +
  "Set DTB_E2E_SKIP_DIST_CHECK=1 to run against this dist/ anyway.";

/** Newest mtime (ms) under `dir`, recursively; `null` when nothing qualifies. */
function newestMtime(dir: string, skip: (name: string, isDir: boolean) => boolean): number | null {
  let newest: number | null = null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip(entry.name, entry.isDirectory())) continue;
    const path = join(dir, entry.name);
    const mtime = entry.isDirectory() ? newestMtime(path, skip) : statSync(path).mtimeMs;
    if (mtime !== null && (newest === null || mtime > newest)) newest = mtime;
  }
  return newest;
}

const isTestFile = (name: string) => /\.test\./.test(name);

export default function globalSetup(): void {
  if (process.env.DTB_E2E_SKIP_DIST_CHECK === "1") return;

  if (!existsSync(DIST)) {
    throw new Error(
      `dist/ is missing at ${DIST} — the playground links file:../.. and cannot run without a build; ${HINT}`,
    );
  }

  const srcNewest = newestMtime(SRC, (name, isDir) =>
    isDir ? name === "__tests__" : isTestFile(name),
  );
  const distNewest = newestMtime(DIST, () => false);
  if (srcNewest === null || distNewest === null) return;

  if (srcNewest > distNewest) {
    const src = new Date(srcNewest).toISOString();
    const dist = new Date(distNewest).toISOString();
    throw new Error(
      `src/ (${src}) is newer than dist/ (${dist}) — this suite would prove the old build; ${HINT}`,
    );
  }
}
