import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const NOT_AN_EXTENSION = new Set(["shared", "__tests__"]);

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

  return {
    onDisk,
    published,
    withStyles: onDisk.filter((name) => existsSync(resolve(root, "src/ext", name, "css.ts"))),
  };
}
