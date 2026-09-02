/**
 * Copies the freshly built `dist/` into this fixture's own `node_modules` as
 * `@nejcm/dev-toolbar`, with a package.json carrying the real `exports` map.
 *
 * A `file:` link would be simpler but wrong: Jest resolves through realpath,
 * so the linked `dist/` would pull React from the repo root's node_modules
 * while the test pulls it from this fixture's, causing an "invalid hook
 * call". Copying keeps one React copy.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const dist = join(root, "dist");

if (!existsSync(join(dist, "testing.cjs"))) {
  console.error(
    "[jest-consumer] dist/testing.cjs is missing. Run `npm run build` in the " +
      "repo root first, or use `npm run test:jest-consumer`, which does it for you.",
  );
  process.exit(1);
}

const target = join(here, "node_modules", "@nejcm", "dev-toolbar");
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(dist, join(target, "dist"), { recursive: true });

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
writeFileSync(
  join(target, "package.json"),
  `${JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      type: pkg.type,
      main: pkg.main,
      module: pkg.module,
      types: pkg.types,
      exports: pkg.exports,
    },
    null,
    2,
  )}\n`,
);

console.log("[jest-consumer] synced dist/ into node_modules/@nejcm/dev-toolbar");
