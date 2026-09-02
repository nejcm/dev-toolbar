/**
 * End-to-end check of the published `./testing` subpath.
 *
 * The consumer test above proves the *module surface*; this one proves the
 * *package surface*: it asks Node itself — not Vite, not an alias — to resolve
 * `@nejcm/dev-toolbar/testing` through `package.json#exports` (self-reference)
 * and to actually import the built file.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// jsdom rewrites `import.meta.url` to an http: URL, so derive the repo root
// from the process instead. Vitest always runs from the config's directory.
const root = `${process.cwd().replace(/\/$/, "")}/`;
const pkg = JSON.parse(readFileSync(`${root}package.json`, "utf8")) as {
  exports: Record<string, unknown>;
  files: string[];
};

const built = existsSync(`${root}dist/testing.js`);
// Locally, a checkout that has not been built yet should not fail `npm test`.
// In CI it must: silently dropping the only end-to-end assertions about the
// published artefact is exactly the failure mode worth catching.
const mustBeBuilt = Boolean(process.env["CI"]);

// The exact, sorted `./testing` surface, asserted against both the ESM
// (`dist/testing.js`) and CJS (`dist/testing.cjs`) builds below. Exact
// equality, not arrayContaining: this test exists to prove the published
// package surface, so both an accidental removal and an accidental addition
// to the built output must fail it. `bun run verify` builds before testing,
// so this holds for the committed source too — but the assertion itself
// reads the built files, not `src/testing/index.ts` directly.
const EXPECTED_EXPORTS = [
  "cleanupToolbar",
  "createMemoryStorage",
  "createMockBus",
  "createNullStorage",
  "installToolbarLayout",
  "makeCommand",
  "makeExtension",
  "mountToolbar",
  "renderWithToolbar",
  "resetExtensionIds",
  "setTestingLibrary",
  "testingLibraryReady",
];

describe("package.json exports", () => {
  it("declares ./testing explicitly, with no wildcard subpaths", () => {
    // Per-condition `types`, for the reason spelled out in
    // `src/core/__tests__/boundary.test.ts`, which asserts every other subpath.
    expect(pkg.exports["./testing"]).toEqual({
      import: { types: "./dist/testing.d.ts", default: "./dist/testing.js" },
      require: { types: "./dist/testing.d.cts", default: "./dist/testing.cjs" },
    });
    expect(Object.keys(pkg.exports).some((key) => key.includes("*"))).toBe(false);
  });

  it("publishes neither the playground nor the Jest consumer fixture", () => {
    expect(pkg.files).not.toContain("examples");
    expect(pkg.files).not.toContain("test");
    expect(existsSync(`${root}examples/playground/package.json`)).toBe(true);
    expect(existsSync(`${root}test/fixtures/jest-consumer/package.json`)).toBe(true);
  });
});

if (!built && mustBeBuilt) {
  describe("built ./testing entry", () => {
    it("has a dist/ to check (CI must run `npm run build` before `npm test`)", () => {
      expect(built).toBe(true);
    });
  });
} else {
  describe.skipIf(!built)("built ./testing entry", () => {
    const node = (source: string, cwd: string = root) =>
      execFileSync(process.execPath, ["--input-type=module", "-e", source], {
        cwd,
        encoding: "utf8",
      }).trim();

    it("resolves and imports through Node's own exports map", () => {
      const names = node(
        `const m = await import("@nejcm/dev-toolbar/testing");` +
          `console.log(Object.keys(m).sort().join(","));`,
      );
      expect(names.split(",")).toEqual(EXPECTED_EXPORTS);
    });

    it("exposes the same surface through the require() (CJS) condition", () => {
      // `__esModule` is defined via `Object.defineProperty` with no
      // `enumerable: true`, so it defaults to non-enumerable and Node's own
      // `--input-type=commonjs` `require()` gives exactly the named exports —
      // no extra `__esModule` entry to filter out. Read the same way as the
      // ESM case above, so both conditions of the `require` entry
      // (`dist/testing.cjs`) are locked to the same list.
      const names = execFileSync(
        process.execPath,
        [
          "--input-type=commonjs",
          "-e",
          `const m = require("@nejcm/dev-toolbar/testing");` +
            `console.log(Object.keys(m).sort().join(","));`,
        ],
        { cwd: root, encoding: "utf8" },
      ).trim();
      expect(names.split(",")).toEqual(EXPECTED_EXPORTS);
    });

    it('emits its own .d.ts and a "use client" banner in both formats', () => {
      for (const file of ["dist/testing.js", "dist/testing.cjs"]) {
        expect(readFileSync(`${root}${file}`, "utf8").startsWith('"use client";')).toBe(true);
      }
      const types = readFileSync(`${root}dist/testing.d.ts`, "utf8");
      expect(types).toContain("renderWithToolbar");
      expect(types).toContain("MockClock");
    });

    it("never imports @testing-library/react statically", () => {
      // A static import is hoisted to the top of the bundle and makes the whole
      // subpath unimportable without the optional peer. A dynamic one does not.
      const source = readFileSync(`${root}dist/testing.js`, "utf8");
      expect(source).not.toMatch(/^\s*import[^;]*from\s*["']@testing-library\/react["']/m);
      expect(source).toContain('import("@testing-library/react")');
    });

    it("imports without @testing-library/react installed", () => {
      // A fixture outside the repo, holding a copy of dist plus react only, so
      // Node's upward resolution cannot reach this repo's own RTL.
      const fixture = mkdtempSync(join(tmpdir(), "dtb-no-rtl-"));
      try {
        const pkgDir = join(fixture, "node_modules", "@nejcm", "dev-toolbar");
        mkdirSync(pkgDir, { recursive: true });
        cpSync(`${root}dist`, join(pkgDir, "dist"), { recursive: true });
        writeFileSync(
          join(pkgDir, "package.json"),
          JSON.stringify({
            name: "@nejcm/dev-toolbar",
            version: "0.0.0",
            type: "module",
            exports: pkg.exports,
          }),
        );
        for (const dep of ["react", "react-dom"]) {
          symlinkSync(`${root}node_modules/${dep}`, join(fixture, "node_modules", dep), "dir");
        }
        writeFileSync(
          join(fixture, "package.json"),
          JSON.stringify({ name: "fixture", private: true, type: "module" }),
        );
        expect(existsSync(join(fixture, "node_modules", "@testing-library"))).toBe(false);

        const output = node(
          `const m = await import("@nejcm/dev-toolbar/testing");` +
            `const bus = m.createMockBus();` +
            `bus.clock.setTimeout(() => bus.emit("tick", 1), 10);` +
            `bus.clock.advance(20);` +
            `let message = "no-throw";` +
            `try { m.renderWithToolbar(); } catch (error) { message = error.message; }` +
            `console.log(JSON.stringify({` +
            `  ticks: bus.payloads("tick"),` +
            `  ext: m.makeExtension({ id: "x", label: "X" }).id,` +
            `  layout: typeof m.installToolbarLayout,` +
            `  message,` +
            `}));`,
          fixture,
        );
        const result = JSON.parse(output) as {
          ticks: number[];
          ext: string;
          layout: string;
          message: string;
        };

        // The DOM-free helpers work with no RTL anywhere on disk…
        expect(result.ticks).toEqual([1]);
        expect(result.ext).toBe("x");
        expect(result.layout).toBe("function");
        // …and the one helper that needs it says so, actionably.
        expect(result.message).toContain("@testing-library/react");
        expect(result.message).toContain("npm install --save-dev");
        // Both remedy forms, because the dynamic-import one is exactly what is
        // broken in the runner most likely to need the escape hatch.
        expect(result.message).toContain("setTestingLibrary(require('@testing-library/react'))");
        expect(result.message).toContain(
          "setTestingLibrary(await import('@testing-library/react'))",
        );
        expect(result.message).toContain("setupFilesAfterEnv");
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    });
  });
}
