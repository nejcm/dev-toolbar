/**
 * `/ext/theme-editor`'s runtime, without React.
 *
 * The two things worth the most attention here are the ones this extension
 * inherits from earlier phases and has to keep for itself: **exact reversal**
 * of everything it wrote to the host document, and **fail-closed** treatment of
 * every foreign input — a token name, a token value, a pasted recipe, a URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THEME_PARAM,
  OVERRIDES_KEY,
  PREVIEW_KEY,
  createThemeEditorRuntime,
  parseOverrides,
  readStoredThemeOverrides,
  resetRequested,
} from "../runtime";
import {
  RESERVED_PREFIXES,
  checkTokenName,
  checkTokenValue,
  inferType,
  parseRecipe,
} from "../types";
import type { DesignTokenDefinition } from "../types";
import { createMemoryStorage } from "../../../core/storage";
import type { ExtensionRuntimeApi, ToolbarStorage } from "../../../core/contract";

const TOKENS: DesignTokenDefinition[] = [
  { name: "--brand-500", label: "Brand", type: "color", value: "#3355ff", group: "Colour" },
  { name: "--radius-md", type: "length", value: "8px", defaultValue: "8px" },
  { name: "--scale", type: "number", value: "1" },
  { name: "--font-stack", type: "string", value: "Inter, sans-serif" },
];

let aborts: AbortController[] = [];

function fakeApi(storage: ToolbarStorage | null): ExtensionRuntimeApi {
  const controller = new AbortController();
  aborts.push(controller);
  return {
    signal: controller.signal,
    isVisible: () => true,
    subscribeVisibility: () => () => {},
    storage: storage ?? createMemoryStorage(),
    getCommands: () => [],
    runCommand: () => Promise.resolve(false),
    invokeCommand: async () => ({ ok: false, reason: "unknown-command" }) as const,
    getDiagnostics: () => [],
  };
}

const root = () => document.documentElement;

beforeEach(() => {
  root().removeAttribute("style");
});

afterEach(() => {
  for (const controller of aborts.splice(0)) controller.abort();
  root().removeAttribute("style");
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */

describe("name validation — the guard that keeps the toolbar out of it", () => {
  it("refuses every reserved prefix, whatever case it is written in", () => {
    for (const prefix of RESERVED_PREFIXES) {
      expect(checkTokenName(`${prefix}bg`)).toBe("reserved");
      expect(checkTokenName(`${prefix.toUpperCase()}BG`)).toBe("reserved");
    }
    expect(checkTokenName("--dev-toolbar-height")).toBe("reserved");
  });

  it("refuses anything that could close a declaration", () => {
    for (const name of [
      "--x; color: red",
      "--x} body {",
      "--x/*",
      "--x\\",
      "brand",
      "",
      `--${"x".repeat(200)}`,
    ]) {
      expect(checkTokenName(name), name).toBe("syntax");
    }
  });

  it("accepts ordinary token names", () => {
    expect(checkTokenName("--brand-500")).toBeNull();
    expect(checkTokenName("--_private")).toBeNull();
    expect(checkTokenName("--2xl")).toBeNull();
  });

  it("never writes a reserved name onto the surface, even when declared", () => {
    // This is the whole "an app edit must not restyle the toolbar" guarantee,
    // asserted against the DOM rather than against the refusal helper — the
    // §14.7 lesson about a test that only ever compares a rule to itself.
    const runtime = createThemeEditorRuntime({
      tokens: [{ name: "--dtb-bg", type: "color", value: "#000" }],
    });
    runtime.start(fakeApi(createMemoryStorage()));
    expect(runtime.setOverride("--dtb-bg", "#ff0000")).toBe("syntax");
    expect(root().style.getPropertyValue("--dtb-bg")).toBe("");
    expect(root().hasAttribute("style")).toBe(false);

    const view = runtime.store.peek().tokens.find((token) => token.name === "--dtb-bg");
    expect(view?.refusal).toBe("reserved");
    expect(runtime.store.peek().refusedCount).toBe(1);
  });
});

describe("value validation", () => {
  it("refuses the constructs that escape a declaration or fetch", () => {
    for (const value of [
      "red; background: url(https://evil.test/x)",
      "red } body {",
      "/* */red",
      "url(https://evil.test/x.png)",
      "image-set('https://evil.test/x.png')",
      "expression(alert(1))",
      "<script>",
      "a\\b",
    ]) {
      expect(checkTokenValue("string", value), value).toBe("syntax");
    }
  });

  it("refuses a value that is not of the token's type, and coerces nothing", () => {
    expect(checkTokenValue("number", "abc")).toBe("type");
    expect(checkTokenValue("number", "")).toBe("empty");
    expect(checkTokenValue("length", "not-a-length")).toBe("type");
    expect(checkTokenValue("length", "8px")).toBeNull();
    expect(checkTokenValue("number", "1.5")).toBeNull();
  });

  it("lets modern colour syntax and functions through", () => {
    for (const value of [
      "#ff0055",
      "oklch(62% 0.2 260)",
      "color-mix(in srgb, red 40%, blue)",
      "var(--other-token)",
      "clamp(8px, 2vw, 24px)",
    ]) {
      expect(checkTokenValue("color", value), value).toBeNull();
    }
  });

  it("refuses a refused value at the runtime, not only at the helper", () => {
    const runtime = createThemeEditorRuntime({ tokens: TOKENS });
    runtime.start(fakeApi(createMemoryStorage()));
    expect(runtime.setOverride("--scale", "abc")).toBe("type");
    expect(runtime.overrides()).toEqual({});
    expect(root().style.getPropertyValue("--scale")).toBe("");
  });
});

/* -------------------------------------------------------------------------- */

describe("applying and reversing", () => {
  it("writes the custom property onto the surface", () => {
    const runtime = createThemeEditorRuntime({ tokens: TOKENS });
    runtime.start(fakeApi(createMemoryStorage()));
    expect(runtime.setOverride("--brand-500", "#ff0000")).toBeNull();
    expect(root().style.getPropertyValue("--brand-500")).toBe("#ff0000");
  });

  it("restores the document byte-for-byte, style attribute included", () => {
    // Byte equality, not "no obvious change" — the /ext/overlays §14.2
    // standard. `setProperty` then `removeProperty` leaves `style=""` behind,
    // which this assertion is specifically here to catch.
    const before = root().outerHTML.slice(0, 200);
    expect(root().hasAttribute("style")).toBe(false);

    const runtime = createThemeEditorRuntime({ tokens: TOKENS });
    runtime.start(fakeApi(createMemoryStorage()));
    runtime.setOverride("--brand-500", "#ff0000");
    runtime.setOverride("--radius-md", "16px");
    expect(root().hasAttribute("style")).toBe(true);

    runtime.resetAll();
    expect(root().hasAttribute("style")).toBe(false);
    expect(root().outerHTML.slice(0, 200)).toBe(before);
  });

  it("restores an inline value it displaced rather than deleting it", () => {
    root().style.setProperty("--brand-500", "#00ff00");
    root().style.setProperty("--kept", "1");
    const before = root().getAttribute("style");

    const runtime = createThemeEditorRuntime({ tokens: TOKENS });
    runtime.start(fakeApi(createMemoryStorage()));
    runtime.setOverride("--brand-500", "#ff0000");
    expect(root().style.getPropertyValue("--brand-500")).toBe("#ff0000");

    runtime.resetAll();
    expect(root().style.getPropertyValue("--brand-500")).toBe("#00ff00");
    expect(root().style.getPropertyValue("--kept")).toBe("1");
    expect(root().getAttribute("style")).toBe(before);
  });

  it("restores an `!important` inline declaration with its priority", () => {
    // jsdom drops `!important` on custom properties entirely — the attribute it
    // writes for `setProperty("--x", "red", "important")` is `--x: red;` and
    // `getPropertyPriority` comes back `""`. So the ambient document cannot
    // observe this at all, and asserting against it would be a test that passes
    // whether or not the priority is carried. §14.6 and §10.6's rule, met a
    // third time: a platform difference makes a real guarantee untestable in
    // the place you would naturally test it. The declaration is driven directly
    // instead, and the browser pass covers the real cascade.
    const calls: string[] = [];
    const style = {
      _v: new Map<string, [string, string]>(),
      get length() {
        return style._v.size;
      },
      setProperty(name: string, value: string, priority = "") {
        calls.push(`set ${name}=${value}!${priority}`);
        style._v.set(name, [value, priority]);
      },
      removeProperty(name: string) {
        calls.push(`remove ${name}`);
        style._v.delete(name);
      },
      getPropertyValue: (name: string) => style._v.get(name)?.[0] ?? "",
      getPropertyPriority: (name: string) => style._v.get(name)?.[1] ?? "",
    };
    const element = {
      style,
      hasAttribute: () => true,
      removeAttribute: () => {
        throw new Error("must not remove a style attribute it did not create");
      },
      closest: () => null,
    };
    const fakeDocument = {
      documentElement: element,
      defaultView: null,
      querySelector: () => element,
      head: null,
    } as unknown as Document;

    style.setProperty("--brand-500", "#00ff00", "important");
    const runtime = createThemeEditorRuntime({
      tokens: TOKENS,
      document: fakeDocument,
    });
    runtime.start(fakeApi(createMemoryStorage()));
    runtime.setOverride("--brand-500", "#ff0000");
    expect(style.getPropertyValue("--brand-500")).toBe("#ff0000");
    expect(style.getPropertyPriority("--brand-500")).toBe("");

    runtime.clearOverride("--brand-500");
    expect(style.getPropertyValue("--brand-500")).toBe("#00ff00");
    expect(style.getPropertyPriority("--brand-500")).toBe("important");
  });

  it("reverses on teardown, without being asked", () => {
    const runtime = createThemeEditorRuntime({ tokens: TOKENS });
    const api = fakeApi(createMemoryStorage());
    const dispose = runtime.start(api);
    runtime.setOverride("--brand-500", "#ff0000");
    dispose();
    expect(root().hasAttribute("style")).toBe(false);
  });

  it("reverses on the abort signal too, not only on the returned cleanup", () => {
    const runtime = createThemeEditorRuntime({ tokens: TOKENS });
    const controller = new AbortController();
    const api = { ...fakeApi(createMemoryStorage()), signal: controller.signal };
    runtime.start(api);
    runtime.setOverride("--brand-500", "#ff0000");
    controller.abort();
    expect(root().hasAttribute("style")).toBe(false);
  });

  it("holds edits back on preview off and puts them back exactly", () => {
    const runtime = createThemeEditorRuntime({ tokens: TOKENS });
    runtime.start(fakeApi(createMemoryStorage()));
    runtime.setOverride("--brand-500", "#ff0000");

    runtime.setPreview(false);
    expect(root().hasAttribute("style")).toBe(false);
    // Kept, not discarded: that is the whole difference from a reset.
    expect(runtime.overrides()).toEqual({ "--brand-500": "#ff0000" });
    expect(runtime.store.peek().preview).toBe(false);

    runtime.setPreview(true);
    expect(root().style.getPropertyValue("--brand-500")).toBe("#ff0000");
  });

  it("keeps the edits applied while the bar is hidden", () => {
    // The deliberate difference from /ext/overlays, which detaches everything
    // on the same signal. Repainting the application every time somebody
    // pressed the hide shortcut would make the extension unusable.
    const notify: ((visible: boolean) => void)[] = [];
    const runtime = createThemeEditorRuntime({ tokens: TOKENS });
    runtime.start({
      ...fakeApi(createMemoryStorage()),
      subscribeVisibility: (callback) => {
        notify.push(callback);
        return () => {};
      },
    });
    runtime.setOverride("--brand-500", "#ff0000");
    expect(notify).toHaveLength(1);
    notify[0]?.(false);
    expect(root().style.getPropertyValue("--brand-500")).toBe("#ff0000");
  });

  it("says so, per token, when there is nowhere to write", () => {
    const runtime = createThemeEditorRuntime({
      tokens: TOKENS,
      surfaces: [{ id: "missing", selector: ".not-on-this-page" }],
    });
    runtime.start(fakeApi(createMemoryStorage()));
    runtime.setOverride("--brand-500", "#ff0000");
    const snapshot = runtime.store.peek();
    expect(snapshot.writable).toBe(false);
    expect(snapshot.tokens.find((token) => token.name === "--brand-500")?.applyError).toContain(
      "missing",
    );
  });

  it("refuses a surface that lives inside a dev toolbar", () => {
    const host = document.createElement("div");
    host.setAttribute("data-dev-toolbar", "");
    const inner = document.createElement("div");
    inner.className = "inside-the-bar";
    host.appendChild(inner);
    document.body.appendChild(host);
    try {
      const runtime = createThemeEditorRuntime({
        tokens: TOKENS,
        surfaces: [{ id: "bar", selector: ".inside-the-bar" }],
      });
      runtime.start(fakeApi(createMemoryStorage()));
      runtime.setOverride("--brand-500", "#ff0000");
      expect(inner.hasAttribute("style")).toBe(false);
      expect(runtime.store.peek().writable).toBe(false);
    } finally {
      host.remove();
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("before and after", () => {
  it("keeps showing the application's own value under an edit", () => {
    const runtime = createThemeEditorRuntime({ tokens: TOKENS });
    runtime.start(fakeApi(createMemoryStorage()));
    runtime.setOverride("--brand-500", "#ff0000");
    const view = runtime.store.peek().tokens.find((token) => token.name === "--brand-500");
    expect(view?.effectiveText).toBe("#ff0000");
    expect(view?.baseText).toBe("#3355ff");
    expect(view?.overridden).toBe(true);
  });

  it("captures the computed value before the write when no `value` was supplied", () => {
    // The §12.1 trap from the other direction: once the property is on the
    // element, the computed value *is* the edit, so a row that re-read it would
    // claim the application already agreed.
    root().style.setProperty("--computed-only", "rgb(1, 2, 3)");
    const runtime = createThemeEditorRuntime({
      tokens: [{ name: "--computed-only", type: "color" }],
    });
    runtime.start(fakeApi(createMemoryStorage()));
    runtime.setOverride("--computed-only", "#ffffff");
    const view = runtime.store.peek().tokens.find((token) => token.name === "--computed-only");
    expect(view?.effectiveText).toBe("#ffffff");
    expect(view?.baseText).toBe("rgb(1, 2, 3)");
  });
});

/* -------------------------------------------------------------------------- */

describe("redaction", () => {
  it("leaves colours, lengths and numbers readable whatever they are called", () => {
    // `session` is in DEFAULT_SENSITIVE_KEYS, and `--session-panel-bg`
    // normalises to `sessionpanelbg`. Masking it would make the token you most
    // need to see the one you cannot — /ext/flags' §12.6 argument for booleans.
    const runtime = createThemeEditorRuntime({
      tokens: [
        { name: "--session-panel-bg", type: "color", value: "#123456" },
        { name: "--auth-radius", type: "length", value: "4px" },
      ],
    });
    const snapshot = runtime.store.peek();
    expect(snapshot.maskedCount).toBe(0);
    expect(snapshot.tokens[0]?.effectiveText).toBe("#123456");
    expect(snapshot.tokens[1]?.effectiveText).toBe("4px");
  });

  it("masks a free string token by its name", () => {
    const runtime = createThemeEditorRuntime({
      tokens: [{ name: "--api-token", type: "string", value: "abc123" }],
    });
    const view = runtime.store.peek().tokens[0];
    expect(view?.effectiveText).toBe("[redacted]");
    expect(view?.masked).toBe(true);
    expect(runtime.store.peek().maskedCount).toBe(1);
  });

  it("masks a credential-shaped value whatever the token's type is", () => {
    const runtime = createThemeEditorRuntime({
      tokens: [
        {
          name: "--brand-image-src",
          type: "string",
          value: "https://cdn.test/a?access_token=super-secret",
        },
      ],
    });
    const view = runtime.store.peek().tokens[0];
    expect(view?.effectiveText).not.toContain("super-secret");
    expect(view?.masked).toBe(true);
  });

  it("honours `sensitive` unconditionally", () => {
    const runtime = createThemeEditorRuntime({
      tokens: [{ name: "--brand-500", type: "color", value: "#123456", sensitive: true }],
    });
    expect(runtime.store.peek().tokens[0]?.effectiveText).toBe("[redacted]");
  });

  it("never lets a masked value out through an export or the diagnostics door", () => {
    const runtime = createThemeEditorRuntime({
      tokens: [{ name: "--api-token", type: "string", value: "public" }],
    });
    runtime.start(fakeApi(createMemoryStorage()));
    runtime.setOverride("--api-token", "sk-live-should-never-appear");

    expect(runtime.cssText()).not.toContain("sk-live-should-never-appear");
    expect(runtime.cssText()).toContain("[redacted]");
    expect(runtime.figmaText()).not.toContain("sk-live-should-never-appear");
    expect(JSON.stringify(runtime.diagnostics())).not.toContain("sk-live-should-never-appear");
    // The recipe is *executable*, so it omits what it cannot represent rather
    // than carrying the mask into a document a machine applies.
    const recipe = JSON.parse(runtime.recipeText()) as {
      overrides: Record<string, string>;
      maskedValuesOmitted?: number;
    };
    expect(recipe.overrides).toEqual({});
    expect(recipe.maskedValuesOmitted).toBe(1);
  });

  it("does not mask its own structural fields, at any depth", () => {
    // Found by writing the test above. `redact()` matches key names by word
    // segment, so this field was first called `omittedMaskedTokens` — whose
    // `Tokens` segment matches `token` — and came back as `"[redacted]"` where
    // a count belongs.
    // A count that reads as a credential is a wrong fact in an outbound
    // document, which is exactly what §15.3 is about; the difference is only
    // that the foreign key here was *ours*.
    //
    // **Recursive, not top-level.** The first version of this scan looked only
    // at the outermost keys, which is why it passed while `recipe.overrides` —
    // one level down, keyed by token names — was being re-masked wholesale. A
    // scan that stops at the depth where the last bug happened only ever
    // catches the last bug.
    const runtime = createThemeEditorRuntime({
      tokens: [
        { name: "--api-token", type: "string", value: "public" },
        // Ordinary names whose *segments* are credential words — `session`,
        // `token` and `auth` each stand alone here, so the word list matches
        // them however carefully it is matched. (The names this test was
        // written with, `--sidebar-bg` and `--spinner-size`, collided only
        // while the list was tested as a substring of the normalised key; they
        // stopped colliding, and stopped testing anything, when it became
        // segment matching.)
        { name: "--session-panel-bg", type: "color", value: "#ffffff" },
        { name: "--token-color", type: "color", value: "#000000" },
        { name: "--auth-panel-radius", type: "length", value: "2px" },
      ],
      now: () => 0,
    });
    runtime.start(fakeApi(createMemoryStorage()));
    runtime.setOverride("--api-token", "sk-live-x");
    runtime.setOverride("--session-panel-bg", "#101418");
    runtime.setOverride("--token-color", "#f5f5f5");
    runtime.setOverride("--auth-panel-radius", "6px");

    const offenders: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (typeof node === "string") {
        if (node === "[redacted]") offenders.push(path);
        return;
      }
      if (Array.isArray(node)) {
        node.forEach((entry, index) => walk(entry, `${path}[${index}]`));
        return;
      }
      if (node !== null && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) {
          walk(value, `${path}.${key}`);
        }
      }
    };

    // Both documents something *applies*: the recipe JSON and the share link's
    // payload. `diagnostics()` is deliberately not here — it is a human-read
    // report and a mask in it is the feature.
    walk(JSON.parse(runtime.recipeText()), "recipe");
    const link = runtime.shareLink();
    if (link !== null) {
      const payload = new URL(link).searchParams.get("dtb-theme");
      walk(JSON.parse(payload as string), "link");
    }
    expect(offenders).toEqual([]);
  });

  it("round-trips a colour whose own name is a credential word", () => {
    // The acceptance criterion this defect broke: `plans/dev-bar.md` says the
    // JSON round-trips without loss. It did not, because a belt-and-braces
    // `redact()` pass downstream of the classified join re-applied key matching
    // to the token names — masking them in the one document that gets applied,
    // where `sanitize()` then refuses the mask sentinel and drops them
    // entirely.
    //
    // The names are `--session-panel-bg` and `--token-color`: a `session` and a
    // `token` segment, so they collide with the word list on their own terms
    // rather than through the substring rule the original repro
    // (`--sidebar-bg`, `--spinner-size`) depended on. A colour is a colour —
    // §16.3 classifies both out of name matching, and the two-piece split in
    // `executablePayload` is what keeps that true one level down.
    const runtime = createThemeEditorRuntime({
      tokens: [
        { name: "--session-panel-bg", type: "color", value: "#ffffff" },
        { name: "--token-color", type: "color", value: "#000000" },
      ],
      now: () => 0,
    });
    runtime.start(fakeApi(createMemoryStorage()));
    runtime.setOverride("--session-panel-bg", "#101418");
    runtime.setOverride("--token-color", "#f5f5f5");

    const text = runtime.recipeText();
    expect(text).toContain('"--session-panel-bg": "#101418"');
    expect(text).toContain('"--token-color": "#f5f5f5"');

    runtime.resetAll();
    expect(runtime.importRecipe(text)).toEqual({
      applied: 2,
      dropped: 0,
      error: null,
    });
    expect(runtime.overrides()).toEqual({
      "--session-panel-bg": "#101418",
      "--token-color": "#f5f5f5",
    });
  });

  it("keeps the two executable documents in agreement", () => {
    // The disagreement is what proved the mask was a defect rather than a
    // policy: the link carried raw values while the recipe carried masks. They
    // are now built by one function, so a difference is impossible rather than
    // unlikely.
    const runtime = createThemeEditorRuntime({
      tokens: [
        { name: "--sidebar-bg", type: "color", value: "#ffffff" },
        { name: "--api-token", type: "string", value: "public" },
      ],
      now: () => 0,
    });
    runtime.start(fakeApi(createMemoryStorage()));
    runtime.setOverride("--sidebar-bg", "#101418");
    runtime.setOverride("--api-token", "sk-live-x");

    const link = runtime.shareLink();
    expect(link).not.toBeNull();
    const fromLink = new URL(link as string).searchParams.get("dtb-theme");
    // Full equality holds here because the clock is frozen (`now: () => 0`).
    // In production two reads seconds apart carry different `createdAt` and
    // `name` values, which is correct — they were produced at different times.
    // What must never differ is anything describing the *theme*, and this
    // assertion covers that as a subset.
    expect(JSON.parse(fromLink as string)).toEqual(JSON.parse(runtime.recipeText()));
    // And the genuinely masked one is still omitted from both, with the count.
    const parsed = JSON.parse(runtime.recipeText()) as {
      overrides: Record<string, string>;
      maskedValuesOmitted?: number;
    };
    expect(Object.keys(parsed.overrides)).toEqual(["--sidebar-bg"]);
    expect(parsed.maskedValuesOmitted).toBe(1);
    expect(fromLink).not.toContain("sk-live-x");
  });
});

/* -------------------------------------------------------------------------- */

describe("exports", () => {
  const built = () => {
    const runtime = createThemeEditorRuntime({ tokens: TOKENS, now: () => 0 });
    runtime.start(fakeApi(createMemoryStorage()));
    runtime.setOverride("--brand-500", "#ff0000");
    runtime.setOverride("--radius-md", "16px");
    return runtime;
  };

  it("writes CSS whose names and values are the ones on the page", () => {
    const css = built().cssText();
    expect(css).toContain(":root {");
    expect(css).toContain("  --brand-500: #ff0000;");
    expect(css).toContain("  --radius-md: 16px;");
  });

  it("round-trips its own recipe", () => {
    const runtime = built();
    const text = runtime.recipeText();
    runtime.resetAll();
    expect(runtime.overrides()).toEqual({});

    const result = runtime.importRecipe(text);
    expect(result.error).toBeNull();
    expect(result.applied).toBe(2);
    expect(runtime.overrides()).toEqual({
      "--brand-500": "#ff0000",
      "--radius-md": "16px",
    });
    expect(root().style.getPropertyValue("--radius-md")).toBe("16px");
  });

  it("exports the W3C design-tokens shape for Figma", () => {
    const figma = JSON.parse(built().figmaText()) as Record<string, unknown>;
    expect(
      (figma["Colour"] as Record<string, { $type: string; $value: string }>)["brand-500"],
    ).toEqual({ $type: "color", $value: "#ff0000" });
    expect((figma["Tokens"] as Record<string, { $type: string }>)["radius-md"]?.$type).toBe(
      "dimension",
    );
  });

  it("says nothing is active rather than exporting an empty rule", () => {
    const runtime = createThemeEditorRuntime({ tokens: TOKENS });
    expect(runtime.cssText()).toContain("No theme overrides are active");
  });
});

/* -------------------------------------------------------------------------- */

describe("foreign recipes", () => {
  const mounted = () => {
    const runtime = createThemeEditorRuntime({ tokens: TOKENS });
    runtime.start(fakeApi(createMemoryStorage()));
    return runtime;
  };

  it("refuses a wrong schema version, and says which", () => {
    expect(parseRecipe('{"schemaVersion":2,"overrides":{}}').error).toContain("schemaVersion 2");
    expect(parseRecipe("not json").error).toContain("not JSON");
    expect(parseRecipe('{"schemaVersion":1}').error).toContain("overrides");
  });

  it("drops a token this application does not declare", () => {
    const runtime = mounted();
    const result = runtime.importRecipe(
      JSON.stringify({
        schemaVersion: 1,
        overrides: { "--brand-500": "#ff0000", "--not-ours": "red" },
      }),
    );
    expect(result.applied).toBe(1);
    expect(result.dropped).toBe(1);
    expect(runtime.overrides()).toEqual({ "--brand-500": "#ff0000" });
    expect(root().style.getPropertyValue("--not-ours")).toBe("");
    expect(runtime.store.peek().notice).toContain("1 dropped");
  });

  it("says how many of the developer's own edits an import replaced", () => {
    // `adopt()` replaces rather than merges — a recipe is a whole theme — which
    // sits awkwardly next to `sanitize()`'s own argument, two functions up, that
    // the developer's work is not silently discarded. There is no undo, so the
    // minimum is to say what happened in the same sentence.
    const runtime = mounted();
    runtime.setOverride("--brand-500", "#111111");
    runtime.setOverride("--radius-md", "1px");

    runtime.importRecipe(
      JSON.stringify({
        schemaVersion: 1,
        name: "Whole theme",
        overrides: { "--scale": "3" },
      }),
    );
    const notice = runtime.store.peek().notice ?? "";
    expect(notice).toContain("1 token applied");
    expect(notice).toContain("2 earlier edits replaced");
    expect(runtime.overrides()).toEqual({ "--scale": "3" });
    // And the replaced ones are actually off the page, not merely off the map.
    expect(root().style.getPropertyValue("--brand-500")).toBe("");
    expect(root().style.getPropertyValue("--radius-md")).toBe("");
  });

  it("drops a value that would fetch, even under a declared name", () => {
    const runtime = mounted();
    const result = runtime.importRecipe(
      JSON.stringify({
        schemaVersion: 1,
        overrides: { "--font-stack": "url(https://evil.test/x)" },
      }),
    );
    expect(result.applied).toBe(0);
    expect(result.dropped).toBe(1);
    expect(root().style.getPropertyValue("--font-stack")).toBe("");
  });

  it("refuses the mask itself, so a redacted export cannot be re-imported as a value", () => {
    const runtime = mounted();
    const result = runtime.importRecipe(
      JSON.stringify({
        schemaVersion: 1,
        overrides: { "--font-stack": "[redacted]" },
      }),
    );
    expect(result.applied).toBe(0);
    expect(runtime.overrides()).toEqual({});
  });

  it("keeps a `__proto__` override as data", () => {
    const { recipe } = parseRecipe('{"schemaVersion":1,"overrides":{"__proto__":"red"}}');
    expect(Object.prototype.hasOwnProperty.call(recipe?.overrides ?? {}, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>)["red"]).toBeUndefined();
  });

  it("applies a preset through the same door", () => {
    const runtime = createThemeEditorRuntime({
      tokens: TOKENS,
      presets: [
        {
          schemaVersion: 1,
          name: "High contrast",
          mode: "light",
          surface: "root",
          overrides: { "--brand-500": "#000000", "--nope": "x" },
          createdAt: "",
        },
      ],
    });
    runtime.start(fakeApi(createMemoryStorage()));
    expect(runtime.applyPreset("High contrast")).toBe(true);
    expect(runtime.overrides()).toEqual({ "--brand-500": "#000000" });
    expect(runtime.applyPreset("Nothing")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe("the URL", () => {
  const withSearch = (search: string, run: () => void) => {
    const original = window.location.search;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, search, href: `http://localhost/${search}` },
    });
    try {
      run();
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { ...window.location, search: original },
      });
    }
  };

  it("clears every stored edit before any of them is applied", () => {
    const storage = createMemoryStorage();
    storage.setItem(OVERRIDES_KEY, JSON.stringify({ "--brand-500": "#ff0000" }));
    withSearch("?dtb-theme=reset", () => {
      expect(resetRequested(DEFAULT_THEME_PARAM)).toBe(true);
      const runtime = createThemeEditorRuntime({ tokens: TOKENS });
      runtime.start(fakeApi(storage));
      expect(runtime.overrides()).toEqual({});
      // The point of "before": the wedging edit must never reach the page on
      // the reset load, not merely be removed afterwards.
      expect(root().style.getPropertyValue("--brand-500")).toBe("");
      expect(storage.getItem(OVERRIDES_KEY)).toBeNull();
    });
  });

  it("adopts a shared recipe through the same sanitiser", () => {
    const recipe = encodeURIComponent(
      JSON.stringify({
        schemaVersion: 1,
        name: "Shared",
        overrides: { "--brand-500": "#00ff00", "--evil": "url(https://evil.test)" },
      }),
    );
    withSearch(`?dtb-theme=${recipe}`, () => {
      const runtime = createThemeEditorRuntime({ tokens: TOKENS });
      runtime.start(fakeApi(createMemoryStorage()));
      expect(runtime.overrides()).toEqual({ "--brand-500": "#00ff00" });
      expect(runtime.store.peek().notice).toContain("Shared");
    });
  });

  it("says so rather than throwing when the URL carries nonsense", () => {
    withSearch("?dtb-theme=%7Bnope", () => {
      const runtime = createThemeEditorRuntime({ tokens: TOKENS });
      runtime.start(fakeApi(createMemoryStorage()));
      expect(runtime.overrides()).toEqual({});
      expect(runtime.store.peek().notice).toContain("refused");
    });
  });
});

/* -------------------------------------------------------------------------- */

describe("failing closed", () => {
  it("survives a tokens getter that throws, at factory time", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const runtime = createThemeEditorRuntime({
      tokens: () => {
        throw new Error("nope");
      },
    });
    expect(runtime.store.peek().tokens).toEqual([]);
    expect(runtime.store.peek().readError).toContain("could not be read");
    expect(spy).toHaveBeenCalled();
  });

  it("survives a getter that throws while `redact()` walks a definition", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const hostile: DesignTokenDefinition = {
      name: "--brand-500",
      type: "color",
      get value(): string {
        throw new Error("hostile getter");
      },
    };
    const runtime = createThemeEditorRuntime({ tokens: [hostile] });
    expect(runtime.store.peek().tokens).toEqual([]);
    expect(runtime.store.peek().readError).not.toBeNull();
    expect(spy).toHaveBeenCalled();
  });

  it("records an onApply failure against its own token and clears it on its own success", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let broken = true;
    const runtime = createThemeEditorRuntime({
      tokens: TOKENS,
      onApply: (name) => {
        if (broken && name === "--brand-500") throw new Error("provider offline");
      },
    });
    runtime.start(fakeApi(createMemoryStorage()));
    runtime.setOverride("--brand-500", "#ff0000");
    runtime.setOverride("--radius-md", "16px");

    const snapshot = runtime.store.peek();
    // Per token, not one global slot — the §12.4 defect. A success on
    // `--radius-md` must not erase the failure on `--brand-500`.
    expect(snapshot.applyErrors["--brand-500"]).toContain("provider offline");
    expect(snapshot.applyErrors["--radius-md"]).toBeUndefined();
    expect(snapshot.tokens.find((token) => token.name === "--brand-500")?.applyError).toBeDefined();

    broken = false;
    runtime.setOverride("--brand-500", "#00ff00");
    expect(runtime.store.peek().applyErrors["--brand-500"]).toBeUndefined();
    expect(spy).toHaveBeenCalled();
  });

  it("survives a mode adapter that throws in either direction", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const runtime = createThemeEditorRuntime({
      tokens: TOKENS,
      mode: {
        read: () => {
          throw new Error("no mode");
        },
        set: () => {
          throw new Error("cannot set");
        },
      },
    });
    expect(runtime.store.peek().mode).toBeNull();
    runtime.start(fakeApi(createMemoryStorage()));
    expect(() => runtime.setMode("dark")).not.toThrow();
    expect(runtime.store.peek().notice).toContain("refused");
    expect(spy).toHaveBeenCalled();
  });

  it("survives a storage adapter that throws", () => {
    const hostile: ToolbarStorage = {
      getItem: () => {
        throw new Error("no");
      },
      setItem: () => {
        throw new Error("no");
      },
      removeItem: () => {
        throw new Error("no");
      },
    };
    const runtime = createThemeEditorRuntime({ tokens: TOKENS });
    expect(() => runtime.start(fakeApi(hostile))).not.toThrow();
    expect(() => runtime.setOverride("--radius-md", "12px")).not.toThrow();
    expect(root().style.getPropertyValue("--radius-md")).toBe("12px");
  });

  it("keeps exporting when `Date` has been patched", () => {
    const real = globalThis.Date;
    class Broken extends real {
      constructor(...args: ConstructorParameters<typeof Date>) {
        super(...args);
        throw new Error("patched clock");
      }
    }
    (globalThis as { Date: unknown }).Date = Broken;
    try {
      const runtime = createThemeEditorRuntime({ tokens: TOKENS, now: () => 0 });
      runtime.start(fakeApi(createMemoryStorage()));
      runtime.setOverride("--radius-md", "16px");
      const recipe = JSON.parse(runtime.recipeText()) as { createdAt: string };
      expect(recipe.createdAt).toBe("unknown");
      expect(() => runtime.diagnostics()).not.toThrow();
    } finally {
      (globalThis as { Date: unknown }).Date = real;
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("persistence", () => {
  it("re-applies stored edits on the next mount", () => {
    const storage = createMemoryStorage();
    const first = createThemeEditorRuntime({ tokens: TOKENS });
    const dispose = first.start(fakeApi(storage));
    first.setOverride("--brand-500", "#ff0000");
    dispose();
    expect(root().hasAttribute("style")).toBe(false);

    const second = createThemeEditorRuntime({ tokens: TOKENS });
    second.start(fakeApi(storage));
    expect(root().style.getPropertyValue("--brand-500")).toBe("#ff0000");
    expect(second.store.peek().overriddenCount).toBe(1);
  });

  it("shows and clears an edit whose token the catalogue no longer declares", () => {
    // Anything you apply must appear in what you display (§12.4). An orphan is
    // still written to the page on every mount, so a panel that dropped it
    // would make it invisible *and* unclearable.
    const storage = createMemoryStorage();
    storage.setItem(OVERRIDES_KEY, JSON.stringify({ "--renamed-token": "#ff0000" }));
    const runtime = createThemeEditorRuntime({ tokens: TOKENS });
    runtime.start(fakeApi(storage));
    expect(root().style.getPropertyValue("--renamed-token")).toBe("#ff0000");

    const view = runtime.store.peek().tokens.find((token) => token.name === "--renamed-token");
    expect(view?.orphaned).toBe(true);
    expect(runtime.store.peek().overriddenCount).toBe(1);

    runtime.clearOverride("--renamed-token");
    expect(root().hasAttribute("style")).toBe(false);
  });

  it("drops a reserved name out of storage instead of carrying it forever", () => {
    // A reserved name is dropped by `vetStored`, unlike an orphan. It can never
    // be written by anything, so keeping it was pure residue — and residue with
    // no exit: `writeOne` refused it on every load, and its row had no editor
    // and so no per-row clear, leaving "Reset everything" or the kill switch as
    // the only way out.
    const storage = createMemoryStorage();
    storage.setItem(
      OVERRIDES_KEY,
      JSON.stringify({ "--dtb-bg": "#ff0000", "--brand-500": "#00ff00" }),
    );
    const runtime = createThemeEditorRuntime({ tokens: TOKENS });
    runtime.start(fakeApi(storage));

    expect(runtime.overrides()).toEqual({ "--brand-500": "#00ff00" });
    expect(runtime.store.peek().notice).toContain("--dtb-bg");
    // Written back, so it does not come round again on the next load.
    expect(JSON.parse(storage.getItem(OVERRIDES_KEY) as string) as unknown).toEqual({
      "--brand-500": "#00ff00",
    });
  });

  it("re-applies every edit when the surface element is replaced", () => {
    // The panel says `override ?? base` for every row. If an SPA re-renders the
    // subtree a surface selects, the hold goes with the old node — and writing
    // only the token the developer just touched would leave every other row
    // claiming an edit the page had reverted. §12.4's honesty rule in reverse,
    // and invisible, because the panel is the thing that would be wrong.
    const first = document.createElement("div");
    first.id = "surface";
    document.body.appendChild(first);
    try {
      const runtime = createThemeEditorRuntime({
        tokens: TOKENS,
        surfaces: [{ id: "s", selector: "#surface" }],
      });
      runtime.start(fakeApi(createMemoryStorage()));
      runtime.setOverride("--brand-500", "#ff0000");
      runtime.setOverride("--radius-md", "16px");
      expect(first.style.getPropertyValue("--radius-md")).toBe("16px");

      // The application replaces the node the selector resolves to.
      const second = document.createElement("div");
      second.id = "surface";
      first.remove();
      document.body.appendChild(second);
      expect(second.hasAttribute("style")).toBe(false);

      // One further edit, to any token, migrates the hold — and must bring the
      // others with it.
      runtime.setOverride("--scale", "2");
      expect(second.style.getPropertyValue("--scale")).toBe("2");
      expect(second.style.getPropertyValue("--brand-500")).toBe("#ff0000");
      expect(second.style.getPropertyValue("--radius-md")).toBe("16px");

      // And the new element is still released exactly.
      runtime.resetAll();
      expect(second.hasAttribute("style")).toBe(false);
    } finally {
      document.getElementById("surface")?.remove();
      first.remove();
    }
  });

  it("persists the preview toggle", () => {
    const storage = createMemoryStorage();
    const first = createThemeEditorRuntime({ tokens: TOKENS });
    const dispose = first.start(fakeApi(storage));
    first.setOverride("--brand-500", "#ff0000");
    first.setPreview(false);
    expect(storage.getItem(PREVIEW_KEY)).toBe("0");
    dispose();

    const second = createThemeEditorRuntime({ tokens: TOKENS });
    second.start(fakeApi(storage));
    expect(second.store.peek().preview).toBe(false);
    expect(root().hasAttribute("style")).toBe(false);
  });

  it("writes nothing when persistence is off", () => {
    const storage = createMemoryStorage();
    const runtime = createThemeEditorRuntime({ tokens: TOKENS, persist: false });
    runtime.start(fakeApi(storage));
    runtime.setOverride("--brand-500", "#ff0000");
    expect(storage.getItem(OVERRIDES_KEY)).toBeNull();
  });

  it("hands `readStoredThemeOverrides` a plain object, not a null prototype", () => {
    const storage = createMemoryStorage();
    storage.setItem(OVERRIDES_KEY, JSON.stringify({ "--brand-500": "#ff0000" }));
    const result = readStoredThemeOverrides({
      instanceId: "test",
      storage: {
        getItem: (key) =>
          key === "dtb:v1:test:ext:theme-editor:overrides" ? storage.getItem(OVERRIDES_KEY) : null,
        setItem: () => {},
        removeItem: () => {},
      },
    });
    // §12.5: a null-prototype map across a public API breaks `hasOwnProperty`.
    expect(result.hasOwnProperty("--brand-500")).toBe(true);
  });

  it("drops non-string entries out of a persisted map", () => {
    expect(parseOverrides('{"--a":"red","--b":5,"--c":null}')).toEqual({
      "--a": "red",
    });
    expect(parseOverrides("[1,2]")).toEqual({});
    expect(parseOverrides("nope")).toEqual({});
  });
});

describe("type inference", () => {
  it("reads the shape of whatever value there is", () => {
    expect(inferType({ name: "--a", value: "#fff" })).toBe("color");
    expect(inferType({ name: "--a", value: "oklch(60% .2 200)" })).toBe("color");
    expect(inferType({ name: "--a", value: "12px" })).toBe("length");
    expect(inferType({ name: "--a", value: "1.5" })).toBe("number");
    expect(inferType({ name: "--a", value: "Inter, sans-serif" })).toBe("string");
    expect(inferType({ name: "--a" })).toBe("string");
    expect(inferType({ name: "--a", type: "color", value: "12px" })).toBe("color");
  });
});

/* -------------------------------------------------------------------------- */

describe("structural validation — the half a character deny list cannot see", () => {
  it("refuses a value whose brackets never close — a truncated `calc(` used to be accepted", () => {
    /* Regression: `checkTokenValue` short-circuited on the `FUNCTIONAL`
       prefix before anything looked at structure, so `calc(` returned `null`,
       was written to the surface as a live declaration, and was printed into
       `cssText()` — where an unclosed function swallows every declaration
       after it. */
    expect(checkTokenValue("color", "calc(")).toBe("syntax");
    expect(checkTokenValue("length", "clamp(1px, 2vw")).toBe("syntax");
    expect(checkTokenValue("string", "var(--a")).toBe("syntax");
    // Balanced functional values are untouched.
    expect(checkTokenValue("length", "calc(1px + 2px)")).toBeNull();
    expect(checkTokenValue("color", "color-mix(in oklab, red, blue)")).toBeNull();
  });

  it("refuses a stray closer and a mismatched pair", () => {
    expect(checkTokenValue("string", "1px)")).toBe("syntax");
    expect(checkTokenValue("string", "min(1px]")).toBe("syntax");
    expect(checkTokenValue("string", "[a]")).toBeNull();
  });

  it("refuses an unterminated string", () => {
    expect(checkTokenValue("string", '"Inter')).toBe("syntax");
    expect(checkTokenValue("string", '"Inter", sans-serif')).toBeNull();
  });

  it("refuses nesting deeper than 32", () => {
    expect(checkTokenValue("string", `${"min(".repeat(32)}1px${")".repeat(32)}`)).toBeNull();
    expect(checkTokenValue("string", `${"min(".repeat(33)}1px${")".repeat(33)}`)).toBe("syntax");
  });

  it("refuses a bare `!` but keeps one inside quotes — `!important` is dropped by CSSOM", () => {
    // CSSOM takes priority as a separate argument, so a conforming browser
    // drops `red !important` whole while the panel claims it applied.
    expect(checkTokenValue("color", "red !important")).toBe("syntax");
    expect(checkTokenValue("string", "red!important")).toBe("syntax");
    expect(checkTokenValue("string", '"wow!"')).toBeNull();
  });

  it("denies a backslash before the scanner sees it — which is why the scanner has no escape state", () => {
    /* Ordering pin. `structurallySound` runs *after* `VALUE_FORBIDDEN` and
       treats `\` as an ordinary character, so `"a\("` reads to it as a
       balanced quoted string and would be accepted on its own. Only the
       earlier deny list refuses it. Drop `\` from `VALUE_FORBIDDEN`, or move
       the scanner in front of it, and this value reaches the page. */
    expect(checkTokenValue("string", '"a\\("')).toBe("syntax");
    expect(checkTokenValue("string", '"a\\""')).toBe("syntax");
  });
});

describe("write verification — a declaration the page refused is not a success", () => {
  it("records an applyError when the value does not read back off the element", () => {
    /* Regression: `writeOne` ended with an unconditional
       `applyErrors.delete(name)`, so a declaration CSSOM dropped — which is
       what a real browser does with `red !important`, where priority is a
       separate argument to `setProperty` — was laundered into an applied
       edit, and the row went on reporting `overridden: true`. */
    const runtime = createThemeEditorRuntime({ tokens: TOKENS });
    runtime.start(fakeApi(null));
    const refuse = vi.spyOn(root().style, "setProperty").mockImplementation(() => {});

    expect(runtime.setOverride("--brand-500", "#ff0000")).toBeNull();
    const snapshot = runtime.store.peek();
    expect(snapshot.applyErrors["--brand-500"]).toBe(
      "The page refused this value — it reads back as empty.",
    );
    expect(snapshot.tokens.find((view) => view.name === "--brand-500")?.applyError).toBe(
      "The page refused this value — it reads back as empty.",
    );

    // …and a write that does land clears it again.
    refuse.mockRestore();
    expect(runtime.setOverride("--brand-500", "#00ff00")).toBeNull();
    expect(runtime.store.peek().applyErrors["--brand-500"]).toBeUndefined();
    expect(root().style.getPropertyValue("--brand-500")).toBe("#00ff00");
  });

  it("accepts a value the element normalises only in whitespace", () => {
    // Custom properties round-trip verbatim; the one difference CSSOM may
    // introduce is whitespace collapsing, which must not read as a refusal.
    const runtime = createThemeEditorRuntime({
      tokens: [{ name: "--stack", type: "string", value: "a" }],
    });
    runtime.start(fakeApi(null));
    expect(runtime.setOverride("--stack", "Inter,   sans-serif")).toBeNull();
    expect(runtime.store.peek().applyErrors["--stack"]).toBeUndefined();
  });
});

describe("`readStoredThemeOverrides` — the pre-mount door", () => {
  const reader = (payload: unknown): ToolbarStorage => ({
    getItem: (key) =>
      key === "dtb:v1:test:ext:theme-editor:overrides" ? JSON.stringify(payload) : null,
    setItem: () => {},
    removeItem: () => {},
  });

  it("vets what it hands back — it used to return raw storage", () => {
    /* Regression: the helper returned `parseOverrides()` verbatim while
       `start()` vetted the same bytes, and README § "It changes what your app
       looks like" tells consumers to feed the result into their own theme
       provider — so the app applied values the panel had already refused. */
    const result = readStoredThemeOverrides({
      instanceId: "test",
      storage: reader({
        "--good": "#ff0000",
        "--closes-the-rule": "red; } body {",
        "--unbalanced": "calc(",
        "--dtb-bg": "#000000",
        "--masked": "[redacted]",
        "--empty": "   ",
        "--not-a-string": 5,
      }),
    });
    expect(result).toEqual({ "--good": "#ff0000" });
  });

  it("reaches the mounted runtime's answer when handed the catalogue, and says where it cannot", () => {
    /* The residual divergence, pinned on purpose so nobody closes it by
       copying validation into a second place: without `tokens` every value is
       checked as a `"string"`, the loosest type, so a value the catalogue
       declares `number`/`length` and would refuse as one survives here.
       `color` and `string` cannot diverge at all — `checkTokenValue`
       short-circuits before any type branch. */
    const stored = { "--radius-md": "wide", "--brand-500": "not-a-colour" };

    expect(readStoredThemeOverrides({ instanceId: "test", storage: reader(stored) })).toEqual({
      "--radius-md": "wide",
      "--brand-500": "not-a-colour",
    });

    const withCatalogue = readStoredThemeOverrides({
      instanceId: "test",
      storage: reader(stored),
      tokens: TOKENS,
    });
    expect(withCatalogue).toEqual({ "--brand-500": "not-a-colour" });

    // …and that is exactly what `start()` keeps out of the same bytes.
    const storage = createMemoryStorage();
    storage.setItem(OVERRIDES_KEY, JSON.stringify(stored));
    const runtime = createThemeEditorRuntime({ tokens: TOKENS });
    runtime.start(fakeApi(storage));
    expect(runtime.overrides()).toEqual(withCatalogue);
  });

  it("falls back to the type-independent check when the catalogue getter throws", () => {
    // A getter reading application state that has not been built yet is the
    // plausible pre-mount failure; it must not cost the security pass.
    const result = readStoredThemeOverrides({
      instanceId: "test",
      storage: reader({ "--radius-md": "wide", "--unbalanced": "calc(" }),
      tokens: () => {
        throw new Error("not mounted yet");
      },
    });
    expect(result).toEqual({ "--radius-md": "wide" });
  });

  it("honours a custom mask", () => {
    expect(
      readStoredThemeOverrides({
        instanceId: "test",
        storage: reader({ "--a": "***", "--b": "#fff" }),
        mask: "***",
      }),
    ).toEqual({ "--b": "#fff" });
  });
});

describe("surface migration — one reconciler, one owner", () => {
  const APP_SURFACE = [{ id: "app", label: "App", selector: "#app" }];
  const makeApp = (): HTMLElement => {
    const element = document.createElement("div");
    element.id = "app";
    document.body.appendChild(element);
    return element;
  };

  afterEach(() => {
    for (const node of Array.from(document.querySelectorAll("#app"))) node.remove();
  });

  const started = (extra: Partial<Parameters<typeof createThemeEditorRuntime>[0]> = {}) => {
    const runtime = createThemeEditorRuntime({
      tokens: TOKENS,
      surfaces: APP_SURFACE,
      ...extra,
    });
    runtime.start(fakeApi(null));
    return runtime;
  };

  it("moves the edits onto a replaced surface element on publish, not only on the next write", () => {
    /* Regression: migration ran only inside `writeOne`, driven by a
       `surfaceReplaced` flag set in `currentHold()`. An SPA that re-rendered
       `#app` therefore stranded every edit on the detached node until
       somebody happened to type another value, while the snapshot went on
       reporting `overridden: true`. */
    const first = makeApp();
    const runtime = started();
    runtime.setOverride("--brand-500", "#ff0000");
    expect(first.style.getPropertyValue("--brand-500")).toBe("#ff0000");

    first.remove();
    const second = makeApp();
    runtime.refresh();

    expect(second.style.getPropertyValue("--brand-500")).toBe("#ff0000");
    expect(runtime.store.peek().writable).toBe(true);
  });

  it("releases a surface that was retargeted while still on the page — identity, not connectedness", () => {
    // The case an `isConnected` test cannot see: both elements are live, and
    // the old one is still wearing our inline values.
    const first = makeApp();
    const runtime = started();
    runtime.setOverride("--brand-500", "#ff0000");

    const second = document.createElement("div");
    second.id = "app";
    document.body.insertBefore(second, first);
    runtime.refresh();

    expect(second.style.getPropertyValue("--brand-500")).toBe("#ff0000");
    expect(first.hasAttribute("style")).toBe(false);
  });

  it("sets no per-token error when the surface is gone, and re-applies when it returns", () => {
    // A surface missing for one render between two paints must not mark every
    // row failed; `writable: false` is the truthful signal and the snapshot
    // already carries it.
    const first = makeApp();
    const runtime = started();
    runtime.setOverride("--brand-500", "#ff0000");
    first.remove();
    runtime.refresh();

    const gone = runtime.store.peek();
    expect(gone.writable).toBe(false);
    expect(gone.applyErrors).toEqual({});
    expect(gone.tokens.find((view) => view.name === "--brand-500")?.applyError).toBeUndefined();
    expect(gone.overriddenCount).toBe(1);
    expect(first.hasAttribute("style")).toBe(false);

    const back = makeApp();
    runtime.refresh();
    expect(back.style.getPropertyValue("--brand-500")).toBe("#ff0000");
  });

  it("polls a static catalogue on a non-root surface — the timer used to need a function", () => {
    /* Regression: the reconcile timer existed only when `tokens` was a
       function, so an application with a fixed catalogue and a `#app` surface
       never noticed the element being replaced. */
    vi.useFakeTimers();
    try {
      const first = makeApp();
      const runtime = started({ pollMs: 250 });
      runtime.setOverride("--brand-500", "#ff0000");
      first.remove();
      const second = makeApp();

      vi.advanceTimersByTime(300);
      expect(second.style.getPropertyValue("--brand-500")).toBe("#ff0000");
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats pollMs: NaN as the default interval — NaN makes setInterval fire every tick", () => {
    vi.useFakeTimers();
    try {
      const interval = vi.spyOn(globalThis, "setInterval");
      started({ pollMs: Number.NaN });
      expect(interval).toHaveBeenCalled();
      expect(interval.mock.calls[0]?.[1]).toBe(1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not touch the page from an export helper", () => {
    // The rejected fix was to reconcile inside `buildSnapshot()`, which would
    // make `cssText()`, `diagnostics()` and every export mutate the document.
    const first = makeApp();
    const runtime = started();
    runtime.setOverride("--brand-500", "#ff0000");
    first.remove();
    const second = makeApp();

    runtime.cssText();
    runtime.figmaText();
    runtime.diagnostics();
    expect(second.style.getPropertyValue("--brand-500")).toBe("");
    expect(second.hasAttribute("style")).toBe(false);
  });
});

describe("surface migration — the guards on the reconciler itself", () => {
  const APP_SURFACE = [{ id: "app", label: "App", selector: "#app" }];

  const detached = (): HTMLElement => document.createElement("div");

  /**
   * A `document` whose `querySelector` hands back a *different* live element
   * on each of its first few calls, then settles. A proxied document, a shim
   * or a test double does exactly this; a real one does not.
   */
  const alternatingDocument = (a: HTMLElement, b: HTMLElement, alternations: number) => {
    let calls = 0;
    const target = {
      documentElement: document.documentElement,
      defaultView: null,
      querySelector: () => {
        calls += 1;
        // It settles eventually, so an unguarded reconciler *terminates* here
        // rather than hanging the suite — the evidence is the call count, not
        // a timeout.
        if (calls > alternations) return b;
        return calls % 2 === 0 ? a : b;
      },
    } as unknown as Document;
    return { target, calls: () => calls };
  };

  it("terminates against a resolver that never returns the same element twice", () => {
    /* The `migrating` latch is a termination guarantee, not a redundancy.
       Without it every re-applied write re-enters the reconciler with a fresh
       element, and `writeOne`'s try/catch swallows the eventual RangeError
       and keeps going — so the re-entry is exponential rather than a fast
       stack overflow. */
    // One override, so an unguarded reconciler recurses *linearly* — with two
    // it branches, and 300 alternations would not finish this century.
    const { target, calls } = alternatingDocument(detached(), detached(), 300);
    const runtime = createThemeEditorRuntime({
      tokens: [{ name: "--brand-500", type: "color", value: "#3355ff" }],
      surfaces: APP_SURFACE,
      document: target,
    });
    runtime.start(fakeApi(null));
    runtime.setOverride("--brand-500", "#ff0000");
    runtime.refresh();

    // The bound is the evidence: the work is a function of the number of
    // edits, not of how many times the resolver changed its mind.
    expect(calls()).toBeLessThan(60);
  });

  it("writes nothing to the page once the runtime has been disposed", () => {
    /* Regression: `publish()` gained a `reconcileSurface()` call, and
       `refresh()` is `publish` — and also the `${id}.refresh` command's body.
       A consumer holding the runtime handle could therefore re-apply every
       edit *after* teardown had restored the page, breaking "unmounting the
       toolbar must leave the page exactly as it found it". */
    const element = document.createElement("div");
    element.id = "app";
    document.body.appendChild(element);
    try {
      const runtime = createThemeEditorRuntime({ tokens: TOKENS, surfaces: APP_SURFACE });
      const dispose = runtime.start(fakeApi(null));
      runtime.setOverride("--brand-500", "#ff0000");
      expect(element.getAttribute("style")).toBe("--brand-500: #ff0000;");

      dispose();
      expect(element.hasAttribute("style")).toBe(false);

      runtime.refresh();
      expect(element.getAttribute("style")).toBeNull();
      expect(element.style.getPropertyValue("--brand-500")).toBe("");
    } finally {
      element.remove();
    }
  });

  it("refuses a newline inside a quoted value — a browser reads it as a bad-string", () => {
    // Unreachable from the panel's `<input>`, reachable from an imported
    // recipe, a shared link or storage.
    expect(checkTokenValue("string", '"a\nb"')).toBe("syntax");
    expect(checkTokenValue("string", '"a b"')).toBeNull();
  });
});

describe("the token list signature", () => {
  it("republishes when label, group or metadata masking changes", () => {
    let group = "Colour";
    const runtime = createThemeEditorRuntime({
      tokens: () => [
        {
          name: "--brand-500",
          label: "Brand",
          type: "color",
          value: "#3355ff",
          group,
        },
      ],
    });
    const before = runtime.store.getSnapshot().revision;
    group = "Colors";
    runtime.refresh();
    runtime.store.flush();
    expect(runtime.store.getSnapshot().revision).toBeGreaterThan(before);
    expect(runtime.store.getSnapshot().tokens[0]?.group).toBe("Colors");
  });
});
