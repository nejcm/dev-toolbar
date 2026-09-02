import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_CSS } from "../css";

const stylesheet = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("core stylesheet", () => {
  it("stays identical to the shipped styles.css", () => {
    expect(CORE_CSS).toBe(stylesheet);
  });

  it("positions with logical properties so the bar and overflow popup mirror under RTL", () => {
    // left/right/margin-left/margin-right/padding-left/padding-right would pin to a
    // physical side regardless of dir="rtl"; inset-inline(-start|-end) and friends
    // flip automatically. No exceptions today — whitelist any future one here with
    // a comment saying why it is direction-agnostic.
    expect(CORE_CSS).not.toMatch(
      /\bleft:|\bright:|margin-left|margin-right|padding-left|padding-right/,
    );
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
