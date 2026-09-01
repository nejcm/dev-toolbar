/**
 * The rule that keeps the layering honest: **core may not import from
 * `runtime/` or `ext/`.**
 *
 * Asserting that against the source is necessary but not sufficient — a
 * transitive import through a third module, or a shared chunk the bundler
 * decides to hoist, would slip past a grep. So this walks the *built* graph:
 * it follows `dist/index.js`'s imports into every chunk it reaches and looks
 * for strings that only exist in `runtime/` and `ext/metrics/`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = `${process.cwd().replace(/\/$/, "")}/`;
const pkg = JSON.parse(readFileSync(`${root}package.json`, "utf8")) as {
  exports: Record<string, unknown>;
};

/** Only ever present in a `src/runtime/*` or `src/ext/metrics/*` module. */
const RUNTIME_MARKER = "[dev-toolbar/runtime]";
const EXT_MARKER = "[dev-toolbar/ext/metrics]";

function sourceFiles(directory: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name)) output.push(path);
  }
  return output;
}

describe("core boundary (source)", () => {
  it("never imports a value from runtime/ or ext/", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(resolve(root, "src/core"))) {
      const source = readFileSync(file, "utf8");
      // `import type` would erase, but core has no business referencing these
      // at all, so the check does not carve out an exception for it.
      for (const match of source.matchAll(
        /from\s+["']([^"']+)["']/g,
      )) {
        const specifier = match[1] as string;
        if (/(^|\/)(runtime|ext)(\/|$)/.test(specifier)) {
          offenders.push(`${file} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps /testing off runtime/ and ext/ too, so it works before they exist", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(resolve(root, "src/testing"))) {
      for (const match of readFileSync(file, "utf8").matchAll(
        /from\s+["'](\.\.?\/[^"']+)["']/g,
      )) {
        const specifier = match[1] as string;
        if (/(^|\/)(runtime|ext)(\/|$)/.test(specifier)) {
          offenders.push(`${file} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

const built = existsSync(`${root}dist/index.js`);
const mustBeBuilt = Boolean(process.env["CI"]);

if (!built && mustBeBuilt) {
  describe("core boundary (built)", () => {
    it("has a dist/ to check (CI must run `npm run build` before `npm test`)", () => {
      expect(built).toBe(true);
    });
  });
} else {
  describe.skipIf(!built)("core boundary (built)", () => {
    /** Every file reachable from `entry` through relative ESM imports. */
    const reachable = (entry: string): string[] => {
      const seen = new Set<string>();
      const queue = [resolve(root, entry)];
      while (queue.length > 0) {
        const file = queue.pop() as string;
        if (seen.has(file) || !existsSync(file)) continue;
        seen.add(file);
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(
          /(?:from|import|require)\s*\(?\s*["'](\.[^"']+)["']/g,
        )) {
          queue.push(resolve(dirname(file), match[1] as string));
        }
      }
      return [...seen];
    };

    it("pulls no runtime/ or ext/ code into the root entry, chunks included", () => {
      const graph = reachable("dist/index.js");
      // The split build must actually have produced a chunk to follow, or this
      // assertion would pass vacuously on a single-file bundle.
      expect(graph.length).toBeGreaterThan(1);
      for (const file of graph) {
        const source = readFileSync(file, "utf8");
        expect(source, file).not.toContain(RUNTIME_MARKER);
        expect(source, file).not.toContain(EXT_MARKER);
      }
    });

    it("pulls none into the CommonJS root entry either", () => {
      const source = readFileSync(`${root}dist/index.cjs`, "utf8");
      expect(source).not.toContain(RUNTIME_MARKER);
      expect(source).not.toContain(EXT_MARKER);
    });

    it("does contain the markers where they belong, so the check can fail", () => {
      expect(readFileSync(`${root}dist/runtime.cjs`, "utf8")).toContain(
        RUNTIME_MARKER,
      );
      expect(readFileSync(`${root}dist/ext/metrics.cjs`, "utf8")).toContain(
        EXT_MARKER,
      );
    });
  });
}

if (built || !mustBeBuilt) {
  describe.skipIf(!built)("subpath entries", () => {
    const node = (source: string) =>
      execFileSync(process.execPath, ["--input-type=module", "-e", source], {
        cwd: root,
        encoding: "utf8",
      }).trim();

    it("declares ./runtime and ./ext/metrics explicitly, with no wildcards", () => {
      expect(pkg.exports["./runtime"]).toEqual({
        types: "./dist/runtime.d.ts",
        import: "./dist/runtime.js",
        require: "./dist/runtime.cjs",
      });
      expect(pkg.exports["./ext/metrics"]).toEqual({
        types: "./dist/ext/metrics.d.ts",
        import: "./dist/ext/metrics.js",
        require: "./dist/ext/metrics.cjs",
      });
      expect(Object.keys(pkg.exports).some((key) => key.includes("*"))).toBe(
        false,
      );
    });

    it('emits both formats with a "use client" banner and its own .d.ts', () => {
      for (const file of [
        "dist/runtime.js",
        "dist/runtime.cjs",
        "dist/ext/metrics.js",
        "dist/ext/metrics.cjs",
      ]) {
        expect(
          readFileSync(`${root}${file}`, "utf8").startsWith('"use client";'),
          file,
        ).toBe(true);
      }
      // Shared chunks carry it too, or the directive would be lost for any
      // consumer that reaches the code through one.
      for (const file of readdirSync(`${root}dist`)) {
        if (!/^chunk-.*\.js$/.test(file)) continue;
        expect(
          readFileSync(`${root}dist/${file}`, "utf8").startsWith('"use client";'),
          file,
        ).toBe(true);
      }
      expect(readFileSync(`${root}dist/runtime.d.ts`, "utf8")).toContain(
        "createRingBuffer",
      );
      expect(readFileSync(`${root}dist/ext/metrics.d.ts`, "utf8")).toContain(
        "MetricsOptions",
      );
    });

    it("resolves through Node's own exports map", () => {
      const names = node(
        `const r = await import("@nejcm/dev-toolbar/runtime");` +
          `const m = await import("@nejcm/dev-toolbar/ext/metrics");` +
          `console.log(JSON.stringify({ runtime: Object.keys(r).sort(), metrics: Object.keys(m).sort() }));`,
      );
      const result = JSON.parse(names) as {
        runtime: string[];
        metrics: string[];
      };
      expect(result.runtime).toEqual(
        expect.arrayContaining([
          "createEventBus",
          "createRingBuffer",
          "createThrottledStore",
          "redact",
        ]),
      );
      expect(result.metrics).toEqual(
        expect.arrayContaining(["metrics", "createMetricsRuntime"]),
      );
    });

    it("builds a working extension object outside a DOM", () => {
      // /ext/metrics must import cleanly in Node: an extension is a plain
      // object, and only its slots need a browser.
      const output = node(
        `const { metrics } = await import("@nejcm/dev-toolbar/ext/metrics");` +
          `const ext = metrics({ only: ["memory"] });` +
          `console.log(JSON.stringify({ id: ext.id, commands: ext.commands.map(c => c.id) }));`,
      );
      expect(JSON.parse(output)).toEqual({
        id: "metrics",
        commands: ["metrics.reset", "metrics.copy"],
      });
    });
  });
}
