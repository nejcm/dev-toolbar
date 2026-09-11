/**
 * The root entry's export list, pinned against the documentation. Every
 * export is a semver commitment, so the rule is mechanical: exported means
 * written down in the README or `docs/api.md`, and this test is the gate.
 * The list is read out of the source rather than restated here — a
 * hand-maintained copy of the surface is a second thing to forget.
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
    // A bare declaration would be exported without appearing in any
    // `export { … }` block, and every assertion below would miss it —
    // type-level forms (`export interface`) are just as public and undocumented.
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
    // only ever see the array they're handed, never the toolbar's merged list
    // (props + dynamic registrations, `hidden` removed) — that's read through
    // `api.getCommands()`/`api.getDiagnostics()` or `useToolbarCommands()`/
    // `useDevToolbar().getCommands()`. Re-exporting one of these would
    // advertise a staler answer under the same name.
    for (const name of ["collectCommands", "resolveExtensionCommands", "collectDiagnostics"]) {
      expect(values, name).not.toContain(name);
      expect(root, name).not.toHaveProperty(name);
    }
    // `runCommand` stays: it resolves against the mounted toolbars at call
    // time, so it is the documented no-context path.
    expect(values).toContain("runCommand");
  });
});
