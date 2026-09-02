/**
 * Per-entrypoint size report for `dist/`.
 *
 * Naive `find dist -name '*.js' | wc -c` is misleading here because tsup
 * code-splits the ESM build (e.g. `dist/index.js` is a thin re-export in
 * front of a large shared chunk). So each entry is measured as the transitive
 * closure of its own relative imports -- the set a bundler actually pulls in
 * for that subpath. Source maps are excluded (published but never loaded).
 *
 * Entries come from `package.json` `exports`, not a hardcoded list, so a new
 * subpath appears automatically once it's publishable.
 */
import { gzipSync } from "node:zlib";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/**
 * Matches relative specifiers in every form bundlers emit: `from "./x"`,
 * `import "./x"`, `require("./x")`, `import("./x")`. Dynamic `import(` is
 * kept even though nothing uses it today, so a future lazy chunk doesn't
 * silently go unreported.
 *
 * The leading `(?<![\w$.])` prevents matching identifier suffixes like
 * `reimport(...)` or `obj.import(...)`, which would over-report size by
 * attributing a chunk to an entry that never imports it.
 *
 * This is a regex over text, not a parser, so it could follow a specifier
 * written inside a comment -- accepted since esbuild's banner comments don't
 * start with `.` and this only ever scans built output, not hand-written src.
 */
const RELATIVE_SPECIFIER = /(?<![\w$.])(?:from|import|require\(|import\()\s*["'](\.[^"']*)["']/g;

/**
 * Files reachable from `entryFile` via relative specifiers (absolute paths,
 * entry included). Missing targets are skipped rather than thrown -- a broken
 * `dist/` is the build's problem to report, not this script's.
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
      // Extensionless specifiers (e.g. ".") are esbuild re-export markers, not real files.
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
      /* condition may not apply, e.g. a css-only entry has no .cjs */
    }
  }
  if (buffers.length === 0) return null;
  const raw = Buffer.concat(buffers);
  // Gzip the concatenation, not a sum of per-file gzips, to match how a bundler
  // actually compresses one output (per-file sums over-report the dictionary cost).
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
 * `exports` values are either a bare path (`./styles.css`) or a conditions
 * object, and each condition may itself be a path or a nested
 * `{ types, default }` object -- both forms are handled here. `./package.json`
 * is excluded as it's not a shipped artifact.
 */
const entries = Object.entries(pkg.exports)
  .filter(([subpath]) => subpath !== "./package.json")
  .map(([subpath, value]) => {
    const conditions = typeof value === "string" ? { import: value } : value;
    const abs = (p) => (p ? resolve(root, p) : undefined);
    const target = (condition) =>
      abs(typeof condition === "string" ? condition : condition?.default);
    const types = (condition) => (typeof condition === "string" ? undefined : condition?.types);
    return {
      name: subpath === "." ? pkg.name : subpath.replace(/^\.\//, ""),
      esm: target(conditions.import),
      cjs: target(conditions.require),
      // ESM declarations, falling back to a top-level `types`.
      types: abs(types(conditions.import) ?? conditions.types),
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
  // An empty closure means the entry file is missing (unbuilt/half-built dist/);
  // reported as dashes rather than a crash, so a failed build still gets a summary.
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
