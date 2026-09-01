/**
 * The rule that keeps the layering honest: **core may not import from
 * `runtime/` or `ext/`.**
 *
 * Asserting that against the source is necessary but not sufficient — a
 * transitive import through a third module, or a shared chunk the bundler
 * decides to hoist, would slip past a grep. So this walks the *built* graph:
 * it follows `dist/index.js`'s imports into every chunk it reaches and looks
 * for strings that only exist in `runtime/` and the `ext/*` subpaths.
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
  "[dev-toolbar/ext/flags]",
  "[dev-toolbar/ext/command-menu]",
  "[dev-toolbar/ext/overlays]",
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
      expect(readFileSync(`${root}dist/ext/flags.cjs`, "utf8")).toContain(
        EXT_MARKERS[2] as string,
      );
      expect(
        readFileSync(`${root}dist/ext/command-menu.cjs`, "utf8"),
      ).toContain(EXT_MARKERS[3] as string);
      expect(readFileSync(`${root}dist/ext/overlays.cjs`, "utf8")).toContain(
        EXT_MARKERS[4] as string,
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
      // Three now: /ext/flags must drag in neither of the other two.
      const flagsBundle = readFileSync(`${root}dist/ext/flags.cjs`, "utf8");
      expect(flagsBundle).not.toContain(EXT_MARKERS[0] as string);
      expect(flagsBundle).not.toContain(EXT_MARKERS[1] as string);
      // Four. /ext/command-menu reads the aggregation, which is core's, so it
      // must not end up carrying the extensions that produce it.
      const menuBundle = readFileSync(
        `${root}dist/ext/command-menu.cjs`,
        "utf8",
      );
      for (const marker of EXT_MARKERS.slice(0, 3)) {
        expect(menuBundle, marker).not.toContain(marker);
      }
      // Five. /ext/overlays is the first extension that draws over the host
      // page; it must not drag any of the others along for the ride.
      const overlaysBundle = readFileSync(
        `${root}dist/ext/overlays.cjs`,
        "utf8",
      );
      for (const marker of EXT_MARKERS.slice(0, 4)) {
        expect(overlaysBundle, marker).not.toContain(marker);
      }
      expect(menuBundle).not.toContain(EXT_MARKERS[4] as string);
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
      expect(pkg.exports["./ext/flags"]).toEqual({
        types: "./dist/ext/flags.d.ts",
        import: "./dist/ext/flags.js",
        require: "./dist/ext/flags.cjs",
      });
      expect(pkg.exports["./ext/command-menu"]).toEqual({
        types: "./dist/ext/command-menu.d.ts",
        import: "./dist/ext/command-menu.js",
        require: "./dist/ext/command-menu.cjs",
      });
      expect(pkg.exports["./ext/overlays"]).toEqual({
        types: "./dist/ext/overlays.d.ts",
        import: "./dist/ext/overlays.js",
        require: "./dist/ext/overlays.cjs",
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
        "dist/ext/flags.js",
        "dist/ext/flags.cjs",
        "dist/ext/command-menu.js",
        "dist/ext/command-menu.cjs",
        "dist/ext/overlays.js",
        "dist/ext/overlays.cjs",
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
      expect(readFileSync(`${root}dist/ext/flags.d.ts`, "utf8")).toContain(
        "FlagsOptions",
      );
      expect(
        readFileSync(`${root}dist/ext/command-menu.d.ts`, "utf8"),
      ).toContain("CommandMenuOptions");
      expect(readFileSync(`${root}dist/ext/overlays.d.ts`, "utf8")).toContain(
        "OverlaysOptions",
      );
    });

    it("resolves through Node's own exports map", () => {
      const names = node(
        `const r = await import("@nejcm/dev-toolbar/runtime");` +
          `const m = await import("@nejcm/dev-toolbar/ext/metrics");` +
          `const e = await import("@nejcm/dev-toolbar/ext/environment");` +
          `const f = await import("@nejcm/dev-toolbar/ext/flags");` +
          `const c = await import("@nejcm/dev-toolbar/ext/command-menu");` +
          `const o = await import("@nejcm/dev-toolbar/ext/overlays");` +
          `console.log(JSON.stringify({ runtime: Object.keys(r).sort(), metrics: Object.keys(m).sort(), environment: Object.keys(e).sort(), flags: Object.keys(f).sort(), commandMenu: Object.keys(c).sort(), overlays: Object.keys(o).sort() }));`,
      );
      const result = JSON.parse(names) as {
        runtime: string[];
        metrics: string[];
        environment: string[];
        flags: string[];
        commandMenu: string[];
        overlays: string[];
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
      expect(result.flags).toEqual(
        expect.arrayContaining([
          "flags",
          "createFlagsRuntime",
          "readStoredOverrides",
          "FLAGS_CSS",
        ]),
      );
      expect(result.commandMenu).toEqual(
        expect.arrayContaining([
          "commandMenu",
          "createCommandMenuRuntime",
          "filterCommands",
          "COMMAND_MENU_CSS",
        ]),
      );
      expect(result.overlays).toEqual(
        expect.arrayContaining([
          "overlays",
          "createOverlaysRuntime",
          "setHostOutlines",
          "OVERLAYS_CSS",
          "BOXES_CSS",
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

      // And /ext/flags, whose per-flag commands are enumerated in the factory
      // from a snapshot built there — so that build must also survive Node.
      // /ext/flags now declares `commands` as a *function* — the P2 contract
      // change — so the shape of what it returns is asserted by calling it.
      const flags = node(
        `const { flags } = await import("@nejcm/dev-toolbar/ext/flags");` +
          `const ext = flags({ flags: [{ key: "a", type: "boolean", defaultValue: false }], onOverride: () => {} });` +
          `console.log(JSON.stringify({ id: ext.id, commands: ext.commands().map(c => c.id) }));`,
      );
      expect(JSON.parse(flags)).toEqual({
        id: "flags",
        commands: [
          "flags.toggle.a",
          "flags.clearOverrides",
          "flags.copyRecipe",
          "flags.copyJson",
          "flags.refresh",
        ],
      });

      // /ext/command-menu is the one extension that contributes nothing: it
      // reads the aggregation instead of adding to it, and its surface is the
      // overlay slot rather than a panel.
      const menu = node(
        `const { commandMenu } = await import("@nejcm/dev-toolbar/ext/command-menu");` +
          `const ext = commandMenu();` +
          `console.log(JSON.stringify({ id: ext.id, commands: ext.commands ?? null, overlay: typeof ext.overlay, panel: typeof ext.panel }));`,
      );
      expect(JSON.parse(menu)).toEqual({
        id: "command-menu",
        commands: null,
        overlay: "function",
        panel: "undefined",
      });

      // /ext/overlays draws over the DOM, so importing it *without* one is the
      // interesting case: the factory must build the store, enumerate its
      // toggle commands and touch no document until start(api) runs.
      const drawn = node(
        `const { overlays } = await import("@nejcm/dev-toolbar/ext/overlays");` +
          `const ext = overlays({ defaults: { boxes: true } });` +
          `console.log(JSON.stringify({ id: ext.id, commands: ext.commands().map(c => c.id), overlay: typeof ext.overlay, active: ext.commands().length }));`,
      );
      expect(JSON.parse(drawn)).toEqual({
        id: "overlays",
        commands: [
          "overlays.toggle.boxes",
          "overlays.toggle.grid",
          "overlays.toggle.inspect",
          "overlays.toggle.focus",
          "overlays.disableAll",
        ],
        overlay: "function",
        active: 5,
      });
    });
  });
}
