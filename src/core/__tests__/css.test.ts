import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_CSS } from "../css";

const stylesheet = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("core stylesheet", () => {
  it("stays identical to the shipped styles.css", () => {
    expect(CORE_CSS).toBe(stylesheet);
  });

  it("puts every rule inside the dev-toolbar layer, scoped by the attribute", () => {
    expect(CORE_CSS.trimStart()).toContain("@layer dev-toolbar {");
    const selectors = CORE_CSS.match(/^\s{2}\[[^\n]*\{$/gm) ?? [];
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector).toContain("[data-dev-toolbar]");
    }
  });
});
