import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { auditEmbedGuards, styleRules } from "../../test-utils/css-rules";
import { CORE_CSS } from "../css";

const stylesheet = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("core stylesheet", () => {
  it("stays identical to the shipped styles.css", () => {
    expect(CORE_CSS).toBe(stylesheet);
  });

  /**
   * The structural half of the `data-dtb-embed` promise in docs/embedding.md.
   * `src/kit/__tests__/embed.test.tsx` proves the guard *works*, by matching
   * core's rules against a vendor DOM — but only against the elements that
   * fixture happens to contain, so a new unguarded rule naming an element it
   * does not have would pass unnoticed. This one needs no fixture: it reads
   * every selector core ships and rejects any that styles a descendant by
   * element rather than by a `data-dtb-*` attribute without the guard, naming
   * it. Between them, the fixture says the mechanism holds and this says the
   * mechanism is applied everywhere.
   */
  describe("no element-level descendant default reaches an embedded subtree", () => {
    it("guards every one of them", () => {
      const audit = auditEmbedGuards(CORE_CSS);

      expect(audit.unguarded).toEqual([]);

      // Not vacuous: the sheet parsed, and the rules the guard exists for were
      // classified as element-level rather than sorted into an exempt bucket.
      expect(styleRules(CORE_CSS).length).toBeGreaterThan(40);
      expect(audit.keyed.length).toBeGreaterThan(20);
      expect(audit.guarded).toEqual(
        expect.arrayContaining([
          // box-sizing on every descendant, the button face, field geometry,
          // and both focus rings — one per category the docs list.
          "[data-dev-toolbar] :where(:not([data-dtb-embed] *))",
          "[data-dev-toolbar] :where(menu, ol, ul):where(:not([data-dtb-embed] *))",
          "[data-dev-toolbar] :where(button):where(:not([data-dtb-embed] *))",
          "[data-dev-toolbar] :where(select):where(:not([data-dtb-embed] *))",
          '[data-dev-toolbar] :where(a, button, summary, [role="button"], [tabindex]):where(:not([data-dtb-embed] *)):focus-visible',
          "[data-dev-toolbar] :where(input, select, textarea):where(:not([data-dtb-embed] *)):focus-visible",
        ]),
      );
    });

    /**
     * Mutation test: the invariant above is only worth having if it fails.
     * Each probe is a shape a future core rule could plausibly take — a bare
     * element default, and one nested under a part that *is* an ancestor of
     * the embed frame — and each must be named in the failure.
     */
    it.each([
      ["a bare element default", "[data-dev-toolbar] :where(table) { margin: 0; }"],
      [
        "an element default under a part",
        '[data-dev-toolbar] [data-dtb-part="panel-body"] > p { margin-top: 4px; }',
      ],
      ["a state rule on an element", "[data-dev-toolbar] summary:hover { color: red; }"],
    ])("flags %s", (_name, rule) => {
      const mutated = CORE_CSS.replace("@layer dev-toolbar {", `@layer dev-toolbar {\n  ${rule}\n`);
      expect(mutated).not.toBe(CORE_CSS);

      const audit = auditEmbedGuards(mutated);

      expect(audit.unguarded).toEqual([rule.slice(0, rule.indexOf("{")).trim()]);
    });

    /** And fails closed on a sheet it cannot classify rather than passing it. */
    it("refuses a selector it cannot place", () => {
      const mutated = CORE_CSS.replace(
        "@layer dev-toolbar {",
        "@layer dev-toolbar {\n  .some-global { margin: 0; }\n",
      );
      expect(() => auditEmbedGuards(mutated)).toThrow(/not scoped by \[data-dev-toolbar\]/);
      expect(() => styleRules("@unknown-at-rule x { a { color: red } }")).toThrow(
        /unrecognised at-rule/,
      );
    });
  });
});
