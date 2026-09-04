/**
 * The root entry's export list, pinned against the documentation.
 *
 * Every name `src/index.ts` exports is a semver commitment, and an export
 * nobody wrote down is the worst kind: it binds the package without ever
 * having been offered to anyone. So the rule is mechanical — if it is
 * exported, it is written down in the README or in `docs/api.md` — and this
 * test is what makes it a gate rather than an intention.
 *
 * The list is read out of the source rather than restated here on purpose. A
 * hand-maintained copy of the surface is a second thing to forget, and the
 * failure it hides ("we added an export") is the one worth catching.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as root from "@nejcm/dev-toolbar";

const repo = `${process.cwd().replace(/\/$/, "")}/`;
const source = readFileSync(`${repo}src/index.ts`, "utf8");
/**
 * The consumer-facing documentation set. The README is the introduction and
 * `docs/api.md` is the full reference for this entry, so an export is
 * documented if it appears in either.
 */
const docs = [`${repo}README.md`, `${repo}docs/api.md`]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

/** `export { a, b }` / `export type { A, B }`, with the aliases stripped. */
function exportedNames(onlyTypes: boolean): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/export\s+(type\s+)?\{([^}]*)\}/g)) {
    if (Boolean(match[1]) !== onlyTypes) continue;
    for (const entry of (match[2] as string).split(",")) {
      const name = entry
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) names.push(name);
    }
  }
  return names.sort();
}

const values = exportedNames(false);
const types = exportedNames(true);

describe("root entry surface", () => {
  it("is a barrel, so the parser above sees the whole surface", () => {
    // A declaration in `src/index.ts` would be exported without appearing in
    // any `export { … }` block, and every assertion below would miss it. The
    // type-level forms matter as much as the value ones: an `export interface`
    // written here would be just as public and just as undocumented.
    expect(source).not.toMatch(
      // `\b(?!\s*\{)` so the legitimate `export type { … }` re-export block
      // below is not read as a `type X =` declaration.
      /^export\s+(const|let|var|function|class|async|type|interface|enum|declare|namespace)\b(?!\s*\{)/m,
    );
    expect(source).not.toMatch(/^export\s+(default|\*)/m);
    expect(values.length).toBeGreaterThan(0);
    expect(types.length).toBeGreaterThan(0);
  });

  it("exports exactly what the source says, at runtime", () => {
    expect(Object.keys(root).sort()).toEqual(values);
  });

  it("documents every export in the README or docs/api.md", () => {
    const undocumented = [...values, ...types].filter(
      (name) => !new RegExp(`\\b${name}\\b`).test(docs),
    );
    // If this fails: either write the export a line in docs/api.md § Other
    // exports (or § Types), or stop exporting it. Both are fine; leaving it undocumented
    // is not — see the file comment.
    expect(undocumented).toEqual([]);
  });

  it("keeps the aggregation helpers off the public surface", () => {
    // `collectCommands`, `resolveExtensionCommands` and `collectDiagnostics`
    // only ever see the array they are handed, which is never the merged list
    // the toolbar renders — props plus dynamic registrations, `hidden` removed.
    // Extensions read the aggregation through `api.getCommands()` /
    // `api.getDiagnostics()`, the host through `useToolbarCommands()` /
    // `useDevToolbar().getCommands()`. Re-exporting one of these from the root
    // advertises a staler answer under the same name; documenting it would not
    // make it a better one.
    for (const name of ["collectCommands", "resolveExtensionCommands", "collectDiagnostics"]) {
      expect(values, name).not.toContain(name);
      expect(root, name).not.toHaveProperty(name);
    }
    // `runCommand` stays: it resolves against the mounted toolbars at call
    // time, so it is the documented no-context path.
    expect(values).toContain("runCommand");
  });
});
