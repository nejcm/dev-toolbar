/**
 * `/ext/theme-editor`'s runtime, without React.
 *
 * The two things worth the most attention here are the ones this extension
 * inherits from earlier phases and has to keep for itself: **exact reversal**
 * of everything it wrote to the host document, and **fail-closed** treatment of
 * every foreign input — a token name, a token value, a pasted recipe, a URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeExtensionApi } from "@nejcm/dev-toolbar/testing";
import {
  DEFAULT_THEME_PARAM,
  OVERRIDES_KEY,
  PREVIEW_KEY,
  SURFACE_KEY,
  createThemeEditorRuntime,
  parseOverrides,
  readStoredThemeOverrides,
  resetRequested,
} from "../runtime";
import {
  MASK_SENTINEL,
  RESERVED_PREFIXES,
  checkTokenName,
  checkTokenValue,
  inferType,
  parseRecipe,
} from "../types";
import type { DesignTokenDefinition, ThemeSurface } from "../types";
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
  const fake = fakeExtensionApi({ storage: storage ?? createMemoryStorage() });
  aborts.push(fake.controller);
  return fake.api;
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

describe("consumer redaction getters", () => {
  const properties = [
    "mask",
    "keys",
    "extraKeys",
    "allowKeys",
    "maxDepth",
    "maxArrayLength",
    "maxNodes",
    "values",
  ] as const;
  const tokens: DesignTokenDefinition[] = [
    { name: "--private", type: "string", value: "secret", sensitive: true },
    { name: "--api-token", type: "string", value: "secret" },
    { name: "--header", type: "string", value: "Bearer secret" },
  ];

  it.each([...properties, "redactOptions"])("survives a throwing %s getter", (property) => {
    const error = new Error("not ready");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const getter = vi.fn(() => {
      throw error;
    });
    const redactOptions =
      property === "redactOptions"
        ? undefined
        : Object.defineProperty({}, property, { get: getter });
    const options = { tokens, redactOptions };
    if (property === "redactOptions") Object.defineProperty(options, property, { get: getter });
    const runtime = createThemeEditorRuntime(options);
    runtime.start(fakeApi(null));
    runtime.refresh();
    expect(runtime.store.peek().tokens).toHaveLength(3);
    for (const token of runtime.store.peek().tokens) {
      expect(token.effectiveText).toBe(
        token.name === "--header" ? `Bearer ${MASK_SENTINEL}` : MASK_SENTINEL,
      );
      expect(token.masked).toBe(true);
    }
    expect(
      runtime.importRecipe(
        JSON.stringify({ schemaVersion: 1, overrides: { "--private": MASK_SENTINEL } }),
      ).applied,
    ).toBe(0);
    expect(JSON.stringify(runtime.diagnostics())).not.toContain("secret");
    expect(runtime.cssText()).not.toContain("secret");
    expect(runtime.recipeText()).not.toContain("secret");
    expect(runtime.figmaText()).not.toContain("secret");
    expect(getter).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("[dev-toolbar/ext/theme-editor]"),
      error,
    );
  });

  it("uses one snapshot for sensitive values, redaction and stored validation", () => {
    const getters = properties.map(
      (property) =>
        [
          property,
          vi
            .fn()
            .mockReturnValueOnce(property === "mask" ? "***" : undefined)
            .mockImplementation(() => {
              throw new Error("read twice");
            }),
        ] as const,
    );
    const redactOptions = Object.defineProperties(
      {},
      Object.fromEntries(getters.map(([property, get]) => [property, { get }])),
    );
    const readOptions = vi
      .fn()
      .mockReturnValueOnce(redactOptions)
      .mockImplementation(() => {
        throw new Error("read twice");
      });
    const runtime = createThemeEditorRuntime({
      tokens,
      get redactOptions() {
        return readOptions();
      },
    });
    const storage = createMemoryStorage();
    storage.setItem(OVERRIDES_KEY, JSON.stringify({ "--private": "***", "--ordinary": "ok" }));
    runtime.start(fakeApi(storage));
    runtime.refresh();
    expect(runtime.overrides()).toEqual({ "--ordinary": "ok" });
    for (const token of runtime.store.peek().tokens.filter((token) => !token.orphaned)) {
      expect(token.effectiveText).toBe(token.name === "--header" ? "Bearer ***" : "***");
    }
    expect(
      runtime.importRecipe(JSON.stringify({ schemaVersion: 1, overrides: { "--private": "***" } }))
        .applied,
    ).toBe(0);
    runtime.diagnostics();
    runtime.recipeText();
    expect(readOptions).toHaveBeenCalledTimes(1);
    for (const [, getter] of getters) expect(getter).toHaveBeenCalledTimes(1);
  });
});

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
  it.each(["all", "preview"])("keeps preview off across a restart when %s reads throw", (reads) => {
    const blocked = () => {
      throw new Error("blocked");
    };
    const storage = {
      getItem(key: string) {
        if (reads === "all" || key === PREVIEW_KEY) return blocked();
        return null;
      },
      setItem: blocked,
      removeItem: blocked,
    };
    const runtime = createThemeEditorRuntime();
    const stop = runtime.start(fakeApi(storage));
    runtime.setPreview(false);
    expect(runtime.store.getSnapshot().preview).toBe(false);
    stop();
    const stopAgain = runtime.start(fakeApi(storage));
    expect(runtime.store.getSnapshot().preview).toBe(false);
    stopAgain();
  });

  it("restores preview on when readable storage has no preview key on restart", () => {
    const storage = createMemoryStorage();
    const runtime = createThemeEditorRuntime();
    const stop = runtime.start(fakeApi(storage));
    runtime.setPreview(false);
    storage.removeItem(PREVIEW_KEY);
    stop();
    const stopAgain = runtime.start(fakeApi(storage));
    expect(runtime.store.getSnapshot().preview).toBe(true);
    stopAgain();
  });

  it("keeps a session edit across a restart when every storage call throws", () => {
    // The read fallback is the serialised *empty* map, so a throw and "nothing
    // stored" arrive at `start` looking identical. Overwriting the session map
    // with that fallback loses an edit that only ever lived in memory, because
    // the throwing adapter never let it be persisted in the first place.
    const blocked = () => {
      throw new Error("blocked");
    };
    const storage = { getItem: blocked, setItem: blocked, removeItem: blocked };
    const runtime = createThemeEditorRuntime({ tokens: TOKENS });
    const stop = runtime.start(fakeApi(storage));
    runtime.setOverride("--brand-500", "#ff0000");
    expect(runtime.store.getSnapshot().overriddenCount).toBe(1);
    stop();

    const stopAgain = runtime.start(fakeApi(storage));
    const snapshot = runtime.store.getSnapshot();
    expect(snapshot.overriddenCount).toBe(1);
    expect(snapshot.tokens.find((view) => view.name === "--brand-500")?.overridden).toBe(true);
    // The retained map is re-applied to the page, not merely remembered.
    expect(root().style.getPropertyValue("--brand-500")).toBe("#ff0000");
    stopAgain();
  });

  it("clears the session map on a restart when readable storage has no edits", () => {
    // The other half of the guard above: storage that answers, with the key
    // gone, is a real "no edits stored" and must still win over the session.
    const storage = createMemoryStorage();
    const runtime = createThemeEditorRuntime({ tokens: TOKENS });
    const stop = runtime.start(fakeApi(storage));
    runtime.setOverride("--brand-500", "#ff0000");
    storage.removeItem(OVERRIDES_KEY);
    stop();

    const stopAgain = runtime.start(fakeApi(storage));
    expect(runtime.store.getSnapshot().overriddenCount).toBe(0);
    expect(root().style.getPropertyValue("--brand-500")).toBe("");
    stopAgain();
  });

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

    // Back on is the default, so it removes the key rather than storing "1" —
    // and reads back as on.
    second.setPreview(true);
    expect(storage.getItem(PREVIEW_KEY)).toBeNull();
    const third = createThemeEditorRuntime({ tokens: TOKENS });
    third.start(fakeApi(storage));
    expect(third.store.peek().preview).toBe(true);
  });

  it("stores a chosen surface, the default one included, and survives a reorder", () => {
    const storage = createMemoryStorage();
    const surfaces: ThemeSurface[] = [
      { id: "root", selector: ":root" },
      { id: "app", selector: "#app" },
    ];
    const host = document.createElement("div");
    host.id = "app";
    document.body.appendChild(host);
    try {
      const runtime = createThemeEditorRuntime({ tokens: TOKENS, surfaces });
      runtime.start(fakeApi(storage));
      runtime.selectSurface("app");
      expect(storage.getItem(SURFACE_KEY)).toBe("app");
      runtime.selectSurface("root");
      // The default is whatever the consumer lists first, so "chose the
      // default" and "never chose" must stay distinguishable: the id is kept.
      expect(storage.getItem(SURFACE_KEY)).toBe("root");

      // …and when the consumer later puts another surface first, the explicit
      // pick still wins over the new default.
      const reordered = createThemeEditorRuntime({
        tokens: TOKENS,
        surfaces: [surfaces[1] as ThemeSurface, surfaces[0] as ThemeSurface],
      });
      reordered.start(fakeApi(storage));
      expect(reordered.store.peek().surface.id).toBe("root");

      // An id the next mount's list no longer has reads as the default.
      storage.setItem(SURFACE_KEY, "gone");
      const next = createThemeEditorRuntime({ tokens: TOKENS, surfaces });
      next.start(fakeApi(storage));
      expect(next.store.peek().surface.id).toBe("root");
    } finally {
      host.remove();
    }
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
    expect(Object.getPrototypeOf(parseOverrides(null))).toBeNull();
    expect(Object.getPrototypeOf(parseOverrides("nope"))).toBeNull();
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

  it("guards and snapshots the supplied mask before checking stored entries", () => {
    const error = new Error("not ready");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const getter = vi.fn(() => {
      throw error;
    });
    expect(
      readStoredThemeOverrides({
        instanceId: "test",
        storage: reader({ "--masked": MASK_SENTINEL, "--good": "#fff" }),
        get mask() {
          return getter();
        },
      }),
    ).toEqual({ "--good": "#fff" });
    expect(getter).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("[dev-toolbar/ext/theme-editor]"),
      error,
    );
    const changing = vi.fn().mockReturnValueOnce("***").mockReturnValue("different");
    expect(
      readStoredThemeOverrides({
        instanceId: "test",
        storage: reader({ "--a": "***", "--b": "***", "--good": "#fff" }),
        get mask() {
          return changing();
        },
      }),
    ).toEqual({ "--good": "#fff" });
    expect(changing).toHaveBeenCalledTimes(1);
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

  it("uses the theme-editor default when pollMs is non-finite", () => {
    vi.useFakeTimers();
    try {
      const first = makeApp();
      const runtime = started({ pollMs: Number.NaN });
      runtime.setOverride("--brand-500", "#ff0000");
      first.remove();
      const second = makeApp();

      vi.advanceTimersByTime(999);
      expect(second.style.getPropertyValue("--brand-500")).toBe("");
      vi.advanceTimersByTime(1);
      expect(second.style.getPropertyValue("--brand-500")).toBe("#ff0000");
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

describe("publication guarantees", () => {
  const initial: DesignTokenDefinition = {
    name: "--publication",
    label: "Publication",
    description: "Description",
    group: "Theme",
    type: "string",
    value: "a",
    defaultValue: "a",
  };

  it.each([
    ["name", "--renamed"],
    ["label", "Renamed"],
    ["description", "Changed"],
    ["group", "Other"],
    ["type", "color"],
  ] as const)("publishes token.%s alone exactly once", (field, value) => {
    let definition: DesignTokenDefinition = { ...initial };
    const runtime = createThemeEditorRuntime({ tokens: () => [definition] });
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    definition = { ...definition, [field]: value };
    runtime.refresh();
    expect(runtime.store.getSnapshot().tokens).toEqual([{ ...before.tokens[0], [field]: value }]);
    expect(runtime.store.getSnapshot().groups).toEqual([
      { name: field === "group" ? value : "Theme", tokens: runtime.store.getSnapshot().tokens },
    ]);
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.store.destroy();
  });

  it.each(["effectiveText", "baseText", "defaultText"] as const)(
    "publishes %s with its raw value",
    (field) => {
      let definition = { ...initial };
      const runtime = createThemeEditorRuntime({ tokens: () => [definition] });
      runtime.setOverride("--publication", "a");
      const before = runtime.store.getSnapshot();
      const listener = vi.fn();
      runtime.store.subscribe(listener);
      if (field === "effectiveText") runtime.setOverride("--publication", "b");
      else {
        definition = { ...definition, [field === "baseText" ? "value" : "defaultValue"]: "b" };
        runtime.refresh();
      }
      const raw =
        field === "effectiveText"
          ? { effective: "b", override: "b" }
          : field === "baseText"
            ? { base: "b" }
            : { defaultValue: "b" };
      expect(runtime.store.getSnapshot().tokens).toEqual([
        { ...before.tokens[0], ...raw, [field]: "b" },
      ]);
      expect(listener).toHaveBeenCalledTimes(1);
      runtime.store.destroy();
    },
  );

  it("publishes masked alone with maskedCount", () => {
    let sensitive = false;
    const runtime = createThemeEditorRuntime({
      tokens: () => [{ ...initial, value: "[redacted]", defaultValue: "[redacted]", sensitive }],
    });
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    sensitive = true;
    runtime.refresh();
    expect(runtime.store.getSnapshot().tokens).toEqual([{ ...before.tokens[0], masked: true }]);
    expect(runtime.store.getSnapshot().maskedCount).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.store.destroy();
  });

  it("publishes metadataMasked alone when redacted metadata text stays equal", () => {
    let description = "Bearer abcdefghijklmnop";
    const runtime = createThemeEditorRuntime({ tokens: () => [{ ...initial, description }] });
    const before = runtime.store.getSnapshot();
    expect(before.tokens[0]?.metadataMasked).toBe(true);
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    description = before.tokens[0]?.description ?? "";
    runtime.refresh();
    expect(runtime.store.getSnapshot().tokens).toEqual([
      { ...before.tokens[0], metadataMasked: false },
    ]);
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.store.destroy();
  });

  // Pins missing raw effective in signature() (runtime.ts:915): null and a literal em dash
  // share effectiveText, leaving the swatch condition at ui.tsx:224 stale.
  // When covered, invert to toHaveBeenCalledTimes(1) and getSnapshot() toBe(peek()).
  it("BUG: null and a literal em dash hide a raw effective color change", () => {
    let value: string | undefined;
    const runtime = createThemeEditorRuntime({
      tokens: () => [{ ...initial, type: "color", value }],
    });
    const before = runtime.store.getSnapshot();
    expect(before.tokens[0]?.effective).toBeNull();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    value = "—";
    runtime.refresh();
    expect(runtime.store.peek().tokens).toEqual([
      { ...before.tokens[0], base: "—", effective: "—" },
    ]);
    expect(listener).not.toHaveBeenCalled();
    expect(runtime.store.getSnapshot()).toBe(before);
    runtime.store.destroy();
  });

  // Pins missing modeWritable in signature() (runtime.ts:915); ui.tsx:476 keeps the button disabled.
  // When covered, invert to toHaveBeenCalledTimes(1) and getSnapshot() toBe(peek()).
  it("BUG: changing only the mode setter leaves modeWritable stale", () => {
    const mode: { read(): "light"; set?: (value: "light" | "dark") => void } = {
      read: () => "light",
    };
    const runtime = createThemeEditorRuntime({ tokens: [initial], mode });
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    mode.set = () => {};
    runtime.refresh();
    expect(runtime.store.peek()).toEqual({
      ...before,
      modeWritable: true,
      revision: before.revision + 1,
    });
    expect(listener).not.toHaveBeenCalled();
    expect(runtime.store.getSnapshot()).toBe(before);
    runtime.store.destroy();
  });

  // Pins surface aliasing: signature() (runtime.ts:915) omits label/selector and reads
  // the already-mutated id from both snapshots; ui.tsx:439/442/504 changes without notification.
  // After snapshot isolation and comparison are fixed, keep the old field before refresh;
  // after refresh expect toHaveBeenCalledTimes(1) and getSnapshot() toBe(peek()), not before.
  it.each(["label", "selector", "id"] as const)(
    "BUG: aliased surface %s mutates the published snapshot without notifying",
    (field) => {
      const surfaces: ThemeSurface[] = [{ id: "one", label: "One", selector: ":root" }];
      const runtime = createThemeEditorRuntime({ surfaces, tokens: [initial] });
      const before = runtime.store.getSnapshot();
      const listener = vi.fn();
      runtime.store.subscribe(listener);
      const value = field === "selector" ? "html" : "Changed";
      surfaces[0]![field] = value;
      expect(runtime.store.getSnapshot()).toBe(before);
      expect(runtime.store.getSnapshot().surface[field]).toBe(value);
      runtime.refresh();
      expect(runtime.store.peek().surface[field]).toBe(value);
      expect(runtime.store.getSnapshot()).toBe(before);
      expect(listener).not.toHaveBeenCalled();
      runtime.store.destroy();
    },
  );

  // Pins aliased surfaces membership, omitted by signature() (runtime.ts:915);
  // ui.tsx:433/442 sees the published list mutate without notification.
  // After snapshot isolation and comparison are fixed, before.surfaces must retain length 1;
  // after refresh expect toHaveBeenCalledTimes(1) and getSnapshot() toBe(peek()), not before.
  it("BUG: aliased surface-list membership mutates the published snapshot without notifying", () => {
    const surfaces: ThemeSurface[] = [{ id: "one", selector: ":root" }];
    const runtime = createThemeEditorRuntime({ surfaces });
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    surfaces.push({ id: "two", label: "Two", selector: "body" });
    expect(before.surfaces).toHaveLength(2);
    runtime.refresh();
    expect(runtime.store.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    runtime.store.destroy();
  });

  it("publishes mode, preview, notice and writable changes synchronously", () => {
    let mode: "light" | "dark" = "light";
    const element = document.createElement("div");
    element.id = "publication-target";
    document.body.append(element);
    const runtime = createThemeEditorRuntime({
      tokens: [initial],
      surfaces: [{ id: "one", selector: "#publication-target" }],
      mode: {
        read: () => mode,
        set: (next) => {
          mode = next;
        },
      },
    });
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    runtime.setMode("dark");
    expect(runtime.store.getSnapshot().mode).toBe("dark");
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.setPreview(false);
    expect(runtime.store.getSnapshot().preview).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    runtime.importRecipe("invalid");
    expect(runtime.store.getSnapshot().notice).toContain("Import refused");
    expect(listener).toHaveBeenCalledTimes(3);
    element.remove();
    runtime.refresh();
    expect(runtime.store.getSnapshot().writable).toBe(false);
    expect(listener).toHaveBeenCalledTimes(4);
    runtime.store.destroy();
  });

  it("publishes override, orphan, refusal and apply-error state with their dependent fields", () => {
    let definitions: DesignTokenDefinition[] = [{ name: "--publication", type: "string" }];
    let fail = false;
    const runtime = createThemeEditorRuntime({
      tokens: () => definitions,
      onApply: () => {
        if (fail) throw new Error("apply failed");
      },
    });
    runtime.setPreview(false);
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    runtime.setOverride("--publication", "a");
    expect(runtime.store.getSnapshot()).toMatchObject({
      overriddenCount: 1,
      tokens: [{ overridden: true }],
    });
    expect(listener).toHaveBeenCalledTimes(1);
    fail = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    runtime.setOverride("--publication", "a");
    expect(runtime.store.getSnapshot().tokens[0]?.applyError).toContain("apply failed");
    expect(Object.keys(runtime.store.getSnapshot().applyErrors)).toEqual(["--publication"]);
    expect(listener).toHaveBeenCalledTimes(2);
    definitions = [];
    runtime.refresh();
    expect(runtime.store.getSnapshot()).toMatchObject({
      supplied: false,
      tokens: [{ orphaned: true }],
    });
    expect(listener).toHaveBeenCalledTimes(3);
    definitions = [{ name: "--dtb-forbidden", type: "string" }];
    runtime.refresh();
    expect(runtime.store.getSnapshot().tokens[0]?.refusal).toBe("reserved");
    expect(runtime.store.getSnapshot().refusedCount).toBe(1);
    expect(listener).toHaveBeenCalledTimes(4);
    log.mockRestore();
    runtime.store.destroy();
  });

  it("reconciles DOM before notifying, flushes each refresh and consumes revisions on idle attempts", async () => {
    vi.useFakeTimers();
    let definition = { ...initial };
    let element = document.createElement("div");
    document.body.append(element);
    const runtime = createThemeEditorRuntime({
      tokens: () => [definition],
      surfaces: [{ id: "one", selector: "div" }],
    });
    const harness = fakeExtensionApi();
    try {
      runtime.start(harness.api);
      runtime.setOverride("--publication", "b");
      const old = element;
      element = document.createElement("div");
      old.replaceWith(element);
      const listener = vi.fn(() => [
        element.style.getPropertyValue("--publication"),
        old.style.getPropertyValue("--publication"),
      ]);
      runtime.store.subscribe(listener);
      definition = { ...definition, label: "Changed" };
      runtime.refresh();
      expect(runtime.store.getSnapshot()).toBe(runtime.store.peek());
      expect(listener).toHaveBeenCalledTimes(1);
      definition = { ...definition, label: "Again" };
      runtime.refresh();
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener.mock.results.map((result) => result.value)).toEqual([
        ["b", ""],
        ["b", ""],
      ]);
      const stable = runtime.store.getSnapshot();
      runtime.cssText();
      runtime.recipeText();
      runtime.figmaText();
      runtime.diagnostics();
      expect(runtime.store.peek()).toBe(stable);
      runtime.refresh();
      expect(runtime.store.peek().revision).toBe(stable.revision + 1);
      expect(runtime.store.getSnapshot()).toBe(stable);
      await Promise.resolve();
      vi.advanceTimersByTime(250);
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      runtime.store.destroy();
      harness.abort();
      element.remove();
      vi.useRealTimers();
    }
  });
});

describe("publication of theme status", () => {
  it("publishes readError alone while the token list stays empty", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = false;
    const runtime = createThemeEditorRuntime({
      tokens: () => {
        if (fail) throw new Error("unreadable");
        return [];
      },
    });
    const before = runtime.store.getSnapshot();
    expect(before.readError).toBeNull();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    fail = true;
    runtime.refresh();
    expect(runtime.store.getSnapshot()).toEqual({
      ...before,
      readError: "The token list could not be read — it threw. See the console.",
      revision: before.revision + 1,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.store.destroy();
    log.mockRestore();
  });

  it("selecting a declared surface publishes selection and notice once", () => {
    const runtime = createThemeEditorRuntime({
      tokens: TOKENS,
      surfaces: [
        { id: "one", label: "One", selector: ":root" },
        { id: "two", label: "Two", selector: "body" },
      ],
    });
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    runtime.selectSurface("two");
    expect(runtime.store.getSnapshot()).toEqual({
      ...before,
      surface: before.surfaces[1],
      notice: "Surface: Two.",
      revision: before.revision + 1,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.store.destroy();
  });
});

describe("isolated theme publication fields", () => {
  it("publishes preview alone after an edit has cleared the notice", () => {
    const runtime = createThemeEditorRuntime({ tokens: TOKENS });
    runtime.setPreview(false);
    runtime.setOverride("--scale", "1");
    const before = runtime.store.getSnapshot();
    expect(before.notice).toBeNull();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    runtime.setPreview(true);
    expect(runtime.store.getSnapshot()).toEqual({
      ...before,
      preview: true,
      revision: before.revision + 1,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.store.destroy();
  });

  it("publishes orphaned alone with the rest of the catalogue and row unchanged", () => {
    const anchor: DesignTokenDefinition = { name: "--anchor", value: "a" };
    let definitions: DesignTokenDefinition[] = [
      anchor,
      { name: "--publication", label: "publication", group: "No longer declared", type: "string" },
    ];
    const runtime = createThemeEditorRuntime({ tokens: () => definitions });
    runtime.setOverride("--publication", "a");
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    definitions = [anchor];
    runtime.refresh();
    const tokens = before.tokens.map((token) =>
      token.name === "--publication" ? { ...token, orphaned: true } : token,
    );
    expect(runtime.store.getSnapshot()).toEqual({
      ...before,
      tokens,
      groups: before.groups.map((group) => ({
        ...group,
        tokens: tokens.filter((token) => token.group === group.name),
      })),
      revision: before.revision + 1,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.store.destroy();
  });

  it("publishes overridden alone in the UI when the edit matches the base value", () => {
    const runtime = createThemeEditorRuntime({ tokens: [{ name: "--publication", value: "a" }] });
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    runtime.setOverride("--publication", "a");
    expect(runtime.store.getSnapshot().tokens).toEqual([
      { ...before.tokens[0], override: "a", overridden: true },
    ]);
    expect(runtime.store.getSnapshot().overriddenCount).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.store.destroy();
  });
});

describe("selected surface publication", () => {
  it("publishes the selected surface ID alone when selector, label and notice stay equal", () => {
    const runtime = createThemeEditorRuntime({
      tokens: TOKENS,
      surfaces: [
        { id: "one", label: "Same", selector: ":root" },
        { id: "two", label: "Same", selector: ":root" },
      ],
    });
    runtime.selectSurface("two");
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    runtime.selectSurface("one");
    expect(runtime.store.getSnapshot()).toEqual({
      ...before,
      surface: { ...before.surface, id: "one" },
      revision: before.revision + 1,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.store.destroy();
  });
});

describe("apply-error publication without token rows", () => {
  // Pins missing applyErrors keys in signature() (runtime.ts:915) when fallback tokens
  // are empty; ui.tsx:412 never receives the newly failed edit key.
  // When covered, invert to toHaveBeenCalledTimes(1) and getSnapshot() toBe(peek()).
  it("BUG: a failed edit under an unreadable catalogue adds an invisible error key", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const runtime = createThemeEditorRuntime({
      tokens: [
        {
          name: "--publication",
          type: "string",
          get label(): string {
            throw new Error("unreadable label");
          },
        },
      ],
      onApply: () => {
        throw new Error("adapter failed");
      },
    });
    const before = runtime.store.getSnapshot();
    expect(before.tokens).toEqual([]);
    expect(before.readError).not.toBeNull();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    runtime.setOverride("--publication", "a");
    expect(runtime.store.peek()).toEqual({
      ...before,
      applyErrors: { "--publication": expect.stringContaining("adapter failed") },
      revision: before.revision + 1,
    });
    expect(listener).not.toHaveBeenCalled();
    expect(runtime.store.getSnapshot()).toBe(before);
    runtime.store.destroy();
    log.mockRestore();
  });
});

/* -------------------------------------------------------------------------- */

describe("a failure's error text reaches the row", () => {
  const hostileGetter = () =>
    Object.defineProperty(new Error("x"), "message", {
      get() {
        throw new Error("no");
      },
    });

  describe("from the consumer's onApply", () => {
    it("masks a credential-carrying URL with the extension's own redactOptions", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const runtime = createThemeEditorRuntime({
        tokens: TOKENS,
        // `ticket` is not a default sensitive key: only the consumer's options mask it.
        redactOptions: { extraKeys: ["ticket"] },
        onApply: () => {
          throw new Error("failed for https://x/?ticket=abc");
        },
      });
      runtime.start(fakeApi(null));
      runtime.setOverride("--brand-500", "#ff0000");
      const recorded = runtime.store.peek().applyErrors["--brand-500"];
      expect(recorded).toContain("failed for https://x/?ticket=[redacted]");
      expect(recorded).not.toContain("abc");
    });

    it("records a message getter that throws instead of throwing out of setOverride()", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const runtime = createThemeEditorRuntime({
        tokens: TOKENS,
        onApply: () => {
          throw hostileGetter();
        },
      });
      runtime.start(fakeApi(null));
      expect(() => runtime.setOverride("--brand-500", "#ff0000")).not.toThrow();
      expect(runtime.store.peek().applyErrors["--brand-500"]).toContain("[unreadable]");
    });

    it("describes a non-string message by its tag, as a string", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const runtime = createThemeEditorRuntime({
        tokens: TOKENS,
        onApply: () => {
          throw Object.assign(new Error("x"), { message: 42 });
        },
      });
      runtime.start(fakeApi(null));
      expect(() => runtime.setOverride("--brand-500", "#ff0000")).not.toThrow();
      expect(runtime.store.peek().applyErrors["--brand-500"]).toContain("[object Error]");
    });

    it("records the failure when the consumer's redactOptions throw on read", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const runtime = createThemeEditorRuntime({
        tokens: TOKENS,
        redactOptions: {
          get extraKeys(): string[] {
            throw new Error("no");
          },
        },
        onApply: () => {
          throw new Error("failed for https://x/?token=abc");
        },
      });
      runtime.start(fakeApi(null));
      expect(() => runtime.setOverride("--brand-500", "#ff0000")).not.toThrow();
      const recorded = runtime.store.peek().applyErrors["--brand-500"];
      expect(recorded).toContain("failed for https://x/?token=[redacted]");
      expect(recorded).not.toContain("abc");
    });
  });

  describe("from the surface write", () => {
    it("masks a credential-carrying URL with the extension's own redactOptions", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const runtime = createThemeEditorRuntime({
        tokens: TOKENS,
        // `ticket` is not a default sensitive key: only the consumer's options mask it.
        redactOptions: { extraKeys: ["ticket"] },
      });
      runtime.start(fakeApi(null));
      vi.spyOn(root().style, "setProperty").mockImplementation(() => {
        throw new Error("failed for https://x/?ticket=abc");
      });
      expect(runtime.setOverride("--brand-500", "#ff0000")).toBeNull();
      const recorded = runtime.store.peek().applyErrors["--brand-500"];
      expect(recorded).toContain("failed for https://x/?ticket=[redacted]");
      expect(recorded).toContain("the page did not take this value");
      expect(recorded).not.toContain("abc");
    });

    it("records a message getter that throws instead of throwing out of setOverride()", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const runtime = createThemeEditorRuntime({ tokens: TOKENS });
      runtime.start(fakeApi(null));
      vi.spyOn(root().style, "setProperty").mockImplementation(() => {
        throw hostileGetter();
      });
      expect(() => runtime.setOverride("--brand-500", "#ff0000")).not.toThrow();
      expect(runtime.store.peek().applyErrors["--brand-500"]).toContain("[unreadable]");
    });

    it("describes a non-string message by its tag, as a string", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const runtime = createThemeEditorRuntime({ tokens: TOKENS });
      runtime.start(fakeApi(null));
      vi.spyOn(root().style, "setProperty").mockImplementation(() => {
        throw Object.assign(new Error("x"), { message: 42 });
      });
      expect(() => runtime.setOverride("--brand-500", "#ff0000")).not.toThrow();
      expect(runtime.store.peek().applyErrors["--brand-500"]).toContain("[object Error]");
    });

    it("records the failure when the consumer's redactOptions throw on read", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const runtime = createThemeEditorRuntime({
        tokens: TOKENS,
        redactOptions: {
          get extraKeys(): string[] {
            throw new Error("no");
          },
        },
      });
      runtime.start(fakeApi(null));
      vi.spyOn(root().style, "setProperty").mockImplementation(() => {
        throw new Error("failed for https://x/?token=abc");
      });
      expect(() => runtime.setOverride("--brand-500", "#ff0000")).not.toThrow();
      const recorded = runtime.store.peek().applyErrors["--brand-500"];
      expect(recorded).toContain("failed for https://x/?token=[redacted]");
      expect(recorded).not.toContain("abc");
    });
  });
});
