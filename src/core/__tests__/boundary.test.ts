/**
 * The rule that keeps the layering honest: **core may not import from
 * `runtime/`, `kit/` or `ext/`.**
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

/**
 * Core's own message prefix. Trailing space, no slash: it matches core's
 * `[dev-toolbar] ...` messages and not `[dev-toolbar/testing]` or
 * `[dev-toolbar/runtime]`, which makes it a marker for *core code* rather than
 * for any one construct inside it.
 */
const CORE_PREFIX = "[dev-toolbar] ";

/** Only ever present in a `src/runtime/*` or `src/ext/*` module. */
const RUNTIME_MARKER = "[dev-toolbar/runtime]";
const EXT_MARKERS = [
  "[dev-toolbar/ext/metrics]",
  "[dev-toolbar/ext/environment]",
  "[dev-toolbar/ext/flags]",
  "[dev-toolbar/ext/command-menu]",
  "[dev-toolbar/ext/overlays]",
  "[dev-toolbar/ext/diagnostics]",
  "[dev-toolbar/ext/theme-editor]",
  // Appended, never inserted: the indices below are positional.
  "[dev-toolbar/ext/agent]",
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

function moduleSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(/from\s+["']([^"']+)["']/g),
    ...source.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g),
    ...source.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']/g),
  ].map((match) => match[1] as string);
}

/** One or more `../`, then the guarded source directory. */
const RELATIVE_CORE = String.raw`(?:\.\.\/)+core\/[^"']+`;
const RELATIVE_KIT = String.raw`(?:\.\.\/)+kit(?:\/[^"']+)?`;
const PACKAGE_ROOT = String.raw`@nejcm\/dev-toolbar`;
const PACKAGE_KIT = String.raw`@nejcm\/dev-toolbar\/kit(?:\/[^"']+)?`;

/**
 * Every *value* import matching a relative path pattern in one source file.
 * `import type` and a wholly `{ type A, type B }` clause erase to nothing, so
 * they are not value imports and are deliberately not reported.
 *
 * Exported shape rather than an inline regex because the forms it has to cover
 * are the point — `__tests__` below asserts each of them, so a blind spot fails
 * a test rather than passing review.
 */
function valueImportsMatching(source: string, target: string): string[] {
  const found: string[] = [];

  // 1. `import ... from "…"` / `export ... from "…"`, with a binding clause.
  //    The clause may not contain a quote or a semicolon, or it would run past
  //    the end of its own statement into a later one's specifier.
  for (const match of source.matchAll(
    new RegExp(
      String.raw`(?:^|\n)\s*(?:import|export)\s+(?!type\s)([^"';]*?)from\s+["'](${target})["']`,
      "g",
    ),
  )) {
    const names = (match[1] as string)
      .replace(/[{}]/g, "")
      .split(",")
      .map((name) => name.trim());
    // `import { type A, type B } from "../core/x"` is type-only in effect.
    if (names.some((name) => name.length > 0 && !name.startsWith("type "))) {
      found.push(match[2] as string);
    }
  }

  // 2. Side-effect import: no binding at all, but the module still runs and is
  //    still inlined, so it is still a second copy of core.
  for (const match of source.matchAll(
    new RegExp(String.raw`(?:^|\n)\s*import\s+["'](${target})["']`, "g"),
  )) {
    found.push(match[1] as string);
  }

  // 3. `import("…")` and `require("…")`, which carry no clause to inspect and
  //    are invisible to pattern 1.
  for (const match of source.matchAll(
    new RegExp(String.raw`\b(?:import|require)\s*\(\s*["'](${target})["']`, "g"),
  )) {
    found.push(match[1] as string);
  }

  return found;
}

const coreValueImports = (source: string): string[] => valueImportsMatching(source, RELATIVE_CORE);
const kitValueImports = (source: string): string[] => [
  ...valueImportsMatching(source, RELATIVE_KIT),
  ...valueImportsMatching(source, PACKAGE_KIT),
];
const outsideCoreLayer = (specifier: string): boolean =>
  /(^|\/)(runtime|kit|ext)(\/|$)/.test(specifier);

describe("core boundary (source)", () => {
  it("never imports from runtime/, kit/ or ext/", () => {
    const files = sourceFiles(resolve(root, "src/core")).filter(
      // This file contains forbidden-import fixtures for the scanner's meta-tests.
      (file) => file !== resolve(root, "src/core/__tests__/boundary.test.ts"),
    );
    const offenders: string[] = [];
    for (const file of files) {
      for (const specifier of moduleSpecifiers(readFileSync(file, "utf8"))) {
        if (outsideCoreLayer(specifier)) {
          offenders.push(`${file} -> ${specifier}`);
        }
      }
    }
    expect(files.length).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });

  it("detects every import form that can cross core's layer", () => {
    for (const source of [
      'import type { Severity } from "../kit";',
      'import { matchesQuery } from "../kit/query";',
      'import "../kit";',
      'void import("../kit/query");',
      'const kit = require("../kit");',
    ]) {
      expect(moduleSpecifiers(source).some(outsideCoreLayer), source).toBe(true);
    }
    expect(moduleSpecifiers('import { storage } from "../storage";').some(outsideCoreLayer)).toBe(
      false,
    );
  });

  it("keeps /testing off runtime/, kit/ and ext/", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(resolve(root, "src/testing"))) {
      for (const specifier of moduleSpecifiers(readFileSync(file, "utf8"))) {
        if (outsideCoreLayer(specifier)) {
          offenders.push(`${file} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("detects every import form forbidden in /testing", () => {
    for (const source of [
      'import { parseRecord } from "@nejcm/dev-toolbar/kit";',
      'import "../kit";',
      'void import("@nejcm/dev-toolbar/runtime");',
      'const flags = require("@nejcm/dev-toolbar/ext/flags");',
    ]) {
      expect(moduleSpecifiers(source).some(outsideCoreLayer), source).toBe(true);
    }
    expect(
      moduleSpecifiers('import { DevToolbar } from "@nejcm/dev-toolbar";').some(outsideCoreLayer),
    ).toBe(false);
  });

  it("never value-imports a relative path into core/ from /testing", () => {
    // The rule that makes one core instance possible. CJS output has no code
    // splitting, so a *value* import of `../core/x` is inlined into
    // `dist/testing.cjs`: the consumer gets a second core, a second React
    // context, and a `useDevToolbar()` that throws inside
    // `renderWithToolbar()`. `import type` erases and carries no identity, so
    // it stays allowed.
    const offenders: string[] = [];
    for (const file of sourceFiles(resolve(root, "src/testing"))) {
      // `__tests__/` is exempt: nothing there is a tsup entry, so none of it
      // reaches `dist/`. `__tests__/heightVariable.test.ts` in particular has to
      // import core's originals — comparing them with the re-derived copies is
      // its whole job.
      if (/(^|\/)__tests__\//.test(file)) continue;
      for (const specifier of coreValueImports(readFileSync(file, "utf8"))) {
        offenders.push(`${file} -> ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);

    // The scan must actually have looked at something, or the exemption above
    // could silently grow to cover the whole directory.
    expect(
      sourceFiles(resolve(root, "src/testing")).filter((file) => !/(^|\/)__tests__\//.test(file))
        .length,
    ).toBeGreaterThan(1);
  });

  it("detects every form a value import can take", () => {
    // The check above is a regex over source, so its blind spots are the whole
    // risk: a form it cannot see is a form that can reintroduce the bug
    // silently. Each of these is a value import of core and must be caught.
    for (const source of [
      'import { DevToolbar } from "../core/DevToolbar";',
      'import DevToolbar from "../core/DevToolbar";',
      'import * as core from "../core/DevToolbar";',
      // Side-effect only: no binding, but the module still runs and is inlined.
      'import "../core/styles";',
      // Deeper than one level up — `src/testing/nested/x.ts`.
      'import { createMemoryStorage } from "../../core/storage";',
      // Dynamic, which the static-clause pattern cannot see at all.
      'const core = await import("../core/storage");',
      'void import("../../core/storage");',
      // CommonJS: catches `require()` calls inside `.ts`/`.tsx` sources.
      'const { createMemoryStorage } = require("../core/storage");',
      // Re-exports: `export *` and a named re-export both bind values.
      'export * from "../core/storage";',
      'export { createMemoryStorage } from "../core/storage";',
      // A type-only clause with one value smuggled in alongside it.
      'import { type DevToolbarProps, DevToolbar } from "../core/DevToolbar";',
    ]) {
      expect(coreValueImports(source), source).not.toEqual([]);
    }

    // And each of these must not be caught: types erase, and a sibling module
    // or the package's own specifier is not a relative path into core.
    for (const source of [
      'import type { DevToolbarProps } from "../core/DevToolbar";',
      'import { type A, type B } from "../core/contract";',
      'export type { ToolbarCommand } from "../core/contract";',
      'export type * from "../core/contract";',
      'import { DevToolbar } from "@nejcm/dev-toolbar";',
      'import { installToolbarLayout } from "./layout";',
      // A mention in prose must not trip it.
      '// never import from "../core/storage" directly',
    ]) {
      expect(coreValueImports(source), source).toEqual([]);
    }
  });

  it("detects relative kit value imports but allows types and the package specifier", () => {
    const from = (clause: string, specifier: string): string =>
      `${clause} from ${JSON.stringify(specifier)};`;
    for (const source of [
      from("import { parseRecord }", "../../kit"),
      from("export { matchesQuery }", "../kit/query"),
      'const kit = await import("../../../kit");',
      'const kit = require("../../kit/poller");',
    ]) {
      expect(valueImportsMatching(source, RELATIVE_KIT), source).not.toEqual([]);
    }

    for (const source of [
      from("import type { Severity }", "../../kit"),
      from("import { type Severity }", "../../kit"),
      from("import { parseRecord }", "@nejcm/dev-toolbar/kit"),
    ]) {
      expect(valueImportsMatching(source, RELATIVE_KIT), source).toEqual([]);
    }
  });
});

describe("runtime boundary (source)", () => {
  const files = sourceFiles(resolve(root, "src/runtime")).filter(
    (file) => !/(^|\/)__tests__\//.test(file),
  );

  it("never value-imports kit", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const specifier of kitValueImports(readFileSync(file, "utf8"))) {
        offenders.push(`${file} -> ${specifier}`);
      }
    }
    expect(files.length).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });

  it("detects runtime-to-kit value imports and allows erased or sibling imports", () => {
    for (const source of [
      'import { parseRecord } from "../kit";',
      'export { matchesQuery } from "../../kit/query";',
      'const kit = await import("@nejcm/dev-toolbar/kit");',
      'const poller = require("@nejcm/dev-toolbar/kit/poller");',
    ]) {
      expect(kitValueImports(source), source).not.toEqual([]);
    }

    for (const source of [
      'import type { Severity } from "../kit";',
      'import { type Severity } from "@nejcm/dev-toolbar/kit";',
      'import { createRingBuffer } from "./ringBuffer";',
      'import type { ToolbarStorage } from "../core/contract";',
    ]) {
      expect(kitValueImports(source), source).toEqual([]);
    }
  });
});

describe("extension kit (source)", () => {
  /**
   * The kit is shared by first-party and third-party extensions, so it is held
   * to the same rules as the eight extensions:
   * no extension marker (the dist scan below reads markers as proof one
   * bundle does not carry another's code), no core message prefix, no value
   * import of core, and nothing reaching sideways into a sibling extension.
   *
   * Everything here is expressed with path strings and `readFileSync`, never
   * an import: this file lives under `src/core`, whose own scan above rejects
   * any specifier naming `runtime`, `kit` or `ext`.
   */
  const kitDirectory = resolve(root, "src/kit");
  const extDirectory = resolve(root, "src/ext");
  const files = sourceFiles(kitDirectory).filter((file) => !/(^|\/)__tests__\//.test(file));
  const reachesExtension = (file: string, specifier: string): boolean => {
    if (!specifier.startsWith(".")) return /(^|\/)ext\//.test(specifier);
    return resolve(dirname(file), specifier).startsWith(`${extDirectory}/`);
  };

  it("has files to check", () => {
    // A rename that empties the directory must fail here rather than pass
    // every assertion below vacuously.
    expect(files.length).toBeGreaterThan(0);
  });

  it("carries no extension or core marker", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const marker of EXT_MARKERS) {
        if (source.includes(marker)) offenders.push(`${file} -> ${marker}`);
      }
      if (source.includes(CORE_PREFIX)) offenders.push(`${file} -> ${CORE_PREFIX}`);
    }
    expect(offenders).toEqual([]);
  });

  it("never value-imports core relatively or through the package root", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const specifier of [
        ...coreValueImports(source),
        ...valueImportsMatching(source, PACKAGE_ROOT),
      ]) {
        offenders.push(`${file} -> ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("detects package-root value imports but allows type imports", () => {
    const from = (clause: string): string =>
      `${clause} from ${JSON.stringify("@nejcm/dev-toolbar")};`;
    expect(valueImportsMatching(from("import { createMemoryStorage }"), PACKAGE_ROOT)).toEqual([
      "@nejcm/dev-toolbar",
    ]);
    expect(valueImportsMatching(from("import type { ToolbarStorage }"), PACKAGE_ROOT)).toEqual([]);
  });

  it("never reaches into a sibling extension", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const specifier of moduleSpecifiers(readFileSync(file, "utf8"))) {
        if (reachesExtension(file, specifier)) offenders.push(`${file} -> ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("detects every import form that can reach an extension", () => {
    const file = resolve(kitDirectory, "example.ts");
    for (const source of [
      'import type { FlagValue } from "../ext/flags";',
      'import { flags } from "../ext/flags";',
      'import "../ext/flags";',
      'void import("../ext/flags");',
      'const flags = require("../ext/flags");',
      'import { flags } from "@nejcm/dev-toolbar/ext/flags";',
    ]) {
      expect(
        moduleSpecifiers(source).some((value) => reachesExtension(file, value)),
        source,
      ).toBe(true);
    }
  });
});

describe("extension boundary (source)", () => {
  it("never value-imports a relative path into core or kit", () => {
    const files = sourceFiles(resolve(root, "src/ext")).filter(
      (file) => !/(^|\/)__tests__\//.test(file),
    );
    const offenders: string[] = [];
    for (const file of files) {
      for (const specifier of coreValueImports(readFileSync(file, "utf8"))) {
        offenders.push(`${file} -> ${specifier}`);
      }
      for (const specifier of valueImportsMatching(readFileSync(file, "utf8"), RELATIVE_KIT)) {
        offenders.push(`${file} -> ${specifier}`);
      }
    }

    expect(files.length).toBeGreaterThan(10);
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
      // `./testing` used to be the only other reader of core, which put core in
      // a shared chunk this walk had to follow. It now reaches core through the
      // package's own specifier — external, so `dist/index.js` is self-contained
      // and this graph is a single file. The non-vacuity guard therefore moves
      // to an entry that does still share a chunk, which is what proves the walk
      // follows imports rather than passing for free on one file.
      expect(graph.length).toBeGreaterThan(0);
      expect(reachable("dist/ext/metrics.js").length).toBeGreaterThan(1);
      for (const file of graph) {
        const source = readFileSync(file, "utf8");
        expect(source, file).not.toContain(RUNTIME_MARKER);
        for (const marker of EXT_MARKERS) {
          expect(source, `${file} / ${marker}`).not.toContain(marker);
        }
      }
    });

    it("makes the CommonJS /testing entry require the main entry, not inline core", () => {
      // The regression this guards: `dist/testing.cjs` used to carry its own
      // copy of core, so a CommonJS consumer mixing `.` and `./testing` got two
      // of everything. Verified in a real CJS consumer by
      // `test/fixtures/jest-consumer/shared-instance.test.js`; asserted on the
      // bytes here so it fails on `bun run test` rather than only in the
      // fixture.
      //
      // The primary invariant is the pair below: /testing must *reach* the main
      // entry, and must not contain core's own message prefix. `CORE_PREFIX`
      // has a trailing space and no slash, so it matches core's messages and not
      // /testing's `[dev-toolbar/testing]` ones — it is a marker for core code
      // in general rather than for a React context in particular, which is what
      // makes it catch core inlined *without* a context too.
      const cjs = readFileSync(`${root}dist/testing.cjs`, "utf8");
      expect(cjs).toContain('require("@nejcm/dev-toolbar")');
      expect(cjs).not.toContain(CORE_PREFIX);
      // And the ESM entry, where code splitting could equally have inlined it.
      const esm = readFileSync(`${root}dist/testing.js`, "utf8");
      expect(esm).toContain('from "@nejcm/dev-toolbar"');
      expect(esm).not.toContain(CORE_PREFIX);
      // Second line of defence, not the invariant: drop it without ceremony if
      // /testing ever legitimately creates a context of its own.
      expect(cjs).not.toContain("createContext");
      expect(esm).not.toContain("createContext");
    });

    it("finds core's marker where it belongs, so the check above can fail", () => {
      // `not.toContain` over a string that appears nowhere would pass forever.
      expect(readFileSync(`${root}dist/index.cjs`, "utf8")).toContain(CORE_PREFIX);
      expect(readFileSync(`${root}dist/index.js`, "utf8")).toContain(CORE_PREFIX);
      // And the prefix must not match /testing's own messages, or the assertion
      // would fail for the wrong reason the moment one of them is reworded.
      expect(readFileSync(`${root}dist/testing.cjs`, "utf8")).toContain("[dev-toolbar/testing]");
    });

    it("pulls none into the CommonJS root entry either", () => {
      const source = readFileSync(`${root}dist/index.cjs`, "utf8");
      expect(source).not.toContain(RUNTIME_MARKER);
      for (const marker of EXT_MARKERS) {
        expect(source, marker).not.toContain(marker);
      }
    });

    it("does contain the markers where they belong, so the check can fail", () => {
      expect(readFileSync(`${root}dist/runtime.cjs`, "utf8")).toContain(RUNTIME_MARKER);
      expect(readFileSync(`${root}dist/ext/metrics.cjs`, "utf8")).toContain(
        EXT_MARKERS[0] as string,
      );
      expect(readFileSync(`${root}dist/ext/environment.cjs`, "utf8")).toContain(
        EXT_MARKERS[1] as string,
      );
      expect(readFileSync(`${root}dist/ext/flags.cjs`, "utf8")).toContain(EXT_MARKERS[2] as string);
      expect(readFileSync(`${root}dist/ext/command-menu.cjs`, "utf8")).toContain(
        EXT_MARKERS[3] as string,
      );
      expect(readFileSync(`${root}dist/ext/overlays.cjs`, "utf8")).toContain(
        EXT_MARKERS[4] as string,
      );
      expect(readFileSync(`${root}dist/ext/diagnostics.cjs`, "utf8")).toContain(
        EXT_MARKERS[5] as string,
      );
      expect(readFileSync(`${root}dist/ext/theme-editor.cjs`, "utf8")).toContain(
        EXT_MARKERS[6] as string,
      );
      expect(readFileSync(`${root}dist/ext/agent.cjs`, "utf8")).toContain(EXT_MARKERS[7] as string);
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
      expect(readFileSync(`${root}dist/ext/environment.cjs`, "utf8")).not.toContain(
        EXT_MARKERS[0] as string,
      );
      expect(readFileSync(`${root}dist/ext/metrics.cjs`, "utf8")).not.toContain(
        EXT_MARKERS[1] as string,
      );
      // Three now: /ext/flags must drag in neither of the other two.
      const flagsBundle = readFileSync(`${root}dist/ext/flags.cjs`, "utf8");
      expect(flagsBundle).not.toContain(EXT_MARKERS[0] as string);
      expect(flagsBundle).not.toContain(EXT_MARKERS[1] as string);
      // Four. /ext/command-menu reads the aggregation, which is core's, so it
      // must not end up carrying the extensions that produce it.
      const menuBundle = readFileSync(`${root}dist/ext/command-menu.cjs`, "utf8");
      for (const marker of EXT_MARKERS.slice(0, 3)) {
        expect(menuBundle, marker).not.toContain(marker);
      }
      // Five. /ext/overlays is the first extension that draws over the host
      // page; it must not drag any of the others along for the ride.
      const overlaysBundle = readFileSync(`${root}dist/ext/overlays.cjs`, "utf8");
      for (const marker of EXT_MARKERS.slice(0, 4)) {
        expect(overlaysBundle, marker).not.toContain(marker);
      }
      expect(menuBundle).not.toContain(EXT_MARKERS[4] as string);
      // Six. /ext/diagnostics is the second reader of a core aggregation, and
      // the one whose whole job is to report on the others — so it is the most
      // likely of the lot to drag one in. It must not: a consumer who wants a
      // bug-report button should not thereby ship a flag editor.
      const diagnosticsBundle = readFileSync(`${root}dist/ext/diagnostics.cjs`, "utf8");
      for (const marker of EXT_MARKERS.slice(0, 5)) {
        expect(diagnosticsBundle, marker).not.toContain(marker);
      }
      for (const bundle of [flagsBundle, menuBundle, overlaysBundle]) {
        expect(bundle).not.toContain(EXT_MARKERS[5] as string);
      }
      // Seven. /ext/theme-editor writes to the host document, which makes it
      // the one a consumer is most likely to adopt on its own; adding a token
      // editor must not thereby ship a flag editor, a palette or a profiler.
      const themeBundle = readFileSync(`${root}dist/ext/theme-editor.cjs`, "utf8");
      for (const marker of EXT_MARKERS.slice(0, 6)) {
        expect(themeBundle, marker).not.toContain(marker);
      }
      for (const bundle of [flagsBundle, menuBundle, overlaysBundle, diagnosticsBundle]) {
        expect(bundle).not.toContain(EXT_MARKERS[6] as string);
      }

      // Eight. /ext/agent publishes core's aggregations on a global. It reads
      // them through `api`, so it must carry none of the extensions that
      // produce them — a bridge is a transport, and a transport that ships a
      // flag editor is not one.
      const agentBundle = readFileSync(`${root}dist/ext/agent.cjs`, "utf8");
      for (const marker of EXT_MARKERS.slice(0, 7)) {
        expect(agentBundle, marker).not.toContain(marker);
      }
      for (const bundle of [
        flagsBundle,
        menuBundle,
        overlaysBundle,
        diagnosticsBundle,
        themeBundle,
      ]) {
        expect(bundle).not.toContain(EXT_MARKERS[7] as string);
      }

      for (const [name, bundle] of [
        ["metrics", readFileSync(`${root}dist/ext/metrics.cjs`, "utf8")],
        ["environment", readFileSync(`${root}dist/ext/environment.cjs`, "utf8")],
        ["flags", flagsBundle],
        ["command-menu", menuBundle],
        ["overlays", overlaysBundle],
        ["diagnostics", diagnosticsBundle],
        ["theme-editor", themeBundle],
        ["agent", agentBundle],
      ] as const) {
        expect(bundle, name).not.toContain(CORE_PREFIX);
      }
    });

    it("declares the root, ./runtime, ./kit and the ./ext/* entries explicitly, with no wildcards", () => {
      // Per-condition `types`, not one shared `types` key. A single
      // `./dist/*.d.ts` resolves as ESM under `require` too, which tells a
      // CommonJS consumer the package is ESM and breaks every type in it.
      // `src/testing/__tests__/exports.test.ts` asserts `./testing` the same way.
      const subpaths = [
        ".",
        "./runtime",
        "./kit",
        "./ext/metrics",
        "./ext/environment",
        "./ext/flags",
        "./ext/command-menu",
        "./ext/overlays",
        "./ext/diagnostics",
        "./ext/theme-editor",
        "./ext/agent",
      ];
      for (const subpath of subpaths) {
        const base = subpath === "." ? "./dist/index" : `./dist/${subpath.replace(/^\.\//, "")}`;
        expect(pkg.exports[subpath], subpath).toEqual({
          import: { types: `${base}.d.ts`, default: `${base}.js` },
          require: { types: `${base}.d.cts`, default: `${base}.cjs` },
        });
      }
      expect(Object.keys(pkg.exports).some((key) => key.includes("*"))).toBe(false);
    });

    it('emits both formats with a "use client" banner and its own .d.ts', () => {
      for (const file of [
        "dist/runtime.js",
        "dist/runtime.cjs",
        "dist/kit.js",
        "dist/kit.cjs",
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
        "dist/ext/diagnostics.js",
        "dist/ext/diagnostics.cjs",
        "dist/ext/theme-editor.js",
        "dist/ext/theme-editor.cjs",
        "dist/ext/agent.js",
        "dist/ext/agent.cjs",
      ]) {
        expect(readFileSync(`${root}${file}`, "utf8").startsWith('"use client";'), file).toBe(true);
      }
      // Shared chunks carry it too, or the directive would be lost for any
      // consumer that reaches the code through one.
      for (const file of readdirSync(`${root}dist`)) {
        if (!/^chunk-.*\.js$/.test(file)) continue;
        expect(readFileSync(`${root}dist/${file}`, "utf8").startsWith('"use client";'), file).toBe(
          true,
        );
      }
      expect(readFileSync(`${root}dist/runtime.d.ts`, "utf8")).toContain("createRingBuffer");
      expect(readFileSync(`${root}dist/kit.d.ts`, "utf8")).toContain("createPoller");
      expect(readFileSync(`${root}dist/kit.d.cts`, "utf8")).toContain("createPoller");
      expect(readFileSync(`${root}dist/ext/metrics.d.ts`, "utf8")).toContain("MetricsOptions");
      expect(readFileSync(`${root}dist/ext/environment.d.ts`, "utf8")).toContain(
        "EnvironmentOptions",
      );
      expect(readFileSync(`${root}dist/ext/flags.d.ts`, "utf8")).toContain("FlagsOptions");
      expect(readFileSync(`${root}dist/ext/command-menu.d.ts`, "utf8")).toContain(
        "CommandMenuOptions",
      );
      expect(readFileSync(`${root}dist/ext/overlays.d.ts`, "utf8")).toContain("OverlaysOptions");
      expect(readFileSync(`${root}dist/ext/diagnostics.d.ts`, "utf8")).toContain(
        "DiagnosticsOptions",
      );
      expect(readFileSync(`${root}dist/ext/theme-editor.d.ts`, "utf8")).toContain(
        "ThemeEditorOptions",
      );
      expect(readFileSync(`${root}dist/ext/agent.d.ts`, "utf8")).toContain("AgentBridgeOptions");
    });

    it("declares every subpath the plan promised, and nothing by wildcard", () => {
      // The closing check for P4: the delivery plan's `exports` map is `.`,
      // `./runtime`, `./kit`, `./testing`, `./styles.css` and one entry per `./ext/*`,
      // enumerated. Asserting the whole key set — rather than each key on its
      // own — is what makes a *missing* entry fail rather than only a wrong one.
      expect(Object.keys(pkg.exports).sort()).toEqual([
        ".",
        "./ext/agent",
        "./ext/command-menu",
        "./ext/diagnostics",
        "./ext/environment",
        "./ext/flags",
        "./ext/metrics",
        "./ext/overlays",
        "./ext/theme-editor",
        "./kit",
        "./package.json",
        "./runtime",
        "./styles.css",
        "./testing",
      ]);
    });

    it("resolves through Node's own exports map", () => {
      const names = node(
        `const r = await import("@nejcm/dev-toolbar/runtime");` +
          `const k = await import("@nejcm/dev-toolbar/kit");` +
          `const m = await import("@nejcm/dev-toolbar/ext/metrics");` +
          `const e = await import("@nejcm/dev-toolbar/ext/environment");` +
          `const f = await import("@nejcm/dev-toolbar/ext/flags");` +
          `const c = await import("@nejcm/dev-toolbar/ext/command-menu");` +
          `const o = await import("@nejcm/dev-toolbar/ext/overlays");` +
          `const d = await import("@nejcm/dev-toolbar/ext/diagnostics");` +
          `const t = await import("@nejcm/dev-toolbar/ext/theme-editor");` +
          `const a = await import("@nejcm/dev-toolbar/ext/agent");` +
          `console.log(JSON.stringify({ runtime: Object.keys(r).sort(), kit: Object.keys(k).sort(), metrics: Object.keys(m).sort(), environment: Object.keys(e).sort(), flags: Object.keys(f).sort(), commandMenu: Object.keys(c).sort(), overlays: Object.keys(o).sort(), diagnostics: Object.keys(d).sort(), themeEditor: Object.keys(t).sort(), agent: Object.keys(a).sort() }));`,
      );
      const result = JSON.parse(names) as {
        runtime: string[];
        kit: string[];
        metrics: string[];
        environment: string[];
        flags: string[];
        commandMenu: string[];
        overlays: string[];
        diagnostics: string[];
        themeEditor: string[];
        agent: string[];
      };
      expect(result.runtime).toEqual(
        expect.arrayContaining([
          "createEventBus",
          "createRingBuffer",
          "createThrottledStore",
          "redact",
        ]),
      );
      expect(result.kit).toEqual([
        "Action",
        "Banner",
        "Chip",
        "CopyButton",
        "EmptyState",
        "Field",
        "KIT_CSS",
        "Note",
        "Row",
        "Rows",
        "SearchField",
        "Select",
        "Tag",
        "TextInput",
        "createPoller",
        "createStyleInjector",
        "ensureKitStyles",
        "matchesQuery",
        "parseList",
        "parseRecord",
        "readJson",
        "resolveStyleNonce",
        "useCopyStatus",
        "useExtensionSurface",
        "writeJson",
      ]);
      expect(result.metrics).toEqual(expect.arrayContaining(["metrics", "createMetricsRuntime"]));
      expect(result.environment).toEqual(
        expect.arrayContaining(["environment", "createEnvironmentRuntime", "ENVIRONMENT_CSS"]),
      );
      expect(result.flags).toEqual(
        expect.arrayContaining(["flags", "createFlagsRuntime", "readStoredOverrides", "FLAGS_CSS"]),
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
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          "diagnostics",
          "createDiagnosticsRuntime",
          "createResponsivenessMonitor",
          "renderMarkdown",
          "DIAGNOSTICS_CSS",
        ]),
      );
      expect(result.themeEditor).toEqual(
        expect.arrayContaining([
          "themeEditor",
          "createThemeEditorRuntime",
          "readStoredThemeOverrides",
          "parseRecipe",
          "RESERVED_PREFIXES",
          "THEME_EDITOR_CSS",
        ]),
      );
      expect(result.agent).toEqual(
        expect.arrayContaining([
          "agentBridge",
          "createAgentHandle",
          "createAgentRegistry",
          "installAgentBridge",
          "DEFAULT_GLOBAL_NAME",
        ]),
      );
      expect(result.runtime).toEqual(
        expect.arrayContaining(["writeClipboardText", "writeClipboardTextOrThrow"]),
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
        commands: ["environment.copy", "environment.copyJson", "environment.refresh"],
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
          "flags.set",
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

      // /ext/diagnostics builds its runtime in the factory and starts a
      // PerformanceObserver only in start(api), so importing it in Node — which
      // has a PerformanceObserver but no document — must be inert and must
      // still produce a capturable snapshot that says what it could not read.
      const diag = node(
        `const { diagnostics } = await import("@nejcm/dev-toolbar/ext/diagnostics");` +
          `const { createDiagnosticsRuntime } = await import("@nejcm/dev-toolbar/ext/diagnostics");` +
          `const ext = diagnostics();` +
          `const snap = createDiagnosticsRuntime().capture();` +
          `console.log(JSON.stringify({ id: ext.id, commands: ext.commands.map(c => c.id), contributes: typeof ext.diagnostics, gathered: snap.toolbar.gathered, omissions: snap.omissions.length }));`,
      );
      expect(JSON.parse(diag)).toEqual({
        id: "diagnostics",
        commands: [
          "diagnostics.capture",
          "diagnostics.copy",
          "diagnostics.copyJson",
          "diagnostics.download",
        ],
        // It reads the aggregation, and contributes only a *summary* of its
        // own last capture — never the snapshot, which is built from the
        // aggregation and would embed one snapshot inside the next
        // (`plans/agent-readable-toolbar.md` § Phase 1). Its gather step skips
        // its own id, so the summary never reaches the bug report either.
        contributes: "function",
        gathered: false,
        omissions: 1,
      });

      // /ext/theme-editor writes to a document, so importing it *without* one
      // is the interesting case: the factory must build the store, enumerate
      // its commands and touch no document until start(api) runs.
      const theme = node(
        `const { themeEditor } = await import("@nejcm/dev-toolbar/ext/theme-editor");` +
          `const ext = themeEditor({ tokens: [{ name: "--brand-500", type: "color", value: "#fff" }, { name: "--dtb-bg", type: "color" }] });` +
          `console.log(JSON.stringify({ id: ext.id, commands: ext.commands().map(c => c.id), contributes: typeof ext.diagnostics, overlay: typeof ext.overlay }));`,
      );
      expect(JSON.parse(theme)).toEqual({
        id: "theme-editor",
        commands: [
          "theme-editor.setToken",
          "theme-editor.reset",
          "theme-editor.togglePreview",
          "theme-editor.copyCss",
          "theme-editor.copyRecipe",
          "theme-editor.copyFigma",
          "theme-editor.copyLink",
          "theme-editor.refresh",
        ],
        contributes: "function",
        overlay: "undefined",
      });
    });
  });
}
