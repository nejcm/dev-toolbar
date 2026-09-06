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
     * Each probe is a shape a future core rule could plausibly take, and each
     * must land in `unguarded` and be named. The second half of the list is
     * the set an earlier, substring-matching classifier waved through: a
     * `[data-dtb-*]` token inside a negation, inside one branch of a selector
     * list, or inside a quoted attribute value is not a condition the selected
     * element meets, and every one of these still matches a vendor element
     * beneath `[data-dtb-embed]`.
     */
    it.each([
      [
        "a bare element default",
        "[data-dev-toolbar] :where(table) { margin: 0; }",
        "[data-dev-toolbar] :where(table)",
      ],
      [
        "an element default under a part",
        '[data-dev-toolbar] [data-dtb-part="panel-body"] > p { margin-top: 4px; }',
        '[data-dev-toolbar] [data-dtb-part="panel-body"] > p',
      ],
      [
        "a state rule on an element",
        "[data-dev-toolbar] summary:hover { color: red; }",
        "[data-dev-toolbar] summary:hover",
      ],
      [
        "an attribute-only subject",
        "[data-dev-toolbar] [aria-label] { color: red; }",
        "[data-dev-toolbar] [aria-label]",
      ],
      [
        "a pseudo-element nested under @media",
        '@media (min-width: 1px) { [data-dev-toolbar] table::after { content: ""; } }',
        "[data-dev-toolbar] table::after",
      ],
      [
        "the unguarded branch of a selector list",
        "[data-dev-toolbar] :where(p):where(:not([data-dtb-embed] *)), [data-dev-toolbar] table { margin: 0; }",
        "[data-dev-toolbar] table",
      ],
      [
        "a data-dtb-* token inside :not()",
        "[data-dev-toolbar] table:not([data-dtb-kind]) { margin: 0; }",
        "[data-dev-toolbar] table:not([data-dtb-kind])",
      ],
      [
        "a data-dtb-* token in only one :is() branch",
        '[data-dev-toolbar] :is([data-dtb-kind="rows"], table) { margin: 0; }',
        '[data-dev-toolbar] :is([data-dtb-kind="rows"], table)',
      ],
      [
        "a [data-dev-toolbar] token inside :not()",
        "[data-dev-toolbar] table:not([data-dev-toolbar]) { margin: 0; }",
        "[data-dev-toolbar] table:not([data-dev-toolbar])",
      ],
      [
        "the guard in only one :is() branch",
        "[data-dev-toolbar] :is(:where(:not([data-dtb-embed] *)), table) { margin: 0; }",
        "[data-dev-toolbar] :is(:where(:not([data-dtb-embed] *)), table)",
      ],
      [
        "a data-dtb-* token inside a quoted attribute value",
        '[data-dev-toolbar] table[data-label="[data-dtb-fake]"] { margin: 0; }',
        '[data-dev-toolbar] table[data-label="[data-dtb-fake]"]',
      ],
    ])("flags %s", (_name, rule, flagged) => {
      const mutated = CORE_CSS.replace("@layer dev-toolbar {", `@layer dev-toolbar {\n  ${rule}\n`);
      expect(mutated).not.toBe(CORE_CSS);

      const audit = auditEmbedGuards(mutated);

      expect(audit.unguarded).toEqual([flagged]);
      // And the probe did not disturb how the real sheet is classified.
      const clean = auditEmbedGuards(CORE_CSS);
      expect(audit.root).toEqual(clean.root);
      expect(audit.keyed).toEqual(clean.keyed);
    });

    /**
     * A quoted value is text, not structure. Each of these hides a plain
     * element default between declarations whose values contain a comment
     * opener, a closing brace or a semicolon — shapes that a scanner stripping
     * comments by regex, or counting braces blindly, erases or mis-nests. The
     * rule then never reaches the audit at all and the sheet reads clean while
     * still styling a vendor `<table>` beneath `[data-dtb-embed]`. Each must
     * be scanned, reach `unguarded`, and be named.
     */
    it.each([
      [
        "a comment opener inside a quoted value",
        [
          '[data-dev-toolbar] { --probe-start: "/*"; }',
          "[data-dev-toolbar] table { color: rgb(1, 2, 3); }",
          '[data-dev-toolbar] { --probe-end: "*/"; }',
        ],
        3,
      ],
      [
        "a closing brace inside a quoted value",
        ['[data-dev-toolbar] { --probe: "}"; }', "[data-dev-toolbar] table { color: red; }"],
        2,
      ],
      [
        "a semicolon inside a quoted value",
        ['[data-dev-toolbar] { --probe: "; }"; }', "[data-dev-toolbar] table { color: red; }"],
        2,
      ],
    ])("scans past %s", (_name, rules, added) => {
      const mutated = CORE_CSS.replace(
        "@layer dev-toolbar {",
        `@layer dev-toolbar {\n  ${rules.join("\n  ")}\n`,
      );

      const audit = auditEmbedGuards(mutated);

      expect(audit.unguarded).toEqual(["[data-dev-toolbar] table"]);
      // Nothing was swallowed: every injected rule is still there to be seen.
      expect(styleRules(mutated)).toHaveLength(styleRules(CORE_CSS).length + added);
      expect(audit.keyed).toEqual(auditEmbedGuards(CORE_CSS).keyed);
    });

    /**
     * And fails closed at that level too: an unclosed string or comment must
     * throw rather than quietly consuming every rule after it.
     */
    it.each([
      [
        "an unterminated string",
        '@layer dev-toolbar { [data-dev-toolbar] { --probe: "oops; } }',
        /unterminated string/,
      ],
      ["an unterminated comment", "@layer dev-toolbar { /* oops }", /unterminated comment/],
      ["an unopened comment terminator", "@layer dev-toolbar { */ }", /unbalanced comment/],
      [
        "an escape inside a string",
        '@layer dev-toolbar { [data-dev-toolbar] { --probe: "a\\"b"; } }',
        /escape inside a string/,
      ],
    ])("refuses %s", (_name, css, message) => {
      expect(() => styleRules(css)).toThrow(message);
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

    /**
     * A statement at-rule the scanner skipped would be a hole the size of
     * whatever it pulls in: `@import` can add a whole sheet the audit never
     * sees. Only the statement forms core actually writes are passed over.
     */
    it.each([
      ["@import", "@import url(unguarded.css);"],
      ["an unknown statement", "@unknown x;"],
    ])("refuses %s", (_name, statement) => {
      expect(() => auditEmbedGuards(`${statement}\n${CORE_CSS}`)).toThrow(
        /unrecognised at-rule statement/,
      );
    });

    it.each([
      ["an unclosed selector paren", "[data-dev-toolbar] :where(table { margin: 0; }"],
      ["a stray closing paren", "[data-dev-toolbar] table) { margin: 0; }"],
    ])("refuses %s", (_name, rule) => {
      const mutated = CORE_CSS.replace("@layer dev-toolbar {", `@layer dev-toolbar {\n  ${rule}\n`);
      expect(() => auditEmbedGuards(mutated)).toThrow(/refusing to classify/);
    });
  });
});
