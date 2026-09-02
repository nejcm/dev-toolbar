/**
 * `@nejcm/dev-toolbar/ext/flags`
 *
 * Feature-flag controls, including a promoted flag pinned in the bar. Written
 * strictly as a consumer of the public extension contract: nothing here
 * imports a *value* from `src/core/*`, only types, which erase at build time.
 *
 * **Flags are yours.** This extension owns no flag store, integrates no
 * provider and reaches for no global — same rule `/ext/environment` follows.
 * You hand it what your application resolved and, optionally, a typed adapter
 * it calls when somebody asks for a local override.
 *
 * ```tsx
 * import { flags } from "@nejcm/dev-toolbar/ext/flags";
 *
 * // Build it ONCE, outside render.
 * const extensions = [
 *   flags({
 *     flags: () =>
 *       catalogue.map((definition) => ({
 *         ...definition,
 *         value: base[definition.key],   // BEFORE local overrides
 *         source: "server-rule",
 *       })),
 *     onOverride: (key, value) => {
 *       // `value === undefined` means "no local override any more".
 *       if (value === undefined) overrideStore.clear(key);
 *       else overrideStore.set(key, value);
 *     },
 *     promoted: { flagKey: "ui-facelift", label: "UI Facelift 2026" },
 *   }),
 * ];
 * ```
 *
 * Omit `onOverride` and the panel is read-only — it lists, searches and copies
 * and changes nothing. That's the honest degradation, not a reason to invent
 * a store.
 *
 * This is the first extension that **mutates the application** rather than
 * observing it, which is why:
 *
 * - **Overrides outlive the tab.** Persisted under
 *   `dtb:v1:<instanceId>:ext:<id>:overrides` and re-applied through your
 *   adapter on the next mount. The app boots with its own values first; call
 *   `readStoredOverrides()` before you render if you need them earlier.
 * - **There is a kill switch.** `?dtb-flags=reset` drops every stored override
 *   before it's applied — the override that breaks the app is the one you
 *   can't reach the panel to remove.
 * - **An override is never quiet.** The bar counts them, every overridden row
 *   is marked, and the app's own value stays on screen next to the override.
 *
 * Flag keys and values reach a clipboard, so every value goes through
 * `redact()` once on the way in. The panel and the copy commands read the
 * same redacted snapshot; there's no unmasked path.
 */
import {
  createFlagsRuntime,
  DEFAULT_RESET_PARAM,
  OVERRIDES_KEY,
  parseOverrides,
  resetRequested,
} from "./runtime";
import { writeClipboardTextOrThrow } from "../../runtime";
import { FlagsChip, FlagsPanel } from "./ui";
import type { FlagsRuntimeOptions } from "./runtime";
import type { FlagValue } from "./types";
import type {
  DevToolbarExtension,
  ExtensionRuntimeApi,
  ToolbarAlign,
  ToolbarCommand,
  ToolbarStorage,
} from "../../core/contract";

export interface FlagsOptions extends Pick<
  FlagsRuntimeOptions,
  | "flags"
  | "onOverride"
  | "pollMs"
  | "promoted"
  | "audience"
  | "redactOptions"
  | "resetParam"
  | "now"
> {
  /** Extension id. Default `"flags"`. */
  id?: string;
  /** Bar label, used by the error chip and the panel's accessible name. Default `"Flags"`. */
  label?: string;
  align?: ToolbarAlign;
  order?: number;
  /**
   * Overflow collapse order. Default `60` — higher than the metrics chips, so
   * a promoted flag survives a narrowing window longer than a memory readout.
   */
  priority?: number;
  hidden?: boolean;
  /** Keep the panel mounted after it closes, preserving the search box. Default `true`. */
  keepMounted?: boolean;
  /**
   * Inject this extension's stylesheet. Default `true`. Core's own
   * `injectStyles` prop is not visible to extensions, so if you turned that off
   * turn this off too and ship `FLAGS_CSS` yourself.
   */
  injectStyles?: boolean;
}

/**
 * Builds the extension. Call it once — the returned object owns the store,
 * the override map and, once started, the timer.
 */
export function flags(options: FlagsOptions = {}): DevToolbarExtension {
  const {
    id = "flags",
    label = "Flags",
    align = "start",
    order = 0,
    priority = 60,
    hidden,
    keepMounted = true,
    injectStyles = true,
    ...runtimeOptions
  } = options;

  // Built here, not in start(api): slot functions run during the toolbar's
  // first render, which is before any effect fires.
  const runtime = createFlagsRuntime(runtimeOptions);

  /**
   * Rebuilt on every aggregation pass (the function form of `commands`) so a
   * flag the catalogue grows after mount gets a toggle command immediately.
   * Command identity is the `id`, so rebuilding costs nothing — `run` looks
   * the flag up live either way.
   *
   * Uses `peek()`, not `getSnapshot()`: the store coalesces publishes at 4 Hz
   * for the chip, and a lagging command list would make "the flag is in the
   * panel but not the palette" a timing question.
   *
   * Orphans get a row so they can be cleared, but no toggle command — offering
   * to turn on a flag the application doesn't have has no place in a palette.
   */
  const perFlagCommands = (): ToolbarCommand[] =>
    runtime.store
      .peek()
      .flags.filter((view) => view.type === "boolean" && !view.orphaned)
      .map((view) => ({
        id: `${id}.toggle.${view.key}`,
        label: `Toggle flag: ${view.label}`,
        group: "Flags",
        keywords: ["flag", "override", view.key],
        run: () => runtime.toggle(view.key),
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

    compact: ({ isOverflowed, isPanelOpen, togglePanel, openPanel }) => (
      <FlagsChip
        runtime={runtime}
        label={label}
        isOverflowed={isOverflowed}
        isPanelOpen={isPanelOpen}
        injectStyles={injectStyles}
        onToggle={togglePanel}
        onOpen={openPanel}
      />
    ),

    /** The redacted override list, for `/ext/diagnostics`. Display strings only, never raw values. */
    diagnostics: () => runtime.diagnostics(),

    panel: () => <FlagsPanel runtime={runtime} label={label} injectStyles={injectStyles} />,

    commands: () => [
      ...perFlagCommands(),
      {
        id: `${id}.clearOverrides`,
        label: "Clear all local flag overrides",
        group: "Flags",
        keywords: ["reset", "revert", "override"],
        run: () => runtime.clearAll(),
      },
      {
        id: `${id}.copyRecipe`,
        label: "Copy flag override recipe",
        group: "Flags",
        keywords: ["clipboard", "share", "override"],
        // Same redacted snapshot the panel renders — a command must not be a
        // way around the UI's masks. `writeClipboardTextOrThrow` throws on
        // failure so the palette can report it.
        run: async () => {
          await writeClipboardTextOrThrow(runtime.recipeText());
        },
      },
      {
        id: `${id}.copyJson`,
        label: "Copy flag overrides as JSON",
        group: "Flags",
        keywords: ["diagnostics", "json", "override"],
        run: async () => {
          await writeClipboardTextOrThrow(JSON.stringify(runtime.diagnostics(), null, 2));
        },
      },
      {
        id: `${id}.refresh`,
        label: "Re-read feature flags",
        group: "Flags",
        keywords: ["reload", "refresh"],
        run: () => runtime.refresh(),
      },
    ],
  };
}

export interface ReadStoredOverridesOptions {
  /** The `instanceId` you pass to `<DevToolbar>`. Default `"default"`. */
  instanceId?: string;
  /** The extension id you passed to `flags()`. Default `"flags"`. */
  id?: string;
  /** Storage to read. Default `localStorage`. */
  storage?: ToolbarStorage;
  /** Reset query parameter, matching what you passed to `flags()`. `null` disables it. */
  resetParam?: string | null;
}

/**
 * Reads the persisted override map **without mounting anything**.
 *
 * On a reload the app boots with its own flag values, and the toolbar only
 * re-applies overrides once `start()` runs in an effect — everything rendered
 * before that is unoverridden. Call this at the top of your entry point and
 * seed your own override store from it so first paint agrees with the panel.
 *
 * Honours `?dtb-flags=reset`, same as `start()`.
 */
export function readStoredOverrides(
  options: ReadStoredOverridesOptions = {},
): Record<string, FlagValue> {
  const {
    instanceId = "default",
    id = "flags",
    storage,
    resetParam = DEFAULT_RESET_PARAM,
  } = options;
  if (resetRequested(resetParam)) return {};
  const key = `dtb:v1:${instanceId}:ext:${id}:${OVERRIDES_KEY}`;
  try {
    const source = storage ?? (typeof localStorage === "undefined" ? null : localStorage);
    if (source === null) return {};
    // A spread copy, not the internal null-prototype map: handing that across
    // a public API means `.hasOwnProperty()` on the result would throw.
    return { ...parseOverrides(source.getItem(key)) };
  } catch {
    return {};
  }
}

export { FLAGS_CSS, ensureFlagsStyles } from "./css";
export {
  createFlagsRuntime,
  DEFAULT_RESET_PARAM,
  OVERRIDES_KEY,
  parseOverrides,
  resetRequested,
} from "./runtime";
export type { FlagsRuntime, FlagsRuntimeOptions } from "./runtime";
export { formatValue, inferType, matchesQuery, parseValue, severityFor } from "./types";
export type {
  FeatureFlagDefinition,
  FlagReading,
  FlagSeverity,
  FlagSource,
  FlagType,
  FlagValue,
  FlagView,
  FlagsInput,
  FlagsSnapshot,
  PromotedFlag,
  ReloadBehavior,
} from "./types";
