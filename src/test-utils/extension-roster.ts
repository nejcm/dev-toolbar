/**
 * Shared by tests that enumerate first-party extensions: reads the source
 * tree and package exports so a new extension cannot disappear from one test
 * suite. `shared` and `__tests__` are support directories, not extensions.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const NOT_AN_EXTENSION = new Set(["shared", "__tests__"]);
const STYLELESS = new Set(["agent"]);

export interface ExtensionRoster {
  onDisk: string[];
  published: string[];
  withStyles: string[];
}

export function extensionRoster(): ExtensionRoster {
  const onDisk = readdirSync(resolve(root, "src/ext"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !NOT_AN_EXTENSION.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
    exports: Record<string, unknown>;
  };
  const published = Object.keys(manifest.exports)
    .filter((key) => key.startsWith("./ext/"))
    .map((key) => key.slice("./ext/".length))
    .sort();
  const missingExports = onDisk.filter((name) => !published.includes(name));
  const missingDirectories = published.filter((name) => !onDisk.includes(name));

  if (missingExports.length > 0 || missingDirectories.length > 0) {
    const details = [
      missingExports.length > 0
        ? `package.json is missing exports for src/ext/${missingExports.join(", src/ext/")}`
        : null,
      missingDirectories.length > 0
        ? `src/ext is missing directories for package.json exports ${missingDirectories.join(", ")}`
        : null,
    ].filter((detail): detail is string => detail !== null);
    throw new Error(`Extension roster mismatch: ${details.join("; ")}`);
  }

  const hasStyles = (name: string): boolean => existsSync(resolve(root, "src/ext", name, "css.ts"));
  const missingStyleless = [...STYLELESS].filter((name) => !onDisk.includes(name));
  const stylelessWithStyles = onDisk.filter((name) => STYLELESS.has(name) && hasStyles(name));
  const styledWithoutStyles = onDisk.filter((name) => !STYLELESS.has(name) && !hasStyles(name));

  if (
    missingStyleless.length > 0 ||
    stylelessWithStyles.length > 0 ||
    styledWithoutStyles.length > 0
  ) {
    const details = [
      missingStyleless.length > 0
        ? `STYLELESS names missing from src/ext: ${missingStyleless.join(", ")}`
        : null,
      stylelessWithStyles.length > 0
        ? `styleless extensions with css.ts: ${stylelessWithStyles.join(", ")}`
        : null,
      styledWithoutStyles.length > 0
        ? `styled extensions without css.ts: ${styledWithoutStyles.join(", ")}`
        : null,
    ].filter((detail): detail is string => detail !== null);
    throw new Error(`Extension style classification mismatch: ${details.join("; ")}`);
  }

  return {
    onDisk,
    published,
    withStyles: onDisk.filter((name) => !STYLELESS.has(name)),
  };
}
