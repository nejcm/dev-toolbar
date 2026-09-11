/**
 * Attacks this extension's own author ran against it. Kept separate from
 * `runtime.test.ts` since they share one shape: every string this extension
 * prints or writes has a source, and these three sources were missed.
 */
import { afterEach, describe, expect, it } from "vitest";
import { fakeExtensionApi } from "@nejcm/dev-toolbar/testing";
import { OVERRIDES_KEY, createThemeEditorRuntime } from "../runtime";
import { isPrintableSelector } from "../types";
import { createMemoryStorage } from "../../../core/storage";
import type { ExtensionRuntimeApi, ToolbarStorage } from "../../../core/contract";

const api = (storage: ToolbarStorage = createMemoryStorage()): ExtensionRuntimeApi =>
  fakeExtensionApi({ storage }).api;

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
    // The selector never resolves and nothing was ever applied — the export
    // was the leak, printing a working rule the consumer never wrote.
    expect(css).not.toContain("evil.test");
    expect(css).not.toContain("background");
    expect(css).toContain(":root {");
    expect(css).toContain("cannot be printed as CSS");
    expect(css).toContain("  --x: #000;");
  });

  it("prints combinators and attribute selectors, which are ordinary", () => {
    // `#app > main` is an ordinary surface selector; denying it would export
    // the block scoped to `:root` instead — a wrong scope, worse than a refusal.
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
    // `localStorage` is writable by any script on the origin, so a persisted
    // edit is no more trustworthy than a pasted recipe.
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
    // The cleaned map is written back, so it isn't re-read and re-refused.
    expect(storage.getItem(OVERRIDES_KEY)).toBeNull();
  });

  it("never writes a reserved name that arrived through storage", () => {
    // `vetStored()` deliberately does not filter names, so a `--dtb-*` entry
    // planted in `localStorage` reaches `applyAll()`; `checkTokenName` inside
    // `writeOne()` is the only line that stops it. A guard reached by two
    // code paths needs a test per path.
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
    // Tests the invariant across every door at once, rather than one
    // implementation of it — it still fails if any door's filter moves or is removed.
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
    // Door 2: a pasted recipe naming both an undeclared reserved token and a
    // declared one — "undeclared" and "reserved" are different filters, so
    // both need covering.
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
    // Unlike an import, the name is not filtered against the catalogue — an
    // orphan is the developer's own work and gets a row so it can be cleared.
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
    // Separate from `masked`: a scrubbed description still leaves a usable
    // value, and tagging it "masked" would refuse to seed the editor for nothing.
    expect(view?.masked).toBe(false);

    const figma = runtime.figmaText();
    expect(figma).not.toContain("super-secret");
    expect(figma).toContain("1 value was masked");
  });

  it("redacts a group name too, and counts it", () => {
    // The group is consumer-supplied configuration reaching the Figma export
    // as a JSON key — prose carrying a credential is the hazard, not injection.
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
    // Deliberate-leak assertion: a credential buried mid-sentence survives
    // because `redact()` matches value shapes anchored to the whole string.
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
    // Three cycles, not one: residue left by one cycle (a stray `style=""`)
    // would make the next acquisition read `hasAttribute("style")` as true
    // and keep it forever — invisible after a single cycle.
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
    // `style=""` is inert, but `[style]` is a legal selector and the attribute
    // isn't ours to remove.
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
