/**
 * The paths this extension's own author attacked, and what each attack found.
 * [dev-toolbar/ext/theme-editor]
 *
 * Three landed on the first pass. They are here rather than folded into
 * `runtime.test.ts` because they share one shape, and the shape is the lesson:
 * **every string this extension prints or writes has a source, and three of them
 * were not on the list.** §15.3's rule is that both halves of a join are foreign
 * until proven otherwise; the corollary this phase adds is that "foreign" is a
 * property of the *source*, so the way to find the gaps is to enumerate sources
 * rather than to re-read the joins.
 *
 * Each `it` below fails against the code as first written.
 */
import { afterEach, describe, expect, it } from "vitest";
import { OVERRIDES_KEY, createThemeEditorRuntime } from "../runtime";
import { isPrintableSelector } from "../types";
import { createMemoryStorage } from "../../../core/storage";
import type { ExtensionRuntimeApi, ToolbarStorage } from "../../../core/contract";

const api = (storage: ToolbarStorage = createMemoryStorage()): ExtensionRuntimeApi => ({
  signal: new AbortController().signal,
  isVisible: () => true,
  subscribeVisibility: () => () => {},
  storage,
  getCommands: () => [],
  runCommand: () => Promise.resolve(false),
  invokeCommand: async () => ({ ok: false, reason: "unknown-command" }) as const,
  getDiagnostics: () => [],
});

const root = () => document.documentElement;

afterEach(() => {
  root().removeAttribute("style");
});

describe("attack 1 — the surface selector is printed, so it is foreign", () => {
  const HOSTILE = ':root { } body { background: url("https://evil.test/x") } .z';

  it("refuses to print a selector that would open a rule of its own", () => {
    expect(isPrintableSelector(HOSTILE)).toBe(false);
    expect(isPrintableSelector(":root")).toBe(true);
    expect(isPrintableSelector("[data-area=checkout] .panel")).toBe(true);

    const runtime = createThemeEditorRuntime({
      tokens: [{ name: "--x", type: "color", value: "#fff" }],
      surfaces: [{ id: "evil", selector: HOSTILE }],
    });
    runtime.start(api());
    runtime.setOverride("--x", "#000");

    const css = runtime.cssText();
    // The selector never resolves — `querySelector` throws on it and the runtime
    // fails closed — so nothing was ever applied. The export was the leak: it
    // printed a *working* rule the consumer never wrote, into a file somebody
    // pastes into their stylesheet.
    expect(css).not.toContain("evil.test");
    expect(css).not.toContain("background");
    expect(css).toContain(":root {");
    expect(css).toContain("cannot be printed as CSS");
    expect(css).toContain("  --x: #000;");
  });

  it("prints combinators and attribute selectors, which are ordinary", () => {
    // The first cut of the guard denied `>`, `+`, `~` and every `@`, under a
    // comment claiming a real selector never contains them. `#app > main` is an
    // ordinary surface selector, and denying it exported the block scoped to
    // `:root` with a note saying it could not be printed — a wrong scope in a
    // stylesheet, which is a worse failure than the one the refusal exists to
    // prevent.
    for (const selector of [
      "#app > main",
      ".a + .b",
      ".a ~ .b",
      '[data-owner="a@b.test"]',
      ":root",
      "[data-area=checkout] .panel",
    ]) {
      expect(isPrintableSelector(selector), selector).toBe(true);
    }
    // And what it must still refuse, including an at-rule in the only position
    // where `@` can open one.
    for (const selector of [
      ":root { } body {",
      "a; b",
      "a /* c */",
      "a\\b",
      "@media screen",
      "url(https://evil.test)",
      "</style><script>",
    ]) {
      expect(isPrintableSelector(selector), selector).toBe(false);
    }
  });

  it("keeps printing an ordinary selector, so the guard is not a blanket refusal", () => {
    const host = document.createElement("div");
    host.id = "surface-ok";
    document.body.appendChild(host);
    try {
      const runtime = createThemeEditorRuntime({
        tokens: [{ name: "--x", type: "color", value: "#fff" }],
        surfaces: [{ id: "ok", selector: "#surface-ok" }],
      });
      runtime.start(api());
      runtime.setOverride("--x", "#000");
      expect(runtime.cssText()).toContain("#surface-ok {");
      expect(runtime.cssText()).not.toContain("cannot be printed");
    } finally {
      host.remove();
    }
  });
});

describe("attack 2 — storage is a door, and it was the one under-treated", () => {
  const HOSTILE = 'red; background: url("https://evil.test/y")';

  it("re-checks a persisted value instead of trusting its own past self", () => {
    // `localStorage` is writable by every script on the origin and by anybody
    // who has been talked into pasting something into a console, so a persisted
    // edit is no more trustworthy than a pasted recipe. Untreated, this value
    // reached two places: `style.setProperty`, where the CSSOM accepts a
    // custom-property value of nearly any shape and wrote
    // `--x: red; background: url(…)` into the inline style attribute verbatim,
    // and `cssText`, which printed the same thing into an export.
    const storage = createMemoryStorage();
    storage.setItem(OVERRIDES_KEY, JSON.stringify({ "--x": HOSTILE }));

    const runtime = createThemeEditorRuntime({
      tokens: [{ name: "--x", type: "color", value: "#fff" }],
    });
    runtime.start(api(storage));

    expect(runtime.overrides()).toEqual({});
    expect(root().getAttribute("style")).toBeNull();
    expect(runtime.cssText()).not.toContain("evil.test");
    expect(runtime.store.peek().notice).toContain("dropped as unusable");
    // And the cleaned map is written back, so it is not re-read and re-refused
    // on every load.
    expect(storage.getItem(OVERRIDES_KEY)).toBeNull();
  });

  it("never writes a reserved name that arrived through storage", () => {
    // The other half of the bleed guard, and the half that was unpinned.
    // `vetStored()` deliberately does not filter *names* — an orphan is the
    // developer's own work — so a `--dtb-*` entry planted in `localStorage`
    // travels all the way to `applyAll()`, and `checkTokenName` inside
    // `writeOne()` is the only line that stops it. Review deleted that line and
    // all 85 tests passed: §16.2's "the test that pins this" covered the
    // `setOverride` door and nothing else.
    //
    // The lesson generalises past this file: a guard reached by two code paths
    // needs a test per path, because the *rule* being right is not evidence
    // that both callers consult it.
    const storage = createMemoryStorage();
    storage.setItem(
      OVERRIDES_KEY,
      JSON.stringify({
        "--dtb-bg": "#ff0000",
        "--dev-toolbar-height": "500px",
        "--x": "#00ff00",
      }),
    );
    const runtime = createThemeEditorRuntime({
      tokens: [{ name: "--x", type: "color", value: "#fff" }],
    });
    runtime.start(api(storage));

    // Nothing reserved reaches the element — asserted against the DOM, not
    // against the refusal helper.
    expect(root().style.getPropertyValue("--dtb-bg")).toBe("");
    expect(root().style.getPropertyValue("--dev-toolbar-height")).toBe("");
    // The legitimate one still applies, so this is not a blanket refusal.
    expect(root().style.getPropertyValue("--x")).toBe("#00ff00");
    // And it is not exported either.
    expect(runtime.cssText()).not.toContain("--dtb-bg");
    expect(runtime.recipeText()).not.toContain("--dtb-bg");
  });

  it("lets no door put a reserved name into the override map", () => {
    // The invariant, across every door at once, rather than one door at a time.
    //
    // This replaces the mutation the reviewer asked for and it is worth saying
    // why. Deleting `writeOne`'s name check used to break the storage-door test;
    // after `vetStored` started dropping reserved names — the residue fix, also
    // requested — the stop moved earlier, so that mutation no longer fails and
    // `writeOne`'s copy became an unreachable funnel invariant. Testing the
    // *property* instead of one implementation of it is the honest replacement:
    // it fails if any door's filter is removed, and it keeps meaning something
    // if the filters move again.
    const storage = createMemoryStorage();
    storage.setItem(
      OVERRIDES_KEY,
      JSON.stringify({ "--dtb-bg": "#ff0000", "--dev-toolbar-height": "9px" }),
    );
    const runtime = createThemeEditorRuntime({
      tokens: [
        { name: "--x", type: "color", value: "#fff" },
        // Declared *and* reserved: the catalogue is a door too.
        { name: "--dtb-accent", type: "color", value: "#000" },
      ],
    });
    runtime.start(api(storage));

    // Door 1: the panel's editor.
    expect(runtime.setOverride("--dtb-accent", "#ff0000")).toBe("syntax");
    // Door 2: a pasted recipe. It names both a reserved token the catalogue
    // does *not* declare and the reserved one it does — the second is the case
    // that matters, because "dropped for being undeclared" and "dropped for
    // being reserved" are two different filters and only one of them is under
    // test if the recipe names only an unknown token.
    runtime.importRecipe(
      JSON.stringify({
        schemaVersion: 1,
        overrides: {
          "--dtb-bg": "#ff0000",
          "--dtb-accent": "#ff0000",
          "--x": "#00ff00",
        },
      }),
    );
    // Door 3: a consumer preset, through the same sanitiser.
    // Door 4: storage, read at start() above.
    const reserved = Object.keys(runtime.overrides()).filter(
      (name) =>
        name.toLowerCase().startsWith("--dtb-") || name.toLowerCase().startsWith("--dev-toolbar"),
    );
    expect(reserved).toEqual([]);
    // And nothing reserved is on the element either.
    const style = root().getAttribute("style") ?? "";
    expect(style).not.toContain("--dtb-");
    expect(style).not.toContain("--dev-toolbar-height");
  });

  it("still applies a legitimate stored edit whose token has been renamed", () => {
    // The name is *not* filtered against the catalogue, unlike an import: an
    // orphan is the developer's own work and gets a row so it can be cleared
    // (§12.4). It is the value that is foreign, not the name.
    const storage = createMemoryStorage();
    storage.setItem(OVERRIDES_KEY, JSON.stringify({ "--renamed": "#00ff00", "--x": HOSTILE }));
    const runtime = createThemeEditorRuntime({
      tokens: [{ name: "--x", type: "color", value: "#fff" }],
    });
    runtime.start(api(storage));

    expect(runtime.overrides()).toEqual({ "--renamed": "#00ff00" });
    expect(root().style.getPropertyValue("--renamed")).toBe("#00ff00");
    expect(runtime.store.peek().tokens.find((view) => view.name === "--renamed")?.orphaned).toBe(
      true,
    );
  });
});

describe("attack 3 — a description is exported, so it is foreign too", () => {
  it("redacts a description, and counts it in the export that carries it", () => {
    const runtime = createThemeEditorRuntime({
      tokens: [
        {
          name: "--x",
          type: "color",
          value: "#fff",
          description: "https://api.test/cb?access_token=super-secret",
        },
      ],
    });
    runtime.start(api());
    runtime.setOverride("--x", "#000");

    const view = runtime.store.peek().tokens[0];
    expect(view?.description).not.toContain("super-secret");
    expect(view?.metadataMasked).toBe(true);
    // Separate from `masked`, which is about the value and drives the editor.
    // A row whose description was scrubbed has a perfectly usable value, and
    // tagging it "masked" would send the input into its refuse-to-seed mode for
    // nothing.
    expect(view?.masked).toBe(false);

    const figma = runtime.figmaText();
    expect(figma).not.toContain("super-secret");
    // The count is computed from what this document actually carries, not
    // borrowed from a neighbouring number (§15.3).
    expect(figma).toContain("1 value was masked");
  });

  it("redacts a group name too, and counts it", () => {
    // §16.8's checklist, applied to the one source it had not been: the group
    // is consumer-supplied configuration and it reaches the Figma export as a
    // JSON key. Injection is not the hazard there — prose carrying a credential
    // is, exactly as for the description.
    const runtime = createThemeEditorRuntime({
      tokens: [
        {
          name: "--x",
          type: "color",
          value: "#fff",
          group: "https://api.test/cb?access_token=super-secret",
        },
      ],
    });
    runtime.start(api());
    runtime.setOverride("--x", "#000");

    const view = runtime.store.peek().tokens[0];
    expect(view?.group).not.toContain("super-secret");
    expect(view?.metadataMasked).toBe(true);
    const figma = runtime.figmaText();
    expect(figma).not.toContain("super-secret");
    expect(figma).toContain("1 value was masked");
  });

  it("does not claim more than an anchored matcher can do", () => {
    // The deliberate-leak assertion, in the spirit of §15.3's. A credential the
    // consumer buried mid-sentence survives, because `redact()` matches value
    // *shapes* anchored to the whole string. Calling the redactor and missing is
    // a different failure from not calling it, and a suite that only showed the
    // successes would imply a guarantee this package does not make.
    const runtime = createThemeEditorRuntime({
      tokens: [
        {
          name: "--x",
          type: "color",
          value: "#fff",
          description: "see https://api.test/cb?access_token=super-secret",
        },
      ],
    });
    runtime.start(api());
    runtime.setOverride("--x", "#000");
    expect(runtime.figmaText()).toContain("super-secret");
    expect(runtime.store.peek().tokens[0]?.metadataMasked).toBe(false);
  });
});

describe("attack 4 — the reversal, against elements it does not own alone", () => {
  const host = () => document.getElementById("hold-target") as HTMLElement;

  const mount = (surface = "#hold-target") => {
    const runtime = createThemeEditorRuntime({
      tokens: [
        { name: "--a", type: "color", value: "#fff" },
        { name: "--b", type: "length", value: "1px" },
      ],
      surfaces: [{ id: "t", selector: surface }],
    });
    runtime.start(api());
    return runtime;
  };

  it("stays exact over repeated acquire/release cycles", () => {
    // Three cycles rather than one, because the residue this guards against is
    // *cumulative*: a cycle that left `style=""` behind would make the next
    // acquisition read `hasAttribute("style")` as true and keep it forever, so
    // "byte-for-byte" would be quietly false from the second cycle on. One
    // cycle cannot show that.
    const element = document.createElement("div");
    element.id = "hold-target";
    document.body.appendChild(element);
    try {
      const runtime = mount();
      for (let cycle = 0; cycle < 3; cycle += 1) {
        runtime.setOverride("--a", "#000000");
        runtime.setOverride("--b", "2px");
        expect(host().hasAttribute("style"), `cycle ${cycle} applied`).toBe(true);
        runtime.resetAll();
        expect(host().getAttribute("style"), `cycle ${cycle} reset`).toBeNull();
      }
    } finally {
      element.remove();
    }
  });

  it("leaves somebody else's declarations, and the attribute holding them", () => {
    const element = document.createElement("div");
    element.id = "hold-target";
    element.setAttribute("style", "color: red");
    document.body.appendChild(element);
    try {
      const runtime = mount();
      runtime.setOverride("--a", "#000000");
      runtime.resetAll();
      expect(host().getAttribute("style")).toBe("color: red;");
    } finally {
      element.remove();
    }
  });

  it("keeps an *empty* attribute it did not create", () => {
    // The case `style.length` cannot see, and the only thing the
    // `hadStyleAttribute` reading decides. `style=""` is inert, but `[style]` is
    // a legal selector and the attribute is not ours: an extension whose
    // headline claim is exact reversal does not remove what it did not add.
    const element = document.createElement("div");
    element.id = "hold-target";
    element.setAttribute("style", "");
    document.body.appendChild(element);
    try {
      const runtime = mount();
      runtime.setOverride("--a", "#000000");
      runtime.resetAll();
      expect(host().getAttribute("style")).toBe("");
    } finally {
      element.remove();
    }
  });

  it("keeps an attribute whose other properties appeared while it was holding", () => {
    const element = document.createElement("div");
    element.id = "hold-target";
    document.body.appendChild(element);
    try {
      const runtime = mount();
      runtime.setOverride("--a", "#000000");
      // A third party writes to the same element behind the hold's back.
      host().style.setProperty("color", "red");
      runtime.resetAll();
      expect(host().style.getPropertyValue("color")).toBe("red");
      expect(host().style.getPropertyValue("--a")).toBe("");
      expect(host().hasAttribute("style")).toBe(true);
    } finally {
      element.remove();
    }
  });
});
