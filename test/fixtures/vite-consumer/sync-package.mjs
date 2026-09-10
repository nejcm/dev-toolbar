/**
 * Packs the repo root exactly as `npm publish` would and unpacks the tarball
 * into this fixture's own `node_modules` as `@nejcm/dev-toolbar` — the same
 * bytes, the same `files` filter, the same `package.json`, in a real
 * directory rather than a link.
 *
 * Not `file:../..`: a linked package is a symlink, and Vite's optimizer treats
 * a symlinked dependency as source (it is left out of the pre-bundle and
 * resolves React through the link, from the repo root's node_modules). The
 * playground has to opt out with `optimizeDeps.exclude` and `resolve.dedupe`
 * for that reason, and so proves nothing about the optimizer. A tarball
 * unpacked in place is what `npm install @nejcm/dev-toolbar` leaves behind,
 * so Vite discovers, scans and pre-bundles it like any other dependency.
 *
 * Also clears `node_modules/.vite`. Vite keys its pre-bundle cache on the
 * lockfile and config, not on the dependency's contents, so without this a
 * rebuilt `dist/` would be served from the previous run's optimized deps.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");

if (!existsSync(join(root, "dist", "kit.js"))) {
  console.error(
    "[vite-consumer] dist/kit.js is missing. Run `bun run build` in the repo " +
      "root first, or use `bun run test:vite-consumer`, which does it for you.",
  );
  process.exit(1);
}

const tarball = join(here, "dev-toolbar.tgz");
const target = join(here, "node_modules", "@nejcm", "dev-toolbar");

// `--ignore-scripts`: the root's `prepare` installs git hooks, which a pack
// must not run. An absolute `--filename` places the tarball (bun refuses it
// alongside `--destination`).
execFileSync("bun", ["pm", "pack", "--ignore-scripts", "--quiet", "--filename", tarball], {
  cwd: root,
  stdio: ["ignore", "ignore", "inherit"],
});

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
// npm-style tarballs wrap everything in `package/`; strip it, as installers do.
execFileSync("tar", ["-xzf", tarball, "-C", target, "--strip-components=1"], {
  stdio: ["ignore", "ignore", "inherit"],
});
rmSync(tarball, { force: true });

rmSync(join(here, "node_modules", ".vite"), { recursive: true, force: true });

console.log("[vite-consumer] unpacked the packed tarball into node_modules/@nejcm/dev-toolbar");
