/**
 * `@nejcm/dev-toolbar/ext/theme-editor`
 *
 * Live design-token editing, per `plans/dev-bar.md` §3H. A pure consumer of
 * the public extension contract: nothing here imports a *value* from
 * `src/core/*`, only types, which erase at build time.
 *
 * ```tsx
 * import { themeEditor } from "@nejcm/dev-toolbar/ext/theme-editor";
 *
 * // Build it ONCE, outside render.
 * const extensions = [
 *   themeEditor({
 *     tokens: [
 *       { name: "--brand-500", label: "Brand", type: "color", group: "Colour" },
 *       { name: "--radius-md", type: "length", defaultValue: "8px" },
 *     ],
 *   }),
 * ];
 * ```
 *
 * **The tokens are yours.** This extension owns no design system and generates
 * no palette — you hand it the custom properties your app publishes, it edits
 * them in place, and hands the edit back as CSS, a versioned recipe, a
 * design-tokens export, or a link.
 *
 * - **Kill switch.** Edits persist under
 *   `dtb:v1:<instanceId>:ext:<id>:overrides` and reapply on the next mount.
 *   `?dtb-theme=reset` drops them before any are applied, so a broken edit is
 *   always recoverable even if it makes the panel unreadable.
 * - **Exact reversal.** Edits are inline custom properties on the surface
 *   element. Prior values are recorded and restored, and an element with no
 *   original `style` attribute ends up with none — `setProperty` then
 *   `removeProperty` would otherwise leave a stray `style=""`.
 * - **Cannot restyle the toolbar.** `--dtb-*` and `--dev-toolbar*` are refused
 *   in code, never written regardless of what a consumer declares.
 *
 * Everything that leaves — panel, exports, share link, clipboard commands,
 * `/ext/diagnostics` — reads one snapshot redacted on the way *in*; there is
 * no unmasked path.
 *
 * Deliberately out of scope (per §14.4, stated in-panel next to the feature):
 * no palette generation from base/accent/contrast, no OKLCH delta model, no
 * Figma plugin — only the deterministic export half of that pipeline.
 */
import { createThemeEditorRuntime } from "./runtime";
import { writeClipboardTextOrThrow } from "../../runtime";
import { describeValueRefusal } from "./types";
import { ThemeChip, ThemePanel } from "./ui";
import { resolveStyleNonce } from "@nejcm/dev-toolbar/kit";
import type { ThemeEditorRuntimeOptions } from "./runtime";
import type {
  DevToolbarExtension,
  ExtensionRuntimeApi,
  ToolbarAlign,
  ToolbarCommand,
} from "../../core/contract";

export interface ThemeEditorOptions extends ThemeEditorRuntimeOptions {
  /** Extension id. Default `"theme-editor"`. */
  id?: string;
  /** Bar label, used by the error chip and the panel's accessible name. Default `"Theme"`. */
  label?: string;
  align?: ToolbarAlign;
  order?: number;
  /**
   * Overflow collapse order. Default `45` — below `/ext/flags` (60) and
   * `/ext/overlays` (50), above the metrics chips. Collapsing only costs
   * position: the `⋮` menu renders the same chip, and every action is also
   * a palette command.
   */
  priority?: number;
  hidden?: boolean;
  /** Keep the panel mounted after it closes, preserving the search and the export choice. Default `true`. */
  keepMounted?: boolean;
  /**
   * Inject this extension's stylesheet. Default `true`. Core's `injectStyles`
   * prop isn't visible to extensions, so if you disabled that, disable this
   * too and ship `THEME_EDITOR_CSS` yourself.
   *
   * Only affects the *panel's* styling — the custom properties the editor
   * writes onto your application are applied either way.
   */
  injectStyles?: boolean;
  /**
   * CSP nonce for this extension's stylesheet. Wins over the `styleNonce`
   * slot prop core forwards from `<DevToolbar>`.
   */
  styleNonce?: string;
}

/**
 * Builds the extension. Call it once — the returned object owns the store, the
 * edit map and, once started, the hold on the surface element.
 */
export function themeEditor(options: ThemeEditorOptions = {}): DevToolbarExtension {
  const {
    id = "theme-editor",
    label = "Theme",
    align = "start",
    order = 40,
    priority = 45,
    hidden,
    keepMounted = true,
    injectStyles = true,
    styleNonce: optionNonce,
  } = options;

  // Built here, not in start(api): slot functions run during the toolbar's
  // first render, before any effect fires.
  const runtime = createThemeEditorRuntime(options);

  // Refusals come back as thrown reasons rather than a coerced value, matching
  // the editor: `setOverride` returns why it refused and the panel keeps the
  // draft instead of writing something the author did not ask for.
  const setTokenCommand: ToolbarCommand<{ name: string; value?: string }> = {
    id: `${id}.setToken`,
    label: "Set a design token",
    description:
      "Overrides one design token by CSS custom-property name, in one call. Omit " +
      "`value` to clear that token's edit. Refuses a value the token's own type " +
      "rejects rather than coercing it.",
    group: "Theme",
    keywords: ["theme", "token", "set", "css", "variable", "colour", "color"],
    input: {
      fields: {
        name: {
          type: "string",
          required: true,
          description: "The custom property, e.g. `--dtb-accent`. Reserved prefixes are refused.",
        },
        value: {
          type: "string",
          description: "The CSS value, e.g. `#3b82f6`. Omit to clear the edit.",
        },
      },
    },
    run: (input) => {
      if (input === null || typeof input !== "object") {
        throw new Error("`theme-editor.setToken` takes `{ name, value? }`.");
      }
      const { name, value } = input;
      if (typeof name !== "string" || name === "") {
        throw new Error("`name` is required and must be a non-empty string.");
      }
      if (value === undefined) {
        runtime.clearOverride(name);
        return;
      }
      if (typeof value !== "string") {
        throw new Error("`value` must be a string — a CSS value is text.");
      }
      const refusal = runtime.setOverride(name, value);
      if (refusal !== null) {
        const type =
          runtime.store.peek().tokens.find((view) => view.name === name)?.type ?? "string";
        throw new Error(`"${name}" was not set: ${describeValueRefusal(refusal, type)}`);
      }
    },
  };

  const presetCommands = (): ToolbarCommand[] =>
    runtime.presets().map((preset) => ({
      id: `${id}.preset.${preset.name}`,
      label: `Apply theme preset: ${preset.name}`,
      group: "Theme",
      keywords: ["theme", "preset", "recipe", "tokens"],
      run: () => {
        runtime.applyPreset(preset.name);
      },
    }));

  return {
    id,
    label,
    contractVersion: 2,
    align,
    order,
    priority,
    keepMounted,
    ...(hidden === undefined ? {} : { hidden }),

    start(api: ExtensionRuntimeApi) {
      return runtime.start(api);
    },

    compact: ({ isOverflowed, isPanelOpen, togglePanel, styleNonce }) => (
      <ThemeChip
        runtime={runtime}
        label={label}
        isOverflowed={isOverflowed}
        isPanelOpen={isPanelOpen}
        injectStyles={injectStyles}
        styleNonce={resolveStyleNonce(optionNonce, styleNonce)}
        onToggle={togglePanel}
      />
    ),

    panel: ({ styleNonce }) => (
      <ThemePanel
        runtime={runtime}
        label={label}
        injectStyles={injectStyles}
        styleNonce={resolveStyleNonce(optionNonce, styleNonce)}
      />
    ),

    /** Redacted edit list for `/ext/diagnostics` — display strings, never raw token values. */
    diagnostics: () => runtime.diagnostics(),

    commands: () => [
      setTokenCommand,
      ...presetCommands(),
      {
        id: `${id}.reset`,
        label: "Reset every theme edit",
        group: "Theme",
        keywords: ["theme", "tokens", "revert", "restore", "design"],
        run: () => runtime.resetAll(),
      },
      {
        id: `${id}.togglePreview`,
        label: runtime.store.peek().preview
          ? "Pause the theme preview (show the app's own values)"
          : "Resume the theme preview",
        group: "Theme",
        keywords: ["theme", "before", "after", "compare", "preview"],
        run: () => runtime.togglePreview(),
      },
      {
        id: `${id}.copyCss`,
        label: "Copy theme edits as CSS variables",
        group: "Theme",
        keywords: ["theme", "css", "clipboard", "variables"],
        // Must throw on failure — the palette is this command's only feedback channel.
        run: async () => {
          await writeClipboardTextOrThrow(runtime.cssText());
        },
      },
      {
        id: `${id}.copyRecipe`,
        label: "Copy theme edits as a recipe (JSON)",
        group: "Theme",
        keywords: ["theme", "json", "recipe", "export", "figma"],
        run: async () => {
          await writeClipboardTextOrThrow(runtime.recipeText());
        },
      },
      {
        id: `${id}.copyFigma`,
        label: "Copy theme edits as design tokens (Figma)",
        group: "Theme",
        keywords: ["theme", "figma", "design tokens", "export"],
        run: async () => {
          await writeClipboardTextOrThrow(runtime.figmaText());
        },
      },
      {
        id: `${id}.copyLink`,
        label: "Copy a share link for this theme",
        group: "Theme",
        keywords: ["theme", "share", "link", "url", "recipe"],
        run: async () => {
          const link = runtime.shareLink();
          if (link === null) {
            throw new Error(
              "There is no page URL to build a share link from. Copy the recipe JSON instead.",
            );
          }
          await writeClipboardTextOrThrow(link);
        },
      },
      {
        id: `${id}.refresh`,
        label: "Re-read the design tokens",
        group: "Theme",
        keywords: ["theme", "reload", "refresh", "tokens"],
        run: () => runtime.refresh(),
      },
    ],
  };
}

export { THEME_EDITOR_CSS, ensureThemeEditorStyles } from "./css";
export {
  DEFAULT_THEME_PARAM,
  OVERRIDES_KEY,
  PREVIEW_KEY,
  SURFACE_KEY,
  createThemeEditorRuntime,
  parseOverrides,
  readStoredThemeOverrides,
  resetRequested,
  themeParamValue,
} from "./runtime";
export type {
  ThemeEditorRuntime,
  ThemeEditorRuntimeOptions,
  ThemeMode,
  ThemeModeAdapter,
} from "./runtime";
export {
  DEFAULT_SURFACE,
  MAX_VALUE_LENGTH,
  RECIPE_SCHEMA_VERSION,
  RESERVED_PREFIXES,
  checkTokenName,
  checkTokenValue,
  describeRefusal,
  describeValueRefusal,
  humanise,
  inferType,
  isHexColor,
  matchesQuery,
  parseRecipe,
  severityFor,
  toColorInputValue,
} from "./types";
export type {
  DesignTokenDefinition,
  RecipeParse,
  ThemeRecipe,
  ThemeSnapshot,
  ThemeSurface,
  TokenRefusal,
  TokenSeverity,
  TokenType,
  TokenView,
  TokensInput,
  ValueRefusal,
} from "./types";
