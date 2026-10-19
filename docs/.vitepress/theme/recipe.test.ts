// @vitest-environment node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import pkg from "../../../package.json";
import { describe, expect, it } from "vitest";
import { EXTENSIONS, FRAMEWORKS, buildRecipe } from "./recipe";
import type { Framework, RecipeOptions } from "./recipe";

const root = fileURLToPath(new URL("../../..", import.meta.url));
// Never written to disk: it only has to sit inside the repo so `react` resolves from node_modules.
const virtualRoot = join(root, ".recipe-check");

const appStub = `export default function App() { return null; }\n`;

const all = EXTENSIONS.map((ext) => ext.id);
const selections = [[], all, ...all.map((id) => [id])];
const cases: RecipeOptions[] = FRAMEWORKS.flatMap(({ id: framework }) =>
  selections.flatMap((extensions) =>
    [true, false].map((lazy) => ({ framework, extensions, lazy })),
  ),
);

function caseName({ framework, extensions, lazy }: RecipeOptions) {
  const what = extensions.length === all.length ? "all" : extensions.join("+") || "none";
  return `${framework}-${what}-${lazy ? "lazy" : "eager"}`;
}

const frameworkTypes: Record<Framework, string[]> = {
  vite: ["node", "vite/client"],
  next: ["node"],
};

const sourcePaths: ts.CompilerOptions = {
  baseUrl: root,
  paths: {
    "@nejcm/dev-toolbar": ["./src/index.ts"],
    "@nejcm/dev-toolbar/ext/*": ["./src/ext/*/index.tsx"],
    "@nejcm/dev-toolbar/runtime": ["./src/runtime/index.ts"],
    "@nejcm/dev-toolbar/kit": ["./src/kit/index.ts"],
  },
};

function typecheck(framework: Framework, resolution: ts.CompilerOptions) {
  const files = new Map<string, string>();
  for (const options of cases.filter((c) => c.framework === framework)) {
    const dir = join(virtualRoot, caseName(options));
    for (const file of buildRecipe(options).files) files.set(join(dir, file.path), file.code);
    if (options.framework === "vite") files.set(join(dir, "src/App.tsx"), appStub);
  }

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    noUncheckedIndexedAccess: true,
    skipLibCheck: true,
    noEmit: true,
    types: frameworkTypes[framework],
    ...resolution,
  };
  const host = ts.createCompilerHost(options);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (name) => files.has(name) || fileExists(name);
  host.readFile = (name) => files.get(name) ?? readFile(name);
  host.directoryExists = (name) => name.startsWith(virtualRoot) || ts.sys.directoryExists(name);
  host.getSourceFile = (name, version, ...rest) => {
    const text = files.get(name);
    return text === undefined
      ? getSourceFile(name, version, ...rest)
      : ts.createSourceFile(name, text, version);
  };

  const program = ts.createProgram([...files.keys()], options, host);
  const errors = [...files.keys()].flatMap((name) => {
    const source = program.getSourceFile(name);
    return source
      ? [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)]
      : [];
  });

  expect(
    errors.map((d) => {
      const where = d.file ? d.file.fileName.slice(virtualRoot.length + 1) : "";
      return `${where}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`;
    }),
  ).toEqual([]);
}

it.each(FRAMEWORKS)(
  "every $name recipe typechecks against the source",
  ({ id: framework }) => typecheck(framework, sourcePaths),
  60_000,
);

const built = existsSync(join(root, "dist/index.d.ts"));
const mustBeBuilt = Boolean(process.env["CI"]) && !process.env["RECIPE_SKIP_DIST"];

if (!built && mustBeBuilt) {
  describe("recipes against the published types", () => {
    it("has a dist/ to check (CI must run `bun run build` before `bun run test`)", () => {
      expect(built).toBe(true);
    });
  });
} else {
  describe.skipIf(!built)("recipes against the published types", () => {
    // No `paths`: the package resolves itself through `exports` to dist/*.d.ts.
    it.each(FRAMEWORKS)(
      "every $name recipe typechecks against dist",
      ({ id: framework }) => typecheck(framework, {}),
      60_000,
    );
  });
}

it("imports only published entry points", () => {
  const published = new Set(
    Object.keys(pkg.exports).map((key) => key.replace(/^\./, "@nejcm/dev-toolbar")),
  );
  const specifiers = cases.flatMap((options) =>
    buildRecipe(options).files.flatMap((file) =>
      [...file.code.matchAll(/from "(@nejcm\/dev-toolbar[^"]*)"/g)].map((match) => match[1]),
    ),
  );
  expect(specifiers.filter((specifier) => !published.has(specifier!))).toEqual([]);
});

it("adds a peer to the install line only for the extension that needs it", () => {
  expect(buildRecipe({ framework: "vite", extensions: ["metrics"], lazy: true }).install).toBe(
    "npm install @nejcm/dev-toolbar",
  );
  expect(buildRecipe({ framework: "vite", extensions: ["a11y"], lazy: true }).install).toBe(
    "npm install @nejcm/dev-toolbar axe-core",
  );
});
