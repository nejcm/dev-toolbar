import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_CSS } from "../css";

const stylesheet = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("core stylesheet", () => {
  it("stays identical to the shipped styles.css", () => {
    expect(CORE_CSS).toBe(stylesheet);
  });
});
