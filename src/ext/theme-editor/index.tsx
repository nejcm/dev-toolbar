/**
 * `@nejcm/dev-toolbar/ext/theme-editor`
 *
 * Live design-token editing, per `plans/dev-bar.md` §3H. Written strictly as a
 * consumer of the public extension contract: nothing here imports a *value*
 * from `src/core/*`, only types, which erase at build time.
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
 * **The tokens are yours.** This extension owns no design system, generates no
 * palette and reaches for no global — the same rule `/ext/environment` follows
 * for session context and `/ext/flags` for flags. You hand it the custom
 * properties your application publishes; it edits them where they live, shows
 * you the difference, and hands the edit back as CSS, as a versioned recipe, as
 * a design-tokens export or as a link.
 *
 * Three things follow from what it is:
 *
 * - **It mutates the application, so there is a kill switch.** Edits persist
 *   under `dtb:v1:<instanceId>:ext:<id>:overrides` and are re-applied on the
 *   next mount. Loading any page with `?dtb-theme=reset` drops them before any
 *   of them is applied, because the edit that makes the page unreadable is the
 *   one you cannot see the panel to remove.
 * - **It touches the host's CSS, so the reversal is exact.** Edits are inline
 *   custom properties on the surface element. What each property said before is
 *   recorded and restored, and an element that had no `style` attribute gets
 *   back to having none — `setProperty` then `removeProperty` leaves `style=""`
 *   behind, and a test compares the markup byte-for-byte.
 * - **It cannot restyle the toolbar.** `--dtb-*` and `--dev-toolbar*` are never
 *   written, whatever a consumer declares — a refusal in code, not a rule in a
 *   stylesheet, because §14.7's lesson is that a guard must not have to win a
 *   cascade argument. Restyling the bar is done from your own stylesheet
 *   (architecture §4.1) and needs nothing from here.
 *
 * Everything that leaves — the panel, three export formats, a share link, the
 * clipboard commands and the `/ext/diagnostics` contribution — reads one
 * snapshot that was redacted on the way *in*. There is no unmasked path.
 *
 * §3H lists more than this ships. What was left out, and what leaving it out
 * costs, is stated in the panel next to the thing itself, per §14.4: no palette
 * generation from base/accent/contrast, no OKLCH delta model, and no Figma
 * plugin — only the deterministic export half of that pipeline.
 */
import { createThemeEditorRuntime } from "./runtime";
import { writeClipboardTextOrThrow } from "../../runtime";
import { ThemeChip, ThemePanel } from "./ui";
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
   * `/ext/overlays` (50), above the metrics chips. Collapsing costs it its
   * position, never its capability: the `···` menu renders the same chip, and
   * every action is also a command the palette can run.
   */
  priority?: number;
  hidden?: boolean;
  /** Keep the panel mounted after it closes, preserving the search and the export choice. Default `true`. */
  keepMounted?: boolean;
  /**
   * Inject this extension's stylesheet. Default `true`. Core's own
   * `injectStyles` prop is not visible to extensions, so if you turned that off
   * turn this off too and ship `THEME_EDITOR_CSS` yourself.
   *
   * This switch is about the *panel's* styling. It has nothing to do with the
   * custom properties the editor writes onto your application, which are the
   * feature and are applied either way.
   */
  injectStyles?: boolean;
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
    ...runtimeOptions
  } = options;

  // Built here, not in start(api): slot functions run during the toolbar's
  // first render, which is before any effect fires.
  const runtime = createThemeEditorRuntime(runtimeOptions);

  /**
   * Enumerated on every aggregation pass, not once in the factory — the
   * function form of `commands` (§13.1).
   *
   * The reason is the same as `/ext/overlays`': the labels say what a run will
   * *do*, and "Pause the theme preview" over an already-paused preview is the
   * same class of lie as a badge that says *edited* over a page that never
   * heard about it. Presets are enumerated live too, because the consumer's
   * preset list is a getter they may fill in after mount.
   *
   * Pure and cheap, as the contract requires: it reads the snapshot the runtime
   * has already built and never re-reads the consumer's catalogue.
   *
   * `peek()`, not `getSnapshot()`: the store coalesces publishes at 4 Hz for
   * the chip's benefit, and "the edit is in the panel but not in the palette"
   * should not be a timing question. Same reasoning as `/ext/flags`.
   */
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
    contractVersion: 1,
    align,
    order,
    priority,
    keepMounted,
    ...(hidden === undefined ? {} : { hidden }),

    start(api: ExtensionRuntimeApi) {
      return runtime.start(api);
    },

    compact: ({ isOverflowed, isPanelOpen, togglePanel }) => (
      <ThemeChip
        runtime={runtime}
        label={label}
        isOverflowed={isOverflowed}
        isPanelOpen={isPanelOpen}
        injectStyles={injectStyles}
        onToggle={togglePanel}
      />
    ),

    panel: () => <ThemePanel runtime={runtime} label={label} injectStyles={injectStyles} />,

    /**
     * The redacted edit list, for `/ext/diagnostics` — display strings, never
     * raw token values, because a bug report is one more front door onto the
     * same data (§11.3, §15.1).
     */
    diagnostics: () => runtime.diagnostics(),

    commands: () => [
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
        // `/runtime`'s throwing writer: a palette reports a throw and closes
        // over a resolve, so a command whose only channel to the user is the
        // palette must throw when nothing reached the clipboard (§15.6).
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
