/**
 * The promise the docs make — install nothing, nothing throws — proven against
 * a consumer where `axe-core` is genuinely unresolvable.
 *
 * `test/fixtures/jest-consumer` reaches the same `"unsupported"` state for a
 * different reason: Node walks up to this repo's own root, where axe is a
 * devDependency, so that fixture really just exercises Jest's inability to run
 * a native `import()`. This copies the built package into a temporary
 * directory outside the checkout — the only place the import really fails to
 * resolve — without touching anything under `node_modules/`.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const root = process.cwd();
const built = existsSync(resolve(root, "dist/ext/a11y.js"));
const mustBeBuilt = Boolean(process.env["CI"]);

const PROBE =
  `const { createA11yRuntime } = await import("@nejcm/dev-toolbar/ext/a11y");` +
  `let peer = "resolved";` +
  `try { await import("axe-core"); } catch { peer = "absent"; }` +
  `const report = await createA11yRuntime().scan();` +
  `console.log(JSON.stringify({ peer, status: report.status, reason: report.unsupportedReason, total: report.total }));`;

const consumers: string[] = [];

/** A real copy: a symlink would resolve back into the checkout. */
const consumer = (withPeer: boolean): string => {
  const directory = mkdtempSync(join(tmpdir(), "dev-toolbar-peer-"));
  consumers.push(directory);
  const modules = join(directory, "node_modules");
  const installed = join(modules, "@nejcm/dev-toolbar");
  mkdirSync(installed, { recursive: true });
  cpSync(resolve(root, "dist"), join(installed, "dist"), { recursive: true });
  cpSync(resolve(root, "package.json"), join(installed, "package.json"));
  // React is the extension's own peer and must resolve either way; a symlink
  // is enough since it can't reach `axe-core` from here.
  symlinkSync(resolve(root, "node_modules/react"), join(modules, "react"));
  if (withPeer) symlinkSync(resolve(root, "node_modules/axe-core"), join(modules, "axe-core"));
  return directory;
};

const probe = (directory: string) =>
  JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", PROBE], {
      cwd: directory,
      encoding: "utf8",
    }).trim(),
  ) as { peer: string; status: string; reason: string | null; total: number };

afterAll(() => {
  for (const directory of consumers) rmSync(directory, { recursive: true, force: true });
});

if (!built && mustBeBuilt) {
  describe("the optional peer, absent for real", () => {
    it("has a dist/ to check (CI must run `bun run build` before `bun run test`)", () => {
      expect(built).toBe(true);
    });
  });
} else {
  describe.skipIf(!built)("the optional peer, absent for real", () => {
    it("reports unsupported, with the install command, when axe cannot be resolved", () => {
      const result = probe(consumer(false));

      expect(result.peer).toBe("absent");
      expect(result.status).toBe("unsupported");
      expect(result.reason).toContain("npm install --save-dev axe-core");
      expect(result.total).toBe(0);
    });

    it("loads the peer in the same consumer once it is installed", () => {
      // Non-vacuity: proves the test above fails because axe is missing, not
      // because the consumer can't import the package at all.
      const result = probe(consumer(true));

      expect(result.peer).toBe("resolved");
      expect(result.status).not.toBe("unsupported");
      expect(result.reason).toBeNull();
    });
  });
}
