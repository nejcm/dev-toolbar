/**
 * Per-entrypoint size report for `dist/`.
 *
 * The naive form of this report -- `find dist -name '*.js' | wc -c`, which is
 * what the sugarwork-ui action it descends from does -- is actively misleading
 * for this package. tsup code-splits the ESM build: `dist/index.js` is 1.5 KB
 * of re-exports in front of a 49 KB shared chunk, and `dist/ext/metrics.js`
 * pulls a different one. Reporting the entry files alone would say every entry
 * costs nothing; reporting the directory total would hide a regression in one
 * extension inside an aggregate. Neither is the number a consumer pays.
 *
 * So each entry is measured as the transitive closure of its own relative
 * imports -- the entry file plus every chunk it can reach -- which is exactly
 * the set a bundler pulls in when an app imports that subpath and nothing else.
 * Source maps are excluded: they are published but never loaded at runtime.
 *
 * Entries come from `package.json` `exports` rather than a second hardcoded
 * list, so a new subpath appears in the report the moment it is publishable.
 */
import { gzipSync } from "node:zlib";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/**
 * Relative specifiers in every form the bundlers emit: `from "./x"`,
 * `import "./x"`, `require("./x")` and `import("./x")`.
 *
 * The dynamic-`import(` alternative is load-bearing even though `dist/` has no
 * relative dynamic import today. The moment a lazy `import()` lands in `src/`,
 * tsup emits a relative dynamic chunk — and a scanner that missed it would
 * silently under-report the one entry that had just grown a large lazy chunk,
 * which is exactly the regression this table exists to catch.
 */
const RELATIVE_SPECIFIER = /(?:from|import|require\(|import\()\s*["'](\.[^"']*)["']/g;

/**
 * Files reachable from `entryFile` by following relative specifiers. Returns
 * absolute paths including the entry itself. Cycles terminate on the seen set;
 * a missing target is skipped rather than thrown, since a `dist/` that fails to
 * resolve is the build's problem to report, not this script's.
 */
const closure = (entryFile) => {
  const seen = new Set();
  const queue = [entryFile];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    seen.add(file);
    for (const [, specifier] of source.matchAll(RELATIVE_SPECIFIER)) {
      // `"."` and other extensionless self-references are re-export markers
      // esbuild leaves behind; only real emitted files carry an extension.
      if (!/\.(?:js|cjs|mjs|css)$/.test(specifier)) continue;
      queue.push(resolve(dirname(file), specifier));
    }
  }
  return [...seen];
};

/** Raw and gzipped byte totals for a set of files, or null if none exist. */
const measure = (files) => {
  const buffers = [];
  for (const file of files) {
    try {
      buffers.push(readFileSync(file));
    } catch {
      /* absent condition (e.g. a css-only entry has no .cjs) */
    }
  }
  if (buffers.length === 0) return null;
  const raw = Buffer.concat(buffers);
  // Gzip the concatenation rather than summing per-file gzip: a bundler
  // compresses one output, so per-file sums over-report by a chunk's worth of
  // dictionary each time.
  return { raw: raw.length, gzip: gzipSync(raw, { level: 9 }).length };
};

const size = (file) => {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
};

/**
 * `exports` values are either a conditions object (`{ types, import, require }`)
 * or a bare path (`./styles.css`). `./package.json` is not a shipped artifact.
 */
const entries = Object.entries(pkg.exports)
  .filter(([subpath]) => subpath !== "./package.json")
  .map(([subpath, value]) => {
    const conditions = typeof value === "string" ? { import: value } : value;
    const abs = (p) => (p ? resolve(root, p) : undefined);
    return {
      name: subpath === "." ? pkg.name : subpath.replace(/^\.\//, ""),
      esm: abs(conditions.import),
      cjs: abs(conditions.require),
      types: abs(conditions.types),
    };
  });

const iec = (bytes) => {
  if (bytes === 0) return "—";
  const units = ["B", "KB", "MB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
};

const rows = entries.map((entry) => {
  // A closure of length 0 means the entry file itself is absent — an unbuilt or
  // half-built `dist/`. Reported as dashes rather than as a crash, so the step
  // still produces a summary on a run where the build is what failed.
  const esmFiles = entry.esm ? closure(entry.esm) : [];
  return {
    name: entry.name,
    esm: measure(esmFiles),
    cjs: entry.cjs ? measure(closure(entry.cjs)) : null,
    types: size(entry.types ?? ""),
    chunks: Math.max(esmFiles.length - 1, 0),
  };
});

const lines = [
  "| Entry | gzip | raw | Chunks | CJS raw | Types |",
  "| --- | --: | --: | --: | --: | --: |",
];
for (const row of rows) {
  lines.push(
    `| \`${row.name}\` | ${iec(row.esm?.gzip ?? 0)} | ${iec(row.esm?.raw ?? 0)} | ${
      row.chunks
    } | ${iec(row.cjs?.raw ?? 0)} | ${iec(row.types)} |`,
  );
}

console.log(lines.join("\n"));
console.log("");
console.log(
  "`gzip`/`raw` measure the `import` condition (ESM, or the stylesheet for " +
    "`styles.css`); `Chunks` is how many shared chunks that entry drags in " +
    "alongside its own file. Each figure is a transitive closure, so a shared " +
    "chunk is counted once per entry that reaches it and the rows deliberately " +
    "do not sum to a directory total. Source maps are excluded — they ship in " +
    "the tarball but are never loaded at runtime.",
);
