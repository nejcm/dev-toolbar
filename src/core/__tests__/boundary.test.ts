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

/** Only ever present in a `src/runtime/*` or `src/ext/*` module. */
const RUNTIME_MARKER = "[dev-toolbar/runtime]";
const EXT_MARKERS = [
  "[dev-toolbar/ext/metrics]",
  "[dev-toolbar/ext/environment]",
];

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
        for (const marker of EXT_MARKERS) {
          expect(source, `${file} / ${marker}`).not.toContain(marker);
        }
      }
    });

    it("pulls none into the CommonJS root entry either", () => {
      const source = readFileSync(`${root}dist/index.cjs`, "utf8");
      expect(source).not.toContain(RUNTIME_MARKER);
      for (const marker of EXT_MARKERS) {
        expect(source, marker).not.toContain(marker);
      }
    });

    it("does contain the markers where they belong, so the check can fail", () => {
      expect(readFileSync(`${root}dist/runtime.cjs`, "utf8")).toContain(
        RUNTIME_MARKER,
      );
      expect(readFileSync(`${root}dist/ext/metrics.cjs`, "utf8")).toContain(
        EXT_MARKERS[0] as string,
      );
      expect(readFileSync(`${root}dist/ext/environment.cjs`, "utf8")).toContain(
        EXT_MARKERS[1] as string,
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

    it("keeps one extension out of another's bundle", () => {
      // Two extensions on two subpaths: neither should drag the other in, or
      // adding a second chip would quietly cost the first one's collectors.
      expect(
        readFileSync(`${root}dist/ext/environment.cjs`, "utf8"),
      ).not.toContain(EXT_MARKERS[0] as string);
      expect(readFileSync(`${root}dist/ext/metrics.cjs`, "utf8")).not.toContain(
        EXT_MARKERS[1] as string,
      );
    });

    it("declares ./runtime and the ./ext/* entries explicitly, with no wildcards", () => {
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
      expect(pkg.exports["./ext/environment"]).toEqual({
        types: "./dist/ext/environment.d.ts",
        import: "./dist/ext/environment.js",
        require: "./dist/ext/environment.cjs",
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
        "dist/ext/environment.js",
        "dist/ext/environment.cjs",
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
      expect(
        readFileSync(`${root}dist/ext/environment.d.ts`, "utf8"),
      ).toContain("EnvironmentOptions");
    });

    it("resolves through Node's own exports map", () => {
      const names = node(
        `const r = await import("@nejcm/dev-toolbar/runtime");` +
          `const m = await import("@nejcm/dev-toolbar/ext/metrics");` +
          `const e = await import("@nejcm/dev-toolbar/ext/environment");` +
          `console.log(JSON.stringify({ runtime: Object.keys(r).sort(), metrics: Object.keys(m).sort(), environment: Object.keys(e).sort() }));`,
      );
      const result = JSON.parse(names) as {
        runtime: string[];
        metrics: string[];
        environment: string[];
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
      expect(result.environment).toEqual(
        expect.arrayContaining([
          "environment",
          "createEnvironmentRuntime",
          "ENVIRONMENT_CSS",
        ]),
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

      // Same for /ext/environment, whose snapshot is built in the factory and
      // must therefore survive having no `window` to detect anything from.
      const env = node(
        `const { environment } = await import("@nejcm/dev-toolbar/ext/environment");` +
          `const ext = environment({ context: { environment: "production", userId: "a@b.io" } });` +
          `console.log(JSON.stringify({ id: ext.id, commands: ext.commands.map(c => c.id) }));`,
      );
      expect(JSON.parse(env)).toEqual({
        id: "environment",
        commands: [
          "environment.copy",
          "environment.copyJson",
          "environment.refresh",
        ],
      });
    });
  });
}
